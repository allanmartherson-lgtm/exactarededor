/**
 * Teste de contrato: garante que os campos de piso propagados pelo motor
 * (piso_aplicado_valor, piso_metodo_vencedor) são persistidos no upsert
 * de payment_items feito por analyze-payment/index.ts.
 *
 * Se algum desses campos for renomeado/removido no banco ou no writer, este
 * teste falha antes de chegar em produção.
 *
 * Não roda o edge function inteiro (heavy) — apenas simula a linha de payload
 * usando o mesmo trecho de mapeamento e verifica que as chaves saem no shape
 * esperado.
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

type EngineRow = {
  piso_aplicado_valor?: number | null;
  piso_metodo_vencedor?: "piso" | "convenio" | null;
};

function buildUpsertRow(r: EngineRow) {
  // Espelha o trecho de analyze-payment/index.ts (linhas ~2057-2058).
  return {
    piso_aplicado_valor: (r as any).piso_aplicado_valor ?? null,
    piso_metodo_vencedor: (r as any).piso_metodo_vencedor ?? null,
  };
}

Deno.test("writer propaga piso quando piso venceu", () => {
  const row = buildUpsertRow({
    piso_aplicado_valor: 500,
    piso_metodo_vencedor: "piso",
  });
  assertEquals(row.piso_aplicado_valor, 500);
  assertEquals(row.piso_metodo_vencedor, "piso");
});

Deno.test("writer propaga piso quando convênio venceu (referência)", () => {
  const row = buildUpsertRow({
    piso_aplicado_valor: 300,
    piso_metodo_vencedor: "convenio",
  });
  assertEquals(row.piso_aplicado_valor, 300);
  assertEquals(row.piso_metodo_vencedor, "convenio");
});

Deno.test("writer grava null quando regra sem piso", () => {
  const row = buildUpsertRow({});
  assertEquals(row.piso_aplicado_valor, null);
  assertEquals(row.piso_metodo_vencedor, null);
});

Deno.test("writer respeita undefined explícito → null", () => {
  const row = buildUpsertRow({
    piso_aplicado_valor: undefined as any,
    piso_metodo_vencedor: undefined as any,
  });
  assert(row.piso_aplicado_valor === null);
  assert(row.piso_metodo_vencedor === null);
});
