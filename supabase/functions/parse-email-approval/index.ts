// Edge function: parse-email-approval
// Lê o arquivo de aprovação anexado (PDF ou imagem), extrai aprovador/data/frase
// via Lovable AI (Gemini multimodal) e cruza com hospital_directors para decidir
// se a aprovação está VALIDADA ou DIVERGENTE.
//
// Input:  { approval_id: string }
// Output: { status, extracted, matched_director_id, validation_errors }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

type Extracted = {
  approver_name: string | null;
  approver_email: string | null;
  approved_at_text: string | null;
  approved_at_iso: string | null;
  approval_phrase: string | null;
  confidence: number | null;
};

const SYSTEM_PROMPT = `Você analisa imagens/PDFs de aprovações por e-mail de pagamentos médicos.
Sempre responda em JSON puro, sem markdown, no formato:
{
  "approver_name": string|null,        // nome completo de quem aprovou (assinatura/remetente)
  "approver_email": string|null,       // e-mail do aprovador (formato user@dominio)
  "approved_at_text": string|null,     // data/hora exatamente como aparece no documento
  "approved_at_iso": string|null,      // mesma data convertida para ISO 8601 (UTC) se possível
  "approval_phrase": string|null,      // trecho curto que confirma a aprovação (ex: "Aprovado", "Pode pagar", "OK")
  "confidence": number                 // 0 a 1, quão certo você está
}
Se não encontrar alguma informação, use null. Não invente.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);


  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!supabaseUrl || !serviceKey || !lovableKey) {
    return new Response(JSON.stringify({ error: "missing_env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let approval_id: string | undefined;
  try { ({ approval_id } = await req.json()); } catch { /* */ }
  if (!approval_id) {
    return new Response(JSON.stringify({ error: "approval_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Carrega a aprovação
  const { data: approval, error: loadErr } = await supabase
    .from("payment_email_approvals")
    .select("id, payment_id, hospital_id, file_path, file_mime, status, parse_attempts")
    .eq("id", approval_id)
    .maybeSingle();
  if (loadErr || !approval) {
    return new Response(JSON.stringify({ error: "approval_not_found", details: loadErr?.message }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Gate de hospital: chamadores não-internos só acessam aprovações do próprio hospital.
  if (!assertCallerHospital(auth, (approval as { hospital_id?: string }).hospital_id ?? "")) {
    return new Response(JSON.stringify({ error: "hospital_scope_denied", message: "Sem acesso a este hospital." }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (approval.status === "applied" || approval.status === "rejected") {
    return new Response(JSON.stringify({ error: "approval_already_finalized", status: approval.status }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Marca como em parsing
  await supabase.from("payment_email_approvals").update({
    status: "parsing",
    parse_attempts: (approval.parse_attempts ?? 0) + 1,
  }).eq("id", approval.id);

  // 2) Baixa o arquivo do storage
  const { data: file, error: dlErr } = await supabase.storage
    .from("payment-email-approvals").download(approval.file_path);
  if (dlErr || !file) {
    await supabase.from("payment_email_approvals").update({
      status: "parse_failed",
      validation_errors: [`Não foi possível baixar o arquivo: ${dlErr?.message ?? "unknown"}`],
    }).eq("id", approval.id);
    return new Response(JSON.stringify({ error: "download_failed", details: dlErr?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  // base64 sem estourar a stack em arquivos grandes
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  const base64 = btoa(bin);

  const mime = approval.file_mime || "application/octet-stream";
  const isPdf = mime.includes("pdf");
  const isImage = mime.startsWith("image/");

  if (!isPdf && !isImage) {
    await supabase.from("payment_email_approvals").update({
      status: "parse_failed",
      validation_errors: [`Tipo de arquivo não suportado: ${mime}. Envie PDF ou imagem (PNG/JPG).`],
    }).eq("id", approval.id);
    return new Response(JSON.stringify({ error: "unsupported_mime", mime }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3) Chama Lovable AI
  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: "Extraia os dados da aprovação deste e-mail." },
  ];
  if (isImage) {
    userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
  } else {
    userContent.push({
      type: "file",
      file: { filename: "aprovacao.pdf", file_data: `data:${mime};base64,${base64}` },
    });
  }

  const model = "google/gemini-2.5-flash";
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": lovableKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiResp.ok) {
    const errBody = await aiResp.text();
    const code = aiResp.status === 429 ? "rate_limited"
              : aiResp.status === 402 ? "credits_exhausted"
              : "ai_error";
    await supabase.from("payment_email_approvals").update({
      status: "parse_failed",
      validation_errors: [`Falha na IA (${code}): ${errBody.slice(0, 300)}`],
      ai_model: model,
    }).eq("id", approval.id);
    return new Response(JSON.stringify({ error: code, details: errBody }), {
      status: aiResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const aiJson = await aiResp.json();
  const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
  let extracted: Extracted;
  try {
    extracted = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
  } catch {
    await supabase.from("payment_email_approvals").update({
      status: "parse_failed",
      validation_errors: ["A IA respondeu em formato inválido. Tente novamente ou anexe outro arquivo."],
      ai_model: model,
    }).eq("id", approval.id);
    return new Response(JSON.stringify({ error: "invalid_ai_json", raw }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4) Cruzamento com hospital_directors
  const errors: string[] = [];
  let matchedId: string | null = null;
  const approverEmail = (extracted.approver_email ?? "").trim().toLowerCase();
  const approverName = (extracted.approver_name ?? "").trim().toLowerCase();

  if (!approverEmail && !approverName) {
    errors.push("A IA não conseguiu identificar quem aprovou. Confirme manualmente.");
  }
  if (!extracted.approval_phrase) {
    errors.push("Não foi encontrado um texto explícito de aprovação no documento.");
  }

  if (approverEmail || approverName) {
    const { data: directors } = await supabase
      .from("hospital_directors")
      .select("id, full_name, email, active")
      .eq("hospital_id", approval.hospital_id)
      .eq("active", true);
    const list = directors ?? [];

    const byEmail = approverEmail
      ? list.find((d) => (d.email ?? "").trim().toLowerCase() === approverEmail)
      : null;
    const byName = !byEmail && approverName
      ? list.find((d) => (d.full_name ?? "").trim().toLowerCase() === approverName)
      : null;

    const matched = byEmail || byName || null;
    if (!matched) {
      errors.push(
        `Aprovador "${extracted.approver_name ?? extracted.approver_email ?? "?"}" não está cadastrado como diretor autorizado deste hospital.`,
      );
    } else {
      matchedId = matched.id;
      if (approverEmail && (matched.email ?? "").trim().toLowerCase() !== approverEmail) {
        errors.push("O nome bate com um diretor cadastrado, mas o e-mail é diferente. Revise.");
      }
    }
  }

  const finalStatus = errors.length === 0 ? "validated" : "divergent";

  await supabase.from("payment_email_approvals").update({
    status: finalStatus,
    extracted: extracted as unknown as Record<string, unknown>,
    matched_director_id: matchedId,
    validation_errors: errors,
    ai_model: model,
    parsed_at: new Date().toISOString(),
  }).eq("id", approval.id);

  return new Response(JSON.stringify({
    status: finalStatus,
    extracted,
    matched_director_id: matchedId,
    validation_errors: errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
