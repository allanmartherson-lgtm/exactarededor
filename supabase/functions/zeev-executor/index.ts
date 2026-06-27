// Zeev Executor — chat executor que propõe ações em lote no pagamento atual.
//
// Fluxo:
//   step=propose → LLM interpreta o pedido, devolve { action, scope, payload, summary, preview_count, sample_items }
//   step=execute → recebe a proposta + confirmação do usuário, aplica a mutação e grava audit_log
//
// Princípios:
//   - Whitelist de ações no servidor (LLM não escolhe SQL).
//   - Nada executa sem confirmação humana (UI mostra card e só então chama execute).
//   - Toda execução grava snapshot em audit_log.diff para rollback.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// -------------------- Tipos públicos --------------------

type Action =
  | "set_sector"
  | "set_cost_center"
  | "link_doctor_company"
  | "register_doctor_pending"
  | "register_company"
  | "resolve_registry_match"
  | "navigate"
  | "answer";

interface Scope {
  /** Filtros declarativos. Todos opcionais; combinados com AND. */
  sector_missing?: boolean;
  cost_center_missing?: boolean;
  doctor_company_missing?: boolean;
  convenio_slug?: string | null;
  doctor_name_like?: string | null;
  procedure_code?: string | null;
  description_like?: string | null;
  /** Filtros de "ver"/responder — não disparam execução. */
  gross_zero?: boolean;
  ai_status_in?: string[];
  needs_human_review?: boolean;
}

interface Proposal {
  action: Action;
  scope: Scope;
  payload: Record<string, unknown>;
  summary: string;
  preview_count: number;
  sample_items: Array<{
    id: string;
    doctor_name: string | null;
    procedure_code: string | null;
    description: string | null;
    attendance_number: string | null;
  }>;
  /** Para ações de cadastro: pares chave→valor exibidos no card de confirmação. */
  details?: Array<{ label: string; value: string }>;
}

interface RequestBody {
  step: "propose" | "execute";
  /** Opcional — quando ausente, só ações sem mutação (navigate/answer) são possíveis. */
  payment_id?: string | null;
  /** Rota atual no app (para dar contexto de navegação ao Zeev). */
  current_path?: string | null;
  prompt?: string;
  proposal?: Proposal;
}

// -------------------- LLM prompt --------------------

const SYSTEM_PROMPT = [
  "Você é o Zeev — assistente do Exacta, sistema de repasse médico hospitalar.",
  "Você interpreta pedidos do analista e devolve UMA proposta estruturada. Você nunca executa direto: ações que mutam dados são confirmadas pelo analista; navegação é aplicada com 1 clique; respostas em texto são imediatas.",
  "",
  "REGRAS ABSOLUTAS:",
  "- NUNCA proponha apagar pagamentos, mexer em regras, aprovar lote, finalizar NF, ou qualquer ação financeira.",
  "- Use os números/contexto que o servidor já te passou (contagens, agregados, preferências aprendidas). Não invente.",
  "- Se 'learned_preferences' do contexto incluir uma preferência cujo 'when' bate com a situação atual (ex.: mesmo convenio_slug + sector_missing), proponha o mesmo payload aprendido. Mencione no summary que é uma preferência recorrente — mas SEMPRE espere confirmação humana.",
  "- Responda sempre em PT-BR, breve e direto. Sem rodeio.",
  "",
  "AÇÕES DISPONÍVEIS (escolha exatamente UMA):",
  "1) answer — quando o analista PERGUNTA algo respondível com o contexto. Use o 'summary' como a resposta completa em texto (pode ter 2-3 frases). Ideal para 'quantos itens estão zerados?', 'qual médico tem mais divergência?'.",
  "2) navigate — quando o analista quer IR a uma seção/filtro. payload: { url?: string, filter?: 'zerados'|'divergentes'|'sem_regra'|'reprovados' }. Use 'filter' para os 4 filtros padrão do grid. Use 'url' para rotas absolutas tipo '/pagamentos', '/regras', '/pendencias'. summary = 1 frase explicando para onde vai.",
  "3) set_sector — aplica setor em lote. payload: { sector_code }. scope.sector_missing=true para 'sem setor'.",
  "4) set_cost_center — aplica centro de custos. payload: { cost_center_code }. scope.cost_center_missing=true.",
  "5) link_doctor_company — vincula médico→PJ. payload: { company_id }. scope.doctor_company_missing=true.",
  "6) register_doctor_pending — cria médico em modo 'pending_admin_review=true'. payload: { full_name, crm, crm_uf (2 letras), cpf?, vinculo? } — full_name+crm+crm_uf são obrigatórios; se faltar, use 'clarify'. Use quando o analista pede 'cadastrar médico novo X com CRM Y/UF'.",
  "7) register_company — cria PJ. payload: { name, document (CNPJ — 14 dígitos), state_uf? } — name+document obrigatórios. Use quando pedir 'cadastrar empresa X CNPJ Y'.",
  "8) resolve_registry_match — registra alias para texto novo que devia bater com cadastro existente. payload: { alias_type: 'convenio'|'sector'|'doctor', alias_text, canonical_id (uuid do doctor) OU canonical_slug (slug do convenio/setor) }. Use quando o analista diz 'sempre que vier \"X\" considera como Y'.",
  "9) clarify — quando o pedido é ambíguo e você precisa perguntar de volta. summary = a pergunta.",
  "10) unsupported — quando não dá pra atender com nenhuma ação acima. summary = explicação curta + sugestão alternativa.",
  "",
  "REGRA DE OURO: se o analista usa verbo de VER/MOSTRAR/IR ('me mostra', 'leva pros zerados', 'abre os divergentes'), prefira 'navigate'. Se PERGUNTA ('quantos', 'qual', 'tem algum'), prefira 'answer'. Só use set_/link_/register_/resolve_ quando ele pedir explicitamente para APLICAR/CADASTRAR/VINCULAR. Para cadastro: extraia CRM no formato '12345/SP' como crm='12345', crm_uf='SP'. CNPJ pode vir com pontuação — preserve só dígitos.",

].join("\n");

const RESPOND_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "set_sector",
        "set_cost_center",
        "link_doctor_company",
        "register_doctor_pending",
        "register_company",
        "resolve_registry_match",
        "navigate",
        "answer",
        "unsupported",
        "clarify",
      ],
    },
    scope: {
      type: "object",
      properties: {
        sector_missing: { type: "boolean" },
        cost_center_missing: { type: "boolean" },
        doctor_company_missing: { type: "boolean" },
        convenio_slug: { type: "string" },
        doctor_name_like: { type: "string" },
        procedure_code: { type: "string" },
        description_like: { type: "string" },
        gross_zero: { type: "boolean" },
        needs_human_review: { type: "boolean" },
      },
      additionalProperties: false,
    },
    payload: {
      type: "object",
      properties: {
        sector_code: { type: "string" },
        cost_center_code: { type: "string" },
        company_id: { type: "string" },
        url: { type: "string" },
        filter: { type: "string", enum: ["zerados", "divergentes", "sem_regra", "reprovados"] },
        full_name: { type: "string" },
        crm: { type: "string" },
        crm_uf: { type: "string" },
        cpf: { type: "string" },
        vinculo: { type: "string" },
        name: { type: "string" },
        document: { type: "string" },
        state_uf: { type: "string" },
        alias_type: { type: "string", enum: ["convenio", "sector", "doctor"] },
        alias_text: { type: "string" },
        canonical_id: { type: "string" },
        canonical_slug: { type: "string" },
      },
      additionalProperties: false,
    },
    summary: { type: "string" },
  },
  required: ["action", "summary"],
};

// -------------------- Helpers --------------------

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

async function buildItemsQuery(sb: SB, paymentId: string, scope: Scope) {
  let q = sb
    .from("payment_items")
    .select("id, doctor_id, doctor_name, procedure_code, description, attendance_number, sector, cost_center_code, convenio_slug, company_id")
    .eq("payment_id", paymentId)
    .limit(1000);

  if (scope.sector_missing) q = q.or("sector.is.null,sector.eq.");
  if (scope.cost_center_missing) q = q.or("cost_center_code.is.null,cost_center_code.eq.");
  if (scope.convenio_slug) q = q.eq("convenio_slug", scope.convenio_slug);
  if (scope.procedure_code) q = q.eq("procedure_code", scope.procedure_code);
  if (scope.doctor_name_like) q = q.ilike("doctor_name", `%${scope.doctor_name_like}%`);
  if (scope.description_like) q = q.ilike("description", `%${scope.description_like}%`);

  const { data, error } = await q;
  if (error) throw new Error(`query_items: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    doctor_id: string | null;
    doctor_name: string | null;
    procedure_code: string | null;
    description: string | null;
    attendance_number: string | null;
    sector: string | null;
    cost_center_code: string | null;
    convenio_slug: string | null;
    company_id: string | null;
  }>;
}

async function filterDoctorCompanyMissing(sb: SB, items: Array<{ doctor_id: string | null }>) {
  const ids = [...new Set(items.map((i) => i.doctor_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Set<string>();
  const { data } = await sb.from("doctor_companies").select("doctor_id").in("doctor_id", ids);
  const linked = new Set((data ?? []).map((r) => r.doctor_id as string));
  // retorna o set de doctor_ids SEM vínculo
  return new Set(ids.filter((d) => !linked.has(d)));
}

// -------------------- Execução de cada ação --------------------

async function execSetSector(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const sectorCode = String(payload.sector_code ?? "").trim();
  if (!sectorCode) throw new Error("sector_code obrigatório");

  // Resolve setor canônico
  const { data: secRow } = await sb.from("sectors").select("code, name").eq("code", sectorCode).maybeSingle();
  if (!secRow) throw new Error(`Setor ${sectorCode} não encontrado no cadastro.`);

  const items = await buildItemsQuery(sb, paymentId, scope);
  if (items.length === 0) return { affected: 0, before: [], after: { sector: secRow.name } };

  const before = items.map((i) => ({ id: i.id, sector: i.sector }));
  const { error } = await sb
    .from("payment_items")
    .update({ sector: secRow.name, sector_matched_by: "zeev_bulk" })
    .in("id", items.map((i) => i.id));
  if (error) throw new Error(`update_sector: ${error.message}`);
  return { affected: items.length, before, after: { sector: secRow.name } };
}

async function execSetCostCenter(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const ccCode = String(payload.cost_center_code ?? "").trim();
  if (!ccCode) throw new Error("cost_center_code obrigatório");

  const { data: ccRow } = await sb.from("cost_centers").select("code, name").eq("code", ccCode).maybeSingle();
  if (!ccRow) throw new Error(`Centro de custos ${ccCode} não encontrado.`);

  const items = await buildItemsQuery(sb, paymentId, scope);
  if (items.length === 0) return { affected: 0, before: [], after: { cost_center_code: ccCode } };

  const before = items.map((i) => ({ id: i.id, cost_center_code: i.cost_center_code }));
  const { error } = await sb
    .from("payment_items")
    .update({ cost_center_code: ccCode })
    .in("id", items.map((i) => i.id));
  if (error) throw new Error(`update_cc: ${error.message}`);
  return { affected: items.length, before, after: { cost_center_code: ccCode } };
}

async function execLinkDoctorCompany(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const companyId = String(payload.company_id ?? "").trim();
  if (!companyId) throw new Error("company_id obrigatório");

  const { data: comp } = await sb.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!comp) throw new Error("Empresa não encontrada.");

  const items = await buildItemsQuery(sb, paymentId, scope);
  const missing = await filterDoctorCompanyMissing(sb, items);
  const doctorIds = [...missing];
  if (doctorIds.length === 0) return { affected: 0, before: [], after: { company_id: companyId, company_name: comp.name }, created_link_ids: [] };

  const rows = doctorIds.map((doctor_id) => ({
    doctor_id,
    company_id: companyId,
    start_date: new Date().toISOString().slice(0, 10),
  }));
  const { data: inserted, error } = await sb
    .from("doctor_companies")
    .insert(rows)
    .select("id, doctor_id");
  if (error) throw new Error(`link_doctor_company: ${error.message}`);

  return {
    affected: inserted?.length ?? 0,
    before: doctorIds.map((d) => ({ doctor_id: d, had_link: false })),
    after: { company_id: companyId, company_name: comp.name },
    created_link_ids: (inserted ?? []).map((r) => r.id),
  };
}

// -------------------- Cadastros (Fase 2) --------------------

function digitsOnly(s: string): string {
  return (s ?? "").replace(/\D+/g, "");
}

function isValidCnpj(cnpj: string): boolean {
  const c = digitsOnly(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

async function userHasInternalRole(sb: SB, userId: string): Promise<boolean> {
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "diretor", "validador", "analista", "gestao_medica"]);
  return (data?.length ?? 0) > 0;
}

async function execRegisterDoctorPending(sb: SB, payload: Record<string, unknown>, actorId: string, hospitalId: string | null) {
  const full_name = String(payload.full_name ?? "").trim();
  const crm = String(payload.crm ?? "").trim();
  const crm_uf = String(payload.crm_uf ?? "").trim().toUpperCase();
  const cpf = payload.cpf ? digitsOnly(String(payload.cpf)) : null;
  const vinculo = payload.vinculo ? String(payload.vinculo).trim() : null;
  if (!full_name || !crm || crm_uf.length !== 2) throw new Error("full_name, crm e crm_uf (2 letras) obrigatórios.");

  // Dedup: mesmo CRM+UF já existente?
  const { data: existing } = await sb
    .from("doctors")
    .select("id, full_name")
    .eq("crm", crm)
    .eq("crm_uf", crm_uf)
    .maybeSingle();
  if (existing) {
    throw new Error(`CRM ${crm}/${crm_uf} já existe para "${existing.full_name}". Use vincular alias em vez de cadastrar de novo.`);
  }

  const insertRow: Record<string, unknown> = {
    full_name,
    crm,
    crm_uf,
    cpf,
    vinculo,
    pending_admin_review: true,
    pending_review_note: "Criado via Zeev — pendente aprovação do admin.",
    created_by: actorId,
    created_by_user_id: actorId,
    active: true,
  };
  if (hospitalId) insertRow.state_uf = crm_uf; // referência inicial

  const { data: inserted, error } = await sb
    .from("doctors")
    .insert(insertRow)
    .select("id, code, full_name, crm, crm_uf")
    .single();
  if (error) throw new Error(`register_doctor: ${error.message}`);

  return {
    affected: 1,
    before: null,
    after: inserted,
  };
}

async function execRegisterCompany(sb: SB, payload: Record<string, unknown>, actorId: string) {
  const name = String(payload.name ?? "").trim();
  const document = digitsOnly(String(payload.document ?? ""));
  const state_uf = payload.state_uf ? String(payload.state_uf).trim().toUpperCase() : null;
  if (!name) throw new Error("name obrigatório.");
  if (!isValidCnpj(document)) throw new Error("CNPJ inválido.");

  const { data: existing } = await sb
    .from("companies")
    .select("id, name")
    .eq("document", document)
    .maybeSingle();
  if (existing) throw new Error(`CNPJ já cadastrado para "${existing.name}".`);

  const { data: inserted, error } = await sb
    .from("companies")
    .insert({ name, document, state_uf, created_by: actorId })
    .select("id, code, name, document, state_uf")
    .single();
  if (error) throw new Error(`register_company: ${error.message}`);

  return { affected: 1, before: null, after: inserted };
}

async function execResolveRegistryMatch(sb: SB, payload: Record<string, unknown>, actorId: string) {
  const alias_type = String(payload.alias_type ?? "") as "convenio" | "sector" | "doctor";
  const alias_text = String(payload.alias_text ?? "").trim();
  if (!alias_text) throw new Error("alias_text obrigatório.");

  let row: Record<string, unknown>;
  let table: "doctor_aliases" | "convenio_aliases" | "sector_aliases";
  let resolved: { id: string; label: string };

  if (alias_type === "doctor") {
    const canonical_id = String(payload.canonical_id ?? "").trim();
    if (!canonical_id) throw new Error("canonical_id obrigatório para alias de médico.");
    const { data: d } = await sb.from("doctors").select("id, full_name").eq("id", canonical_id).maybeSingle();
    if (!d) throw new Error("Médico canônico não encontrado.");
    table = "doctor_aliases";
    row = { doctor_id: canonical_id, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: d.id as string, label: d.full_name as string };
  } else if (alias_type === "convenio") {
    const slug = String(payload.canonical_slug ?? "").trim();
    if (!slug) throw new Error("canonical_slug obrigatório para alias de convênio.");
    const { data: c } = await sb.from("convenios").select("slug, name").eq("slug", slug).maybeSingle();
    if (!c) throw new Error("Convênio canônico não encontrado.");
    table = "convenio_aliases";
    row = { convenio_slug: slug, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: slug, label: c.name as string };
  } else if (alias_type === "sector") {
    const slug = String(payload.canonical_slug ?? "").trim();
    if (!slug) throw new Error("canonical_slug obrigatório para alias de setor.");
    const { data: s } = await sb.from("sectors").select("slug, name").eq("slug", slug).maybeSingle();
    if (!s) throw new Error("Setor canônico não encontrado.");
    table = "sector_aliases";
    row = { sector_slug: slug, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: slug, label: s.name as string };
  } else {
    throw new Error("alias_type inválido.");
  }

  const { data: inserted, error } = await sb.from(table).insert(row).select("id").single();
  if (error) throw new Error(`resolve_alias: ${error.message}`);

  return {
    affected: 1,
    before: null,
    after: { alias_id: inserted.id, alias_type, alias_text, resolved_to: resolved },
  };
}

// -------------------- Memória híbrida (Fase 4) --------------------

/** Gera assinatura estável e curta do que foi aceito, para agrupar repetições. */
function buildPreferenceScope(action: string, scope: Scope, payload: Record<string, unknown>): { scope: Record<string, unknown>; hash: string } {
  const keys: Record<string, unknown> = { action };
  // Campos relevantes do escopo (filtros)
  if (scope.convenio_slug) keys.convenio_slug = scope.convenio_slug;
  if (scope.procedure_code) keys.procedure_code = scope.procedure_code;
  if (scope.sector_missing) keys.sector_missing = true;
  if (scope.cost_center_missing) keys.cost_center_missing = true;
  if (scope.doctor_company_missing) keys.doctor_company_missing = true;
  // Campos relevantes do payload (o "valor" da preferência)
  for (const k of ["sector_code", "cost_center_code", "company_id", "alias_type", "canonical_id", "canonical_slug"]) {
    if (payload[k]) keys[k] = payload[k];
  }
  const hashSrc = Object.keys(keys).sort().map((k) => `${k}=${String(keys[k])}`).join("|");
  // hash SHA-256 → hex
  return { scope: keys, hash: hashSrc };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Após um execute aceito, grava evento + upsert do pattern. */
async function recordZeevPreference(
  sb: SB,
  hospitalId: string | null,
  action: string,
  scope: Scope,
  payload: Record<string, unknown>,
  paymentId: string | null,
) {
  if (!hospitalId) return; // sem hospital, sem memória
  const { scope: prefScope, hash: rawHash } = buildPreferenceScope(action, scope, payload);
  const scope_hash = await sha256Hex(rawHash);

  // Tenta upsert via select+update / insert
  const { data: existing } = await sb
    .from("learned_patterns")
    .select("id, occurrences")
    .eq("hospital_id", hospitalId)
    .eq("kind", "zeev_preference")
    .eq("scope_hash", scope_hash)
    .maybeSingle();

  let patternId: string;
  if (existing) {
    const newCount = (existing.occurrences ?? 0) + 1;
    const newConfidence = Math.min(1, newCount / 3); // 1→0.33, 2→0.66, 3+→1.0
    const { error } = await sb
      .from("learned_patterns")
      .update({
        occurrences: newCount,
        confidence: newConfidence,
        last_seen_at: new Date().toISOString(),
        signal: { last_payload: payload, last_scope: scope },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return;
    patternId = existing.id as string;
  } else {
    const { data: ins, error } = await sb
      .from("learned_patterns")
      .insert({
        hospital_id: hospitalId,
        kind: "zeev_preference",
        scope: prefScope,
        scope_hash,
        signal: { last_payload: payload, last_scope: scope },
        occurrences: 1,
        confidence: 0.33,
        status: "ativo",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !ins) return;
    patternId = ins.id as string;
  }

  await sb.from("learned_pattern_events").insert({
    pattern_id: patternId,
    source_kind: "zeev_executor",
    payment_id: paymentId,
    payload: { action, scope, payload },
  });
}

/** Carrega top N preferências ativas do hospital pra injetar no contexto do LLM. */
async function loadLearnedPreferences(sb: SB, hospitalId: string | null) {
  if (!hospitalId) return [];
  const { data } = await sb
    .from("learned_patterns")
    .select("scope, signal, occurrences, confidence")
    .eq("hospital_id", hospitalId)
    .eq("kind", "zeev_preference")
    .eq("status", "ativo")
    .order("occurrences", { ascending: false })
    .limit(15);
  return (data ?? []).map((p) => ({
    when: p.scope,
    suggested_payload: (p.signal as { last_payload?: unknown } | null)?.last_payload ?? null,
    seen: p.occurrences,
    confidence: p.confidence,
  }));
}

// -------------------- Preview --------------------

async function buildPreview(sb: SB, paymentId: string, scope: Scope, action: Action): Promise<{ count: number; samples: Proposal["sample_items"] }> {
  const items = await buildItemsQuery(sb, paymentId, scope);

  if (action === "link_doctor_company") {
    const missing = await filterDoctorCompanyMissing(sb, items);
    const filtered = items.filter((i) => i.doctor_id && missing.has(i.doctor_id));
    return {
      count: filtered.length,
      samples: filtered.slice(0, 3).map((i) => ({
        id: i.id,
        doctor_name: i.doctor_name,
        procedure_code: i.procedure_code,
        description: i.description,
        attendance_number: i.attendance_number,
      })),
    };
  }

  return {
    count: items.length,
    samples: items.slice(0, 3).map((i) => ({
      id: i.id,
      doctor_name: i.doctor_name,
      procedure_code: i.procedure_code,
      description: i.description,
      attendance_number: i.attendance_number,
    })),
  };
}

// -------------------- LLM call --------------------

async function callLLM(prompt: string, paymentContext: Record<string, unknown>) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Contexto do pagamento atual:\n${JSON.stringify(paymentContext, null, 2)}\n\nPedido do analista:\n"${prompt}"\n\nDevolva a proposta via tool 'respond'.`,
        },
      ],
      tools: [{
        type: "function",
        function: { name: "respond", description: "Devolve a proposta estruturada", parameters: RESPOND_SCHEMA },
      }],
      tool_choice: { type: "function", function: { name: "respond" } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
    const err = new Error(`ai_gateway_${resp.status}: ${text}`);
    (err as Error & { status?: number }).status = status;
    throw err;
  }

  const data = await resp.json();
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("LLM não retornou tool call");
  try {
    return JSON.parse(toolCall.function.arguments ?? "{}");
  } catch {
    throw new Error("falha ao parsear tool call");
  }
}

// -------------------- Aggregates --------------------

async function buildPaymentAggregates(sb: SB, paymentId: string) {
  const { data, error } = await sb
    .from("payment_items")
    .select("id, ai_status, gross_amount, expected_amount, manual_intervention_reason_id, ai_findings, company_id, sector, cost_center_code, doctor_id, is_pool_item")
    .eq("payment_id", paymentId)
    .limit(20000);
  if (error || !data) return null;

  let total = 0, zerados = 0, divergentes = 0, semRegra = 0, reprovados = 0, semSetor = 0, semCc = 0, semEmpresa = 0;
  for (const it of data) {
    total++;
    const g = Number(it.gross_amount ?? 0);
    if (!g || g === 0) zerados++;
    if ((it.ai_status === "reprovado" || it.ai_status === "alerta") && !it.manual_intervention_reason_id) divergentes++;
    if (it.ai_status === "reprovado") reprovados++;
    const findings = it.ai_findings as { needs_human_review?: boolean } | null;
    if (findings?.needs_human_review) semRegra++;
    if (!it.sector || it.sector === "") semSetor++;
    if (!it.cost_center_code || it.cost_center_code === "") semCc++;
    if (!it.company_id && !it.is_pool_item) semEmpresa++;
  }
  return { total, zerados, divergentes, sem_regra: semRegra, reprovados, sem_setor: semSetor, sem_cc: semCc, sem_empresa: semEmpresa };
}

// -------------------- HTTP handler --------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth (required) — must validate BEFORE any DB access or LLM call
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: authErr } = await userClient.auth.getUser();
    const actorId: string | null = u?.user?.id ?? null;
    if (authErr || !actorId) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as RequestBody;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // payment_id opcional. Quando presente, busca contexto enriquecido.
    let pay: { id: string; hospital_id: string | null; company_name: string | null; reference: string | null } | null = null;
    let aggregates: Awaited<ReturnType<typeof buildPaymentAggregates>> = null;
    if (body.payment_id) {
      const { data } = await sb
        .from("payments")
        .select("id, hospital_id, company_name, reference")
        .eq("id", body.payment_id)
        .maybeSingle();
      if (!data) return jsonResp({ error: "Pagamento não encontrado" }, 404);
      pay = data;
      aggregates = await buildPaymentAggregates(sb, body.payment_id);
    }


    // Hospital ativo (necessário pra memória híbrida quando não há payment_id)
    let activeHospitalId: string | null = pay?.hospital_id ?? null;
    if (!activeHospitalId) {
      const { data: ah } = await sb.from("user_active_hospital").select("hospital_id").eq("user_id", actorId).maybeSingle();
      activeHospitalId = (ah?.hospital_id as string) ?? null;
    }

    if (body.step === "propose") {
      if (!body.prompt) return jsonResp({ error: "prompt obrigatório" }, 400);

      const learnedPrefs = await loadLearnedPreferences(sb, activeHospitalId);

      const llm = await callLLM(body.prompt, {
        current_path: body.current_path ?? null,
        payment: pay ? { id: pay.id, reference: pay.reference, company_name: pay.company_name } : null,
        aggregates: aggregates ?? null,
        has_payment_context: !!body.payment_id,
        learned_preferences: learnedPrefs,
      });

      // Ações sem mutação — devolve direto pro cliente aplicar.
      if (llm.action === "answer" || llm.action === "navigate" || llm.action === "unsupported" || llm.action === "clarify") {
        return jsonResp({
          step: "respond",
          action: llm.action,
          summary: llm.summary ?? "",
          payload: llm.payload ?? {},
        });
      }

      const scope: Scope = llm.scope ?? {};
      const payload: Record<string, unknown> = llm.payload ?? {};
      const REGISTRY_ACTIONS = new Set(["register_doctor_pending", "register_company", "resolve_registry_match"]);

      // Validações de payload por ação → se faltar campo, vira clarify
      if (llm.action === "set_sector" && !payload.sector_code) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual setor (código) devo aplicar?" });
      }
      if (llm.action === "set_cost_center" && !payload.cost_center_code) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual centro de custos (código P12) devo aplicar?" });
      }
      if (llm.action === "link_doctor_company" && !payload.company_id) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Em qual empresa (ID) devo vincular os médicos?" });
      }
      if (llm.action === "register_doctor_pending") {
        const missing: string[] = [];
        if (!payload.full_name) missing.push("nome completo");
        if (!payload.crm) missing.push("CRM");
        if (!payload.crm_uf) missing.push("UF do CRM");
        if (missing.length) {
          return jsonResp({ step: "respond", action: "clarify", summary: `Pra cadastrar o médico preciso de: ${missing.join(", ")}.` });
        }
      }
      if (llm.action === "register_company") {
        const missing: string[] = [];
        if (!payload.name) missing.push("razão social");
        if (!payload.document) missing.push("CNPJ");
        if (missing.length) {
          return jsonResp({ step: "respond", action: "clarify", summary: `Pra cadastrar a empresa preciso de: ${missing.join(", ")}.` });
        }
      }
      if (llm.action === "resolve_registry_match") {
        if (!payload.alias_type || !payload.alias_text || (!payload.canonical_id && !payload.canonical_slug)) {
          return jsonResp({ step: "respond", action: "clarify", summary: "Pra registrar o alias preciso de: tipo (convenio/sector/doctor), texto alternativo e o cadastro canônico de destino." });
        }
      }

      // Ações de cadastro: NÃO precisam de payment_id e usam details em vez de sample_items.
      if (REGISTRY_ACTIONS.has(llm.action)) {
        const details: Array<{ label: string; value: string }> = [];
        if (llm.action === "register_doctor_pending") {
          details.push({ label: "Nome", value: String(payload.full_name) });
          details.push({ label: "CRM", value: `${payload.crm}/${String(payload.crm_uf).toUpperCase()}` });
          if (payload.cpf) details.push({ label: "CPF", value: digitsOnly(String(payload.cpf)) });
          if (payload.vinculo) details.push({ label: "Vínculo", value: String(payload.vinculo) });
          details.push({ label: "Status", value: "pendente aprovação admin" });
        } else if (llm.action === "register_company") {
          details.push({ label: "Razão social", value: String(payload.name) });
          details.push({ label: "CNPJ", value: digitsOnly(String(payload.document)) });
          if (payload.state_uf) details.push({ label: "UF", value: String(payload.state_uf).toUpperCase() });
        } else if (llm.action === "resolve_registry_match") {
          details.push({ label: "Tipo", value: String(payload.alias_type) });
          details.push({ label: "Texto novo", value: String(payload.alias_text) });
          details.push({ label: "Aponta para", value: String(payload.canonical_id ?? payload.canonical_slug) });
        }
        const proposal: Proposal = {
          action: llm.action,
          scope: {},
          payload,
          summary: llm.summary ?? "",
          preview_count: 1,
          sample_items: [],
          details,
        };
        return jsonResp({ step: "propose", proposal });
      }

      // Ações de mutação no lote — exigem payment_id
      if (!body.payment_id || !pay) {
        return jsonResp({
          step: "respond",
          action: "unsupported",
          summary: "Para aplicar essa ação preciso estar dentro de um pagamento específico. Abra o lote e tente de novo.",
        });
      }

      const { count, samples } = await buildPreview(sb, body.payment_id, scope, llm.action as Action);

      const proposal: Proposal = {
        action: llm.action,
        scope,
        payload,
        summary: llm.summary ?? "",
        preview_count: count,
        sample_items: samples,
      };

      return jsonResp({ step: "propose", proposal });
    }

    if (body.step === "execute") {
      if (!body.proposal) return jsonResp({ error: "proposal obrigatória" }, 400);
      const p = body.proposal;
      const REGISTRY_ACTIONS = new Set(["register_doctor_pending", "register_company", "resolve_registry_match"]);

      // Registros: gate de papel interno; não exigem payment_id
      if (REGISTRY_ACTIONS.has(p.action)) {
        const ok = await userHasInternalRole(sb, actorId);
        if (!ok) return jsonResp({ error: "Apenas papéis internos (analista+) podem cadastrar." }, 403);

        let result: { affected: number; before: unknown; after: unknown };
        if (p.action === "register_doctor_pending") {
          result = await execRegisterDoctorPending(sb, p.payload, actorId, pay?.hospital_id ?? null);
        } else if (p.action === "register_company") {
          result = await execRegisterCompany(sb, p.payload, actorId);
        } else {
          result = await execResolveRegistryMatch(sb, p.payload, actorId);
        }

        const after = result.after as { id?: string };
        await sb.from("audit_log").insert({
          entity_type: p.action === "register_doctor_pending" ? "doctor"
                     : p.action === "register_company" ? "company"
                     : "alias",
          entity_id: after?.id ?? null,
          action: `zeev.${p.action}`,
          actor_id: actorId,
          hospital_id: pay?.hospital_id ?? null,
          company_name: pay?.company_name ?? null,
          diff: {
            source: "zeev_executor",
            summary: p.summary,
            payload: p.payload,
            after: result.after,
          },
        });

        const msg = p.action === "register_doctor_pending" ? "Médico cadastrado (pendente aprovação)."
                  : p.action === "register_company" ? "Empresa cadastrada."
                  : "Alias registrado.";
        return jsonResp({ step: "executed", action: p.action, affected: 1, message: msg });
      }

      // Mutações no lote
      if (!body.payment_id || !pay) return jsonResp({ error: "payment_id obrigatório para executar" }, 400);

      let result: { affected: number; before: unknown; after: unknown; created_link_ids?: string[] };
      if (p.action === "set_sector") {
        result = await execSetSector(sb, body.payment_id, p.scope, p.payload);
      } else if (p.action === "set_cost_center") {
        result = await execSetCostCenter(sb, body.payment_id, p.scope, p.payload);
      } else if (p.action === "link_doctor_company") {
        result = await execLinkDoctorCompany(sb, body.payment_id, p.scope, p.payload);
      } else {
        return jsonResp({ error: `ação não suportada: ${p.action}` }, 400);
      }


      await sb.from("audit_log").insert({
        entity_type: "payment",
        entity_id: body.payment_id,
        action: `zeev.${p.action}`,
        actor_id: actorId,
        hospital_id: pay.hospital_id,
        company_name: pay.company_name,
        diff: {
          source: "zeev_executor",
          summary: p.summary,
          scope: p.scope,
          payload: p.payload,
          affected: result.affected,
          before: result.before,
          after: result.after,
          created_link_ids: result.created_link_ids ?? null,
        },
      });

      return jsonResp({
        step: "executed",
        action: p.action,
        affected: result.affected,
        message: `Aplicado em ${result.affected} ${result.affected === 1 ? "item" : "itens"}.`,
      });
    }

    return jsonResp({ error: "step inválido" }, 400);
  } catch (err) {
    const e = err as Error & { status?: number };
    return jsonResp({ error: e.message ?? String(err) }, e.status ?? 500);
  }
});
