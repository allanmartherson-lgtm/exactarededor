/**
 * Sub-Onda 2B — Testes do hash de duplicidade e classificação de severidade.
 *
 * Cobertura (6 testes):
 *  1. Hash determinístico para o mesmo input.
 *  2. Variações irrelevantes (case, acentos, espaços, horário do dia)
 *     produzem o MESMO hash.
 *  3. attendance_number diferente → hashes diferentes (mesmo dia, mesmo proc).
 *  4. Itens sem dados-chave (attendance/code/date) → hash null.
 *  5. classifyDuplicateMatch: bloqueio só a partir de "aprovado" em diante.
 *  6. classifyDuplicateMatch: cancelado/rejeitado ignoram; aguardando_*
 *     alertam.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeItemHash,
  classifyDuplicateMatch,
  normForHash,
  evaluateDuplicate,
  isMatchCoveredByOverride,
  BLOCK_PAYMENT_STATUSES,
  WARN_PAYMENT_STATUSES,
  IGNORE_PAYMENT_STATUSES,
} from "./itemHash.ts";

Deno.test("2B-hash #1: hash é determinístico (mesmo input → mesmo hash)", async () => {
  const input = {
    attendance_number: "ATD-12345",
    agreement_text: "Bradesco Saúde",
    procedure_date: "2026-05-13T14:00:00Z",
    procedure_code: "30715091",
    doctor_role: "Cirurgião Principal",
  };
  const a = await computeItemHash(input);
  const b = await computeItemHash(input);
  assertEquals(a, b);
  assert(a && a.length === 64, "SHA-256 hex deve ter 64 chars");
});

Deno.test("2B-hash #2: variações irrelevantes (case/acento/espaço/horário) → MESMO hash", async () => {
  const base = await computeItemHash({
    attendance_number: "ATD-12345",
    agreement_text: "Bradesco Saúde",
    procedure_date: "2026-05-13T14:00:00Z",
    procedure_code: "30715091",
    doctor_role: "Cirurgião Principal",
  });
  // Mesmo dia, horário diferente; convênio sem acento; case diferente; espaços extras.
  const variant = await computeItemHash({
    attendance_number: "  atd-12345  ",
    agreement_text: "BRADESCO SAUDE",
    procedure_date: "2026-05-13T23:59:00Z",
    procedure_code: "30715091",
    doctor_role: "cirurgiao principal",
  });
  assertEquals(base, variant, "Variações triviais devem produzir hashes idênticos");
});

Deno.test("2B-hash #3: attendance_number diferente → hashes DIFERENTES (mesmo proc, mesmo dia)", async () => {
  const a = await computeItemHash({
    attendance_number: "ATD-1",
    agreement_text: "Bradesco",
    procedure_date: "2026-05-13",
    procedure_code: "30715091",
    doctor_role: "cirurgiao",
  });
  const b = await computeItemHash({
    attendance_number: "ATD-2",
    agreement_text: "Bradesco",
    procedure_date: "2026-05-13",
    procedure_code: "30715091",
    doctor_role: "cirurgiao",
  });
  assert(a && b);
  assert(a !== b, "attendance_number diferente deve gerar hashes diferentes");
});

Deno.test("2B-hash #4: itens sem campos-chave → hash null", async () => {
  assertEquals(
    await computeItemHash({
      attendance_number: null,
      procedure_code: "30715091",
      procedure_date: "2026-05-13",
    }),
    null,
    "Sem attendance_number → null",
  );
  assertEquals(
    await computeItemHash({
      attendance_number: "ATD-1",
      procedure_code: null,
      procedure_date: "2026-05-13",
    }),
    null,
    "Sem procedure_code → null",
  );
  assertEquals(
    await computeItemHash({
      attendance_number: "ATD-1",
      procedure_code: "30715091",
      procedure_date: null,
    }),
    null,
    "Sem procedure_date → null",
  );
});

Deno.test("2B-hash #5: classifyDuplicateMatch — TODOS os status de aprovado em diante BLOQUEIAM", () => {
  // Garantia explícita do mapa final acordado com o usuário.
  const expectedBlock = [
    "aprovado",
    "aprovado_em_revisao",
    "aprovado_com_ressalva",
    "pedido_nf_enviado",
    "nf_recebida",
    "nf_questionada",
    "nf_divergente",
    "nf_conciliada",
    "lancado",
    "arquivado",
    "pago",
  ];
  for (const st of expectedBlock) {
    assertEquals(classifyDuplicateMatch(st), "block", `${st} deveria BLOQUEAR`);
    assert(BLOCK_PAYMENT_STATUSES.has(st));
  }
});

Deno.test("2B-hash #6: classifyDuplicateMatch — cancelado/rejeitado IGNORAM; rascunho..aguardando_aprovacao ALERTAM", () => {
  for (const st of ["cancelado", "rejeitado"]) {
    assertEquals(classifyDuplicateMatch(st), "none", `${st} deveria IGNORAR`);
    assert(IGNORE_PAYMENT_STATUSES.has(st));
  }
  const expectedWarn = [
    "rascunho",
    "em_analise_ia",
    "revisao_analista",
    "aguardando_validacao",
    "devolvido_analista",
    "aguardando_aprovacao",
  ];
  for (const st of expectedWarn) {
    assertEquals(classifyDuplicateMatch(st), "warn", `${st} deveria ALERTAR`);
    assert(WARN_PAYMENT_STATUSES.has(st));
  }

  // Sanity: normForHash continua determinístico (usado no hash).
  assertEquals(normForHash("Cirurgião Principal"), normForHash("cirurgiao principal"));
});

/* ===== BUGFIX 2B — Override com escopo restrito (testes 7, 8, 9) ===== */

const ITEM_A = "00000000-0000-0000-0000-00000000000a";
const PAY_A  = "00000000-0000-0000-0000-0000000000aa";
const ITEM_B = "00000000-0000-0000-0000-00000000000b";
const PAY_B  = "00000000-0000-0000-0000-0000000000bb";
const ITEM_C = "00000000-0000-0000-0000-00000000000c";
const PAY_C  = "00000000-0000-0000-0000-0000000000cc";
const ITEM_D = "00000000-0000-0000-0000-00000000000d";
const PAY_D  = "00000000-0000-0000-0000-0000000000dd";

type M = {
  other_item_id: string;
  other_payment_id: string;
  severity: "block" | "warn";
};
const m = (item: string, pay: string, sev: "block" | "warn" = "block"): M =>
  ({ other_item_id: item, other_payment_id: pay, severity: sev });

Deno.test("2B-bugfix #7: override é específico ao lote autorizado — Item C ainda bloqueia mesmo com override de B existente em B", () => {
  // Item B foi avaliado e o diretor autorizou override pareado com Lote A.
  const overrideOnB = {
    by: "diretor-uuid",
    at: new Date().toISOString(),
    justification: "ok",
    paired_with_item_ids: [ITEM_A],
    paired_with_payment_ids: [PAY_A],
  };
  // Reanalisando Item B contra Lote A pago → coberto, vira "override".
  const evalB = evaluateDuplicate([m(ITEM_A, PAY_A, "block")], overrideOnB);
  assertEquals(evalB.severity, "override");
  assertEquals(evalB.uncovered.length, 0);

  // Agora chega Item C (item NOVO, sem nenhum override próprio)
  // e colide com Lote A E com Lote B. Tem que BLOQUEAR — o override que existe
  // está no Item B, não no C; o motor avalia C com override=null.
  const matchesForC = [m(ITEM_A, PAY_A, "block"), m(ITEM_B, PAY_B, "block")];
  const evalC = evaluateDuplicate(matchesForC, null);
  assertEquals(evalC.severity, "block", "Item C deve bloquear — sem override próprio");
  assertEquals(evalC.uncovered.length, 2, "ambas as colisões aparecem como não-cobertas");
  assert(evalC.uncovered.some((x) => x.other_payment_id === PAY_A));
  assert(evalC.uncovered.some((x) => x.other_payment_id === PAY_B));
});

Deno.test("2B-bugfix #8: override do Item C cobre A e B — mas não cobre Lote D futuro", () => {
  // Diretor autoriza override em C pareado com Lote A e Lote B.
  const overrideOnC = {
    by: "diretor-uuid",
    at: new Date().toISOString(),
    justification: "ok",
    paired_with_item_ids: [ITEM_A, ITEM_B],
    paired_with_payment_ids: [PAY_A, PAY_B],
  };

  // Reanaliso C contra A e B → todas cobertas → "override".
  const evalC = evaluateDuplicate(
    [m(ITEM_A, PAY_A, "block"), m(ITEM_B, PAY_B, "block")],
    overrideOnC,
  );
  assertEquals(evalC.severity, "override");

  // Lote D chega depois (item novo, sem override próprio, colide com A, B e C).
  const evalD = evaluateDuplicate(
    [m(ITEM_A, PAY_A, "block"), m(ITEM_B, PAY_B, "block"), m(ITEM_C, PAY_C, "block")],
    null,
  );
  assertEquals(evalD.severity, "block", "Item D deve bloquear");
  assertEquals(evalD.uncovered.length, 3);

  // Sanity: o override de C, isolado, NÃO cobre uma colisão com Lote D.
  assert(!isMatchCoveredByOverride(m(ITEM_D, PAY_D), overrideOnC));
});

Deno.test("2B-bugfix #9: override parcial não passa — colisão não-coberta derruba o override e mantém bloqueio", () => {
  // Item E tem override forjado/parcial cobrindo só Lote X.
  const ITEM_X = "00000000-0000-0000-0000-0000000000e1";
  const PAY_X  = "00000000-0000-0000-0000-0000000000f1";
  const ITEM_Y = "00000000-0000-0000-0000-0000000000e2";
  const PAY_Y  = "00000000-0000-0000-0000-0000000000f2";

  const partial = {
    by: "diretor-uuid",
    at: new Date().toISOString(),
    justification: "ok",
    paired_with_item_ids: [ITEM_X],
    paired_with_payment_ids: [PAY_X],
  };

  const matches = [m(ITEM_X, PAY_X, "block"), m(ITEM_Y, PAY_Y, "block")];
  const ev = evaluateDuplicate(matches, partial);
  assertEquals(ev.severity, "block", "Override parcial NÃO libera — bloqueia");
  assertEquals(ev.uncovered.length, 1);
  assertEquals(ev.uncovered[0].other_payment_id, PAY_Y, "trace mostra exatamente a colisão sem autorização");
  assert(isMatchCoveredByOverride(matches[0], partial), "X está coberto");
  assert(!isMatchCoveredByOverride(matches[1], partial), "Y não está coberto");
});
