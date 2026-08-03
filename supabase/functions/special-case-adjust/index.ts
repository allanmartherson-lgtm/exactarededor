// Cria ajuste retroativo formal (company_financial_adjustments) a partir de
// marcações de caso especial APROVADAS sobre um pagamento já FECHADO.
//
// Princípio: pagamento fechado é IMUTÁVEL. Não recalcula payment_items, não
// dispara analyze-payment — gera um ajuste paralelo amarrado às marcas. Isto
// preserva o snapshot de fechamento (regra core do projeto: redução de cálculo
// nunca silenciosa) e segue o padrão de generate-retroactive-adjustment.
//
// Fluxo:
//   1) preview=true → calcula totais por empresa (delta declarado pelo
//      gestor) e retorna sem persistir. Banner mostra para confirmação.
//   2) preview=false → exige role admin/diretor/gestao_medica; se valor
//      negativo (dedução) exige `allow_reduction:true` (gate equivalente ao
//      _allow_calc_reduction da RPC de regras). Cria
//      company_financial_adjustments, vincula special_case_marks via
//      retro_adjustment_id e grava audit_log com snapshot completo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type, prefer, x-active-hospital",
};

const ItemSchema = z.object({
  company_id: z.string().uuid(),
  valor: z.number(),                 // pode ser negativo (dedução) ou positivo (complemento)
  descricao: z.string().min(1).max(255),
});

const BodySchema = z.object({
  payment_id: z.string().uuid(),
  items: z.array(ItemSchema).min(1),
  mark_ids: z.array(z.string().uuid()).min(1),
  preview: z.boolean().default(false),
  allow_reduction: z.boolean().default(false),
});

const CLOSED = new Set(["pago", "fechado", "concluido", "aprovado_diretor", "aprovado"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: functionCorsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Permissão: apenas decisores podem materializar ajuste retroativo. Analista
    // pode invocar preview, mas não persistir — espelha decide-special-case.
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const canDecide = roleSet.has("admin") || roleSet.has("diretor") || roleSet.has("gestao_medica");
    if (!body.preview && !canDecide) {
      return new Response(JSON.stringify({ error: "forbidden_role" }), {
        status: 403, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pagamento precisa estar fechado — adjust retroativo só faz sentido aqui.
    const { data: payment } = await admin
      .from("payments")
      .select("id, hospital_id, status")
      .eq("id", body.payment_id).maybeSingle();
    if (!payment) {
      return new Response(JSON.stringify({ error: "payment_not_found" }), {
        status: 404, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    // Gate de hospital: ajuste financeiro só no hospital do chamador.
    if (!assertCallerHospital(_auth, (payment as { hospital_id?: string }).hospital_id ?? "")) {
      return new Response(JSON.stringify({ error: "hospital_scope_denied", message: "Sem acesso a este hospital." }), {
        status: 403, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!CLOSED.has(payment.status)) {
      return new Response(JSON.stringify({ error: "payment_not_closed", status: payment.status }), {
        status: 409, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega marcas — devem estar approved e pertencer a este pagamento.
    const { data: marks } = await admin
      .from("special_case_marks")
      .select("id, status, payment_id, retro_adjustment_id")
      .in("id", body.mark_ids);
    const invalid = (marks ?? []).filter(
      (m: any) => m.payment_id !== body.payment_id || m.status !== "approved",
    );
    if ((marks?.length ?? 0) !== body.mark_ids.length || invalid.length > 0) {
      return new Response(JSON.stringify({ error: "marks_invalid", invalid }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    const alreadyApplied = (marks ?? []).filter((m: any) => m.retro_adjustment_id);
    if (alreadyApplied.length > 0 && !body.preview) {
      return new Response(JSON.stringify({
        error: "marks_already_applied",
        ids: alreadyApplied.map((m: any) => m.id),
      }), { status: 409, headers: { ...functionCorsHeaders, "Content-Type": "application/json" } });
    }

    // Agrupa por empresa (várias marcas podem mapear pra mesma PJ).
    const byCompany = new Map<string, { valor: number; descs: string[] }>();
    for (const it of body.items) {
      const cur = byCompany.get(it.company_id) ?? { valor: 0, descs: [] };
      cur.valor += it.valor;
      cur.descs.push(it.descricao);
      byCompany.set(it.company_id, cur);
    }

    const summary = Array.from(byCompany.entries()).map(([company_id, v]) => ({
      company_id,
      valor: Math.round(v.valor * 100) / 100,
      tipo: v.valor >= 0 ? "complemento_retroativo" : "deducao_retroativa",
    }));
    const totalReducao = summary.filter((s) => s.valor < 0).reduce((a, b) => a + b.valor, 0);

    // GATE de redução: dedução retroativa só passa com confirmação explícita.
    // Equivale ao _allow_calc_reduction da governança de regras.
    if (totalReducao < 0 && !body.allow_reduction && !body.preview) {
      return new Response(JSON.stringify({
        error: "reduction_requires_confirmation",
        total_reduction: totalReducao,
        summary,
      }), { status: 409, headers: { ...functionCorsHeaders, "Content-Type": "application/json" } });
    }

    if (body.preview) {
      return new Response(JSON.stringify({ ok: true, preview: true, summary }), {
        headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persiste — um ajuste por empresa.
    const createdIds: string[] = [];
    for (const [company_id, agg] of byCompany.entries()) {
      const tipo = agg.valor >= 0 ? "complemento_retroativo" : "deducao_retroativa";
      const valor = Math.abs(Math.round(agg.valor * 100) / 100);
      if (valor === 0) continue;
      const desc = `Caso especial — ${agg.descs.join(" | ")}`.slice(0, 255);
      const { data: adj, error: adjErr } = await admin
        .from("company_financial_adjustments")
        .insert({
          company_id,
          tipo,
          descricao: desc,
          valor_total: valor,
          parcelas_total: 1,
          parcelas_pagas: 0,
          data_inicio: new Date().toISOString().slice(0, 10),
          ativo: true,
          origem: `special_case:${body.payment_id}`,
          hospital_id: payment.hospital_id,
        })
        .select("id")
        .single();
      if (adjErr) {
        return new Response(JSON.stringify({ error: adjErr.message, created_so_far: createdIds }), {
          status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
        });
      }
      createdIds.push(adj.id);

      // Vincula marcas desta empresa ao ajuste. Como uma marca pode cobrir
      // mais de uma empresa, vinculamos pela primeira ocorrência (registro
      // de origem). O audit_log abaixo guarda o mapeamento completo.
      await admin
        .from("special_case_marks")
        .update({
          retro_adjustment_id: adj.id,
          retro_applied_at: new Date().toISOString(),
          retro_applied_by: user.id,
        })
        .in("id", body.mark_ids)
        .is("retro_adjustment_id", null);
    }

    // Snapshot de auditoria — fonte da verdade para reconstrução.
    await admin.from("audit_log").insert({
      user_id: user.id,
      action: "special_case_retro_adjust",
      entity_type: "payments",
      entity_id: body.payment_id,
      metadata: {
        payment_id: body.payment_id,
        mark_ids: body.mark_ids,
        adjustments: createdIds,
        summary,
        total_reduction: totalReducao,
        allow_reduction: body.allow_reduction,
      },
    });

    return new Response(JSON.stringify({ ok: true, adjustments: createdIds, summary }), {
      headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("special-case-adjust error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  }
});
