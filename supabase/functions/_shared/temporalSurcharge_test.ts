import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickTemporalSurcharge } from "./rulesEngine.ts";

const cfg = (over: Partial<Parameters<typeof pickTemporalSurcharge>[0]> = {}) => ({
  fds_pct: null,
  feriado_pct: null,
  noturno_pct: null,
  noturno_inicio: null,
  noturno_fim: null,
  ...over,
});

Deno.test("sem nenhuma configuração retorna null", () => {
  // Quinta-feira útil 14h
  assertEquals(pickTemporalSurcharge(cfg(), "2026-06-18T14:00:00"), null);
});

Deno.test("fim de semana aplica quando configurado", () => {
  const r = pickTemporalSurcharge(cfg({ fds_pct: 30 }), "2026-06-20T10:00:00"); // sábado
  assertEquals(r?.pct, 30);
  assertEquals(r?.reason, "fim de semana");
});

Deno.test("fim de semana NÃO aplica em dia útil", () => {
  assertEquals(pickTemporalSurcharge(cfg({ fds_pct: 30 }), "2026-06-18T10:00:00"), null);
});

Deno.test("feriado nacional aplica (7 de setembro)", () => {
  const r = pickTemporalSurcharge(cfg({ feriado_pct: 50 }), "2026-09-07T10:00:00");
  assertEquals(r?.pct, 50);
  assertEquals(r?.reason, "feriado");
});

Deno.test("noturno aplica dentro da janela 19h-07h em horário 22h", () => {
  const r = pickTemporalSurcharge(
    cfg({ noturno_pct: 30, noturno_inicio: "19:00", noturno_fim: "07:00" }),
    "2026-06-18T22:00:00",
  );
  assertEquals(r?.pct, 30);
  assertEquals(r?.reason, "noturno");
});

Deno.test("noturno aplica em horário 03h (janela cruza meia-noite)", () => {
  const r = pickTemporalSurcharge(
    cfg({ noturno_pct: 30, noturno_inicio: "19:00", noturno_fim: "07:00" }),
    "2026-06-18T03:00:00",
  );
  assertEquals(r?.pct, 30);
});

Deno.test("noturno NÃO aplica em 14h", () => {
  assertEquals(
    pickTemporalSurcharge(
      cfg({ noturno_pct: 30, noturno_inicio: "19:00", noturno_fim: "07:00" }),
      "2026-06-18T14:00:00",
    ),
    null,
  );
});

Deno.test("noturno é ignorado quando data não tem hora", () => {
  assertEquals(
    pickTemporalSurcharge(
      cfg({ noturno_pct: 30, noturno_inicio: "19:00", noturno_fim: "07:00" }),
      "2026-06-18",
    ),
    null,
  );
});

Deno.test("'só o maior': noturno 30% + feriado 50% no mesmo plantão → feriado vence", () => {
  // 7 de setembro 2026 cai numa segunda-feira, 22h (noturno)
  const r = pickTemporalSurcharge(
    cfg({
      noturno_pct: 30,
      noturno_inicio: "19:00",
      noturno_fim: "07:00",
      feriado_pct: 50,
    }),
    "2026-09-07T22:00:00",
  );
  assertEquals(r?.pct, 50);
  assertEquals(r?.reason, "feriado");
});

Deno.test("'só o maior': fds 30% + noturno 40% no sábado à noite → noturno vence", () => {
  const r = pickTemporalSurcharge(
    cfg({
      fds_pct: 30,
      noturno_pct: 40,
      noturno_inicio: "19:00",
      noturno_fim: "07:00",
    }),
    "2026-06-20T23:00:00", // sábado 23h
  );
  assertEquals(r?.pct, 40);
  assertEquals(r?.reason, "noturno");
});

Deno.test("janela noturna inválida (início == fim) não aplica", () => {
  assertEquals(
    pickTemporalSurcharge(
      cfg({ noturno_pct: 30, noturno_inicio: "12:00", noturno_fim: "12:00" }),
      "2026-06-18T12:30:00",
    ),
    null,
  );
});
