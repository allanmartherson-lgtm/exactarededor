// Teste de contrato — Portal externo (submit-invoice GET)
// ============================================================
// Garante, em tempo de build, que o JSON devolvido para o RECEBEDOR
// (recipient da NF, fora da Rede D'Or) jamais cresça para incluir
// histórico interno, observações, análises de IA, status_history,
// audit_log ou findings — informações estritamente internas.
//
// Estratégia: ler o source da edge function e validar três invariantes
// na ROTA GET (que é a única rota lida pelo portal):
//
//   1) Cada `.select(...)` é uma allowlist explícita (NUNCA `select("*")`).
//   2) Apenas tabelas permitidas são consultadas dentro do GET.
//   3) Apenas colunas permitidas aparecem nos selects do GET.
//
// Qualquer regressão (ex.: alguém adicionar `payment_observations` ao GET,
// ou trocar a allowlist por `select("*")`) quebra o teste — protegendo
// a fronteira entre dados internos e dados expostos para fora.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC_PATH = new URL("./index.ts", import.meta.url);
const SRC = await Deno.readTextFile(SRC_PATH);

// --- Extrai o bloco do GET (do `if (req.method === "GET")` até a primeira
// linha de retorno + 1, suficiente pra capturar todos os selects da rota).
function extractGetBranch(src: string): string {
  const start = src.indexOf('if (req.method === "GET")');
  assert(start >= 0, "Não encontrei o branch GET — a rota mudou?");
  // Encontra o fechamento do `if` casando chaves a partir do `{` inicial.
  const openIdx = src.indexOf("{", start);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("Não consegui delimitar o bloco do GET.");
}

const GET_BLOCK = extractGetBranch(SRC);

// --- Coleta todas as chamadas `.from("xxx")` e `.select("...")` no bloco.
function matchAll(re: RegExp, s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(re)) out.push(m[1]);
  return out;
}

// Remove chamadas a `supabase.storage.from(...)` (bucket de storage) antes de
// escanear — só nos interessa o Data API (`supabase.from(...)`).
const DATA_API_BLOCK = GET_BLOCK.replace(/\.storage\s*\.from\(\s*["'][^"']+["']\s*\)/g, ".storage.__bucket__");
const tablesQueried = matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g, DATA_API_BLOCK);
const selects = matchAll(/\.select\(\s*["']([^"']+)["']\s*\)/g, DATA_API_BLOCK);

// --- Allowlists. Atualize com cautela; cada adição precisa de revisão.
const ALLOWED_TABLES = new Set<string>([
  "invoices",
  "payments",
  "invoice_questions",
  "invoice_question_attachments",
]);

// Tabelas que NUNCA podem ser tocadas pelo GET do portal (defense in depth).
const FORBIDDEN_TABLES = new Set<string>([
  "payment_observations",
  "payment_status_history",
  "ai_analysis_versions",
  "audit_log",
  "ai_findings",
  "validation_findings",
  "user_roles",
  "profiles",
  "rules",
  "rule_calculations",
  "payment_assignments",
]);

// Colunas permitidas por tabela (allowlist estrita por tabela).
const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  invoices: new Set([
    "id", "expected_amount", "status", "recipient_email",
    "payment_id", "company_name", "received_at",
  ]),
  payments: new Set([
    "reference", "description", "sectors", "specialties",
    "competence_months", "competence_month", "payment_kind", "status",
  ]),
  invoice_questions: new Set([
    "id", "author_type", "author_name", "message", "created_at",
  ]),
  invoice_question_attachments: new Set([
    "id", "question_id", "file_name", "storage_path", "mime_type", "size_bytes",
  ]),
};

// Colunas que JAMAIS podem aparecer em selects do GET do portal,
// mesmo que a tabela onde estão fosse permitida no futuro.
const FORBIDDEN_COLUMNS = new Set<string>([
  "ai_status", "ai_findings", "ai_summary", "ai_observations",
  "validation_findings", "internal_notes", "observation_type",
  "exception_note", "exception_authorizer",
  "approver_id", "validator_id", "analyst_id",
  "resolved_by", "answered_by_observation_id",
]);

Deno.test("GET nunca usa select('*') — sempre allowlist explícita", () => {
  const starSelect = /\.select\(\s*["']\s*\*\s*["']\s*\)/.test(GET_BLOCK);
  assertEquals(starSelect, false, "Detected select('*') na rota GET do portal — proibido.");
});

Deno.test("GET só toca tabelas explicitamente permitidas", () => {
  for (const t of tablesQueried) {
    assert(
      ALLOWED_TABLES.has(t),
      `Tabela "${t}" consultada no GET não está na allowlist. ` +
        `Se for legítimo, adicione em ALLOWED_TABLES (com revisão de segurança).`,
    );
    assert(
      !FORBIDDEN_TABLES.has(t),
      `Tabela INTERNA "${t}" consultada no GET — vazamento de histórico interno.`,
    );
  }
});

Deno.test("GET expõe apenas colunas permitidas por tabela", () => {
  // Reconstrói pares (tabela, select) na ordem em que aparecem no source.
  // Cada `.from(table).select(cols)` vira um par; usamos uma regex robusta
  // que casa `.from("t")...select("cols")` permitindo encadeamento.
  const pairRe = /\.from\(\s*["']([^"']+)["']\s*\)[\s\S]*?\.select\(\s*["']([^"']+)["']\s*\)/g;
  const seen: Array<{ table: string; cols: string[] }> = [];
  for (const m of GET_BLOCK.matchAll(pairRe)) {
    const table = m[1];
    const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
    seen.push({ table, cols });
  }
  assert(seen.length > 0, "Não detectei nenhum .from(...).select(...) no GET — quebra de invariante.");

  for (const { table, cols } of seen) {
    const allowed = ALLOWED_COLUMNS[table];
    assert(allowed, `Sem allowlist de colunas definida para "${table}".`);
    for (const c of cols) {
      assert(
        !FORBIDDEN_COLUMNS.has(c),
        `Coluna sensível "${c}" exposta no GET (tabela ${table}).`,
      );
      assert(
        allowed.has(c),
        `Coluna "${c}" não está na allowlist de "${table}". ` +
          `Se for legítimo expor para o recebedor da NF, atualize ALLOWED_COLUMNS com revisão.`,
      );
    }
  }
});

Deno.test("GET não chama RPC nem .functions.invoke (sem efeitos colaterais externos)", () => {
  // Defense in depth: GET é leitura pura — não pode disparar fluxos internos
  // (notificações, edge functions, RPC com SECURITY DEFINER) que poderiam
  // logar/vazar dados pra outros canais.
  assert(!/\.rpc\(/.test(GET_BLOCK), "GET não pode chamar .rpc(...).");
  assert(!/\.functions\.invoke\(/.test(GET_BLOCK), "GET não pode chamar .functions.invoke(...).");
});
