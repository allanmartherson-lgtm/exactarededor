// @version 2026-05-20-calcOverlap-catchall-fix
/**
 * Sub-Onda 2D — Edge function de validação preventiva de regras.
 *
 * Wrapper que combina:
 *   1) RPC `validate_rule_save` (Verificações A/B/C + master_already_exists)
 *   2) Helper TS `detectCalcOverlap` (Verificação D)
 *
 * Auth: JWT do usuário no header. Defesa em profundidade: além do check feito
 * pela função SQL (security definer), também valida role aqui antes da chamada.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { detectCalcOverlap, detectCrossRuleOverlap } from "../_shared/calcOverlap.ts";
import type { RuleCalculationItem } from "../_shared/rulesEngine.ts";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import {
  detectDoctorMultiRule,
  doctorKey,
  extractDoctors,
  type DoctorRef,
  type RuleLike,
} from "../_shared/doctorMultiRule.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-supabase-api-version, apikey, content-type, prefer, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LinkLike = Record<string, unknown> & {
  company_id?: unknown;
  doctors?: unknown;
  excluded_doctors?: unknown;
  auto_include_new_doctors?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findCompanyLink(links: LinkLike[], companyKey: string): LinkLike | null {
  if (!companyKey) return null;
  for (const l of links) {
    const cid = typeof l?.company_id === "string" ? l.company_id : "";
    if (cid && cid === companyKey) return l;
  }
  return null;
}

function normName(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}
function onlyDigits(s: unknown): string {
  return String(s ?? "").replace(/\D+/g, "");
}
function docKeys(d: unknown): string[] {
  if (!d || typeof d !== "object") return [];
  const rec = d as Record<string, unknown>;
  const out = new Set<string>();
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  if (id) out.add(`id:${id}`);
  const crm = onlyDigits(rec.crm);
  if (crm) {
    const rawCrm = String(rec.crm ?? "");
    const ufFromCrm = rawCrm.includes("/") ? rawCrm.split("/").pop() : "";
    const uf = normName(rec.uf) || normName(ufFromCrm);
    out.add(`crm:${crm}`);
    if (uf) out.add(`crm:${crm}/${uf}`);
  }
  const nm = normName(rec.name ?? rec.full_name ?? rec.doctor_name);
  if (nm) out.add(`name:${nm}`);
  return [...out];
}
function docKey(d: unknown): string | null {
  return docKeys(d)[0] ?? null;
}
function doctorKeySet(arr: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(arr)) return out;
  for (const d of arr) {
    for (const k of docKeys(d)) out.add(k);
  }
  return out;
}
function doctorKeyGroups(arr: unknown): Set<string>[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((d) => new Set(docKeys(d)))
    .filter((keys) => keys.size > 0);
}
function hasAnyKey(keys: Set<string>, lookup: Set<string>): boolean {
  for (const k of keys) if (lookup.has(k)) return true;
  return false;
}
function isAutoInclude(link: LinkLike): boolean {
  return link.auto_include_new_doctors !== false;
}

/**
 * Conjunto de médicos habilitados de duas linhas (mesma empresa) tem interseção?
 * - explicit × explicit: interseção das listas `doctors`.
 * - autoInc × explicit: outro lado tem ao menos 1 médico que NÃO está em excluded.
 * - autoInc × autoInc: cruza os médicos reais da PJ; só conflita se alguém
 *   estiver habilitado nos dois lados. Sem cadastro carregável, mantém fallback conservador.
 */
function enabledDoctorsOverlap(a: LinkLike, b: LinkLike, companyDoctors: Set<string>[] = []): boolean {
  const aAuto = isAutoInclude(a);
  const bAuto = isAutoInclude(b);
  const aDocGroups = doctorKeyGroups(a.doctors);
  const bDocGroups = doctorKeyGroups(b.doctors);
  const aDocs = doctorKeySet(a.doctors);
  const bDocs = doctorKeySet(b.doctors);
  const aExcl = doctorKeySet(a.excluded_doctors);
  const bExcl = doctorKeySet(b.excluded_doctors);

  if (!aAuto && !bAuto) {
    // Sem lista de nenhum lado = ninguém habilitado explicitamente.
    if (aDocs.size === 0 || bDocs.size === 0) return false;
    for (const k of aDocs) if (bDocs.has(k)) return true;
    return false;
  }
  if (!aAuto && bAuto) {
    if (aDocGroups.length === 0) return false;
    for (const keys of aDocGroups) if (!hasAnyKey(keys, bExcl)) return true;
    return false;
  }
  if (aAuto && !bAuto) {
    if (bDocGroups.length === 0) return false;
    for (const keys of bDocGroups) if (!hasAnyKey(keys, aExcl)) return true;
    return false;
  }
  if (companyDoctors.length > 0) {
    for (const keys of companyDoctors) {
      if (!hasAnyKey(keys, aExcl) && !hasAnyKey(keys, bExcl)) return true;
    }
    return false;
  }
  return true;
}

interface ValidateRuleSaveRequest {
  rule_id?: string | null;
  scope: "master" | "especifica" | "grupo";
  target_type?: "medico" | "empresa" | null;
  target_identifier?: string | null;
  target_company_id?: string | null;
  group_doctors?: unknown;
  group_company_links?: unknown;
  valid_from?: string | null;
  valid_until?: string | null;
  calculations?: RuleCalculationItem[] | null;
  hospital_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const activeHospitalHeader = req.headers.get("x-active-hospital");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
        ...(activeHospitalHeader ? { "x-active-hospital": activeHospitalHeader } : {}),
      },
    },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // Defesa em profundidade: confere role admin/diretor antes do RPC.
  const { data: roles, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roleErr) {
    return new Response(JSON.stringify({ error: "Falha ao verificar permissão" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!roleSet.has("admin") && !roleSet.has("diretor")) {
    return new Response(
      JSON.stringify({ error: "Apenas admin/diretor podem validar regras" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let body: ValidateRuleSaveRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body || typeof body !== "object" || !body.scope) {
    return new Response(JSON.stringify({ error: "Body inválido: scope é obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.hospital_id) {
    return new Response(JSON.stringify({ error: "hospital_id é obrigatório para validar/salvar regra" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (activeHospitalHeader && activeHospitalHeader !== body.hospital_id) {
    return new Response(JSON.stringify({ error: "Unidade ativa divergente da unidade enviada na regra" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1) RPC validate_rule_save — Verificações A/B/C + master_already_exists
  const { data: sqlOut, error: rpcErr } = await supabase.rpc("validate_rule_save", {
    _rule_id: body.rule_id ?? null,
    _scope: body.scope,
    _target_type: body.target_type ?? null,
    _target_identifier: body.target_identifier ?? null,
    _target_company_id: body.target_company_id ?? null,
    _group_doctors: body.group_doctors ?? null,
    _group_company_links: body.group_company_links ?? null,
    _valid_from: body.valid_from ?? null,
    _valid_until: body.valid_until ?? null,
    _hospital_id: body.hospital_id ?? null,
  });
  if (rpcErr) {
    return new Response(
      JSON.stringify({ error: "Falha em validate_rule_save", detail: rpcErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sqlProblemsRaw: Array<Record<string, unknown>> =
    Array.isArray((sqlOut as { problems?: unknown[] })?.problems)
      ? ((sqlOut as { problems: Array<Record<string, unknown>> }).problems)
      : [];

  // 2) Refina `company_already_bound`:
  //    (a) só mantém se houver overlap real de cálculos com a regra peer; e
  //    (b) para a empresa em disputa, exige interseção de médicos habilitados
  //        nos dois lados. Se as listas (apenas/exceto/auto-incluir) deixam
  //        conjuntos disjuntos, não há conflito real em runtime.
  const newCalcs: RuleCalculationItem[] = body.calculations ?? [];
  const cabIds = new Set<string>();
  for (const p of sqlProblemsRaw) {
    if (p.type === "company_already_bound" && typeof p.existing_rule_id === "string") {
      cabIds.add(p.existing_rule_id);
    }
  }
  const overlapByPeer = new Map<string, boolean>();
  const linksByPeer = new Map<string, LinkLike[]>();
  const companyDoctorKeys = new Map<string, Set<string>[]>();
  if (cabIds.size > 0) {
    const [peerCalcsRes, peerRulesRes] = await Promise.all([
      supabase.from("rule_calculations").select("*").in("rule_id", Array.from(cabIds)),
      supabase.from("rules").select("id, group_company_links").in("id", Array.from(cabIds)),
    ]);
    if (peerCalcsRes.error || peerRulesRes.error) {
      return new Response(
        JSON.stringify({ error: "Falha ao carregar regras peers", detail: (peerCalcsRes.error ?? peerRulesRes.error)?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const byRule = new Map<string, RuleCalculationItem[]>();
    for (const row of (peerCalcsRes.data ?? []) as Array<RuleCalculationItem & { rule_id: string }>) {
      const list = byRule.get(row.rule_id) ?? [];
      list.push(row);
      byRule.set(row.rule_id, list);
    }
    for (const peerId of cabIds) {
      const peerList = byRule.get(peerId) ?? [];
      const cross = detectCrossRuleOverlap(newCalcs, peerList);
      overlapByPeer.set(peerId, cross.length > 0);
    }
    for (const r of (peerRulesRes.data ?? []) as Array<{ id: string; group_company_links: unknown }>) {
      linksByPeer.set(
        r.id,
        Array.isArray(r.group_company_links) ? (r.group_company_links as LinkLike[]) : [],
      );
    }

    const companyIds = new Set<string>();
    for (const p of sqlProblemsRaw) {
      if (typeof p.company_key === "string" && UUID_RE.test(p.company_key)) {
        companyIds.add(p.company_key);
      }
    }
    if (companyIds.size > 0) {
      const { data: doctorCompanyRows, error: doctorCompanyErr } = await supabase
        .from("doctor_companies")
        .select("company_id, doctor_id, doctors(id, full_name, crm, crm_uf, active)")
        .in("company_id", Array.from(companyIds));
      if (doctorCompanyErr) {
        return new Response(
          JSON.stringify({ error: "Falha ao carregar médicos das empresas", detail: doctorCompanyErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      for (const row of (doctorCompanyRows ?? []) as Array<Record<string, unknown>>) {
        const companyId = typeof row.company_id === "string" ? row.company_id : "";
        const d = row.doctors as Record<string, unknown> | null;
        if (!companyId || !d || d.active === false) continue;
        const keys = new Set(docKeys({
          id: typeof row.doctor_id === "string" ? row.doctor_id : d.id,
          name: d.full_name,
          crm: d.crm,
          uf: d.crm_uf,
        }));
        if (keys.size === 0) continue;
        const list = companyDoctorKeys.get(companyId) ?? [];
        list.push(keys);
        companyDoctorKeys.set(companyId, list);
      }
    }
  }

  const candidateLinks: LinkLike[] = Array.isArray(body.group_company_links)
    ? (body.group_company_links as LinkLike[])
    : [];

  const companyProblemKeep = new Map<string, boolean>();
  const companyProblemKey = (peerId: string, companyKey: string) => `${peerId}::${companyKey}`;
  const shouldKeepCompanyProblem = (p: Record<string, unknown>): boolean => {
    const peerId = typeof p.existing_rule_id === "string" ? p.existing_rule_id : "";
    const companyKey = typeof p.company_key === "string" ? p.company_key : "";
    const cacheKey = companyProblemKey(peerId, companyKey);
    const cached = companyProblemKeep.get(cacheKey);
    if (cached !== undefined) return cached;

    let keep = true;
    if (overlapByPeer.get(peerId) !== true) return false;
    const candLink = findCompanyLink(candidateLinks, companyKey);
    const peerLink = findCompanyLink(linksByPeer.get(peerId) ?? [], companyKey);
    if (candLink && peerLink && !enabledDoctorsOverlap(candLink, peerLink, companyDoctorKeys.get(companyKey) ?? [])) {
      keep = false;
    }
    companyProblemKeep.set(cacheKey, keep);
    return keep;
  };

  const sqlProblems = sqlProblemsRaw.filter((p) => {
    if (p.type === "company_already_bound") return shouldKeepCompanyProblem(p);
    if (p.type === "validity_overlap" && typeof p.company_key === "string") {
      // A RPC emite `validity_overlap` pareado ao conflito de empresa. Se a
      // empresa compartilhada foi liberada por médicos disjuntos (ex.: DF Neuro
      // com Victor só na neurovascular e excluído na regra geral), a vigência
      // também não pode bloquear o salvamento.
      return shouldKeepCompanyProblem(p);
    }
    return true;
  });

  // 3) Helper TS — Verificação D (calc_overlap intra-regra)
  const calcProblems = detectCalcOverlap(newCalcs, {
    calculationMode: typeof body.calculation_mode === "string" ? body.calculation_mode : null,
  });


  // 4) Verificação E — médico em múltiplas regras sem restrições diferenciadoras
  const doctorProblems = await (async () => {
    try {
      const candidate: RuleLike = {
        id: body.rule_id ?? "__candidate__",
        name: "(regra em edição)",
        active: true,
        scope: body.scope,
        target_type: body.target_type ?? null,
        target_identifier: body.target_identifier ?? null,
        group_doctors: (body.group_doctors as DoctorRef[] | null) ?? null,
        group_company_links:
          (body.group_company_links as { company_id?: string; doctors?: DoctorRef[] | null }[] | null) ?? null,
      };
      const candidateDoctors = extractDoctors(candidate);
      if (candidateDoctors.length === 0) return [];

      const query = supabase
        .from("rules")
        .select("id, name, active, scope, target_type, target_identifier, group_doctors, group_company_links")
        .eq("active", true);
      if (body.rule_id) query.neq("id", body.rule_id);
      if (body.hospital_id) query.eq("hospital_id", body.hospital_id);
      const { data: peerRules, error: peerErr } = await query;
      if (peerErr || !peerRules) return [];

      const candidateKeys = new Set(
        candidateDoctors.map(doctorKey).filter((k): k is string => !!k),
      );
      const relevantPeers = (peerRules as RuleLike[]).filter((r) =>
        extractDoctors(r).some((d) => {
          const k = doctorKey(d);
          return k && candidateKeys.has(k);
        }),
      );
      if (relevantPeers.length === 0) return [];

      const peerIds = relevantPeers.map((r) => r.id);
      const { data: peerCalcRows } = await supabase
        .from("rule_calculations")
        .select("*")
        .in("rule_id", peerIds);
      const calcsByRule = new Map<string, RuleCalculationItem[]>();
      calcsByRule.set(candidate.id, newCalcs);
      for (const row of (peerCalcRows ?? []) as Array<RuleCalculationItem & { rule_id: string }>) {
        const list = calcsByRule.get(row.rule_id) ?? [];
        list.push(row);
        calcsByRule.set(row.rule_id, list);
      }
      return detectDoctorMultiRule([candidate, ...relevantPeers], calcsByRule);
    } catch {
      return [];
    }
  })();

  const allProblems = [...sqlProblems, ...calcProblems, ...doctorProblems];
  return new Response(
    JSON.stringify({ valid: allProblems.length === 0, problems: allProblems }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
