// Edge function genérica para o fluxo de importação Excel/CSV.
// Modo:
//  - "commit"  : recebe linhas já mapeadas/validadas no navegador e grava no banco
//
// O cliente envia: { mode, records, totalRows?, replaceBefore?, profile }
// profile descreve a entidade-alvo, campos obrigatórios e contexto fixo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
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

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

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
      mode: "parse" | "preview" | "commit" | "dry_run";
      records?: Record<string, any>[];
      totalRows?: number;
      replaceBefore?: boolean;
      profile?: Profile;
    };

    if (mode !== "commit" && mode !== "dry_run") {
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

    // Guard multi-tenant: quando o profile carimba hospital_id no fixedContext
    // (entidades escopadas por hospital, ex.: sectors/convenios), o chamador
    // precisa ter vínculo com esse hospital. Entidades globais (sem hospital_id
    // no fixedContext) seguem só sob checagem de role acima.
    const targetHospitalId = (fixed as any)?.hospital_id ?? null;
    if (targetHospitalId && !_auth.is_internal && !assertCallerHospital(_auth, targetHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
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

    // =====================================================================
    // DRY-RUN: classifica cada registro contra o banco sem gravar nada.
    // Retorna quantos seriam criados / atualizados / ignorados por já
    // existirem (com base no importMode) + amostras para inspeção.
    // =====================================================================
    if (mode === "dry_run") {
      const wouldCreate: Record<string, any>[] = [];
      const wouldUpdate: Record<string, any>[] = [];
      const wouldSkip: Record<string, any>[] = [];
      let existingCount = 0;

      if (records.length > 0 && naturalKey && naturalKey.length > 0) {
        // Busca registros existentes pela chave natural.
        // Estratégia: para chave composta, buscamos pelo 1º campo com IN(...) e
        // depois filtramos no code os que casam a chave completa. Para chave
        // simples, IN direto.
        const firstKey = naturalKey[0];
        const values = [...new Set(records.map((r) => r[firstKey]).filter((v) => v != null && v !== ""))];
        const existingKeys = new Set<string>();
        // Paginação segura para não estourar limite de URL do PostgREST
        const PAGE = 500;
        for (let i = 0; i < values.length; i += PAGE) {
          const slice = values.slice(i, i + PAGE);
          const { data, error } = await admin
            .from(profile.entity)
            .select(naturalKey.join(","))
            .in(firstKey, slice as any);
          if (error) {
            return new Response(
              JSON.stringify({ error: `Falha ao consultar existentes: ${error.message}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          for (const row of (data ?? []) as any[]) {
            existingKeys.add(naturalKey.map((k) => String(row[k] ?? "").toLowerCase()).join("||"));
          }
        }
        existingCount = existingKeys.size;

        for (const rec of records) {
          const k = naturalKey.map((kk) => String(rec[kk] ?? "").toLowerCase()).join("||");
          const exists = existingKeys.has(k);
          if (!exists) {
            wouldCreate.push(rec);
          } else if (importMode === "update" || importMode === "replace") {
            wouldUpdate.push(rec);
          } else {
            wouldSkip.push(rec);
          }
        }
      } else {
        // Sem chave natural, tudo seria insert
        for (const rec of records) wouldCreate.push(rec);
      }

      const sampleFields = naturalKey && naturalKey.length > 0 ? naturalKey : Object.keys(records[0] ?? {}).slice(0, 3);
      const sampleOf = (arr: Record<string, any>[]) =>
        arr.slice(0, 20).map((r) => {
          const out: Record<string, any> = {};
          for (const k of sampleFields) out[k] = r[k];
          return out;
        });

      return new Response(
        JSON.stringify({
          dry_run: true,
          import_mode: importMode,
          total: typeof totalRows === "number" ? totalRows : incomingRecords.length,
          valid: records.length,
          validation_errors: errors.length,
          duplicates: dups.length,
          would_create: wouldCreate.length,
          would_update: wouldUpdate.length,
          would_skip_existing: wouldSkip.length,
          existing_matches: existingCount,
          would_delete_before_replace: importMode === "replace" ? "estimado no commit" : 0,
          samples: {
            create: sampleOf(wouldCreate),
            update: sampleOf(wouldUpdate),
            skip: sampleOf(wouldSkip),
          },
          errors: errors.slice(0, 50),
          duplicates_detail: dups.slice(0, 50),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

      // Pré-carrega cadastro de empresas (por nome + alias + CNPJ) — usado quando o
      // import é de médicos com vínculo a empresas.
      let companyByKey = new Map<string, string>();
      const hasDoctorCompanies = profile.entity === "doctors" && records.some((rec) => Array.isArray(rec.companies_raw) && rec.companies_raw.length > 0);
      if (hasDoctorCompanies) {
        const { data: comps } = await admin.from("companies").select("id,name,aliases,document");
        const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");
        for (const c of (comps ?? []) as any[]) {
          if (c.name) companyByKey.set(`name::${String(c.name).toLowerCase().trim()}`, c.id);
          if (c.document && onlyDigits(c.document)) companyByKey.set(`cnpj::${onlyDigits(c.document)}`, c.id);
          for (const a of (c.aliases ?? []) as string[]) {
            if (a) companyByKey.set(`name::${String(a).toLowerCase().trim()}`, c.id);
          }
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
        } else if (importMode === "append" && naturalKey) {
          // Append inteligente: ignora registros já existentes (mesma chave natural)
          // ao invés de falhar todo o chunk por violação de unique. Assim
          // reimportar uma planilha que já contém médicos cadastrados apenas
          // adiciona os novos, sem erros de "duplicate key".
          const { error, data } = await admin
            .from(profile.entity)
            .upsert(slice, { onConflict: naturalKey.join(","), ignoreDuplicates: true } as any)
            .select("id");
          resErr = error;
          if (!error) inserted += (data?.length ?? 0);
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
      // ATENÇÃO — reescrito em 10/07/2026: nunca fazer delete-then-insert.
      // Regra: preservar vínculos ativos que continuem na nova lista, encerrar (soft-close)
      // os que sumiram, inserir apenas os inéditos com start_date = CURRENT_DATE.
      // Isso evita perda silenciosa de histórico (caso Angioplastika × Cirurgia Brasília, 03/06/2026).
      if (hasDoctorCompanies) {
        const crms = [...new Set(records.map((rec) => String(rec.crm ?? "")).filter(Boolean))];
        const { data: docs } = await admin.from("doctors").select("id,crm,crm_uf").in("crm", crms);
        const doctorByKey = new Map<string, string>();
        for (const doc of (docs ?? []) as any[]) doctorByKey.set(`${doc.crm}||${doc.crm_uf}`, doc.id);

        // Monta desejo: doctor_id -> Set<company_id> vindos da planilha
        const desired = new Map<string, Set<string>>();
        const doctorsInFile = new Set<string>();
        for (const rec of records) {
          const doctorId = doctorByKey.get(`${rec.crm}||${rec.crm_uf}`);
          if (!doctorId) continue;
          doctorsInFile.add(doctorId);
          const cids = (Array.isArray(rec.companies_raw) ? rec.companies_raw : [])
            .map((n: string) => {
              const raw = String(n).trim();
              if (!raw) return undefined;
              const digits = raw.replace(/\D/g, "");
              if (digits.length >= 11) {
                const byCnpj = companyByKey.get(`cnpj::${digits}`);
                if (byCnpj) return byCnpj;
              }
              return companyByKey.get(`name::${raw.toLowerCase()}`);
            })
            .filter(Boolean) as string[];
          if (!desired.has(doctorId)) desired.set(doctorId, new Set());
          for (const cid of cids) desired.get(doctorId)!.add(cid);
        }

        if (doctorsInFile.size) {
          // Vínculos ativos hoje para os médicos da planilha
          const { data: existing } = await admin
            .from("doctor_companies")
            .select("id,doctor_id,company_id,start_date,end_date")
            .in("doctor_id", [...doctorsInFile])
            .is("end_date", null);

          const existingByDoctor = new Map<string, Array<{ id: string; company_id: string; start_date: string | null }>>();
          for (const row of (existing ?? []) as any[]) {
            if (!existingByDoctor.has(row.doctor_id)) existingByDoctor.set(row.doctor_id, []);
            existingByDoctor.get(row.doctor_id)!.push(row);
          }

          const today = new Date().toISOString().slice(0, 10);
          const toClose: string[] = [];        // ids de vínculos a soft-close
          const toInsert: Array<{ doctor_id: string; company_id: string; start_date: string }> = [];

          for (const doctorId of doctorsInFile) {
            const want = desired.get(doctorId) ?? new Set<string>();
            const active = existingByDoctor.get(doctorId) ?? [];
            const activeCompanyIds = new Set(active.map((a) => a.company_id));

            // 1) Encerrar vínculos ativos que não vieram na planilha
            //    Só encerra se a planilha listou PELO MENOS UMA PJ para esse médico —
            //    evita apagar tudo quando a linha veio sem coluna PJ preenchida.
            if (want.size > 0) {
              for (const a of active) {
                if (!want.has(a.company_id)) toClose.push(a.id);
              }
            }

            // 2) Inserir vínculos novos (não existentes ativos)
            for (const cid of want) {
              if (!activeCompanyIds.has(cid)) {
                toInsert.push({ doctor_id: doctorId, company_id: cid, start_date: today });
              }
            }
          }

          if (toClose.length) {
            await admin
              .from("doctor_companies")
              .update({ end_date: today, end_reason: "substituido_por_import" })
              .in("id", toClose);
          }
          if (toInsert.length) {
            await admin.from("doctor_companies").insert(toInsert);
          }
        }
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
