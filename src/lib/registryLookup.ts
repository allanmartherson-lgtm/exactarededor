/**
 * Lookup estrito de cadastros (médicos, convênios, setores).
 *
 * Princípios:
 *  - A fonte de verdade são as tabelas `doctors`, `convenios`, `sectors` +
 *    suas tabelas de alias (`doctor_aliases`, `convenio_aliases`, `sector_aliases`).
 *  - Ordem de match: documento exato → nome exato normalizado → alias normalizado.
 *  - NÃO faz fuzzy match. Sem correspondência = retorno `null` para que o
 *    chamador exija ação do analista (vincular a registro existente, criar alias
 *    ou cadastrar novo). Resolve o caso "paciente colocado como médico".
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";

export type MatchedBy = "crm" | "cpf" | "slug" | "name" | "alias" | null;

export type DoctorRegistryEntry = {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
  cpf: string | null;
  specialties: string[];
};

export type ConvenioRegistryEntry = { slug: string; name: string };
export type SectorRegistryEntry = { slug: string; name: string };

export type DoctorRegistry = {
  byCrm: Map<string, DoctorRegistryEntry>; // só dígitos (UF desconhecida)
  byCrmUf: Map<string, DoctorRegistryEntry>; // chave "<digitos>/<UF>" — match preciso
  byCpf: Map<string, DoctorRegistryEntry>;
  byAlias: Map<string, DoctorRegistryEntry>; // covers full_name (seeded) + aliases
};
export type ConvenioRegistry = {
  bySlug: Map<string, ConvenioRegistryEntry>;
  byAlias: Map<string, ConvenioRegistryEntry>;
};
export type SectorRegistry = {
  bySlug: Map<string, SectorRegistryEntry>;
  byAlias: Map<string, SectorRegistryEntry>;
};

export function normalize(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Aceita CRM em formato unificado ("28923/DF", "28923-DF", "28923 DF",
 * "CRM/DF 28923") ou só números ("28923"). Retorna {number, uf}.
 * uf vazio quando não foi possível detectar.
 */
export function parseCrm(raw: string | null | undefined): { number: string; uf: string } {
  const s = String(raw ?? "").toUpperCase().trim();
  if (!s) return { number: "", uf: "" };
  // tenta capturar UF de 2 letras em qualquer posição
  const ufMatch = s.match(/\b([A-Z]{2})\b/);
  const number = s.replace(/\D/g, "");
  const uf = ufMatch ? ufMatch[1] : "";
  return { number, uf };
}

const crmUfKey = (number: string, uf: string | null | undefined) =>
  `${number}/${String(uf ?? "").toUpperCase().trim()}`;

// ====== loaders ======

const REGISTRY_CACHE_TTL_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableLookupError = (error: any) =>
  error?.code === "57014" || /timeout|temporar/i.test(String(error?.message ?? ""));

async function runLookupQuery<T>(queryFactory: () => any, attempts = 4): Promise<T[]> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data, error } = await queryFactory();
    if (!error) return (data ?? []) as T[];
    lastErr = error;
    if (!isRetriableLookupError(error)) break;
    await sleep(500 * Math.pow(2, attempt));
  }
  throw lastErr;
}

function readSessionCache<T>(key: string, ttlMs: number): T | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (parsed && Date.now() - parsed.at < ttlMs) return parsed.value;
  } catch { /* ignore */ }
  return null;
}

function writeSessionCache<T>(key: string, value: T): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value })); } catch { /* quota — ignore */ }
}

async function cachedRows<T>(key: string, force: boolean, loader: () => Promise<T>): Promise<T> {
  if (!force) {
    const cached = readSessionCache<T>(key, REGISTRY_CACHE_TTL_MS);
    if (cached) return cached;
  }
  const value = await loader();
  writeSessionCache(key, value);
  return value;
}

/**
 * Pagina todas as linhas de uma query Supabase ignorando o teto default
 * de 1000. Necessário para `doctors` (>4k linhas) — sem isso o resolver
 * perde médicos cadastrados e quebra o lookup estrito.
 */
async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Paginação por chave primária. Evita OFFSET em tabelas com RLS, que precisa
 * "passar" pelas linhas anteriores e vinha estourando statement_timeout.
 */
async function fetchAllById<T extends { id?: string }>(
  buildQuery: (afterId: string | null, limit: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    const rows = await runLookupQuery<T>(() => buildQuery(afterId, pageSize));
    out.push(...rows);
    if (rows.length < pageSize) break;
    const next = rows[rows.length - 1]?.id;
    if (!next || next === afterId) break;
    afterId = next;
  }
  return out;
}

export async function loadDoctorRegistry(force = false): Promise<DoctorRegistry> {
  const reg: DoctorRegistry = { byCrm: new Map(), byCrmUf: new Map(), byCpf: new Map(), byAlias: new Map() };
  const { docs, aliases } = await cachedRows(
    "registry.doctors.v2",
    force,
    async () => {
      const [docs, aliases] = await Promise.all([
        fetchAllById<any>((afterId, limit) => {
          let q = supabase
            .from("doctors")
            .select("id, full_name, crm, crm_uf, specialties")
            .eq("active", true)
            .order("id", { ascending: true })
            .limit(limit);
          if (afterId) q = q.gt("id", afterId);
          return q;
        }),
        fetchAllById<any>((afterId, limit) => {
          let q = supabase
            .from("doctor_aliases")
            .select("id, doctor_id, alias_normalized")
            .order("id", { ascending: true })
            .limit(limit);
          if (afterId) q = q.gt("id", afterId);
          return q;
        }),
      ]);
      return { docs, aliases };
    },
  );
  const byId = new Map<string, DoctorRegistryEntry>();
  for (const d of docs ?? []) {
    const e: DoctorRegistryEntry = {
      id: (d as any).id,
      full_name: (d as any).full_name,
      crm: (d as any).crm ?? null,
      crm_uf: (d as any).crm_uf ?? null,
      cpf: null, // CPF não é mais carregado em massa; use find_doctor_by_document RPC para matching por CPF
      specialties: Array.isArray((d as any).specialties) ? (d as any).specialties.filter(Boolean) : [],
    };

    byId.set(e.id, e);
    const crm = onlyDigits(e.crm);
    if (crm) {
      reg.byCrm.set(crm, e);
      if (e.crm_uf) reg.byCrmUf.set(crmUfKey(crm, e.crm_uf), e);
    }
    const nameKey = normalize(e.full_name);
    if (nameKey) reg.byAlias.set(nameKey, e);
  }
  for (const a of aliases ?? []) {
    const e = byId.get((a as any).doctor_id);
    if (!e) continue;
    const key = (a as any).alias_normalized as string | null;
    if (key && !reg.byAlias.has(key)) reg.byAlias.set(key, e);
  }
  return reg;
}

/**
 * Filtro de escopo por hospital: sempre inclui os registros globais
 * (hospital_id IS NULL) e, quando informado, restringe também ao hospital ativo.
 * Convênios/setores exclusivos de outros hospitais NUNCA aparecem.
 */
function applyHospitalScope<T extends { or: (f: string) => T; is: (c: string, v: null) => T }>(
  q: T,
  hospitalId: string | null | undefined,
): T {
  if (hospitalId) return q.or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`);
  return q.is("hospital_id", null);
}

export async function loadConvenioRegistry(
  hospitalId: string | null = null,
  force = false,
): Promise<ConvenioRegistry> {
  // Guarda sistêmica: se o caller não passou hospitalId, NUNCA caia no bucket
  // "__global__" — resolve no servidor. Evita o bug recorrente do resolver
  // devolvendo cadastro incompleto por hidratação tardia do HospitalContext.
  const effectiveHospitalId = hospitalId ?? (await resolveActiveHospitalId());
  const reg: ConvenioRegistry = { bySlug: new Map(), byAlias: new Map() };
  const cacheKey = `registry.convenios.v3.${effectiveHospitalId ?? "__global__"}`;
  const { conv, aliases } = await cachedRows(
    cacheKey,
    force,
    async () => {
      const [conv, aliases] = await Promise.all([
        fetchAllPaginated<any>((from, to) =>
          applyHospitalScope(
            supabase.from("convenios").select("slug, name, hospital_id").eq("active", true) as any,
            effectiveHospitalId,
          ).range(from, to),
        ),
        fetchAllPaginated<any>((from, to) =>
          applyHospitalScope(
            supabase.from("convenio_aliases").select("convenio_slug, alias_normalized, hospital_id") as any,
            effectiveHospitalId,
          ).range(from, to),
        ),
      ]);
      return { conv, aliases };
    },
  );
  for (const c of conv ?? []) {
    const e: ConvenioRegistryEntry = { slug: (c as any).slug, name: (c as any).name };
    reg.bySlug.set(e.slug, e);
    const nk = normalize(e.name);
    if (nk) reg.byAlias.set(nk, e);
  }
  for (const a of aliases ?? []) {
    const e = reg.bySlug.get((a as any).convenio_slug);
    if (!e) continue;
    const key = (a as any).alias_normalized as string | null;
    if (key && !reg.byAlias.has(key)) reg.byAlias.set(key, e);
  }
  return reg;
}

export async function loadSectorRegistry(
  hospitalId: string | null = null,
  force = false,
): Promise<SectorRegistry> {
  // Mesma guarda sistêmica de loadConvenioRegistry — ver comentário lá.
  const effectiveHospitalId = hospitalId ?? (await resolveActiveHospitalId());
  const reg: SectorRegistry = { bySlug: new Map(), byAlias: new Map() };
  const cacheKey = `registry.sectors.v3.${effectiveHospitalId ?? "__global__"}`;
  const { sec, aliases } = await cachedRows(
    cacheKey,
    force,
    async () => {
      const [sec, aliases] = await Promise.all([
        fetchAllPaginated<any>((from, to) =>
          applyHospitalScope(
            supabase.from("sectors").select("slug, name, hospital_id").eq("active", true) as any,
            effectiveHospitalId,
          ).range(from, to),
        ),
        fetchAllPaginated<any>((from, to) =>
          applyHospitalScope(
            supabase.from("sector_aliases").select("sector_slug, alias_normalized, hospital_id") as any,
            effectiveHospitalId,
          ).range(from, to),
        ),
      ]);
      return { sec, aliases };
    },
  );
  for (const s of sec ?? []) {
    const e: SectorRegistryEntry = { slug: (s as any).slug, name: (s as any).name };
    reg.bySlug.set(e.slug, e);
    const nk = normalize(e.name);
    if (nk) reg.byAlias.set(nk, e);
  }
  for (const a of aliases ?? []) {
    const e = reg.bySlug.get((a as any).sector_slug);
    if (!e) continue;
    const key = (a as any).alias_normalized as string | null;
    if (key && !reg.byAlias.has(key)) reg.byAlias.set(key, e);
  }
  return reg;
}

// ====== resolvers (puros, sem inferência) ======

export function resolveDoctor(
  input: { name?: string | null; crm?: string | null; crm_uf?: string | null; cpf?: string | null },
  reg: DoctorRegistry,
): { doctor: DoctorRegistryEntry | null; matched_by: MatchedBy } {
  // CRM aceita formato unificado ("28923/DF") ou separado (crm + crm_uf)
  const parsed = parseCrm(input.crm);
  const number = parsed.number;
  const uf = (input.crm_uf || parsed.uf || "").toUpperCase().trim();
  if (number) {
    if (uf) {
      const e = reg.byCrmUf.get(crmUfKey(number, uf));
      if (e) return { doctor: e, matched_by: "crm" };
    }
    // fallback: match só por número (UF desconhecida em uma das pontas)
    const e = reg.byCrm.get(number);
    if (e) return { doctor: e, matched_by: "crm" };
  }
  const cpf = onlyDigits(input.cpf);
  if (cpf) {
    const e = reg.byCpf.get(cpf);
    if (e) return { doctor: e, matched_by: "cpf" };
  }
  const nameKey = normalize(input.name);
  if (nameKey) {
    const e = reg.byAlias.get(nameKey);
    if (e) {
      const matched_by: MatchedBy = normalize(e.full_name) === nameKey ? "name" : "alias";
      return { doctor: e, matched_by };
    }
  }
  return { doctor: null, matched_by: null };
}

export function resolveConvenio(
  text: string | null | undefined,
  reg: ConvenioRegistry,
): { convenio: ConvenioRegistryEntry | null; matched_by: MatchedBy } {
  const key = normalize(text);
  if (!key) return { convenio: null, matched_by: null };
  // slug direto (texto bruto que já é um slug cadastrado)
  if (reg.bySlug.has(key)) return { convenio: reg.bySlug.get(key)!, matched_by: "slug" };
  const e = reg.byAlias.get(key);
  if (e) {
    const matched_by: MatchedBy = normalize(e.name) === key ? "name" : "alias";
    return { convenio: e, matched_by };
  }
  return { convenio: null, matched_by: null };
}

/**
 * Tokens proibidos como alias de setor — nomes de hospitais/redes que NUNCA
 * devem resolver para um setor (ex.: "DFStar" é o hospital, não um setor).
 * Bloqueio defensivo: mesmo que alguém cadastre um alias errado, o resolver
 * recusa, evitando contaminar o setor das linhas.
 */
const FORBIDDEN_SECTOR_TOKENS = new Set<string>([
  "dfstar", "df star", "hospital df star", "hdf",
  "santa luzia", "hospital santa luzia", "hsl",
]);

export function resolveSector(
  text: string | null | undefined,
  reg: SectorRegistry,
): { sector: SectorRegistryEntry | null; matched_by: MatchedBy } {
  const key = normalize(text);
  if (!key) return { sector: null, matched_by: null };
  if (FORBIDDEN_SECTOR_TOKENS.has(key)) return { sector: null, matched_by: null };
  if (reg.bySlug.has(key)) return { sector: reg.bySlug.get(key)!, matched_by: "slug" };
  const e = reg.byAlias.get(key);
  if (e) {
    const matched_by: MatchedBy = normalize(e.name) === key ? "name" : "alias";
    return { sector: e, matched_by };
  }
  return { sector: null, matched_by: null };
}

// ====== escritores de alias ======

/**
 * Insert idempotente — se o alias já existe (alias_normalized UNIQUE), ignora
 * silenciosamente. Isso permite que o sistema "abasteça" a tabela de aliases
 * a cada vínculo aceito sem quebrar em duplicidade.
 */
type AliasSource = "manual" | "auto";

async function insertAliasIgnoreDup(
  table: "doctor_aliases" | "convenio_aliases" | "sector_aliases",
  payload: Record<string, unknown>,
) {
  // Retry simples para statement_timeout (57014) — o banco às vezes está sob
  // carga pesada (queries longas em payment_company_groups) e um INSERT
  // trivial estoura o limite do PostgREST. Uma 2ª/3ª tentativa quase sempre
  // passa. Duplicidade segue sendo tratada como sucesso silencioso.
  let lastErr: any = null;
  let syncedActive = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await supabase.from(table as any).insert(payload as any);
    if (!res.error) return res;
    const msg = res.error.message ?? "";
    if (/duplicate|unique|conflict/i.test(msg)) return { data: null, error: null } as typeof res;
    lastErr = res.error;
    // RLS por hospital: o servidor pode ter `user_active_hospital` desatualizado
    // (troca em outra aba, RPC anterior falhou etc.). Ressincroniza uma vez
    // usando o hospital_id do payload e tenta de novo.
    const isRlsHospital = /row-level security|hospital_scope_restrictive/i.test(msg);
    const hid = (payload as any)?.hospital_id as string | null | undefined;
    if (isRlsHospital && hid && !syncedActive) {
      syncedActive = true;
      try {
        await supabase.rpc("set_active_hospital", { p_hospital_id: hid } as any);
      } catch { /* ignore — próxima iteração devolve o erro real */ }
      continue;
    }
    const isTimeout = /statement timeout|canceling statement|57014/i.test(msg);
    if (!isTimeout) return res;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return { data: null, error: { ...lastErr, message: `${lastErr?.message ?? "timeout"} — tente novamente em alguns segundos (banco sob carga).` } } as any;
}

export async function createDoctorAlias(doctor_id: string, alias_text: string, source: AliasSource = "manual") {
  return insertAliasIgnoreDup("doctor_aliases", { doctor_id, alias_text, source });
}
export async function createConvenioAlias(
  convenio_slug: string,
  alias_text: string,
  source: AliasSource = "manual",
  hospital_id: string | null = null,
) {
  return insertAliasIgnoreDup("convenio_aliases", { convenio_slug, alias_text, source, hospital_id });
}
export async function createSectorAlias(
  sector_slug: string,
  alias_text: string,
  source: AliasSource = "manual",
  hospital_id: string | null = null,
) {
  return insertAliasIgnoreDup("sector_aliases", { sector_slug, alias_text, source, hospital_id });
}

// ====== auto-aprendizado em lote ======

type LearnRow = {
  doctor_id?: string | null;
  doctor_matched_by?: MatchedBy;
  doctor_name?: string | null;
  convenio_slug?: string | null;
  convenio_matched_by?: MatchedBy;
  agreement_text?: string | null;
  sector_slug?: string | null;
  sector_matched_by?: MatchedBy;
  sector_raw?: string | null;
};

/**
 * Varre linhas resolvidas e cria aliases auto para variações cujo texto bruto
 * difere do canônico mas que o motor casou via documento/slug. Próximas
 * importações resolvem direto via alias — o motor fica mais inteligente sem
 * intervenção do analista.
 *
 * Idempotente: colisões com alias_normalized UNIQUE são ignoradas. Best-effort.
 */
export async function learnAliasesFromResolvedRows(
  rows: LearnRow[],
  registries: { doctorReg: DoctorRegistry | null; convenioReg: ConvenioRegistry | null; sectorReg: SectorRegistry | null },
  hospitalId: string | null = null,
): Promise<{ doctor: number; convenio: number; sector: number }> {
  const doctor = new Map<string, { doctor_id: string; alias_text: string; source: AliasSource }>();
  const convenio = new Map<string, { convenio_slug: string; alias_text: string; source: AliasSource; hospital_id: string | null }>();
  const sector = new Map<string, { sector_slug: string; alias_text: string; source: AliasSource; hospital_id: string | null }>();

  const doctorById = new Map<string, DoctorRegistryEntry>();
  if (registries.doctorReg) {
    for (const d of registries.doctorReg.byAlias.values()) doctorById.set(d.id, d);
  }

  for (const r of rows) {
    if (r.doctor_id && (r.doctor_matched_by === "crm" || r.doctor_matched_by === "cpf") && r.doctor_name) {
      const canN = normalize(doctorById.get(r.doctor_id)?.full_name);
      const rawN = normalize(r.doctor_name);
      if (rawN && rawN !== canN) {
        doctor.set(`${r.doctor_id}::${rawN}`, { doctor_id: r.doctor_id, alias_text: r.doctor_name.trim(), source: "auto" });
      }
    }
    if (r.convenio_slug && r.convenio_matched_by === "slug" && r.agreement_text) {
      const canN = normalize(registries.convenioReg?.bySlug.get(r.convenio_slug)?.name);
      const rawN = normalize(r.agreement_text);
      if (rawN && rawN !== canN && rawN !== r.convenio_slug.toLowerCase()) {
        convenio.set(`${r.convenio_slug}::${rawN}`, { convenio_slug: r.convenio_slug, alias_text: r.agreement_text.trim(), source: "auto", hospital_id: hospitalId });
      }
    }
    if (r.sector_slug && r.sector_matched_by === "slug" && r.sector_raw) {
      const canN = normalize(registries.sectorReg?.bySlug.get(r.sector_slug)?.name);
      const rawN = normalize(r.sector_raw);
      if (rawN && rawN !== canN && rawN !== r.sector_slug.toLowerCase()) {
        sector.set(`${r.sector_slug}::${rawN}`, { sector_slug: r.sector_slug, alias_text: r.sector_raw.trim(), source: "auto", hospital_id: hospitalId });
      }
    }
  }

  const counts = { doctor: 0, convenio: 0, sector: 0 };
  const runInsert = async (table: "doctor_aliases" | "convenio_aliases" | "sector_aliases", payload: any[]) => {
    if (!payload.length) return 0;
    const { error } = await supabase.from(table as any).insert(payload as any);
    if (!error) return payload.length;
    if (/duplicate|unique|conflict/i.test(error.message ?? "")) {
      // tenta uma a uma para registrar os que passam
      let ok = 0;
      for (const row of payload) {
        const r2 = await supabase.from(table as any).insert(row as any);
        if (!r2.error || /duplicate|unique|conflict/i.test(r2.error.message ?? "")) ok += r2.error ? 0 : 1;
      }
      return ok;
    }
    console.warn(`[learn-alias] ${table} insert falhou:`, error.message);
    return 0;
  };
  counts.doctor = await runInsert("doctor_aliases", [...doctor.values()]);
  counts.convenio = await runInsert("convenio_aliases", [...convenio.values()]);
  counts.sector = await runInsert("sector_aliases", [...sector.values()]);
  return counts;
}
