import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { archiveInvoiceFileVersion } from "../_shared/invoiceVersioning.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Status da NF em que a empresa ainda pode conversar pelo portal. */
const CHAT_OPEN_STATUSES = new Set(["aguardando", "recebida", "divergente"]);
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return new Response(JSON.stringify({ error: "token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id, expected_amount, status, recipient_email, payment_id, company_name, received_at")
        .eq("upload_token", token)
        .maybeSingle();
      if (!invoice) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: payment } = await supabase
        .from("payments")
        .select("reference, description, sectors, specialties, competence_months, competence_month, payment_kind, status, payout_breakdown, payout_model_version")
        .eq("id", invoice.payment_id)
        .single();
      // Inclui a thread de questionamentos pra renderizar no portal
      const { data: questions } = await supabase
        .from("invoice_questions")
        .select("id, author_type, author_name, message, created_at")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: true });
      const questionIds = (questions ?? []).map((q: any) => q.id);
      let attachments: any[] = [];
      if (questionIds.length > 0) {
        const { data: atts } = await supabase
          .from("invoice_question_attachments")
          .select("id, question_id, file_name, storage_path, mime_type, size_bytes")
          .in("question_id", questionIds);
        // Anexa URLs assinadas pra o recebedor conseguir baixar (bucket é privado).
        attachments = await Promise.all(
          (atts ?? []).map(async (a: any) => {
            const { data: signed } = await supabase.storage
              .from("invoice-question-attachments")
              .createSignedUrl(a.storage_path, 60 * 60);
            return { ...a, signed_url: signed?.signedUrl ?? null };
          }),
        );
      }
      // Resumo de piso mínimo aplicado nos itens deste pagamento — usado no
      // portal para explicar ao médico quando o repasse foi puxado pelo piso.
      let piso_summary: {
        items_com_piso: number;
        items_piso_aplicado: number;
        total_piso_aplicado: number;
      } | null = null;
      if (invoice.payment_id) {
        const { data: pisoRows } = await supabase
          .from("payment_items")
          .select("piso_aplicado_valor, piso_metodo_vencedor")
          .eq("payment_id", invoice.payment_id)
          .not("piso_aplicado_valor", "is", null);
        if (pisoRows && pisoRows.length > 0) {
          const aplicados = pisoRows.filter((r: any) => r.piso_metodo_vencedor === "piso");
          piso_summary = {
            items_com_piso: pisoRows.length,
            items_piso_aplicado: aplicados.length,
            total_piso_aplicado: aplicados.reduce(
              (s: number, r: any) => s + Number(r.piso_aplicado_valor ?? 0),
              0,
            ),
          };
        }
      }
      return new Response(
        JSON.stringify({ invoice, payment, questions: questions ?? [], attachments, piso_summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // POST: dois modos:
    //   - 'invoice' (default, multipart/form-data) — recebedor envia a NF
    //   - 'question' multipart com action=question — dúvida + anexos opcionais
    //   - 'question' (application/json) — recebedor envia uma dúvida
    const contentType = req.headers.get("content-type") ?? "";

    // Helper com cache para preencher hospital_id em inserts (multi-tenant isolation).
    // Tabelas invoice_questions / invoice_question_attachments / payment_observations
    // têm hospital_id NOT NULL — sem isso o insert é rejeitado silenciosamente.
    const __hospIdCache = new Map<string, string | null>();
    const getHospitalId = async (paymentId: string | null | undefined): Promise<string | null> => {
      if (!paymentId) return null;
      if (__hospIdCache.has(paymentId)) return __hospIdCache.get(paymentId) ?? null;
      const { data } = await supabase.from("payments").select("hospital_id").eq("id", paymentId).maybeSingle();
      const hid = (data?.hospital_id as string | null) ?? null;
      __hospIdCache.set(paymentId, hid);
      return hid;
    };


    // Helpers de anexo (mantidos inline pra não precisar bundler na edge).
    const ALLOWED_MIMES = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
    ]);
    const ALLOWED_EXT = new Set(["pdf","jpg","jpeg","png","gif","webp","xls","xlsx","csv"]);
    const MAX_SIZE = 20 * 1024 * 1024;
    const MAX_FILES = 5;
    const validateAttachment = (f: File): string | null => {
      if (!f.size) return `${f.name}: arquivo vazio`;
      if (f.size > MAX_SIZE) return `${f.name}: maior que 20MB`;
      const mime = (f.type || "").toLowerCase();
      if (mime && ALLOWED_MIMES.has(mime)) return null;
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      if (ALLOWED_EXT.has(ext)) return null;
      return `${f.name}: tipo de arquivo não permitido`;
    };

    const persistAttachments = async (
      files: File[],
      questionId: string,
      invoiceId: string,
      paymentId: string,
      authorType: "recebedor" | "analista",
      authorId: string | null,
    ) => {
      for (const f of files) {
        const ext = f.name.split(".").pop() ?? "bin";
        const safeName = f.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
        const path = `${invoiceId}/${questionId}/${crypto.randomUUID()}.${ext}`;
        const buf = new Uint8Array(await f.arrayBuffer());
        const { error: upErr } = await supabase.storage
          .from("invoice-question-attachments")
          .upload(path, buf, { contentType: f.type || "application/octet-stream", upsert: false });
        if (upErr) throw upErr;
        const __hidAtt = await getHospitalId(paymentId);
        const { error: insErr } = await supabase.from("invoice_question_attachments").insert({
          question_id: questionId,
          invoice_id: invoiceId,
          payment_id: paymentId,
          hospital_id: __hidAtt,
          author_type: authorType,
          author_id: authorId,
          file_name: safeName,
          storage_path: path,
          mime_type: f.type || "application/octet-stream",
          size_bytes: f.size,
        });
        if (insErr) throw insErr;
      }
    };

    // O fluxo multipart cobre dois casos: action=question (com anexos) e o upload da NF.
    // Lemos o body uma única vez aqui pra não consumir o stream duas vezes.
    let multipartForm: FormData | null = null;
    if (contentType.includes("multipart/form-data")) {
      multipartForm = await req.formData();
      const action = String(multipartForm.get("action") ?? "").trim();
      if (action === "question") {
        const form = multipartForm;
        const token = String(form.get("token") ?? "");
        const message = String(form.get("message") ?? "").trim();
        const authorName = String(form.get("author_name") ?? "").trim().slice(0, 120) || null;
        if (!token || !message) {
          return new Response(JSON.stringify({ error: "token e mensagem são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (message.length > 2000) {
          return new Response(JSON.stringify({ error: "Mensagem muito longa (máx. 2000 caracteres)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const files = form.getAll("attachments").filter((v): v is File => v instanceof File && v.size > 0);
        if (files.length > MAX_FILES) {
          return new Response(JSON.stringify({ error: `Máximo de ${MAX_FILES} anexos por mensagem` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        for (const f of files) {
          const err = validateAttachment(f);
          if (err) return new Response(JSON.stringify({ error: err }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: invoice } = await supabase.from("invoices").select("id, payment_id, status").eq("upload_token", token).maybeSingle();
        if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!CHAT_OPEN_STATUSES.has(String(invoice.status))) {
          return new Response(JSON.stringify({ error: "Esta NF já foi finalizada — não é possível enviar novas dúvidas." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const __hid1 = await getHospitalId(invoice.payment_id);
        const { data: q, error: insErr } = await supabase.from("invoice_questions").insert({
          invoice_id: invoice.id,
          payment_id: invoice.payment_id,
          hospital_id: __hid1,
          author_type: "recebedor",
          author_name: authorName,
          message,
        }).select("id").single();
        if (insErr) throw insErr;
        if (files.length > 0) {
          await persistAttachments(files, q.id, invoice.id, invoice.payment_id, "recebedor", null);
        }
        // Marca perguntas pendentes do analista como respondidas (recebedor está respondendo)
        await supabase
          .from("invoice_questions")
          .update({ answered_at: new Date().toISOString() })
          .eq("invoice_id", invoice.id)
          .eq("author_type", "analista")
          .is("answered_at", null);
        await supabase.from("payments").update({ status: "nf_questionada" }).eq("id", invoice.payment_id);
        const { error: obsErr1 } = await supabase.from("payment_observations").insert({
          payment_id: invoice.payment_id,
          hospital_id: __hid1,
          author_type: "sistema",
          message: `Recebedor da NF enviou um questionamento${authorName ? ` (${authorName})` : ""}${files.length ? ` com ${files.length} anexo(s)` : ""}: "${message.slice(0, 200)}${message.length > 200 ? "..." : ""}"`,
          status_to: "nf_questionada",
        });
        if (obsErr1) console.error("[submit-invoice] payment_observations insert error", obsErr1);
        return new Response(JSON.stringify({ ok: true, attachments: files.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Se action != "question" cai para o fluxo de upload de NF abaixo (mantém compatibilidade).
    }

    // -------- modo: questionamento --------
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const token = String(body?.token ?? "");
      const action = String(body?.action ?? "").trim();

      // -------- modo: reset --------
      // Recebedor identificou que enviou a NF errada / divergente e quer refazer.
      // Política fiscal: nenhuma divergência é tolerada; permitimos reabrir o
      // formulário enquanto o pagamento ainda não foi efetivado.
      if (action === "reset") {
        if (!token) {
          return new Response(JSON.stringify({ error: "token obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const justification = String(body?.justification ?? "").trim().slice(0, 2000);
        const authorName = String(body?.author_name ?? "").trim().slice(0, 120) || null;
        const { data: invoice } = await supabase
          .from("invoices")
          .select("id, payment_id, hospital_id, status, file_path, invoice_number, received_amount, ai_validation, ai_extracted_amount, ai_extracted_number, ai_extracted_cnpj")
          .eq("upload_token", token)
          .maybeSingle();
        if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        // Só faz sentido refazer se a NF anterior está bloqueada por divergência
        // (ou ainda aguardando, caso o recebedor tenha desistido do upload).
        if (invoice.status !== "divergente" && invoice.status !== "aguardando") {
          return new Response(JSON.stringify({ error: "Esta NF já foi conciliada — fale com o analista para refazer." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Bloqueio fiscal: depois que o time fiscal já encaminhou o pagamento
        // (conciliada, em aprovação interna, paga ou rejeitada) o recebedor
        // não pode mais reabrir o envio — qualquer ajuste tem que passar pelo
        // analista via thread/contato direto.
        const { data: pay } = await supabase
          .from("payments")
          .select("status")
          .eq("id", invoice.payment_id)
          .maybeSingle();
        const lockedStatuses = new Set([
          "nf_conciliada",
          "aguardando_aprovacao",
          "aprovado",
          "aprovado_com_ressalva",
          "pago",
          "rejeitado",
          "cancelado",
        ]);
        if (pay && lockedStatuses.has(pay.status)) {
          return new Response(
            JSON.stringify({
              error: "Este pagamento já está em aprovação ou foi efetivado pelo time fiscal. Para qualquer ajuste, fale com o analista pelo botão 'Tenho uma dúvida'.",
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        // Snapshot do envio anterior pra ficar registrado no histórico antes de descartar.
        const previousSnapshot = invoice.invoice_number || invoice.received_amount
          ? `NF anterior: ${invoice.invoice_number ?? "—"} / valor ${invoice.received_amount ?? "—"}.`
          : "Nenhum upload anterior registrado.";
        // NUNCA apagar o arquivo: versiona (move para v{n}) e registra em invoice_file_versions.
        const __hidReset = await getHospitalId(invoice.payment_id);
        const versionRes = await archiveInvoiceFileVersion(supabase, invoice as never, {
          source: "reenvio_empresa",
          reason: justification || null,
          hospitalId: __hidReset,
        });
        if (!versionRes.ok) {
          console.error("[submit-invoice] falha ao versionar arquivo da NF:", versionRes.error);
        }
        await supabase.from("invoices").update({
          status: "aguardando",
          invoice_number: null,
          received_amount: null,
          file_path: null,
          received_at: null,
          reconciliation_notes: null,
          ai_validation: null,
          ai_validated_at: null,
          ai_extracted_amount: null,
          ai_extracted_number: null,
          ai_extracted_cnpj: null,
        }).eq("id", invoice.id);
        // Recoloca o pagamento como "aguardando NF" — o status real é
        // recalculado a partir das demais NF se houver mais de uma.
        const { data: siblings } = await supabase.from("invoices").select("status").eq("payment_id", invoice.payment_id);
        const anyDone = siblings?.some((i) => i.status === "conciliada" || i.status === "divergente");
        if (!anyDone) {
          await supabase.from("payments").update({ status: "pedido_nf_enviado" }).eq("id", invoice.payment_id);
        }
        // Histórico interno (visível para analista/validador no detalhe do pagamento).
        const obsMessage = [
          `Recebedor${authorName ? ` (${authorName})` : ""} reabriu o portal para reenviar a NF.`,
          previousSnapshot,
          justification ? `Justificativa: ${justification}` : "Justificativa não informada.",
        ].join(" ");
        const __hid2 = await getHospitalId(invoice.payment_id);
        const { error: obsErr2 } = await supabase.from("payment_observations").insert({
          payment_id: invoice.payment_id,
          hospital_id: __hid2,
          author_type: "sistema",
          message: obsMessage,
        });
        if (obsErr2) console.error("[submit-invoice] payment_observations insert error", obsErr2);
        // Também registra na thread do portal pra ficar visível na próxima conversa
        // entre recebedor e analista (e aparecer na aba "Tenho uma dúvida").
        if (justification) {
          const { error: qErr } = await supabase.from("invoice_questions").insert({
            invoice_id: invoice.id,
            payment_id: invoice.payment_id,
            hospital_id: __hid2,
            author_type: "recebedor",
            author_name: authorName,
            message: `[Reenvio de NF] ${justification}`,
          });
          if (qErr) console.error("[submit-invoice] invoice_questions insert error", qErr);
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const message = String(body?.message ?? "").trim();
      const authorName = String(body?.author_name ?? "").trim().slice(0, 120) || null;
      if (!token || !message) {
        return new Response(JSON.stringify({ error: "token e mensagem são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (message.length > 2000) {
        return new Response(JSON.stringify({ error: "Mensagem muito longa (máx. 2000 caracteres)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: invoice } = await supabase.from("invoices").select("id, payment_id, status").eq("upload_token", token).maybeSingle();
      if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!CHAT_OPEN_STATUSES.has(String(invoice.status))) {
        return new Response(JSON.stringify({ error: "Esta NF já foi finalizada — não é possível enviar novas dúvidas." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const __hid3 = await getHospitalId(invoice.payment_id);
      const { error: insErr } = await supabase.from("invoice_questions").insert({
        invoice_id: invoice.id,
        payment_id: invoice.payment_id,
        hospital_id: __hid3,
        author_type: "recebedor",
        author_name: authorName,
        message,
      });
      if (insErr) throw insErr;

      // Marca perguntas pendentes do analista como respondidas (recebedor está respondendo)
      await supabase
        .from("invoice_questions")
        .update({ answered_at: new Date().toISOString() })
        .eq("invoice_id", invoice.id)
        .eq("author_type", "analista")
        .is("answered_at", null);

      // Move o pagamento para `nf_questionada` para o analista ser notificado.
      // Mantém histórico em payment_observations.
      await supabase.from("payments").update({ status: "nf_questionada" }).eq("id", invoice.payment_id);
      const { error: obsErr3 } = await supabase.from("payment_observations").insert({
        payment_id: invoice.payment_id,
        hospital_id: __hid3,
        author_type: "sistema",
        message: `Recebedor da NF enviou um questionamento${authorName ? ` (${authorName})` : ""}: "${message.slice(0, 200)}${message.length > 200 ? "..." : ""}"`,
        status_to: "nf_questionada",
      });
      if (obsErr3) console.error("[submit-invoice] payment_observations insert error", obsErr3);

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // -------- modo: envio da NF (multipart) --------
    const form = multipartForm ?? await req.formData();
    const token = String(form.get("token") ?? "");
    const invoiceNumber = String(form.get("invoice_number") ?? "").trim();
    const rawReceived = form.get("received_amount");
    const file = form.get("file") as File | null;

    if (!token || !invoiceNumber || !file) {
      return new Response(JSON.stringify({ error: "Dados inválidos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Arquivo maior que 10MB" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: invoice } = await supabase.from("invoices").select("*").eq("upload_token", token).maybeSingle();
    if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (invoice.status !== "aguardando") {
      return new Response(JSON.stringify({ error: "Esta NF já foi enviada" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Recebedor não digita mais o valor — assumimos o valor esperado para fins
    // do registro. A conciliação real fica por conta da IA (valor extraído da NF).
    const expected = Number(invoice.expected_amount);
    const receivedAmount = rawReceived != null && String(rawReceived).trim() !== ""
      ? Number(rawReceived)
      : expected;

    const ext = file.name.split(".").pop() ?? "pdf";
    const path = `${invoice.payment_id}/${invoice.id}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from("invoices").upload(path, buf, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;

    // Conciliação pelo valor (esperado/digitado) e pelo extraído pela IA.
    const tolerance = 0.01;
    const formDiff = Math.abs(expected - receivedAmount);
    const matchesByForm = formDiff <= tolerance;

    // Persiste primeiro o arquivo + valor digitado, com status provisório.
    await supabase.from("invoices").update({
      invoice_number: invoiceNumber,
      received_amount: receivedAmount,
      file_path: path,
      received_at: new Date().toISOString(),
      status: "aguardando",
      reconciliation_notes: "Validando documento...",
    }).eq("id", invoice.id);

    // CNPJ esperado da empresa (cadastro) — comparado programaticamente e
    // também enviado como contexto para a IA.
    let expectedCnpj: string | null = null;
    if (invoice.company_id) {
      const { data: comp } = await supabase
        .from("companies").select("document").eq("id", invoice.company_id).maybeSingle();
      expectedCnpj = onlyDigits(comp?.document) || null;
    }

    // Validação SÍNCRONA por IA: lê o PDF/XML, extrai valor e compara com o pedido.
    // Bloqueia o fluxo até decidir; se a IA falhar, fica em divergência por precaução.
    const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/validate-invoice-pdf`;
    let aiAmount: number | null = null;
    let aiDivergences: string[] = [];
    let aiError: string | null = null;
    let aiConfidence: string | null = null;
    let aiCnpj: string | null = null;
    try {
      const aiResp = await fetch(FN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invoice_id: invoice.id, expected_cnpj: expectedCnpj }),
      });
      const aiJson = await aiResp.json().catch(() => ({}));
      if (!aiResp.ok) {
        aiError = aiJson?.error ?? `ai_status_${aiResp.status}`;
      } else {
        aiAmount = typeof aiJson.extracted_amount === "number" ? aiJson.extracted_amount : null;
        aiDivergences = Array.isArray(aiJson.divergences) ? aiJson.divergences : [];
        aiConfidence = typeof aiJson.confidence === "string" ? aiJson.confidence : null;
        aiCnpj = onlyDigits(aiJson.extracted_cnpj) || null;
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : "ai_unreachable";
    }

    // Comparação dos valores com a NF (digitado e extraído da NF pela IA).
    const aiDiff = aiAmount != null ? Math.abs(expected - aiAmount) : null;
    const matchesByAi = aiDiff != null ? aiDiff <= tolerance : null;

    // Conferência programática do CNPJ do emissor contra o cadastro da PJ.
    const cnpjMismatch = !!(expectedCnpj && aiCnpj && expectedCnpj !== aiCnpj);

    // Política: precisa bater nos dois (form + NF). Se IA falhou, marcamos como
    // divergente pra forçar conferência humana — bloqueia o avanço do fluxo.
    let finalMatches = false;
    let notes = "";
    if (!matchesByForm) {
      notes = `Divergência (valor digitado): pedido ${expected.toFixed(2)} vs digitado ${receivedAmount.toFixed(2)} (Δ ${formDiff.toFixed(2)}).`;
    }
    if (matchesByAi === false) {
      notes += (notes ? " " : "") +
        `Divergência (valor na NF): pedido ${expected.toFixed(2)} vs NF ${aiAmount!.toFixed(2)} (Δ ${aiDiff!.toFixed(2)}).`;
    }
    if (cnpjMismatch) {
      notes += (notes ? " " : "") +
        `Divergência (CNPJ do emissor): cadastro ${expectedCnpj} vs NF ${aiCnpj}.`;
    }
    if (aiDivergences.length > 0) {
      notes += (notes ? " " : "") + `IA: ${aiDivergences.join("; ")}`;
    }
    if (aiError) {
      notes += (notes ? " " : "") + `Falha na validação automática (${aiError}). Conferência manual obrigatória.`;
    }
    if (matchesByForm && matchesByAi === true && !cnpjMismatch) {
      finalMatches = true;
      notes = "Valor digitado e valor extraído da NF conferem com o pedido.";
    }

    // Confiança baixa na leitura da IA: mesmo batendo o valor, NÃO auto-concilia.
    const lowConfidence = finalMatches && aiConfidence === "baixa";
    if (lowConfidence) {
      notes = "Leitura com confiança baixa — revisão manual necessária. " + notes;
    }
    const finalStatus = lowConfidence ? "recebida" : (finalMatches ? "conciliada" : "divergente");

    await supabase.from("invoices").update({
      status: finalStatus,
      reconciliation_notes: notes,
    }).eq("id", invoice.id);

    // Verifica se todas as NF do pagamento já foram processadas
    const { data: allInv } = await supabase.from("invoices").select("status").eq("payment_id", invoice.payment_id);
    const relevant = (allInv ?? []).filter((i) => i.status !== "cancelada");
    const allDone = relevant.every((i) =>
      i.status === "conciliada" || i.status === "divergente" || i.status === "recebida"
    );
    const anyDiverg = relevant.some((i) => i.status === "divergente");
    const anyManual = relevant.some((i) => i.status === "recebida");
    let paymentStatus = "nf_recebida";
    if (allDone) {
      paymentStatus = anyDiverg ? "nf_divergente" : (anyManual ? "nf_recebida" : "nf_conciliada");
      await supabase.from("payments").update({ status: paymentStatus }).eq("id", invoice.payment_id);
      const __hid4 = await getHospitalId(invoice.payment_id);
      const { error: obsErr4 } = await supabase.from("payment_observations").insert({
        payment_id: invoice.payment_id,
        hospital_id: __hid4,
        author_type: "sistema",
        message: anyDiverg
          ? "Todas as NF recebidas, mas há divergência."
          : anyManual
            ? "Todas as NF recebidas; há NF aguardando revisão manual (confiança baixa na leitura)."
            : "Todas as NF recebidas e conciliadas com sucesso.",
        status_to: paymentStatus,
      });
      if (obsErr4) console.error("[submit-invoice] payment_observations insert error", obsErr4);
    } else {
      await supabase.from("payments").update({ status: "nf_recebida" }).eq("id", invoice.payment_id);
    }

    // Notifica o analista em TODA chegada de NF (independente de ser a última do
    // lote) — inclusive quando o resultado exige atenção (divergência/revisão).
    {
      const { data: grp } = invoice.company_group_id
        ? await supabase
          .from("payment_company_groups")
          .select("company_name")
          .eq("id", invoice.company_group_id)
          .maybeSingle()
        : { data: null as { company_name?: string } | null };

      const reason = finalStatus === "divergente"
        ? `NF recebida com divergência. ${notes}`
        : finalStatus === "recebida"
          ? `NF recebida — revisão manual necessária. ${notes}`
          : null;

      console.log(`Triggering notify-analyst-event (nf_received) for payment ${invoice.payment_id} [${finalStatus}]`);
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-analyst-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          paymentId: invoice.payment_id,
          eventType: "nf_received",
          actorName: grp?.company_name ?? invoice.company_name ?? undefined,
          reason,
        }),
      }).catch((e) => console.error("Failed to notify analyst (nf_received):", e));
    }


    return new Response(
      JSON.stringify({
        ok: true,
        matches: finalMatches,
        form_diff: formDiff,
        ai_amount: aiAmount,
        ai_diff: aiDiff,
        ai_error: aiError,
        notes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});