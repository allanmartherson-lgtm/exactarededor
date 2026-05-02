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

// Saudação dinâmica em horário de Brasília (UTC-3)
const greetingBrasilia = (now = new Date()) => {
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return "Bom dia";
  if (brHour >= 12 && brHour < 18) return "Boa tarde";
  return "Boa noite";
};

// Junta lista com vírgulas e "e" no último ("A, B e C")
const joinPt = (arr: string[]) => {
  const a = arr.filter(Boolean);
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  return `${a.slice(0, -1).join(", ")} e ${a[a.length - 1]}`;
};

// "ao" (1) / "aos" (2+)
const aoAos = (n: number) => (n > 1 ? "aos" : "ao");

// Formata competência (YYYY-MM-DD ou array) como "Mês de YYYY"
const MONTH_NAMES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const formatCompetenceBR = (value: string | string[] | null | undefined): string => {
  if (!value) return "";
  const arr = Array.isArray(value) ? value : [value];
  const parts = arr
    .map((v) => /^(\d{4})-(\d{2})/.exec(v))
    .filter(Boolean)
    .map((m) => `${MONTH_NAMES[Number(m![2]) - 1]} de ${m![1]}`);
  return joinPt(Array.from(new Set(parts)));
};

// Soma N dias úteis (seg-sex) a partir de uma data
const addBusinessDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  let added = 0;
  const step = days >= 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setUTCDate(d.getUTCDate() + step);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) added++;
  }
  return d;
};

const formatDateBR = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

const BUSINESS_DAYS_BEFORE_DUE = 10;

// Bloco fixo de dados cadastrais (HIG / DF Star)
const DADOS_CADASTRAIS = `Hospitais Integrados da Gávea S.A - DF Star
CNPJ: 31.635.857/0006-16   C.C.M: 07.895.204/001-40
SGAS 914 Conjunto H - Parte
Asa Sul - CEP: 70.390-140`;

// Assinatura padrão GHM DF Star
const ASSINATURA = `Atenciosamente,

GHM DF Star
Tel: (11) 2142-4879
ghm.repassedfstar@rededor.com.br
www.rededor.com.br`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const payment_id = body?.payment_id as string | undefined;
    const invoice_id = body?.invoice_id as string | undefined;
    if (!payment_id && !invoice_id) {
      return new Response(JSON.stringify({ error: "payment_id ou invoice_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Modo reenvio individual (invoice_id) ----
    let resolvedPaymentId = payment_id ?? null;
    let targetInvoice: any = null;
    if (invoice_id) {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoice_id)
        .single();
      if (!inv) {
        return new Response(JSON.stringify({ error: "invoice_id não encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetInvoice = inv;
      resolvedPaymentId = inv.payment_id;
    }

    const { data: payment } = await supabase.from("payments").select("*").eq("id", resolvedPaymentId).single();
    const { data: items } = await supabase.from("payment_items").select("*").eq("payment_id", resolvedPaymentId);
    if (!payment || !items) throw new Error("Pagamento não encontrado");

    // ---- Pré-validação: CNPJ + carrega lista de e-mails das empresas ----
    type CompanyInfo = { name: string; document: string | null; invoice_emails: string[] };
    const invalid: Array<{ item_id: string; doctor_name: string; document: string | null; company_name: string | null; reason: string }> = [];
    const companyIds = Array.from(new Set(items.map((i: any) => i.company_id).filter(Boolean)));
    const companyMap = new Map<string, CompanyInfo>();
    if (companyIds.length) {
      const { data: comps } = await supabase
        .from("companies")
        .select("id,name,document,invoice_emails")
        .in("id", companyIds);
      (comps ?? []).forEach((c: any) =>
        companyMap.set(c.id, {
          name: c.name,
          document: c.document,
          invoice_emails: Array.isArray(c.invoice_emails) ? c.invoice_emails : [],
        }),
      );
    }

    for (const it of items as any[]) {
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
      return new Response(JSON.stringify({
        error: "cnpj_invalido",
        message: `Envio bloqueado: ${invalid.length} item(ns) com CNPJ inválido.`,
        invalid,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Agrupamento ----
    // Por padrão agrupa por EMPRESA (TO = invoice_emails da empresa, CC = médicos).
    // Se o item não tem company_id, faz fallback agrupando por médico.
    type CompanyBucket = {
      company_id: string;
      company_name: string;
      to: string[];
      cc: Set<string>;
      total: number;
      items: any[];
    };
    type DoctorBucket = {
      doctor_email: string;
      total: number;
      items: any[];
    };

    const byCompany = new Map<string, CompanyBucket>();
    const byDoctorFallback = new Map<string, DoctorBucket>();
    const missingCompanyEmails: Array<{ company_id: string; company_name: string }> = [];

    for (const it of items as any[]) {
      const docEmail = (it.doctor_email ?? "").trim().toLowerCase();
      if (it.company_id && companyMap.has(it.company_id)) {
        const c = companyMap.get(it.company_id)!;
        if (!c.invoice_emails.length) {
          if (!missingCompanyEmails.find((m) => m.company_id === it.company_id)) {
            missingCompanyEmails.push({ company_id: it.company_id, company_name: c.name });
          }
          continue;
        }
        const cur = byCompany.get(it.company_id) ?? {
          company_id: it.company_id,
          company_name: c.name,
          to: c.invoice_emails,
          cc: new Set<string>(),
          total: 0,
          items: [],
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
          items: [],
        };
        cur.total += Number(it.gross_amount ?? 0);
        cur.items.push(it);
        byDoctorFallback.set(docEmail, cur);
      }
    }

    if (missingCompanyEmails.length > 0) {
      return new Response(JSON.stringify({
        error: "empresa_sem_email",
        message: `Envio bloqueado: ${missingCompanyEmails.length} empresa(s) sem e-mail de NF cadastrado. Cadastre em Empresas → editar → "E-mails para pedido de NF".`,
        missing_company_emails: missingCompanyEmails,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (byCompany.size === 0 && byDoctorFallback.size === 0) {
      return new Response(JSON.stringify({ error: "Nenhum destinatário válido (sem empresa com e-mail e sem e-mail de médico)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = req.headers.get("origin") ?? Deno.env.get("PUBLIC_APP_URL") ?? "";
    const created: string[] = [];
    let sentOk = 0;
    let sentErr = 0;
    const sendErrors: string[] = [];
    const summaries: any[] = [];

    // Já existem invoices para este payment? No fluxo de "lote" (sem invoice_id),
    // não criamos novas — apenas reenviamos cada uma individualmente, atualizando o
    // registro existente. Isso evita duplicação ao reenviar em lote.
    const { data: existingForPayment } = await supabase
      .from("invoices")
      .select("id, company_id, recipient_email")
      .eq("payment_id", resolvedPaymentId);
    const existingByCompany = new Map<string, any>();
    const existingByEmail = new Map<string, any>();
    (existingForPayment ?? []).forEach((inv: any) => {
      if (inv.company_id) existingByCompany.set(inv.company_id, inv);
      if (inv.recipient_email) existingByEmail.set(String(inv.recipient_email).toLowerCase(), inv);
    });

    const processBucket = async (opts: {
      to: string[];
      cc: string[];
      total: number;
      items: any[];
      company_id: string | null;
      company_name: string | null;
      recipient_label: string;
      reuse_invoice?: any | null;
    }) => {
      // Reusa invoice existente se possível (evita duplicar no reenvio).
      let invoice: any = opts.reuse_invoice ?? null;
      if (!invoice && opts.company_id && existingByCompany.has(opts.company_id)) {
        invoice = existingByCompany.get(opts.company_id);
      }
      if (!invoice && opts.to[0]) {
        const k = opts.to[0].toLowerCase();
        if (existingByEmail.has(k)) invoice = existingByEmail.get(k);
      }
      if (invoice) {
        await supabase.from("invoices").update({
          expected_amount: opts.total,
          recipient_email: opts.to[0],
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
        invoice = inserted;
        if (!invoice) return;
        created.push(invoice.id);
      }

      const uploadUrl = `${baseUrl}/portal/nota/${invoice.upload_token}`;

      const itemSummaries = opts.items.map((it: any) => {
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

      const summary = {
        invoice_id: invoice.id,
        recipient_to: opts.to,
        recipient_cc: opts.cc,
        recipient_label: opts.recipient_label,
        reference: payment.reference,
        total_amount: opts.total,
        total_amount_formatted: fmtMoney(opts.total),
        items_count: opts.items.length,
        all_documents_valid: itemSummaries.every((s) => s.document_valid || s.document_kind === "indefinido"),
        items: itemSummaries,
        upload_url: uploadUrl,
      };
      summaries.push(summary);

      const itemsList = itemSummaries.map((s) =>
        `- ${s.description} · ${s.gross_amount_formatted}` +
        (s.company_name ? ` · ${s.company_name}` : "") +
        (s.doctor_name ? ` · Dr(a) ${s.doctor_name}` : "") +
        (s.document_raw ? ` · ${s.document_kind.toUpperCase()} ${s.document_formatted} ${s.document_valid ? "✓" : "⚠"}` : "")
      ).join("\n");

      // ---- Texto-padrão do pedido (template HIG) ----
      // Setores: combina sectors + specialties do pagamento (fallback "Produção")
      const setoresArr: string[] = Array.from(new Set([
        ...(Array.isArray(payment.sectors) ? payment.sectors : []),
        ...(Array.isArray(payment.specialties) ? payment.specialties : []),
      ].filter(Boolean)));
      const setoresStr = setoresArr.length ? joinPt(setoresArr) : "Produção médica";
      const competenciaStr = formatCompetenceBR(
        Array.isArray(payment.competence_months) && payment.competence_months.length
          ? payment.competence_months
          : payment.competence_month,
      );
      // Assunto padronizado:
      // "Solicitação de Nota Fiscal - DF Star - Produção - {Setores} - {Competência}"
      const subjectParts = [
        "Solicitação de Nota Fiscal",
        "DF Star",
        "Produção",
        setoresStr,
      ];
      if (competenciaStr) subjectParts.push(competenciaStr);
      const emailSubject = subjectParts.join(" - ");
      summary["email_subject"] = emailSubject;
      // Prazo = data pgto - 10 dias úteis (se houver due_date)
      let prazoLine = "";
      if (payment.payment_due_date) {
        // payment_due_date vem como "YYYY-MM-DD" — parse como UTC pra evitar shift
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(payment.payment_due_date));
        if (m) {
          const due = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
          const prazo = addBusinessDays(due, -BUSINESS_DAYS_BEFORE_DUE);
          prazoLine = `Favor emitir a Nota Fiscal e nos encaminhar até o dia ${formatDateBR(prazo)}.`;
        }
      }

      const greeting = greetingBrasilia();
      // Mesmo link atende upload da NF e envio de dúvidas/divergências (o portal tem ambas as abas)
      const portalUrl = uploadUrl;
      const requestMessage =
`Prezados,
${greeting}!

Solicitamos, por gentileza, a emissão de Nota Fiscal referente ${aoAos(setoresArr.length)} Produção de ${setoresStr}${competenciaStr ? ` ${competenciaStr}` : ""}:

${opts.recipient_label} - ${setoresStr}
Valor: ${summary.total_amount_formatted}
Previsão de pagamento: 10 dias úteis após o envio da NF.
Para envio da NF ou caso tenha dúvidas ou questionamentos, utilize o link abaixo:

${portalUrl}

Dados Cadastrais do Hospital:
${DADOS_CADASTRAIS}
${prazoLine ? `\n${prazoLine}\n` : ""}
${ASSINATURA}`;

      await supabase.from("invoices").update({ request_message: requestMessage }).eq("id", invoice.id);
      summary["request_message"] = requestMessage;

      // SIMULAÇÃO: enquanto o provedor de e-mail (Resend/Lovable Emails) não está
      // conectado, registramos o conteúdo no log para inspeção.
      console.log("[send-invoice-request] PEDIDO DE NF (simulado)", {
        invoice_id: invoice.id,
        to: opts.to,
        cc: opts.cc,
        recipient_label: opts.recipient_label,
        total: summary.total_amount_formatted,
        upload_url: uploadUrl,
        items_count: summary.items_count,
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
              totalAmount: summary.total_amount_formatted,
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
        await supabase.from("invoices").update({
          send_error: msg.slice(0, 500),
        }).eq("id", invoice.id);
        sentErr++;
        sendErrors.push(`${opts.recipient_label}: ${msg}`);
      }
    };

    // 1) Buckets por empresa
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
    // 2) Fallback por médico (itens sem empresa)
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

    // Só avança o pagamento se ao menos um envio teve sucesso. Se TODOS falharam,
    // o pagamento permanece "aprovado" (= aguardando envio) e as invoices
    // ficam visíveis em /notas-fiscais com a mensagem de erro do provedor.
    if (sentOk > 0) {
      await supabase.from("payments").update({ status: "pedido_nf_enviado" }).eq("id", payment_id);
      await supabase.from("payment_observations").insert({
        payment_id,
        author_type: "sistema",
        message:
          `${sentOk} pedido(s) de NF enviado(s) com sucesso` +
          (sentErr > 0 ? ` · ${sentErr} falharam: ${sendErrors.join("; ")}` : "") +
          `. ${byCompany.size} para empresa(s) e ${byDoctorFallback.size} para médico(s) sem empresa vinculada.`,
        status_to: "pedido_nf_enviado",
      });
    } else if (sentErr > 0) {
      await supabase.from("payment_observations").insert({
        payment_id,
        author_type: "sistema",
        message: `Falha ao enviar ${sentErr} pedido(s) de NF: ${sendErrors.join("; ")}. Configure o provedor de e-mail e use "Reenviar" em /notas-fiscais.`,
        status_to: null,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      invoices_created: created.length,
      sent_ok: sentOk,
      sent_error: sentErr,
      send_errors: sendErrors,
      summaries,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[send-invoice-request] erro:", msg);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
