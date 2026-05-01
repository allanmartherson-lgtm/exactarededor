import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- CNPJ/CPF helpers (cópia local — edge não compartilha src/) ----
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");
const formatCNPJ = (raw: string) => {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length !== 14) return raw ?? "";
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
};
const formatCPF = (raw: string) => {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length !== 11) return raw ?? "";
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
};
const isValidCNPJ = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((a, c, i) => a + Number(c) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  return calc(d.slice(0,12), w1) === Number(d[12]) && calc(d.slice(0,13), w2) === Number(d[13]);
};
const isValidCPF = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
};
const formatDoc = (raw: string | null | undefined) => {
  const d = onlyDigits(raw ?? "");
  if (d.length === 14) return formatCNPJ(d);
  if (d.length === 11) return formatCPF(d);
  return raw ?? "—";
};
const validateDoc = (raw: string | null | undefined): { kind: "cnpj" | "cpf" | "indefinido"; valid: boolean } => {
  const d = onlyDigits(raw ?? "");
  if (d.length === 14) return { kind: "cnpj", valid: isValidCNPJ(d) };
  if (d.length === 11) return { kind: "cpf", valid: isValidCPF(d) };
  return { kind: "indefinido", valid: false };
};

const fmtMoney = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const payment_id = body?.payment_id as string | undefined;
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: payment } = await supabase.from("payments").select("*").eq("id", payment_id).single();
    const { data: items } = await supabase.from("payment_items").select("*").eq("payment_id", payment_id);
    if (!payment || !items) throw new Error("Pagamento não encontrado");

    // ---- Pré-validação: bloquear se houver CNPJ inválido em qualquer item/empresa vinculada ----
    const invalid: Array<{ item_id: string; doctor_name: string; document: string | null; company_name: string | null; reason: string }> = [];
    const companyIds = Array.from(new Set(items.map((i: any) => i.company_id).filter(Boolean)));
    let companyMap = new Map<string, { name: string; document: string | null }>();
    if (companyIds.length) {
      const { data: comps } = await supabase.from("companies").select("id,name,document").in("id", companyIds);
      (comps ?? []).forEach((c: any) => companyMap.set(c.id, { name: c.name, document: c.document }));
    }

    for (const it of items as any[]) {
      // Empresa vinculada precisa ter CNPJ válido (quando houver vínculo)
      if (it.company_id) {
        const c = companyMap.get(it.company_id);
        if (c?.document && !isValidCNPJ(c.document)) {
          invalid.push({
            item_id: it.id, doctor_name: it.doctor_name, document: c.document,
            company_name: c.name, reason: `CNPJ da empresa "${c.name}" é inválido.`,
          });
        }
      }
      // Documento avulso registrado no item (company_document como CNPJ)
      const itemCnpjDigits = onlyDigits(it.company_document ?? "");
      if (itemCnpjDigits.length === 14 && !isValidCNPJ(itemCnpjDigits)) {
        invalid.push({
          item_id: it.id, doctor_name: it.doctor_name, document: it.company_document,
          company_name: it.company_name, reason: "CNPJ informado no item é inválido.",
        });
      }
    }

    if (invalid.length > 0) {
      return new Response(JSON.stringify({
        error: "cnpj_invalido",
        message: `Envio bloqueado: ${invalid.length} item(ns) com CNPJ inválido.`,
        invalid,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Agrupa por destinatário (e-mail do médico) ----
    type Bucket = { total: number; items: any[] };
    const byEmail = new Map<string, Bucket>();
    for (const it of items as any[]) {
      const email = (it.doctor_email ?? "").trim().toLowerCase();
      if (!email) continue;
      const cur = byEmail.get(email) ?? { total: 0, items: [] };
      cur.total += Number(it.gross_amount ?? 0);
      cur.items.push(it);
      byEmail.set(email, cur);
    }

    if (byEmail.size === 0) {
      return new Response(JSON.stringify({ error: "Nenhum item com e-mail do médico." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = req.headers.get("origin") ?? Deno.env.get("PUBLIC_APP_URL") ?? "";
    const created: string[] = [];
    const summaries: any[] = [];

    for (const [email, info] of byEmail) {
      const { data: invoice } = await supabase.from("invoices").insert({
        payment_id,
        expected_amount: info.total,
        recipient_email: email,
        status: "aguardando",
        sent_at: new Date().toISOString(),
      }).select().single();
      if (!invoice) continue;
      created.push(invoice.id);

      const uploadUrl = `${baseUrl}/portal/nota/${invoice.upload_token}`;
      const docName = info.items[0].doctor_name;

      // Resumo validado por destinatário
      const itemSummaries = info.items.map((it: any) => {
        const company = it.company_id ? companyMap.get(it.company_id) : null;
        const cnpjRaw = company?.document ?? it.company_document ?? null;
        const v = validateDoc(cnpjRaw);
        return {
          description: it.description ?? it.procedure_name ?? "Serviço",
          gross_amount: Number(it.gross_amount ?? 0),
          gross_amount_formatted: fmtMoney(Number(it.gross_amount ?? 0)),
          company_name: company?.name ?? it.company_name ?? null,
          document_raw: cnpjRaw,
          document_formatted: cnpjRaw ? formatDoc(cnpjRaw) : "—",
          document_kind: v.kind,
          document_valid: v.valid,
          procedure_date: it.procedure_date ?? null,
        };
      });

      const summary = {
        invoice_id: invoice.id,
        recipient_email: email,
        doctor_name: docName,
        reference: payment.reference,
        total_amount: info.total,
        total_amount_formatted: fmtMoney(info.total),
        items_count: info.items.length,
        all_documents_valid: itemSummaries.every((s) => s.document_valid || s.document_kind === "indefinido"),
        items: itemSummaries,
        upload_url: uploadUrl,
      };
      summaries.push(summary);

      // Render simples em texto + html (consumido pelo provedor de e-mail)
      const itemsList = itemSummaries.map((s) =>
        `- ${s.description} · ${s.gross_amount_formatted}` +
        (s.company_name ? ` · ${s.company_name}` : "") +
        (s.document_raw ? ` · ${s.document_kind.toUpperCase()} ${s.document_formatted} ${s.document_valid ? "✓" : "⚠"}` : "")
      ).join("\n");

      try {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "invoice-request",
            recipientEmail: email,
            idempotencyKey: `inv-${invoice.id}`,
            templateData: {
              doctorName: docName,
              reference: payment.reference,
              totalAmount: summary.total_amount_formatted,
              uploadUrl,
              itemsList,
              summary, // resumo estruturado completo
            },
          },
        });
      } catch (e) {
        console.warn("[send-invoice-request] provedor de e-mail não configurado:", e);
      }
    }

    await supabase.from("payments").update({ status: "pedido_nf_enviado" }).eq("id", payment_id);
    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "sistema",
      message: `${created.length} pedido(s) de NF enviado(s). Todos os CNPJs validados.`,
      status_to: "pedido_nf_enviado",
    });

    return new Response(JSON.stringify({
      ok: true,
      invoices_created: created.length,
      summaries,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[send-invoice-request] erro:", msg);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
