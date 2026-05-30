// Detecta médicos vinculados a 2+ regras ativas sem filtros diferenciadores.
// Regra de negócio: um médico só pode estar em múltiplas regras se ao menos uma
// delas tiver restrições (procedure_codes whitelist, sectors, agreement_aliases
// ou allowed_access_routes nos cálculos) que a outra NÃO tenha. Caso contrário,
// há ambiguidade — o motor desempata por critérios secundários e o resultado
// pode não refletir a intenção do cadastro.

export interface DoctorRef {
  crm?: string | null;
  uf?: string | null;
  name?: string | null;
}

export interface RuleLike {
  id: string;
  name: string;
  active?: boolean;
  scope?: string | null;
  target_type?: string | null;
  target_identifier?: string | null;
  group_doctors?: DoctorRef[] | null;
  group_company_links?: { company_id?: string; doctors?: DoctorRef[] | null }[] | null;
}

export interface CalcLike {
  rule_id?: string;
  procedure_codes?: unknown;
  code_match_mode?: string | null;
  sectors?: unknown;
  agreement_aliases?: unknown;
  allowed_access_routes?: unknown;
}

export interface RuleFingerprint {
  codes: string[];
  sectors: string[];
  agreements: string[];
  routes: string[];
}

export interface DoctorMultiRuleProblem {
  type: "doctor_multi_rule";
  severity: "aviso";
  doctor_key: string;
  doctor_label: string;
  rule_ids: string[];
  rule_names: string[];
  rule_fingerprints?: RuleFingerprint[];
  message: string;
}

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

export function doctorKey(d: DoctorRef): string | null {
  const crm = norm(d.crm);
  const uf = norm(d.uf);
  if (crm) return uf ? `crm:${crm}/${uf}` : `crm:${crm}`;
  const name = norm(d.name);
  return name ? `name:${name}` : null;
}

export function doctorLabel(d: DoctorRef): string {
  const crm = (d.crm ?? "").trim();
  const uf = (d.uf ?? "").trim();
  const name = (d.name ?? "").trim();
  const id = crm ? (uf ? `${crm}/${uf}` : crm) : "";
  return [name, id].filter(Boolean).join(" — ") || id || name || "(sem identificador)";
}

/** Extrai todos os médicos referenciados por uma regra (escopo grupo + específica/medico). */
export function extractDoctors(r: RuleLike): DoctorRef[] {
  const out: DoctorRef[] = [];
  for (const d of r.group_doctors ?? []) if (d) out.push(d);
  for (const link of r.group_company_links ?? []) {
    for (const d of link?.doctors ?? []) if (d) out.push(d);
  }
  if (r.scope === "especifica" && r.target_type === "medico" && r.target_identifier) {
    // target_identifier pode ser "CRM/UF" ou só CRM
    const raw = r.target_identifier.trim();
    const [crm, uf] = raw.includes("/") ? raw.split("/") : [raw, ""];
    out.push({ crm, uf });
  }
  return out;
}

/** Fingerprint de restrições da regra (agregado entre seus cálculos). */
export function restrictionFingerprint(calcs: CalcLike[]): {
  codes: Set<string>;
  sectors: Set<string>;
  agreements: Set<string>;
  routes: Set<string>;
  hasAny: boolean;
} {
  const codes = new Set<string>();
  const sectors = new Set<string>();
  const agreements = new Set<string>();
  const routes = new Set<string>();
  for (const c of calcs) {
    const mode = (c.code_match_mode ?? "whitelist") as string;
    const list = Array.isArray(c.procedure_codes) ? (c.procedure_codes as unknown[]) : [];
    if (mode === "whitelist") {
      for (const x of list) {
        const s = String(x ?? "").trim();
        if (s) codes.add(s);
      }
    }
    for (const x of (Array.isArray(c.sectors) ? c.sectors : []) as unknown[]) {
      const s = norm(String(x));
      if (s) sectors.add(s);
    }
    for (const x of (Array.isArray(c.agreement_aliases) ? c.agreement_aliases : []) as unknown[]) {
      const s = norm(String(x));
      if (s) agreements.add(s);
    }
    for (const x of (Array.isArray(c.allowed_access_routes) ? c.allowed_access_routes : []) as unknown[]) {
      const s = norm(String(x));
      if (s) routes.add(s);
    }
  }
  return {
    codes,
    sectors,
    agreements,
    routes,
    hasAny: codes.size + sectors.size + agreements.size + routes.size > 0,
  };
}

const setEq = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Duas regras coexistem legitimamente se pelo menos uma tem restrições
 * (códigos whitelist OU setores/convênios/vias) que a outra não tem.
 * Se as restrições forem idênticas (ou ambas vazias) → alerta.
 */
export function rulesAreDistinguished(a: CalcLike[], b: CalcLike[]): boolean {
  const fa = restrictionFingerprint(a);
  const fb = restrictionFingerprint(b);
  if (!fa.hasAny && !fb.hasAny) return false;
  return !(
    setEq(fa.codes, fb.codes) &&
    setEq(fa.sectors, fb.sectors) &&
    setEq(fa.agreements, fb.agreements) &&
    setEq(fa.routes, fb.routes)
  );
}

/**
 * Detecta colisões: médicos presentes em 2+ regras ativas sem distinção de restrições.
 */
export function detectDoctorMultiRule(
  rules: RuleLike[],
  calcsByRule: Map<string, CalcLike[]>,
): DoctorMultiRuleProblem[] {
  const byDoctor = new Map<string, { label: string; ruleIds: Set<string> }>();
  for (const r of rules) {
    if (r.active === false) continue;
    for (const d of extractDoctors(r)) {
      const key = doctorKey(d);
      if (!key) continue;
      const entry = byDoctor.get(key) ?? { label: doctorLabel(d), ruleIds: new Set() };
      entry.ruleIds.add(r.id);
      // prefer label com nome
      if (!entry.label.includes("—") && doctorLabel(d).includes("—")) {
        entry.label = doctorLabel(d);
      }
      byDoctor.set(key, entry);
    }
  }

  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const out: DoctorMultiRuleProblem[] = [];
  for (const [key, entry] of byDoctor) {
    if (entry.ruleIds.size < 2) continue;
    const ids = [...entry.ruleIds];
    // Verifica se TODOS os pares são indistinguíveis. Basta um par colidir.
    let collides = false;
    for (let i = 0; i < ids.length && !collides; i++) {
      for (let j = i + 1; j < ids.length && !collides; j++) {
        const ca = calcsByRule.get(ids[i]) ?? [];
        const cb = calcsByRule.get(ids[j]) ?? [];
        if (!rulesAreDistinguished(ca, cb)) collides = true;
      }
    }
    if (!collides) continue;
    const names = ids.map((id) => ruleById.get(id)?.name ?? id);
    const fingerprints: RuleFingerprint[] = ids.map((id) => {
      const fp = restrictionFingerprint(calcsByRule.get(id) ?? []);
      return {
        codes: [...fp.codes].sort(),
        sectors: [...fp.sectors].sort(),
        agreements: [...fp.agreements].sort(),
        routes: [...fp.routes].sort(),
      };
    });
    out.push({
      type: "doctor_multi_rule",
      severity: "aviso",
      doctor_key: key,
      doctor_label: entry.label,
      rule_ids: ids,
      rule_names: names,
      rule_fingerprints: fingerprints,
      message: `Médico ${entry.label} está vinculado a ${ids.length} regras ativas sem restrições diferenciadoras: ${names.join(" | ")}. Remova o vínculo de uma delas ou adicione filtros (códigos, setor, convênio, via) que as distingam.`,
    });
  }
  return out;
}
