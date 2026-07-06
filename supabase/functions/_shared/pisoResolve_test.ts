/**
 * Piso por procedimento — resolvePisoForRole.
 *
 * Regras validadas:
 *  - piso_habilitado=false → sempre null (não aplicar piso).
 *  - piso_por_funcao com a função do item vence piso_valor_padrao.
 *  - Sem entrada específica para a função → cai em piso_valor_padrao.
 *  - Chaves de função são normalizadas via classifyDoctorRole (Cirurgião
 *    Principal, cirurgiao, "Cirurgião" batem no mesmo bucket).
 *  - piso_valor_padrao <= 0 ou null → null (piso não configurado).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePisoForRole } from "./rulesEngine.ts";

Deno.test("piso desligado → null", () => {
  assertEquals(
    resolvePisoForRole(
      { piso_habilitado: false, piso_valor_padrao: 1000, piso_por_funcao: [] },
      "Cirurgião Principal",
    ),
    null,
  );
});

Deno.test("piso por função vence padrão", () => {
  const c = {
    piso_habilitado: true,
    piso_valor_padrao: 800,
    piso_por_funcao: [
      { role: "cirurgiao", valor: 1100 },
      { role: "primeiro_aux", valor: 330 },
    ],
  };
  assertEquals(resolvePisoForRole(c, "Cirurgião Principal"), 1100);
  assertEquals(resolvePisoForRole(c, "1º Auxiliar"), 330);
  // Instrumentador não está na lista → cai no padrão.
  assertEquals(resolvePisoForRole(c, "Instrumentador"), 800);
});

Deno.test("sem entrada e sem padrão → null", () => {
  assertEquals(
    resolvePisoForRole(
      { piso_habilitado: true, piso_valor_padrao: null, piso_por_funcao: [] },
      "Cirurgião Principal",
    ),
    null,
  );
});

Deno.test("padrão zero é ignorado (null)", () => {
  assertEquals(
    resolvePisoForRole(
      { piso_habilitado: true, piso_valor_padrao: 0, piso_por_funcao: [] },
      "Cirurgião Principal",
    ),
    null,
  );
});
