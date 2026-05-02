// Edge function: lê o PDF da NF anexado pelo recebedor, usa Lovable AI
// (multimodal) para extrair valor bruto, número da NF e CNPJ do emissor,
// e compara com o pedido. Atualiza `invoices.ai_validation` e os campos
// extraídos. Não muda o status da NF (isso fica com `submit-invoice`,
// que decide o status final somando comparação numérica + parecer da IA).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const onlyDigits = (s: string | null | undefined) =>
  (s ?? "").replace(/\D/g, "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { invoice_id } = await req.json();
    if (!invoice_id || typeof invoice_id !== "string") {
      return json({ error: "invoice_id is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, file_path, expected_amount, received_amount, invoice_number, payment_id")
      .eq("id", invoice_id)
      .maybeSingle();
    if (invErr || !invoice) return json({ error: "invoice not found" }, 404);
    if (!invoice.file_path) return json({ error: "no file attached" }, 400);

    // Baixa o PDF do storage (bucket privado) com a service role
    const { data: fileBlob, error: dlErr } = await supabase
      .storage.from("invoices").download(invoice.file_path);
    if (dlErr || !fileBlob) return json({ error: "cannot download file" }, 500);

    const arrayBuf = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    // base64 em chunks pra evitar stack overflow em PDFs grandes
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[],
      );
    }
    const base64 = btoa(binary);
    const ext = invoice.file_path.split(".").pop()?.toLowerCase() ?? "pdf";
    const mime = ext === "xml" ? "text/xml" : "application/pdf";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const tools = [{
      type: "function",
      function: {
        name: "report_invoice_fields",
        description:
          "Reporta os campos extraídos da nota fiscal anexada e divergências encontradas em relação ao pedido.",
        parameters: {
          type: "object",
          properties: {
            extracted_amount: { type: ["number", "null"], description: "Valor bruto da NF em reais (somente número)." },
            extracted_number: { type: ["string", "null"], description: "Número da NF como aparece no documento." },
            extracted_cnpj:   { type: ["string", "null"], description: "CNPJ do emissor (somente dígitos)." },
            issue_date:       { type: ["string", "null"], description: "Data de emissão (YYYY-MM-DD) se identificada." },
            divergences: {
              type: "array",
              items: { type: "string" },
              description: "Lista de divergências encontradas entre a NF e o pedido (valor, número informado, CNPJ etc.).",
            },
            confidence: { type: "string", enum: ["alta", "media", "baixa"] },
            notes: { type: "string", description: "Observações curtas sobre a leitura do documento." },
          },
          required: ["extracted_amount", "divergences", "confidence"],
          additionalProperties: false,
        },
      },
    }];

    const userPrompt =
      `Você está conferindo uma nota fiscal anexada por um prestador.\n` +
      `Pedido: valor esperado R$ ${Number(invoice.expected_amount).toFixed(2)}` +
      (invoice.invoice_number ? `, número informado pelo prestador: ${invoice.invoice_number}` : "") +
      `.\nExtraia os campos da NF (valor bruto, número, CNPJ do emissor, data) e liste qualquer divergência ` +
      `entre a NF e o pedido. Se o valor bruto da NF for diferente do esperado em mais de R$ 0,01, ` +
      `liste a divergência. Se o número informado pelo prestador não bater com o número impresso na NF, ` +
      `liste a divergência. Use a função report_invoice_fields para responder.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um auditor financeiro que confere notas fiscais." },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_invoice_fields" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      // Status 402/429 são informativos pro chamador
      return json({ error: "ai_error", status: aiResp.status, detail: txt.slice(0, 500) }, 502);
    }

    const aiData = await aiResp.json();
    const call = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    if (call?.function?.arguments) {
      try { parsed = JSON.parse(call.function.arguments); } catch { /* keep empty */ }
    }

    const extractedAmount = parsed.extracted_amount as number | null;
    const extractedNumber = (parsed.extracted_number as string | null) ?? null;
    const extractedCnpj   = onlyDigits(parsed.extracted_cnpj as string) || null;
    const divergences     = Array.isArray(parsed.divergences) ? parsed.divergences as string[] : [];
    const confidence      = (parsed.confidence as string) ?? "media";

    await supabase.from("invoices").update({
      ai_validation: { ...parsed, model: "google/gemini-2.5-flash" },
      ai_validated_at: new Date().toISOString(),
      ai_extracted_amount: extractedAmount,
      ai_extracted_number: extractedNumber,
      ai_extracted_cnpj: extractedCnpj,
    }).eq("id", invoice.id);

    return json({ ok: true, divergences, confidence, extracted_amount: extractedAmount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("validate-invoice-pdf error", msg);
    return json({ error: msg }, 500);
  }
});