/**
 * send-invoice-request — Cria/atualiza invoices do pagamento e dispara
 * o e-mail de pedido de Nota Fiscal para empresa (TO) + médico em CC.
 *
 * Modos:
 *  - lote   (body: { payment_id })  → processa todos os buckets do pagamento
 *  - único  (body: { invoice_id })  → reenvia somente a invoice indicada
 *
 * Pré-validações (retornam 422 sem enviar nada):
 *  - CNPJ inválido  → { error: "cnpj_invalido", invalid: [...] }
 *  - Empresa sem e-mail de NF → { error: "empresa_sem_email", missing_company_emails: [...] }
 *
 * Toda a formatação textual (saudação, competência, dinheiro), validação de
 * CNPJ/CPF e geração do template do e-mail vivem em módulos irmãos
 * (`docs.ts`, `text.ts`, `templates.ts`).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { isValidCNPJ, onlyDigits, formatDoc, validateDoc } from "./docs.ts";
import { fmtMoney } from "./text.ts";
import { buildEmail } from "./templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---- Tipos locais (subset dos rows do banco usados aqui) ----
type Item = {
  id: string;
  payment_id: string;
  doctor_name: string;
  doctor_email: string | null;
  description: string | null;
  procedure_name: string | null;
  procedure_date: string | null;
  gross_amount: number | null;
  company_id: string | null;
  company_name: string | null;
  company_document: string | null;
};
type CompanyInfo = { name: string; document: string | null; invoice_emails: string[] };
type CompanyBucket = {
  company_id: string;
  company_name: string;
  to: string[];
  cc: Set<string>;
  total: number;
  items: Item[];
};
type DoctorBucket = { doctor_email: string; total: number; items: Item[] };
type InvoiceRow = {
  id: string;
  upload_token: string;
  company_id: string | null;
  recipient_email: string | null;
  payment_id: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const payment_id = body?.payment_id as string | undefined;
    const invoice_id = body?.invoice_id as string | undefined;
    const recipient_email = body?.recipient_email as string | undefined;
    if (!payment_id && !invoice_id) {
      return json({ error: "payment_id ou invoice_id obrigatório" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Resolução do modo (lote x reenvio individual) ----
    let resolvedPaymentId = payment_id ?? null;
    let targetInvoice: InvoiceRow | null = null;
    if (invoice_id) {
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoice_id).single();
      if (!inv) return json({ error: "invoice_id não encontrado" }, 404);
      targetInvoice = inv as InvoiceRow;
      resolvedPaymentId = inv.payment_id;
    }

    const { data: payment } = await supabase.from("payments").select("*").eq("id", resolvedPaymentId).single();
    const { data: itemsRaw } = await supabase.from("payment_items").select("*").eq("payment_id", resolvedPaymentId);
    if (!payment || !itemsRaw) throw new Error("Pagamento não encontrado");
    const items = itemsRaw as Item[];

    // ---- Pré-validação: CNPJ + carrega lista de e-mails das empresas ----
    const invalid: Array<{ item_id: string; doctor_name: string; document: string | null; company_name: string | null; reason: string }> = [];
    const companyIds = Array.from(new Set(items.map((i) => i.company_id).filter(Boolean))) as string[];
    const companyMap = new Map<string, CompanyInfo>();
    if (companyIds.length) {
      const { data: comps } = await supabase
        .from("companies")
        .select("id,name,document,invoice_emails")
        .in("id", companyIds);
      (comps ?? []).forEach((c: { id: string; name: string; document: string | null; invoice_emails: string[] | null }) =>
        companyMap.set(c.id, {
          name: c.name,
          document: c.document,
          invoice_emails: Array.isArray(c.invoice_emails) ? c.invoice_emails : [],
        }),
      );
    }

    for (const it of items) {
      if (it.company_id) {
        const c = companyMap.get(it.company_id);
        if (c?.document && !isValidCNPJ(c.document)) {
          invalid.push({
            item_id: it.id, doctor_name: it.doctor_name, document: c.document,
            company_name: c.name, reason: `CNPJ da empresa "${c.name}" é inválido.`,
          });
        }
      }
      const itemCnpjDigits = onlyDigits(it.company_document ?? "");
      if (itemCnpjDigits.length === 14 && !isValidCNPJ(itemCnpjDigits)) {
        invalid.push({
          item_id: it.id, doctor_name: it.doctor_name, document: it.company_document,
          company_name: it.company_name, reason: "CNPJ informado no item é inválido.",
        });
      }
    }

    if (invalid.length > 0) {
      return json({
        error: "cnpj_invalido",
        message: `Envio bloqueado: ${invalid.length} item(ns) com CNPJ inválido.`,
        invalid,
      }, 422);
    }

    // ---- Agrupamento por EMPRESA (com fallback por médico para itens sem empresa) ----
    const byCompany = new Map<string, CompanyBucket>();
    const byDoctorFallback = new Map<string, DoctorBucket>();
    const missingCompanyEmails: Array<{ company_id: string; company_name: string }> = [];

    for (const it of items) {
      const docEmail = (it.doctor_email ?? "").trim().toLowerCase();
      if (it.company_id && companyMap.has(it.company_id)) {
        const c = companyMap.get(it.company_id)!;
        if (!c.invoice_emails.length) {
          if (!missingCompanyEmails.find((m) => m.company_id === it.company_id)) {
            missingCompanyEmails.push({ company_id: it.company_id!, company_name: c.name });
          }
          continue;
        }
        const cur = byCompany.get(it.company_id) ?? {
          company_id: it.company_id,
          company_name: c.name,
          to: c.invoice_emails,
          cc: new Set<string>(),
          total: 0,
          items: [] as Item[],
        };
        cur.total += Number(it.gross_amount ?? 0);
        cur.items.push(it);
        if (docEmail) cur.cc.add(docEmail);
        byCompany.set(it.company_id, cur);
      } else {
        if (!docEmail) continue;
        const cur = byDoctorFallback.get(docEmail) ?? {
          doctor_email: docEmail,
          total: 0,
          items: [] as Item[],
        };
        cur.total += Number(it.gross_amount ?? 0);
        cur.items.push(it);
        byDoctorFallback.set(docEmail, cur);
      }
    }

    if (missingCompanyEmails.length > 0) {
      return json({
        error: "empresa_sem_email",
        message: `Envio bloqueado: ${missingCompanyEmails.length} empresa(s) sem e-mail de NF cadastrado. Cadastre em Empresas → editar → "E-mails para pedido de NF".`,
        missing_company_emails: missingCompanyEmails,
      }, 422);
    }

    if (byCompany.size === 0 && byDoctorFallback.size === 0) {
      return json({ error: "Nenhum destinatário válido (sem empresa com e-mail e sem e-mail de médico)." }, 400);
    }

    const baseUrl = req.headers.get("origin") ?? Deno.env.get("PUBLIC_APP_URL") ?? "";
    const created: string[] = [];
    let sentOk = 0;
    let sentErr = 0;
    const sendErrors: string[] = [];
    const summaries: Record<string, unknown>[] = [];

    // Reaproveita invoices existentes para evitar duplicação no reenvio em lote
    const { data: existingForPayment } = await supabase
      .from("invoices")
      .select("id, company_id, recipient_email, upload_token")
      .eq("payment_id", resolvedPaymentId);
    const existingByCompany = new Map<string, InvoiceRow>();
    const existingByEmail = new Map<string, InvoiceRow>();
    (existingForPayment ?? []).forEach((inv: InvoiceRow) => {
      if (inv.company_id) existingByCompany.set(inv.company_id, inv);
      if (inv.recipient_email) existingByEmail.set(String(inv.recipient_email).toLowerCase(), inv);
    });

    const processBucket = async (opts: {
      to: string[];
      cc: string[];
      total: number;
      items: Item[];
      company_id: string | null;
      company_name: string | null;
      recipient_label: string;
      reuse_invoice?: InvoiceRow | null;
      override_to?: string[];
    }) => {
      const to = opts.override_to ?? opts.to;
      // Reusa invoice existente (por id passado, por company_id, ou por recipient_email)
      let invoice: InvoiceRow | null = opts.reuse_invoice ?? null;
      if (!invoice && opts.company_id && existingByCompany.has(opts.company_id)) {
        invoice = existingByCompany.get(opts.company_id) ?? null;
      }
      if (!invoice && to[0]) {
        const k = to[0].toLowerCase();
        if (existingByEmail.has(k)) invoice = existingByEmail.get(k) ?? null;
      }
      if (invoice) {
        await supabase.from("invoices").update({
          expected_amount: opts.total,
          recipient_email: to[0],
          recipient_cc: opts.cc,
          items_count: opts.items.length,
          company_id: opts.company_id,
          company_name: opts.company_name,
          send_error: null,
        }).eq("id", invoice.id);
      } else {
        const { data: inserted } = await supabase.from("invoices").insert({
          payment_id: resolvedPaymentId,
          expected_amount: opts.total,
          recipient_email: opts.to[0],
          recipient_cc: opts.cc,
          items_count: opts.items.length,
          status: "aguardando",
          company_id: opts.company_id,
          company_name: opts.company_name,
        }).select().single();
        invoice = inserted as InvoiceRow;
        if (!invoice) return;
        created.push(invoice.id);
      }

      const uploadUrl = `${baseUrl}/portal/nota/${invoice.upload_token}`;

      const itemSummaries = opts.items.map((it) => {
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
          doctor_name: it.doctor_name,
        };
      });

      const totalFormatted = fmtMoney(opts.total);

      // Gera assunto + corpo via template module
      const { subject: emailSubject, body: requestMessage } = buildEmail({
        recipient_label: opts.recipient_label,
        total_amount_formatted: totalFormatted,
        upload_url: uploadUrl,
        payment_due_date: payment.payment_due_date ?? null,
        competence:
          Array.isArray(payment.competence_months) && payment.competence_months.length
            ? payment.competence_months
            : payment.competence_month,
        sectors: payment.sectors ?? [],
        specialties: payment.specialties ?? [],
      });

      const summary: Record<string, unknown> = {
        invoice_id: invoice.id,
        recipient_to: opts.to,
        recipient_cc: opts.cc,
        recipient_label: opts.recipient_label,
        reference: payment.reference,
        total_amount: opts.total,
        total_amount_formatted: totalFormatted,
        items_count: opts.items.length,
        all_documents_valid: itemSummaries.every((s) => s.document_valid || s.document_kind === "indefinido"),
        items: itemSummaries,
        upload_url: uploadUrl,
        email_subject: emailSubject,
        request_message: requestMessage,
      };
      summaries.push(summary);

      const itemsList = itemSummaries.map((s) =>
        `- ${s.description} · ${s.gross_amount_formatted}` +
        (s.company_name ? ` · ${s.company_name}` : "") +
        (s.doctor_name ? ` · Dr(a) ${s.doctor_name}` : "") +
        (s.document_raw ? ` · ${s.document_kind.toUpperCase()} ${s.document_formatted} ${s.document_valid ? "✓" : "⚠"}` : "")
      ).join("\n");

      await supabase.from("invoices").update({ request_message: requestMessage }).eq("id", invoice.id);

      console.log("[send-invoice-request] PEDIDO DE NF", {
        invoice_id: invoice.id,
        to: opts.to,
        cc: opts.cc,
        recipient_label: opts.recipient_label,
        total: totalFormatted,
        upload_url: uploadUrl,
        items_count: opts.items.length,
      });

      try {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "invoice-request",
            recipientEmail: opts.to[0],
            cc: [...opts.to.slice(1), ...opts.cc],
            idempotencyKey: `inv-${invoice.id}-${Date.now()}`,
            subject: emailSubject,
            templateData: {
              recipientLabel: opts.recipient_label,
              reference: payment.reference,
              totalAmount: totalFormatted,
              uploadUrl,
              itemsList,
              requestMessage,
              subject: emailSubject,
              summary,
            },
          },
        });
        await supabase.from("invoices").update({
          sent_at: new Date().toISOString(),
          send_error: null,
        }).eq("id", invoice.id);
        sentOk++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[send-invoice-request] falha ao despachar e-mail:", msg);
        await supabase.from("invoices").update({ send_error: msg.slice(0, 500) }).eq("id", invoice.id);
        sentErr++;
        sendErrors.push(`${opts.recipient_label}: ${msg}`);
      }
    };

    // ---- Modo reenvio individual: processa SOMENTE o bucket da invoice alvo ----
    if (targetInvoice) {
      let bucket: CompanyBucket | undefined;
      if (targetInvoice.company_id) bucket = byCompany.get(targetInvoice.company_id);
      let doctorBucket: DoctorBucket | undefined;
      if (!bucket) {
        const k = String(targetInvoice.recipient_email ?? "").toLowerCase();
        doctorBucket = byDoctorFallback.get(k);
      }
      if (!bucket && !doctorBucket) {
        return json({
          error: "sem_itens",
          message: "Não há itens elegíveis para reenviar esta NF (a empresa pode ter sido removida do pagamento).",
        }, 422);
      }
      if (bucket) {
        await processBucket({
          to: bucket.to,
          cc: Array.from(bucket.cc),
          total: bucket.total,
          items: bucket.items,
          company_id: bucket.company_id,
          company_name: bucket.company_name,
          recipient_label: bucket.company_name,
          reuse_invoice: targetInvoice,
        });
      } else if (doctorBucket) {
        await processBucket({
          to: [doctorBucket.doctor_email],
          cc: [],
          total: doctorBucket.total,
          items: doctorBucket.items,
          company_id: null,
          company_name: null,
          recipient_label: doctorBucket.items[0]?.doctor_name ?? doctorBucket.doctor_email,
          reuse_invoice: targetInvoice,
        });
      }
      return json({
        ok: true,
        mode: "single",
        invoice_id: targetInvoice.id,
        sent_ok: sentOk,
        sent_error: sentErr,
        send_errors: sendErrors,
      });
    }

    // ---- Modo lote ----
    for (const bucket of byCompany.values()) {
      await processBucket({
        to: bucket.to,
        cc: Array.from(bucket.cc),
        total: bucket.total,
        items: bucket.items,
        company_id: bucket.company_id,
        company_name: bucket.company_name,
        recipient_label: bucket.company_name,
      });
    }
    for (const bucket of byDoctorFallback.values()) {
      await processBucket({
        to: [bucket.doctor_email],
        cc: [],
        total: bucket.total,
        items: bucket.items,
        company_id: null,
        company_name: null,
        recipient_label: bucket.items[0]?.doctor_name ?? bucket.doctor_email,
      });
    }

    if (sentOk > 0) {
      await supabase.from("payments").update({ status: "pedido_nf_enviado" }).eq("id", resolvedPaymentId);
      await supabase.from("payment_observations").insert({
        payment_id: resolvedPaymentId,
        author_type: "sistema",
        message:
          `${sentOk} pedido(s) de NF enviado(s) com sucesso` +
          (sentErr > 0 ? ` · ${sentErr} falharam: ${sendErrors.join("; ")}` : "") +
          `. ${byCompany.size} para empresa(s) e ${byDoctorFallback.size} para médico(s) sem empresa vinculada.`,
        status_to: "pedido_nf_enviado",
      });
    } else if (sentErr > 0) {
      await supabase.from("payment_observations").insert({
        payment_id: resolvedPaymentId,
        author_type: "sistema",
        message: `Falha ao enviar ${sentErr} pedido(s) de NF: ${sendErrors.join("; ")}. Configure o provedor de e-mail e use "Reenviar" em /notas-fiscais.`,
        status_to: null,
      });
    }

    return json({
      ok: true,
      invoices_created: created.length,
      sent_ok: sentOk,
      sent_error: sentErr,
      send_errors: sendErrors,
      summaries,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[send-invoice-request] erro:", msg);
    return json({ error: msg }, 500);
  }
});
