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

export type MatchedBy = "crm" | "cpf" | "slug" | "name" | "alias" | null;

export type DoctorRegistryEntry = {
  id: string;
  full_name: string;
  crm: string | null;
  cpf: string | null;
};
export type ConvenioRegistryEntry = { slug: string; name: string };
export type SectorRegistryEntry = { slug: string; name: string };

export type DoctorRegistry = {
  byCrm: Map<string, DoctorRegistryEntry>;
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

// ====== loaders ======

export async function loadDoctorRegistry(): Promise<DoctorRegistry> {
  const reg: DoctorRegistry = { byCrm: new Map(), byCpf: new Map(), byAlias: new Map() };
  const [{ data: docs }, { data: aliases }] = await Promise.all([
    supabase.from("doctors").select("id, full_name, crm, cpf").eq("active", true),
    supabase.from("doctor_aliases").select("doctor_id, alias_normalized"),
  ]);
  const byId = new Map<string, DoctorRegistryEntry>();
  for (const d of docs ?? []) {
    const e: DoctorRegistryEntry = {
      id: (d as any).id,
      full_name: (d as any).full_name,
      crm: (d as any).crm ?? null,
      cpf: (d as any).cpf ?? null,
    };
    byId.set(e.id, e);
    const crm = onlyDigits(e.crm);
    if (crm) reg.byCrm.set(crm, e);
    const cpf = onlyDigits(e.cpf);
    if (cpf) reg.byCpf.set(cpf, e);
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

export async function loadConvenioRegistry(): Promise<ConvenioRegistry> {
  const reg: ConvenioRegistry = { bySlug: new Map(), byAlias: new Map() };
  const [{ data: conv }, { data: aliases }] = await Promise.all([
    supabase.from("convenios").select("slug, name").eq("active", true),
    supabase.from("convenio_aliases").select("convenio_slug, alias_normalized"),
  ]);
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

export async function loadSectorRegistry(): Promise<SectorRegistry> {
  const reg: SectorRegistry = { bySlug: new Map(), byAlias: new Map() };
  const [{ data: sec }, { data: aliases }] = await Promise.all([
    supabase.from("sectors").select("slug, name").eq("active", true),
    supabase.from("sector_aliases").select("sector_slug, alias_normalized"),
  ]);
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
  input: { name?: string | null; crm?: string | null; cpf?: string | null },
  reg: DoctorRegistry,
): { doctor: DoctorRegistryEntry | null; matched_by: MatchedBy } {
  const crm = onlyDigits(input.crm);
  if (crm) {
    const e = reg.byCrm.get(crm);
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
      // Heurística: se a chave também é o full_name normalizado, considera "name";
      // caso contrário, foi via alias cadastrado.
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

export function resolveSector(
  text: string | null | undefined,
  reg: SectorRegistry,
): { sector: SectorRegistryEntry | null; matched_by: MatchedBy } {
  const key = normalize(text);
  if (!key) return { sector: null, matched_by: null };
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
  const res = await supabase.from(table as any).insert(payload as any);
  if (res.error && /duplicate|unique|conflict/i.test(res.error.message ?? "")) {
    return { data: null, error: null } as typeof res;
  }
  return res;
}

export async function createDoctorAlias(doctor_id: string, alias_text: string, source: AliasSource = "manual") {
  return insertAliasIgnoreDup("doctor_aliases", { doctor_id, alias_text, source });
}
export async function createConvenioAlias(convenio_slug: string, alias_text: string, source: AliasSource = "manual") {
  return insertAliasIgnoreDup("convenio_aliases", { convenio_slug, alias_text, source });
}
export async function createSectorAlias(sector_slug: string, alias_text: string, source: AliasSource = "manual") {
  return insertAliasIgnoreDup("sector_aliases", { sector_slug, alias_text, source });
}
