/**
 * Sub-Onda 2D — Testes T1, T2, T3, T7, T8 da função SQL `validate_rule_save`.
 *
 * Estratégia (Opção 1 confirmada pelo usuário):
 *   - Conexão Postgres direta via SUPABASE_DB_URL (NUNCA hardcoded).
 *   - Cada teste roda em transação com ROLLBACK final → zero efeito colateral.
 *   - Seed de user_roles(admin) dentro da tx + SET LOCAL request.jwt.claims
 *     para que `auth.uid()` e `has_role()` enxerguem o usuário de teste.
 *
 * Cobertura:
 *   T1 — doctor_already_bound
 *   T2 — validity_overlap (com suggested_valid_until)
 *   T3 — company_already_bound
 *   T7 — self-edit (passar rule_id → não conflita consigo mesma)
 *   T8 — master_already_exists
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newUuid, withAuthenticatedTx } from "./testDbHelper.ts";

interface ValidationProblem {
  type: string;
  doctor_crm?: string;
  company_key?: string;
  existing_rule_id?: string;
  existing_rule_name?: string;
  suggested_valid_until?: string | null;
  [k: string]: unknown;
}
interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

async function callValidate(
  tx: { query: <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]> },
  params: {
    rule_id?: string | null;
    scope: "master" | "especifica" | "grupo";
    target_type?: "medico" | "empresa" | null;
    target_identifier?: string | null;
    target_company_id?: string | null;
    group_doctors?: unknown;
    group_company_links?: unknown;
    valid_from?: string | null;
    valid_until?: string | null;
  },
): Promise<ValidationResult> {
  const rows = await tx.query<{ validate_rule_save: ValidationResult }>(
    `SELECT public.validate_rule_save(
       $1::uuid, $2::public.rule_scope, $3::public.rule_target_type,
       $4::text, $5::uuid, $6::jsonb, $7::jsonb, $8::date, $9::date
     ) AS validate_rule_save`,
    [
      params.rule_id ?? null,
      params.scope,
      params.target_type ?? null,
      params.target_identifier ?? null,
      params.target_company_id ?? null,
      params.group_doctors ? JSON.stringify(params.group_doctors) : null,
      params.group_company_links ? JSON.stringify(params.group_company_links) : null,
      params.valid_from ?? null,
      params.valid_until ?? null,
    ],
  );
  return rows[0].validate_rule_save;
}

async function insertRule(
  tx: { query: <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]> },
  r: {
    name: string;
    scope: "master" | "especifica" | "grupo";
    target_type?: "medico" | "empresa" | null;
    target_identifier?: string | null;
    target_company_id?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
  },
): Promise<string> {
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO public.rules
       (name, rule_text, scope, target_type, target_identifier, target_company_id, valid_from, valid_until, active)
     VALUES ($1, $1, $2::public.rule_scope, $3::public.rule_target_type, $4, $5::uuid, $6::date, $7::date, true)
     RETURNING id`,
    [
      r.name,
      r.scope,
      r.target_type ?? null,
      r.target_identifier ?? null,
      r.target_company_id ?? null,
      r.valid_from ?? null,
      r.valid_until ?? null,
    ],
  );
  return rows[0].id;
}

// =========================== T1 ===========================
Deno.test("2D/T1 — doctor_already_bound: novo cadastro p/ médico já vinculado", async () => {
  await withAuthenticatedTx("admin", async (tx) => {
    const crm = "999" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    await insertRule(tx, {
      name: `Regra existente CRM ${crm}`,
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: "2026-01-01", valid_until: null,
    });

    const out = await callValidate(tx, {
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: "2026-06-01", valid_until: null,
    });

    assertEquals(out.valid, false);
    const bound = out.problems.find((p) => p.type === "doctor_already_bound");
    assert(bound, "esperava problema doctor_already_bound");
    assertEquals(bound!.doctor_crm, crm);
  });
});

// =========================== T2 ===========================
Deno.test("2D/T2 — validity_overlap: vigências sobrepostas com suggested_valid_until", async () => {
  await withAuthenticatedTx("admin", async (tx) => {
    const crm = "888" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    await insertRule(tx, {
      name: `Regra anterior CRM ${crm}`,
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: "2026-01-01", valid_until: "2026-12-31",
    });

    const newFrom = "2026-06-01";
    const out = await callValidate(tx, {
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: newFrom, valid_until: "2026-12-31",
    });

    assertEquals(out.valid, false);
    const overlap = out.problems.find((p) => p.type === "validity_overlap");
    assert(overlap, "esperava problema validity_overlap");
    // Sugestão = newFrom - 1 dia = 2026-05-31
    assertEquals(String(overlap!.suggested_valid_until).slice(0, 10), "2026-05-31");
  });
});

// =========================== T3 ===========================
Deno.test("2D/T3 — company_already_bound: novo cadastro p/ empresa (CNPJ) já vinculada", async () => {
  await withAuthenticatedTx("admin", async (tx) => {
    const cnpj = "33" + Math.floor(Math.random() * 1e12).toString().padStart(12, "0");
    await insertRule(tx, {
      name: `Regra empresa CNPJ ${cnpj}`,
      scope: "especifica", target_type: "empresa", target_identifier: cnpj,
      valid_from: "2026-01-01", valid_until: null,
    });

    const out = await callValidate(tx, {
      scope: "especifica", target_type: "empresa", target_identifier: cnpj,
      valid_from: "2026-06-01", valid_until: null,
    });

    assertEquals(out.valid, false);
    const bound = out.problems.find((p) => p.type === "company_already_bound");
    assert(bound, "esperava problema company_already_bound");
    assertEquals(bound!.company_key, cnpj);
  });
});

// =========================== T7 ===========================
Deno.test("2D/T7 — self-edit: passar rule_id da própria regra → sem conflito consigo mesma", async () => {
  await withAuthenticatedTx("admin", async (tx) => {
    const crm = "777" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    const ruleId = await insertRule(tx, {
      name: `Regra editável CRM ${crm}`,
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: "2026-01-01", valid_until: null,
    });

    const out = await callValidate(tx, {
      rule_id: ruleId,
      scope: "especifica", target_type: "medico", target_identifier: crm,
      valid_from: "2026-06-01", valid_until: null,
    });

    // Não deve conflitar com ela mesma.
    const selfConflict = out.problems.find(
      (p) => p.existing_rule_id === ruleId,
    );
    assertEquals(selfConflict, undefined, "regra não pode conflitar consigo mesma");
    // Como não há outros peers com esse CRM aleatório, deve ser 100% válida.
    assertEquals(out.valid, true);
    assertEquals(out.problems.length, 0);
  });
});

// =========================== T8 ===========================
Deno.test("2D/T8 — master_already_exists: nova master quando já há master ativa", async () => {
  await withAuthenticatedTx("admin", async (tx) => {
    // Garante uma master conhecida (existem outras em DB; o teste só exige
    // que pelo menos uma seja reportada com sugestão correta).
    const existingId = await insertRule(tx, {
      name: "Master de teste 2D/T8",
      scope: "master",
      valid_from: "2026-01-01", valid_until: null,
    });

    const newFrom = "2026-07-15";
    const out = await callValidate(tx, {
      scope: "master",
      valid_from: newFrom, valid_until: null,
    });

    assertEquals(out.valid, false);
    const masters = out.problems.filter((p) => p.type === "master_already_exists");
    assert(masters.length >= 1, "esperava ao menos um master_already_exists");
    const mine = masters.find((p) => p.existing_rule_id === existingId);
    assert(mine, "master inserida pelo teste deve aparecer em problems");
    assertEquals(String(mine!.suggested_valid_until).slice(0, 10), "2026-07-14");
  });
});
