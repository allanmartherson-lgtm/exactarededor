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
import { addBusinessDays, fmtMoney, formatCompetenceBR, formatDateBR, greetingBrasilia, joinPt } from "./text.ts";
import { buildEmail } from "./templates.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

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
  patient_name: string | null;
  attendance_number: string | null;
  procedure_date: string | null;
  agreement_text: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  description: string | null;
  quantity: number | null;
  procedure_amount: number | null;
  gross_amount: number | null;
  doctor_name: string;
  doctor_document: string | null;
  doctor_role: string | null;
  specialty: string | null;
  sector: string | null;
  cost_center_code: string | null;
  access_route: string | null;
  company_id: string | null;
  company_name: string | null;
  company_document: string | null;
  doctor_email: string | null;
  applied_rule_label: string | null;
  applied_calc_method: string | null;
  attendance_character: string | null;
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

    if (!targetInvoice && missingCompanyEmails.length > 0) {
      return json({
        error: "empresa_sem_email",
        message: `Envio bloqueado: ${missingCompanyEmails.length} empresa(s) sem e-mail de NF cadastrado. Cadastre em Empresas → editar → "E-mails para pedido de NF".`,
        missing_company_emails: missingCompanyEmails,
      }, 422);
    }

    if (!targetInvoice && byCompany.size === 0 && byDoctorFallback.size === 0) {
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
          recipient_email: to[0],
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
        lote_name: payment.reference ?? null,
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
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
        if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
          throw new Error("LOVABLE_API_KEY ou RESEND_API_KEY ausente");
        }
        const ccList = [...opts.to.slice(1), ...opts.cc];

        // Setor/especialidade e competência (mesma lógica do template)
        const setoresArr = Array.from(new Set([
          ...((payment.sectors ?? []) as string[]),
          ...((payment.specialties ?? []) as string[]),
        ].filter(Boolean)));
        const setoresStr = setoresArr.length ? joinPt(setoresArr) : "Produção médica";
        const competenciaStr = formatCompetenceBR(
          Array.isArray(payment.competence_months) && payment.competence_months.length
            ? payment.competence_months
            : payment.competence_month,
        );

        // Prazo (10 dias úteis antes do vencimento), se houver
        let prazoFormatted: string | null = null;
        if (payment.payment_due_date) {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(payment.payment_due_date));
          if (m) {
            const due = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
            prazoFormatted = formatDateBR(addBusinessDays(due, -10));
          }
        }

        const prazoRow = prazoFormatted
          ? `<tr><td style="padding:4px 0;font-size:13px;color:#555">Prazo para envio:</td><td style="padding:4px 0;font-size:13px;color:#c0392b;font-weight:600">${prazoFormatted}</td></tr>`
          : "";

        // Gera Excel com detalhamento dos itens (opcional — não bloqueia envio)
        let xlsxBuffer: string | null = null;
        let fileName = "";
        try {
          const wsData = [
            [
              "Atendimento",
              "Paciente",
              "Data",
              "Convênio",
              "Caráter",
              "Cód. Procedimento",
              "Procedimento",
              "Qtd",
              "Valor Convênio (R$)",
              "Valor Pago (R$)",
              "Médico",
              "CRM/Doc",
              "Função",
              "Especialidade",
              "Setor",
              "Centro de Custo",
              "Empresa",
              "CNPJ",
              "Regra Aplicada",
              "Método Cálculo",
            ],
            ...opts.items.map((it) => {
              const company = it.company_id ? companyMap.get(it.company_id) : null;
              const cnpjRaw = company?.document ?? it.company_document ?? "";
              const dateFmt = it.procedure_date
                ? new Date(it.procedure_date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
                : "";
              return [
                it.attendance_number ?? "",
                it.patient_name ?? "",
                dateFmt,
                it.agreement_text ?? "",
                it.attendance_character ?? "",
                it.procedure_code ?? "",
                it.procedure_name ?? it.description ?? "",
                Number(it.quantity ?? 1),
                Number(it.procedure_amount ?? 0),
                Number(it.gross_amount ?? 0),
                it.doctor_name ?? "",
                it.doctor_document ?? "",
                it.doctor_role ?? "",
                it.specialty ?? "",
                it.sector ?? "",
                it.cost_center_code ?? "",
                company?.name ?? it.company_name ?? "",
                cnpjRaw ? formatDoc(cnpjRaw) : "",
                it.applied_rule_label ?? "",
                it.applied_calc_method ?? "",
              ];
            }),
          ];
          const ws = XLSX.utils.aoa_to_sheet(wsData);
          const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
          for (let R = 1; R <= range.e.r; R++) {
            for (const C of [7, 8, 9]) {
              const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
              if (cell) cell.t = "n";
            }
          }
          ws["!cols"] = [
            { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
            { wch: 14 }, { wch: 45 }, { wch: 6 }, { wch: 18 }, { wch: 16 },
            { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 18 },
            { wch: 14 }, { wch: 35 }, { wch: 20 }, { wch: 30 }, { wch: 18 },
          ];
          const wb = XLSX.utils.book_new();
          const sheetName = (opts.recipient_label ?? "Itens").slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          xlsxBuffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
          fileName = `Detalhamento_NF_${(opts.recipient_label ?? "empresa").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)}.xlsx`;
        } catch (xlsxErr) {
          console.warn("[send-invoice-request] falha ao gerar XLSX:", xlsxErr instanceof Error ? xlsxErr.message : String(xlsxErr));
        }

        const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <!-- HEADER -->
    <tr>
      <td style="background:#1E3A5F;padding:28px 40px">
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;opacity:0.7">Hospital DF Star</div>
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px">Pedido de Nota Fiscal</div>
      </td>
    </tr>

    <!-- BODY -->
    <tr>
      <td style="padding:36px 40px 0 40px;font-family:Arial,sans-serif">

        <p style="margin:0 0 6px 0;font-size:14px;color:#1a1a2e">Prezados, <strong>${greetingBrasilia()}!</strong></p>
        <p style="margin:0 0 24px 0;font-size:14px;color:#444;line-height:1.6">
          Solicitamos, por gentileza, a emissão de Nota Fiscal referente à produção de
          <strong>${setoresStr}</strong>${competenciaStr ? ` — <strong>${competenciaStr}</strong>` : ""}:
        </p>

        <!-- CARD EMPRESA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;border-left:4px solid #1E3A5F;border-radius:6px;margin-bottom:28px">
          <tr>
            <td style="padding:20px 24px">
              <div style="font-family:Arial,sans-serif;font-size:17px;font-weight:700;color:#1a1a2e;margin-bottom:14px">${opts.recipient_label}</div>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Arial,sans-serif;font-size:13px;color:#666;padding:3px 20px 3px 0;white-space:nowrap">Valor:</td>
                  <td style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#1E3A5F;padding:3px 0">${totalFormatted}</td>
                </tr>
                <tr>
                  <td style="font-family:Arial,sans-serif;font-size:13px;color:#666;padding:3px 20px 3px 0;white-space:nowrap">Previsão de pagamento:</td>
                  <td style="font-family:Arial,sans-serif;font-size:13px;color:#444;padding:3px 0">10 dias úteis após o envio da NF</td>
                </tr>
                ${prazoRow}
              </table>
            </td>
          </tr>
        </table>

        <!-- INSTRUÇÃO -->
        <p style="margin:0 0 20px 0;font-family:Arial,sans-serif;font-size:13px;color:#555;line-height:1.6">
          Para envio da Nota Fiscal ou em caso de dúvidas e questionamentos, utilize o botão abaixo:
        </p>

        <!-- BOTÃO -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
          <tr>
            <td align="center">
              <a href="${uploadUrl}" style="display:inline-block;background:#1E3A5F;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.3px">
                Enviar Nota Fiscal →
              </a>
            </td>
          </tr>
        </table>

        <!-- DADOS CADASTRAIS -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;padding-top:24px;margin-bottom:32px">
          <tr>
            <td style="padding-top:24px">
              <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Dados Cadastrais do Tomador</div>
              <div style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a2e;line-height:1.8">
                <strong>Hospitais Integrados da Gávea S.A — DF Star</strong><br/>
                CNPJ: 31.635.857/0006-16 &nbsp;&nbsp; C.C.M: 07.895.204/001-40<br/>
                SGAS 914 Conjunto H - Parte, Asa Sul<br/>
                Brasília — DF | CEP: 70.390-140
              </div>
            </td>
          </tr>
        </table>

      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td style="background:#f0f4f8;padding:20px 40px;border-top:1px solid #e2e8f0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:Arial,sans-serif;font-size:12px;color:#666">
              Atenciosamente,<br/>
              <strong style="color:#1E3A5F">GHM DF Star</strong>
            </td>
            <td align="right" style="font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.7">
              ghm.repassedfstar@rededor.com.br<br/>
              (11) 2142-4879
            </td>
          </tr>
        </table>
        <div style="font-family:Arial,sans-serif;font-size:11px;color:#aaa;margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0">
          Este link é único e intransferível. Em caso de dúvidas, responda este e-mail.
        </div>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
        const resendResp = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: "MedPay <onboarding@resend.dev>",
            to: [opts.to[0]],
            cc: ccList.length > 0 ? ccList : undefined,
            subject: emailSubject,
            html,
            attachments: xlsxBuffer
              ? [{ filename: fileName, content: xlsxBuffer }]
              : undefined,
          }),
        });
        if (!resendResp.ok) {
          const errBody = await resendResp.text();
          throw new Error(`Resend ${resendResp.status}: ${errBody}`);
        }
        await supabase.from("invoices").update({
          sent_at: new Date().toISOString(),
          send_error: null,
        }).eq("id", invoice.id);
        sentOk++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[send-invoice-request] falha ao enviar e-mail:", msg);
        await supabase.from("invoices").update({ send_error: msg.slice(0, 500) }).eq("id", invoice.id);
        sentErr++;
        sendErrors.push(`${opts.recipient_label}: ${msg}`);
      }
    };

    // ---- Modo reenvio individual: processa SOMENTE o bucket da invoice alvo ----
    if (targetInvoice) {
      // Tenta achar bucket por company_id
      let bucket: CompanyBucket | undefined;
      if (targetInvoice.company_id) bucket = byCompany.get(targetInvoice.company_id);

      // Se não achou (empresa sem invoice_emails no byCompany), monta bucket direto com todos os itens do pagamento dessa empresa
      if (!bucket && targetInvoice.company_id) {
        const companyItems = items.filter((i) => i.company_id === targetInvoice!.company_id);
        if (companyItems.length > 0) {
          const compInfo = companyMap.get(targetInvoice.company_id);
          const toEmail = recipient_email ?? targetInvoice.recipient_email ?? "";
          if (toEmail) {
            bucket = {
              company_id: targetInvoice.company_id,
              company_name: compInfo?.name ?? targetInvoice.company_name ?? "",
              to: [toEmail],
              cc: new Set<string>(),
              total: companyItems.reduce((sum, i) => sum + Number(i.gross_amount ?? 0), 0),
              items: companyItems,
            };
          }
        }
      }

      // Fallback: tenta bucket por médico
      let doctorBucket: DoctorBucket | undefined;
      if (!bucket) {
        const k = String(targetInvoice.recipient_email ?? "").toLowerCase();
        doctorBucket = byDoctorFallback.get(k);
      }

      if (!bucket && !doctorBucket) {
        return json({
          error: "sem_itens",
          message: "Não há itens elegíveis para reenviar esta NF.",
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
          override_to: recipient_email ? [recipient_email] : undefined,
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
          override_to: recipient_email ? [recipient_email] : undefined,
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
