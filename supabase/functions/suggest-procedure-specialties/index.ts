// Edge function: gera/atualiza sugestões na tabela procedure_specialty_map.
// Para cada procedure_code com >= MIN_SAMPLE ocorrências em payment_items,
// conta as especialidades dos médicos (via doctors.specialties) e, se uma
// concentra >= MIN_CONFIDENCE, cria/atualiza linha como 'sugerido'.
// Nunca sobrescreve linhas com status 'aprovado' ou 'rejeitado'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SAMPLE = 10;
const MIN_CONFIDENCE = 0.6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Carrega itens com código + nome do médico (limita aos últimos 12 meses)
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const { data: items, error: itemsErr } = await supabase
    .from("payment_items")
    .select("procedure_code,procedure_name,doctor_name")
    .not("procedure_code", "is", null)
    .gte("created_at", since.toISOString());

  if (itemsErr) {
    return new Response(JSON.stringify({ error: itemsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Carrega especialidades de médicos
  const docNames = Array.from(new Set(
    (items ?? []).map((i: any) => String(i.doctor_name ?? "").trim()).filter(Boolean),
  ));
  const docSpecs: Record<string, string[]> = {};
  if (docNames.length > 0) {
    const { data: docs } = await supabase
      .from("doctors")
      .select("full_name,specialties,active")
      .in("full_name", docNames);
    for (const d of (docs ?? []) as any[]) {
      if (d.active === false) continue;
      docSpecs[String(d.full_name)] = Array.isArray(d.specialties) ? d.specialties : [];
    }
  }

  // 3. Agrega: { code: { specialty: count, total, descByCode } }
  const agg: Record<string, { counts: Record<string, number>; total: number; desc: string | null }> = {};
  for (const it of (items ?? []) as any[]) {
    const code = String(it.procedure_code ?? "").trim();
    if (!code) continue;
    const docName = String(it.doctor_name ?? "").trim();
    const specs = docSpecs[docName] ?? [];
    if (specs.length === 0) continue;
    if (!agg[code]) agg[code] = { counts: {}, total: 0, desc: it.procedure_name ?? null };
    // Se médico tem múltiplas, distribui igualmente (peso 1/N)
    const w = 1 / specs.length;
    for (const s of specs) {
      const k = s.trim();
      if (!k) continue;
      agg[code].counts[k] = (agg[code].counts[k] ?? 0) + w;
      agg[code].total += w;
    }
  }

  // 4. Carrega linhas existentes para pular aprovadas/rejeitadas
  const codes = Object.keys(agg);
  const existing: Record<string, string> = {};
  if (codes.length > 0) {
    const { data: rows } = await supabase
      .from("procedure_specialty_map")
      .select("procedure_code,status")
      .in("procedure_code", codes);
    for (const r of (rows ?? []) as any[]) {
      existing[String(r.procedure_code)] = String(r.status);
    }
  }

  // 5. Gera sugestões
  let suggested = 0;
  let skipped = 0;
  for (const [code, data] of Object.entries(agg)) {
    if (data.total < MIN_SAMPLE) { skipped++; continue; }
    const sorted = Object.entries(data.counts).sort((a, b) => b[1] - a[1]);
    const [topSpec, topCount] = sorted[0];
    const conf = topCount / data.total;
    if (conf < MIN_CONFIDENCE) { skipped++; continue; }
    const status = existing[code];
    if (status === "aprovado" || status === "rejeitado") { skipped++; continue; }

    const { error: upErr } = await supabase
      .from("procedure_specialty_map")
      .upsert({
        procedure_code: code,
        medical_specialty: topSpec,
        status: "sugerido",
        confidence_pct: Math.round(conf * 100),
        sample_size: Math.round(data.total),
        description: data.desc,
      }, { onConflict: "procedure_code" });
    if (!upErr) suggested++;
  }

  return new Response(
    JSON.stringify({ ok: true, suggested, skipped, codes_analyzed: codes.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
