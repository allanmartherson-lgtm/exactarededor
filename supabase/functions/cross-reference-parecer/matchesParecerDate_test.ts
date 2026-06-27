// Garante que matchesParecerDate nunca usa dt_solic_parecer como fallback
// e sempre compara contra dt_resposta_parecer (data da resposta do parecer).
// Regressão: bug reportado em 27/06/2026 — sistema puxava 30/04 (solicitação)
// mesmo com mapping correto da coluna "data da resposta".
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchesParecerDate, sameDayUtc } from "./index.ts";

Deno.test("sameDayUtc: mesma data em UTC ignora hora", () => {
  assertStrictEquals(
    sameDayUtc("2026-04-30T00:00:00Z", "2026-04-30T23:59:00Z"),
    true,
  );
});

Deno.test("sameDayUtc: datas diferentes retornam false", () => {
  assertStrictEquals(
    sameDayUtc("2026-04-30T12:00:00Z", "2026-05-01T12:00:00Z"),
    false,
  );
});

Deno.test("sameDayUtc: null em qualquer lado retorna false", () => {
  assertStrictEquals(sameDayUtc(null, "2026-04-30T00:00:00Z"), false);
  assertStrictEquals(sameDayUtc("2026-04-30T00:00:00Z", null), false);
  assertStrictEquals(sameDayUtc(null, null), false);
});

Deno.test("matchesParecerDate: confirma quando dt_resposta_parecer == procedureDate", () => {
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: "2026-05-02T00:00:00Z",
  };
  assertEquals(matchesParecerDate(row, "2026-05-02T00:00:00Z"), true);
});

Deno.test("matchesParecerDate: NÃO casa quando procedureDate bate apenas com dt_solic_parecer", () => {
  // Cenário do bug: usuário escolheu data da resposta no mapping,
  // mas procedureDate (30/04) só bate com solicitação. NÃO pode confirmar.
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: "2026-05-02T00:00:00Z",
  };
  assertStrictEquals(matchesParecerDate(row, "2026-04-30T00:00:00Z"), false);
});

Deno.test("matchesParecerDate: dt_resposta_parecer null NUNCA cai para dt_solic_parecer", () => {
  // Parecer ainda não respondido: mesmo que procedureDate == solicitação,
  // resultado deve ser false (sem fallback silencioso).
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: null,
  };
  assertStrictEquals(matchesParecerDate(row, "2026-04-30T00:00:00Z"), false);
});

Deno.test("matchesParecerDate: dt_resposta_parecer string vazia também não cai para solic", () => {
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: "",
  };
  assertStrictEquals(matchesParecerDate(row, "2026-04-30T00:00:00Z"), false);
});

Deno.test("matchesParecerDate: procedureDate null retorna false", () => {
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: "2026-05-02T00:00:00Z",
  };
  assertStrictEquals(matchesParecerDate(row, null), false);
});

Deno.test("matchesParecerDate: ambas as datas iguais (solic == resposta) confirma normalmente", () => {
  const row = {
    dt_solic_parecer: "2026-04-30T00:00:00Z",
    dt_resposta_parecer: "2026-04-30T00:00:00Z",
  };
  assertStrictEquals(matchesParecerDate(row, "2026-04-30T00:00:00Z"), true);
});
