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
  type?: "text" | "number" | "boolean" | "array";
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

// Lê apenas metadados (nome, headers, total, 20 linhas de prévia) sem materializar
// todas as linhas de todas as abas — evita estouro de CPU/memória em arquivos grandes.
function readSheetsMeta(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, cellNF: false, cellText: false });
  const sheets: { name: string; headers: string[]; total: number; preview: any[] }[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"];
    if (!ref) {
      sheets.push({ name, headers: [], total: 0, preview: [] });
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    const total = Math.max(0, range.e.r - range.s.r); // exclui linha de header
    // Limita a leitura à faixa de prévia (header + 20 linhas)
    const previewEnd = Math.min(range.e.r, range.s.r + 20);
    const previewRange = { s: range.s, e: { r: previewEnd, c: range.e.c } };
    const preview = XLSX.utils.sheet_to_json<any>(ws, {
      defval: "",
      range: XLSX.utils.encode_range(previewRange),
    });
    const headers = preview.length ? Object.keys(preview[0]) : [];
    sheets.push({ name, headers, total, preview });
  }
  return { wb, sheets };
}

// Lê apenas uma aba inteira (usado em preview/commit)
function readSheetRows(buf: ArrayBuffer, sheetName?: string): { rows: any[]; headers: string[]; name: string } {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, cellNF: false, cellText: false, sheets: sheetName ? [sheetName] : undefined });
  const name = sheetName ?? wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error("Aba não encontrada");
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers, name };
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
      } else if (f.type === "array") {
        const s = String(raw ?? "").trim();
        out[f.key] = s
          ? s.split(/[,;|\/\s]+/).map((x) => x.trim()).filter(Boolean)
          : [];
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

    if (mode === "parse") {
      const { sheets } = readSheetsMeta(buf);
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

    // Lê apenas a aba alvo (não todas) para economizar CPU/memória
    const { rows: allRows, headers: sheetHeaders } = readSheetRows(buf, sheetName);
    const effectiveMapping = mapping ?? suggestMapping(sheetHeaders, profile.fields);
    const mapped = applyMapping(allRows, effectiveMapping, profile.fields);
    const { valid, errors, dups } = validate(mapped, profile.fields);


    // Anexa contexto fixo
    const fixed = profile.fixedContext ?? {};
    const records = valid.map((r) => {
      const rec: Record<string, any> = { ...r, ...fixed };
      // Para reference_table_items: 'code' é NOT NULL. Em pacotes usamos o package_id como code.
      if (profile.entity === "reference_table_items" && (rec.code == null || rec.code === "")) {
        if (rec.package_id) rec.code = String(rec.package_id);
      }
      return rec;
    });

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
    let inserted = 0;
    const insertErrors: { chunk: number; reason: string }[] = [];
    if (records.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const { error } = await admin.from(profile.entity).insert(slice);
        if (error) {
          insertErrors.push({ chunk: i / CHUNK + 1, reason: error.message });
          // continua tentando os próximos chunks
        } else {
          inserted += slice.length;
        }
      }
    }

    // Apaga arquivo após commit (sucesso parcial também)
    await admin.storage.from("import-uploads").remove([storagePath]);

    return new Response(
      JSON.stringify({
        total: allRows.length,
        inserted,
        skipped: errors.length + dups.length + (records.length - inserted),
        validation_errors: errors.length,
        duplicates: dups.length,
        insert_errors: insertErrors,
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
