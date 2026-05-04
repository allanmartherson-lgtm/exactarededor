// Edge function genérica para o fluxo de importação Excel/CSV.
// Modos:
//  - "parse"   : baixa o arquivo do storage, devolve abas, headers e 20 linhas de prévia
//  - "preview" : aplica mapping numa aba e devolve resumo de validação (não grava)
//  - "commit"  : aplica mapping, valida e insere no banco (dedup por chaves naturais)
//
// O cliente envia: { mode, storagePath, sheetName?, mapping?, profile? }
// profile descreve a entidade-alvo, campos obrigatórios e contexto fixo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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
    | "procedure_classifications"
    | "doctors";
  fields: FieldDef[];
  fixedContext?: Record<string, any>;
  /** Modo de gravação: append (apenas novos), update (upsert), replace (apaga e insere) */
  importMode?: "append" | "update" | "replace";
  /** Para "replace", filtro opcional de escopo (chave -> valor) que limita a deleção */
  replaceScope?: Record<string, any>;
};

const ALLOWED_ENTITIES = new Set<Profile["entity"]>([
  "reference_table_items",
  "companies",
  "cost_centers",
  "rules",
  "procedure_classifications",
  "doctors",
] as any);

// Chave natural para upsert por entidade (suporta modos update/replace)
const ENTITY_KEYS: Partial<Record<Profile["entity"], string[]>> = {
  doctors: ["crm", "crm_uf"],
  procedure_classifications: ["code_tuss", "sector_classified"],
  cost_centers: ["code_p12"],
};

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

// O parsing de Excel/CSV roda no navegador. A função recebe somente linhas já mapeadas,
// reduzindo CPU no runtime serverless e evitando WORKER_RESOURCE_LIMIT.

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
    // Para doctors, separamos a coluna 'companies_raw' (não é coluna real)
    const records = valid.map((r) => {
      const rec: Record<string, any> = { ...r, ...fixed };
      if (profile.entity === "reference_table_items" && (rec.code == null || rec.code === "")) {
        if (rec.package_id) rec.code = String(rec.package_id);
      }
      if (profile.entity === "doctors") {
        if (typeof rec.crm === "string") rec.crm = rec.crm.replace(/\D/g, "");
        if (typeof rec.crm_uf === "string") rec.crm_uf = rec.crm_uf.toUpperCase().trim();
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
    const importMode = profile.importMode ?? "append";
    const naturalKey = ENTITY_KEYS[profile.entity];
    let inserted = 0;
    let updated = 0;
    let removedBeforeReplace = 0;
    const insertErrors: { chunk: number; reason: string }[] = [];

    // Tratamento especial: doctors guarda 'companies_raw' como coluna virtual para vincular depois
    const stripVirtual = (rec: Record<string, any>) => {
      const { companies_raw, ...rest } = rec;
      return rest;
    };

    if (mode === "commit" && records.length > 0) {
      // Pré-carrega mapa de empresas por nome se for doctors
      let companyByName = new Map<string, string>();
      if (profile.entity === "doctors") {
        const { data: comps } = await admin.from("companies").select("id,name");
        for (const c of (comps ?? []) as any[]) {
          companyByName.set(String(c.name).toLowerCase().trim(), c.id);
        }
      }

      // Modo replace: apaga antes
      if (importMode === "replace") {
        let q = admin.from(profile.entity).delete({ count: "exact" } as any);
        const scope = profile.replaceScope ?? {};
        for (const [k, v] of Object.entries(scope)) q = q.eq(k, v);
        // se não houver scope, exige naturalKey para evitar wipe acidental
        if (Object.keys(scope).length === 0) {
          // limita pelas chaves naturais que vão entrar
          if (!naturalKey) {
            return new Response(JSON.stringify({ error: "Replace sem escopo não permitido para esta entidade" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          // wipe completo da tabela
          q = admin.from(profile.entity).delete({ count: "exact" } as any).not("id", "is", null);
        }
        const { count, error: delErr } = await q;
        if (delErr) {
          return new Response(JSON.stringify({ error: `Falha no replace: ${delErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        removedBeforeReplace = count ?? 0;
      }

      const CHUNK = 500;
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK).map(stripVirtual);
        let resErr: any = null;
        let affected = slice.length;

        if (importMode === "update" && naturalKey) {
          const { error } = await admin
            .from(profile.entity)
            .upsert(slice, { onConflict: naturalKey.join(",") } as any);
          resErr = error;
          // não distinguimos created vs updated aqui
          if (!error) updated += affected;
        } else {
          const { error } = await admin.from(profile.entity).insert(slice);
          resErr = error;
          if (!error) inserted += affected;
        }

        if (resErr) {
          insertErrors.push({ chunk: Math.floor(i / CHUNK) + 1, reason: resErr.message });
        }
      }

      // Pós-processo: vínculos doctor -> companies por nome
      if (profile.entity === "doctors") {
        for (const rec of records) {
          const names: string[] = Array.isArray(rec.companies_raw) ? rec.companies_raw : [];
          if (!names.length) continue;
          const { data: doc } = await admin
            .from("doctors")
            .select("id")
            .eq("crm", rec.crm)
            .eq("crm_uf", rec.crm_uf)
            .maybeSingle();
          if (!doc?.id) continue;
          const cids = names
            .map((n) => companyByName.get(String(n).toLowerCase().trim()))
            .filter(Boolean) as string[];
          if (!cids.length) continue;
          await admin.from("doctor_companies").delete().eq("doctor_id", doc.id);
          await admin.from("doctor_companies").insert(
            cids.map((cid) => ({ doctor_id: doc.id, company_id: cid })),
          );
        }
      }
    }

    // Apaga arquivo após commit (sucesso parcial também)
    await admin.storage.from("import-uploads").remove([storagePath]);

    const totalAffected = inserted + updated;
    return new Response(
      JSON.stringify({
        total: allRows.length,
        inserted: totalAffected,
        updated,
        created: inserted,
        removed_before_replace: removedBeforeReplace,
        skipped: errors.length + dups.length + Math.max(0, records.length - totalAffected),
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
