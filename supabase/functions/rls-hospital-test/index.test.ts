import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("RLS hospital isolation — user A cannot read hospital B (and vice-versa)", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/rls-hospital-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
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
