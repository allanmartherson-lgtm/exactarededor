import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isBrazilianNationalHoliday, __test } from "./brHolidays.ts";

// ---------- Páscoa / móveis ----------

Deno.test("Páscoa 2026 cai em 05/04", () => {
  assertEquals(__test.easterSunday(2026), { month: 4, day: 5 });
});

Deno.test("Páscoa em anos variados (smoke)", () => {
  // Valores conferidos contra tabela oficial.
  assertEquals(__test.easterSunday(2024), { month: 3, day: 31 });
  assertEquals(__test.easterSunday(2025), { month: 4, day: 20 });
  assertEquals(__test.easterSunday(2027), { month: 3, day: 28 });
  assertEquals(__test.easterSunday(2030), { month: 4, day: 21 });
});

// ---------- Feriados fixos ----------

Deno.test("Tiradentes (21/04) é feriado nacional", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-21"), true);
  assertEquals(isBrazilianNationalHoliday("21/04/2026"), true);
});

Deno.test("Natal, Confraternização, Independência, Aparecida, Finados, Proclamação", () => {
  for (const d of ["2026-12-25", "2026-01-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15"]) {
    assertEquals(isBrazilianNationalHoliday(d), true, `${d} deveria ser feriado`);
  }
});

Deno.test("Consciência Negra (20/11) é feriado nacional desde 2024", () => {
  assertEquals(isBrazilianNationalHoliday("2026-11-20"), true);
  assertEquals(isBrazilianNationalHoliday("2024-11-20"), true);
});

// ---------- Móveis derivados da Páscoa ----------

Deno.test("Carnaval 2026 (16-17/02) é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-02-16"), true); // segunda
  assertEquals(isBrazilianNationalHoliday("2026-02-17"), true); // terça
});

Deno.test("Sexta-feira Santa 2026 (03/04) é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-03"), true);
});

Deno.test("Corpus Christi 2026 (04/06) é feriado", () => {
  assertEquals(isBrazilianNationalHoliday("2026-06-04"), true);
});

// ---------- Datas com hora (mesmo dia local) ----------

Deno.test("ISO com hora qualquer no MESMO dia é feriado", () => {
  // A regra é: a data registrada (parte YYYY-MM-DD do timestamp) define o dia.
  // Independe da hora — meia-noite, meio-dia ou 23:59 contam como o mesmo dia.
  for (const t of [
    "2026-04-21T00:00:00",
    "2026-04-21T00:00:01",
    "2026-04-21T08:30:00",
    "2026-04-21T12:00:00",
    "2026-04-21T18:45:30",
    "2026-04-21T23:59:59",
    "2026-04-21 14:30", // espaço em vez de 'T'
  ]) {
    assertEquals(isBrazilianNationalHoliday(t), true, `${t} deveria contar como Tiradentes`);
  }
});

Deno.test("ISO com hora em dia anterior/posterior NÃO é feriado", () => {
  // 20/04 e 22/04 não são feriado, mesmo que a hora seja próxima da virada.
  assertEquals(isBrazilianNationalHoliday("2026-04-20T23:59:59"), false);
  assertEquals(isBrazilianNationalHoliday("2026-04-22T00:00:01"), false);
});

// ---------- ISO com fuso horário (offset/Z) ----------
//
// Decisão de design: o motor de regras trata `procedure_date` como uma DATA
// CIVIL local — a data em que o procedimento foi executado segundo o
// hospital, sem reinterpretar por fuso. Por isso, ao receber uma string ISO
// com offset, extraímos a parte YYYY-MM-DD diretamente do prefixo da string,
// SEM converter para UTC (uma conversão poderia "empurrar" o dia para frente
// ou para trás e mudar erroneamente o feriado).

Deno.test("ISO com offset -03:00 (Brasília) — dia local é o que vale", () => {
  // Tiradentes às 03h da manhã em BRT.
  assertEquals(isBrazilianNationalHoliday("2026-04-21T03:00:00-03:00"), true);
  // Tiradentes às 22h em BRT (em UTC já seria 22/04 01h).
  assertEquals(isBrazilianNationalHoliday("2026-04-21T22:00:00-03:00"), true);
  // 20/04 às 23h BRT (= 21/04 02h UTC) — continua não-feriado, porque a data
  // registrada é 20/04.
  assertEquals(isBrazilianNationalHoliday("2026-04-20T23:00:00-03:00"), false);
});

Deno.test("ISO com Z (UTC) — usa a data presente na string", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-21T00:00:00Z"), true);
  assertEquals(isBrazilianNationalHoliday("2026-04-21T23:59:59Z"), true);
  // A string diz 22/04 — não é feriado, mesmo que em BRT (= -03:00) seja
  // ainda 21/04 21:00. Mantemos a data registrada.
  assertEquals(isBrazilianNationalHoliday("2026-04-22T00:30:00Z"), false);
});

Deno.test("ISO com offset positivo +03:00 (Moscow/etc) — usa a data da string", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-21T10:00:00+03:00"), true);
  assertEquals(isBrazilianNationalHoliday("2026-04-21T01:00:00+03:00"), true);
});

Deno.test("ISO com milissegundos e offset", () => {
  assertEquals(isBrazilianNationalHoliday("2026-04-21T14:30:00.123-03:00"), true);
  assertEquals(isBrazilianNationalHoliday("2026-12-25T00:00:00.000Z"), true);
});

// ---------- Formato BR DD/MM/YYYY ----------

Deno.test("DD/MM/YYYY com ano de 2 dígitos", () => {
  assertEquals(isBrazilianNationalHoliday("21/04/26"), true);
  assertEquals(isBrazilianNationalHoliday("25/12/26"), true);
});

Deno.test("DD-MM-YYYY (separador hífen) não é aceito pelo parser BR", () => {
  // Apenas '/' é tratado como BR. Hífen YYYY-MM-DD é ISO.
  assertEquals(isBrazilianNationalHoliday("21-04-2026"), false);
});

// ---------- Date instance ----------

Deno.test("Date instance é interpretada em fuso local", () => {
  // Construção local explícita evita ambiguidade de TZ.
  const tiradentes = new Date(2026, 3, 21, 10, 0, 0); // mês 0-based
  assertEquals(isBrazilianNationalHoliday(tiradentes), true);
  const diaUtil = new Date(2026, 2, 10, 10, 0, 0);
  assertEquals(isBrazilianNationalHoliday(diaUtil), false);
});

// ---------- Cobertura de fuso horário multi-feriado ----------

Deno.test("Diversos feriados validados também com hora e offset BRT", () => {
  for (const d of [
    "2026-01-01T00:00:00-03:00",
    "2026-02-16T08:00:00-03:00",
    "2026-02-17T20:30:00-03:00",
    "2026-04-03T12:00:00-03:00",
    "2026-04-21T07:15:00-03:00",
    "2026-05-01T23:59:59-03:00",
    "2026-06-04T06:00:00-03:00",
    "2026-09-07T14:00:00-03:00",
    "2026-10-12T18:00:00-03:00",
    "2026-11-02T09:00:00-03:00",
    "2026-11-15T11:00:00-03:00",
    "2026-11-20T16:00:00-03:00",
    "2026-12-25T23:00:00-03:00",
  ]) {
    assertEquals(isBrazilianNationalHoliday(d), true, `${d} deveria ser feriado`);
  }
});

// ---------- Dias úteis comuns ----------

Deno.test("Dia útil comum não é feriado (incluindo variações de formato)", () => {
  for (const d of [
    "2026-03-10",
    "2026-03-10T08:00:00",
    "2026-03-10T08:00:00-03:00",
    "2026-03-10T23:00:00Z",
    "10/03/2026",
    "2026-07-15",
  ]) {
    assertEquals(isBrazilianNationalHoliday(d), false, `${d} NÃO deveria ser feriado`);
  }
});

// ---------- Robustez ----------

Deno.test("Entrada inválida ou vazia não quebra", () => {
  assertEquals(isBrazilianNationalHoliday(""), false);
  assertEquals(isBrazilianNationalHoliday("não-é-data"), false);
  // @ts-expect-error — testando entrada fora do tipo
  assertEquals(isBrazilianNationalHoliday(null), false);
  // @ts-expect-error
  assertEquals(isBrazilianNationalHoliday(undefined), false);
});
