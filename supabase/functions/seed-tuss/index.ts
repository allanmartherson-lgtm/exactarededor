// seed-tuss: baixa a tabela oficial ANS TUSS (Tabela 22) e faz upsert em
// public.tuss_procedure_names com source='ANS-TUSS-202501'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CSV_URL =
  "https://raw.githubusercontent.com/charlesfgarcia/tabelas-ans/master/TUSS/tabela%2022/Tabela%2022%20-%20Terminologia%20de%20procedimentos%20e%20eventos%20em%20saude.csv";
const SOURCE = "ANS-TUSS-202501";

// Parser CSV simples com suporte a aspas duplas e delimitador ';'.
function parseCsvLine(line: string, delim = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Falha ao baixar CSV: ${res.status}`);
    let text = await res.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    // Detect header
    const first = parseCsvLine(lines[0]);
    const hasHeader = /codigo|c[oó]digo|code/i.test(first[0] ?? "");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const rows: { code: string; canonical_name: string; source: string }[] = [];
    const seen = new Set<string>();
    for (const line of dataLines) {
      const parts = parseCsvLine(line);
      const code = (parts[0] ?? "").replace(/\D/g, "").trim();
      const name = (parts[1] ?? "").trim();
      if (!code || !name) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      rows.push({ code, canonical_name: name, source: SOURCE });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("tuss_procedure_names")
        .upsert(chunk, { onConflict: "code" });
      if (error) throw error;
      upserted += chunk.length;
    }

    console.log(`[seed-tuss] parsed=${rows.length} upserted=${upserted}`);
    return new Response(
      JSON.stringify({ ok: true, parsed: rows.length, upserted, source: SOURCE }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[seed-tuss] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
