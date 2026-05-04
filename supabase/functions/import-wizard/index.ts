// Edge function genérica para o fluxo de importação Excel/CSV.
// Modo:
//  - "commit"  : recebe linhas já mapeadas/validadas no navegador e grava no banco
//
// O cliente envia: { mode, records, totalRows?, replaceBefore?, profile }
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

// O parsing de Excel/CSV roda no navegador. A função recebe somente linhas já mapeadas,
// reduzindo CPU no runtime serverless e evitando WORKER_RESOURCE_LIMIT.

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
    const { mode, records: incomingRecords, totalRows, replaceBefore, profile } = body as {
      mode: "parse" | "preview" | "commit";
      records?: Record<string, any>[];
      totalRows?: number;
      replaceBefore?: boolean;
      profile?: Profile;
    };

    if (mode !== "commit") {
      return new Response(JSON.stringify({ error: "Parsing e validação agora são executados no navegador" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile || !ALLOWED_ENTITIES.has(profile.entity)) {
      return new Response(JSON.stringify({ error: "profile inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(incomingRecords)) {
      return new Response(JSON.stringify({ error: "records obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { valid, errors, dups } = validate(incomingRecords, profile.fields);

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
      // Pré-carrega mapa de empresas por nome só quando houver vínculo de médicos no lote
      let companyByName = new Map<string, string>();
      const hasDoctorCompanies = profile.entity === "doctors" && records.some((rec) => Array.isArray(rec.companies_raw) && rec.companies_raw.length > 0);
      if (hasDoctorCompanies) {
        const { data: comps } = await admin.from("companies").select("id,name");
        for (const c of (comps ?? []) as any[]) {
          companyByName.set(String(c.name).toLowerCase().trim(), c.id);
        }
      }

      // Modo replace: apaga antes
      if (importMode === "replace" && replaceBefore !== false) {
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

      // Pós-processo em lote: vínculos doctor -> companies por nome
      if (hasDoctorCompanies) {
        const crms = [...new Set(records.map((rec) => String(rec.crm ?? "")).filter(Boolean))];
        const { data: docs } = await admin.from("doctors").select("id,crm,crm_uf").in("crm", crms);
        const doctorByKey = new Map<string, string>();
        for (const doc of (docs ?? []) as any[]) doctorByKey.set(`${doc.crm}||${doc.crm_uf}`, doc.id);
        const links: { doctor_id: string; company_id: string }[] = [];
        const doctorIds = new Set<string>();
        for (const rec of records) {
          const doctorId = doctorByKey.get(`${rec.crm}||${rec.crm_uf}`);
          if (!doctorId) continue;
          const cids = (Array.isArray(rec.companies_raw) ? rec.companies_raw : [])
            .map((n: string) => companyByName.get(String(n).toLowerCase().trim()))
            .filter(Boolean) as string[];
          for (const cid of [...new Set(cids)]) links.push({ doctor_id: doctorId, company_id: cid });
          if (cids.length) doctorIds.add(doctorId);
        }
        if (doctorIds.size) await admin.from("doctor_companies").delete().in("doctor_id", [...doctorIds]);
        if (links.length) await admin.from("doctor_companies").insert(links);
      }
    }

    const totalAffected = inserted + updated;
    return new Response(
      JSON.stringify({
        total: typeof totalRows === "number" ? totalRows : incomingRecords.length,
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
