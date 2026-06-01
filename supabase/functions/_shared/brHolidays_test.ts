import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isBrazilianNationalHoliday, __test } from "./brHolidays.ts";

Deno.test("Páscoa 2026 cai em 05/04", () => {
  const e = __test.easterSunday(2026);
  assertEquals(e, { month: 4, day: 5 });
});

Deno.test("Tiradentes (21/04) é feriado nacional", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-21"), true);
  assertEquals(isBrazilianNationalHoliday("2026-04-21T14:30:00"), true);
  assertEquals(isBrazilianNationalHoliday("21/04/2026"), true);
});

Deno.test("Natal e Confraternização são feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-12-25"), true);
  assertEquals(isBrazilianNationalHoliday("2026-01-01"), true);
});

Deno.test("Carnaval 2026 (terça = 17/02) é feriado", () => {
  // Páscoa 2026 = 05/04 → terça-feira de carnaval = 05/04 - 47 dias = 17/02
  assertEquals(isBrazilianNationalHoliday("2026-02-17"), true);
  assertEquals(isBrazilianNationalHoliday("2026-02-16"), true); // segunda
});

Deno.test("Sexta-feira Santa 2026 (03/04) é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-03"), true);
});

Deno.test("Corpus Christi 2026 (04/06) é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-06-04"), true);
});

Deno.test("Consciência Negra (20/11) é feriado nacional desde 2024", () => {
  assertEquals(isBrazilianNationalHoliday("2026-11-20"), true);
});

Deno.test("Dia útil comum não é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-03-10"), false);
  assertEquals(isBrazilianNationalHoliday("2026-07-15"), false);
});

Deno.test("Entrada inválida não quebra", () => {
  assertEquals(isBrazilianNationalHoliday(""), false);
  assertEquals(isBrazilianNationalHoliday("não-é-data"), false);
});
