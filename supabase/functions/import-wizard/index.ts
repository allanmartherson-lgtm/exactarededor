// Edge function genérica para o fluxo de importação Excel/CSV.
// Modos:
//  - "parse"   : baixa o arquivo do storage, devolve abas, headers e 20 linhas de prévia
//  - "preview" : aplica mapping numa aba e devolve resumo de validação (não grava)
//  - "commit"  : aplica mapping, valida e insere no banco (dedup por chaves naturais)
//
// O cliente envia: { mode, storagePath, sheetName?, mapping?, profile? }
// profile descreve a entidade-alvo, campos obrigatórios e contexto fixo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "boolean";
  aliases?: string[];
  uniqueKey?: boolean; // usado para detectar duplicidade
};

type Profile = {
  // Tabela destino (whitelist apenas as suportadas)
  entity:
    | "reference_table_items"
    | "companies"
    | "cost_centers"
    | "rules"
    | "procedure_classifications";
  fields: FieldDef[];
  fixedContext?: Record<string, any>;
};

const ALLOWED_ENTITIES = new Set<Profile["entity"]>([
  "reference_table_items",
  "companies",
  "cost_centers",
  "rules",
  "procedure_classifications",
]);

const norm = (s: any) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const parseNumber = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[R$\s]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
};

function suggestMapping(headers: string[], fields: FieldDef[]) {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(norm);
    let best: string | null = null;
    for (const h of headers) {
      if (used.has(h)) continue;
      const nh = norm(h);
      if (candidates.includes(nh) || candidates.some((c) => c && nh.includes(c))) {
        best = h;
        break;
      }
    }
    out[f.key] = best;
    if (best) used.add(best);
  }
  return out;
}

function rowsFromBuffer(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheets: { name: string; headers: string[]; total: number; preview: any[] }[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const all = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
    const headers = all.length ? Object.keys(all[0]) : [];
    sheets.push({ name, headers, total: all.length, preview: all.slice(0, 20) });
  }
  return { wb, sheets };
}

function applyMapping(rows: any[], mapping: Record<string, string | null>, fields: FieldDef[]) {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      const src = mapping[f.key];
      const raw = src ? row[src] : undefined;
      if (f.type === "number") out[f.key] = parseNumber(raw);
      else if (f.type === "boolean") {
        const s = String(raw ?? "").toLowerCase().trim();
        out[f.key] = ["1", "true", "sim", "s", "yes", "y", "ativo"].includes(s);
      } else out[f.key] = raw == null ? null : String(raw).trim();
    }
    return out;
  });
}

function validate(mapped: any[], fields: FieldDef[]) {
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  const uniqueKeys = fields.filter((f) => f.uniqueKey).map((f) => f.key);
  const seen = new Set<string>();
  const errors: { row: number; reason: string }[] = [];
  const dups: { row: number; key: string }[] = [];
  const valid: any[] = [];
  mapped.forEach((r, i) => {
    const missing = requiredKeys.filter((k) => r[k] == null || r[k] === "");
    if (missing.length) {
      errors.push({ row: i + 2, reason: `Campos obrigatórios ausentes: ${missing.join(", ")}` });
      return;
    }
    if (uniqueKeys.length) {
      const k = uniqueKeys.map((u) => String(r[u]).toLowerCase()).join("||");
      if (seen.has(k)) {
        dups.push({ row: i + 2, key: k });
        return;
      }
      seen.add(k);
    }
    valid.push(r);
  });
  return { valid, errors, dups };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Cliente com token do usuário (para validar role)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = userData.user.id;
    const { data: rolesData } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    const roles = (rolesData ?? []).map((r: any) => r.role);
    const isAdminish = roles.includes("admin") || roles.includes("diretor");
    if (!isAdminish) {
      return new Response(JSON.stringify({ error: "acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { mode, storagePath, sheetName, mapping, profile } = body as {
      mode: "parse" | "preview" | "commit";
      storagePath: string;
      sheetName?: string;
      mapping?: Record<string, string | null>;
      profile?: Profile;
    };

    if (!storagePath || typeof storagePath !== "string") {
      return new Response(JSON.stringify({ error: "storagePath obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Baixa arquivo do storage
    const { data: file, error: dlErr } = await admin.storage
      .from("import-uploads")
      .download(storagePath);
    if (dlErr || !file) throw new Error(`Falha ao baixar arquivo: ${dlErr?.message}`);
    const buf = await file.arrayBuffer();
    const { sheets } = rowsFromBuffer(buf);

    if (mode === "parse") {
      return new Response(JSON.stringify({ sheets }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile || !ALLOWED_ENTITIES.has(profile.entity)) {
      return new Response(JSON.stringify({ error: "profile inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];
    if (!sheet) throw new Error("Aba não encontrada");

    // Recupera as linhas inteiras (não só preview)
    const wbFull = XLSX.read(buf, { type: "array" });
    const allRows = XLSX.utils.sheet_to_json<any>(wbFull.Sheets[sheet.name], { defval: "" });
    const effectiveMapping = mapping ?? suggestMapping(sheet.headers, profile.fields);
    const mapped = applyMapping(allRows, effectiveMapping, profile.fields);
    const { valid, errors, dups } = validate(mapped, profile.fields);

    // Anexa contexto fixo
    const fixed = profile.fixedContext ?? {};
    const records = valid.map((r) => ({ ...r, ...fixed }));

    if (mode === "preview") {
      return new Response(
        JSON.stringify({
          summary: {
            total: allRows.length,
            valid: valid.length,
            errors: errors.length,
            duplicates: dups.length,
          },
          errors: errors.slice(0, 50),
          duplicates: dups.slice(0, 50),
          mapping: effectiveMapping,
          sample: records.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // commit
    if (records.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, errors: errors.length, duplicates: dups.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const { error } = await admin.from(profile.entity).insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    // Apaga arquivo após commit
    await admin.storage.from("import-uploads").remove([storagePath]);

    return new Response(
      JSON.stringify({
        inserted,
        errors: errors.length,
        duplicates: dups.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
