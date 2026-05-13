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
