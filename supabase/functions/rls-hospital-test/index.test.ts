import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
// A função é um diagnóstico privilegiado (cria/apaga auth.users): só aceita
// service_role ou o token interno de cron. O anon key sozinho retorna 401.
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_TOKEN = Deno.env.get("INTERNAL_CRON_TOKEN") ?? Deno.env.get("CRON_SECRET") ?? "";

Deno.test("RLS hospital isolation — user A cannot read hospital B (and vice-versa)", async () => {
  if (!SERVICE_KEY && !CRON_TOKEN) {
    throw new Error(
      "Faltam credenciais: defina SUPABASE_SERVICE_ROLE_KEY ou INTERNAL_CRON_TOKEN para rodar o teste de RLS.",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_KEY || ANON_KEY}`,
    apikey: ANON_KEY,
  };
  if (CRON_TOKEN) headers["x-cron-secret"] = CRON_TOKEN;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/rls-hospital-test`, {
    method: "POST",
    headers,
  });

  const body = await res.json();

  if (!body.ok) {
    console.error("RLS TEST FAILURES:\n" + (body.failures ?? []).join("\n"));
  } else {
    console.log(`RLS TEST PASSED — ${body.checked} tabelas verificadas, 0 vazamentos.`);
  }

  assertEquals(body.ok, true, `RLS isolation failed: ${JSON.stringify(body.failures)}`);
  assertEquals(body.leaks, 0);
});
