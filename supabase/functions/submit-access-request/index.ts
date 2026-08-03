// Público por design: recebe o formulário de "Solicitar acesso" da tela de login.
// Valida CAPTCHA (Cloudflare Turnstile) + rate-limit antes de gravar em access_requests
// com service role. A política RLS de INSERT direto por anon/authenticated foi removida.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Limites — conservadores o bastante para uso legítimo, restritivos para abuso.
const MAX_PER_IP_HOUR = 3;
const MAX_PER_IP_DAY = 10;
const MAX_PER_EMAIL_DAY = 2;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyCaptcha(token: string, ip: string): Promise<{ ok: boolean; reason?: string }> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) {
    // Bootstrap: enquanto o secret não é configurado, o rate-limit segue ativo.
    console.warn("[submit-access-request] TURNSTILE_SECRET_KEY ausente — CAPTCHA não verificado");
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "captcha_missing" };
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json() as { success?: boolean };
    return data?.success ? { ok: true } : { ok: false, reason: "captcha_invalid" };
  } catch (e) {
    console.error("[submit-access-request] falha ao verificar captcha", e);
    return { ok: false, reason: "captcha_unavailable" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const full_name = str(payload.full_name, 160);
  const email = str(payload.email, 200).toLowerCase();
  const phone = str(payload.phone, 20).replace(/\D/g, "");
  const role_title = str(payload.role_title, 120);
  const department = str(payload.department, 120);
  const birth_date = str(payload.birth_date, 10);
  const message = str(payload.message, 1000);
  const captchaToken = str(payload.captcha_token, 4000);

  const errors: string[] = [];
  if (full_name.length < 3) errors.push("Informe o nome completo.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido.");
  if (phone.length < 10 || phone.length > 11) errors.push("Telefone inválido.");
  if (!role_title) errors.push("Informe o cargo.");
  if (!department) errors.push("Informe o setor.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) errors.push("Data de nascimento inválida.");
  if (errors.length) return json({ error: "validation_failed", details: errors }, 400);

  const ip =
    req.headers.get("cf-connecting-ip") ??
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipHash = ip ? await sha256(ip + (Deno.env.get("SUPABASE_URL") ?? "")) : null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate-limit antes do captcha para não gastar chamada externa em flood.
  const nowMs = Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  if (ipHash) {
    const [{ count: hourCount, error: e1 }, { count: dayCount, error: e2 }] = await Promise.all([
      admin.from("access_request_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", hourAgo),
      admin.from("access_request_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", dayAgo),
    ]);
    if (e1 || e2) {
      console.error("[submit-access-request] falha ao ler rate-limit", e1 ?? e2);
      return json({ error: "internal_error" }, 500);
    }
    if ((hourCount ?? 0) >= MAX_PER_IP_HOUR || (dayCount ?? 0) >= MAX_PER_IP_DAY) {
      return json({ error: "rate_limited" }, 429);
    }
  }

  const { count: emailCount, error: emailCountErr } = await admin
    .from("access_request_attempts").select("id", { count: "exact", head: true })
    .eq("email", email).gte("created_at", dayAgo);
  if (emailCountErr) {
    console.error("[submit-access-request] falha ao ler rate-limit por e-mail", emailCountErr);
    return json({ error: "internal_error" }, 500);
  }
  if ((emailCount ?? 0) >= MAX_PER_EMAIL_DAY) {
    return json({ error: "rate_limited" }, 429);
  }

  const captcha = await verifyCaptcha(captchaToken, ip);
  if (!captcha.ok) return json({ error: captcha.reason ?? "captcha_invalid" }, 403);

  // Registra a tentativa (mesmo que a gravação falhe adiante) para o rate-limit.
  const { error: attemptErr } = await admin
    .from("access_request_attempts")
    .insert({ ip_hash: ipHash, email });
  if (attemptErr) {
    console.error("[submit-access-request] falha ao registrar tentativa", attemptErr);
    return json({ error: "internal_error" }, 500);
  }

  // Mesmas invariantes que a antiga política RLS impunha.
  const { error: insertErr } = await admin.from("access_requests").insert({
    full_name,
    email,
    phone,
    role_title,
    department,
    birth_date,
    message: message || null,
    status: "pendente",
    hospital_id: null,
    requested_roles: ["analista"],
  });

  if (insertErr) {
    if (/duplicate|unique/i.test(insertErr.message)) {
      return json({ error: "duplicate_pending" }, 409);
    }
    console.error("[submit-access-request] falha ao gravar solicitação", insertErr);
    return json({ error: "internal_error" }, 500);
  }

  return json({ ok: true });
});
