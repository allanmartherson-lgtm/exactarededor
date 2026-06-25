import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dedupIntraLot, type DedupItem } from "./dedup.ts";

const mk = (
  id: string,
  attendance: string | null,
  specialty: string | null,
  convenio: string | null,
  date: string | null,
): DedupItem => ({
  id,
  attendance_number: attendance,
  specialty,
  convenio_slug: convenio,
  procedure_date: date,
});

Deno.test("dedup: 1º atendimento permanece, demais reclassificados", () => {
  const items: DedupItem[] = [
    mk("a", "12345", "Cardiologia", "bradesco", "2026-06-01"),
    mk("b", "12345", "Cardiologia", "bradesco", "2026-06-02"),
    mk("c", "12345", "Cardiologia", "bradesco", "2026-06-03"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b", "c"]));
  assertEquals([...r.reclassifiedIds].sort(), ["b", "c"]);
  assertEquals(r.skippedNoKey, []);
});

Deno.test("dedup: ordena por data, NÃO pela ordem do array", () => {
  const items: DedupItem[] = [
    mk("late", "9", "Neuro", "amil", "2026-06-10"),
    mk("early", "9", "Neuro", "amil", "2026-06-01"),
    mk("mid", "9", "Neuro", "amil", "2026-06-05"),
  ];
  const r = dedupIntraLot(items, new Set(["late", "early", "mid"]));
  assertEquals([...r.reclassifiedIds].sort(), ["late", "mid"]);
});

Deno.test("dedup: especialidades diferentes no mesmo atendimento NÃO reclassificam", () => {
  const items: DedupItem[] = [
    mk("a", "111", "Cardiologia", "unimed", "2026-06-01"),
    mk("b", "111", "Neurologia", "unimed", "2026-06-02"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b"]));
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: convênios diferentes NÃO reclassificam", () => {
  const items: DedupItem[] = [
    mk("a", "222", "Cardio", "bradesco", "2026-06-01"),
    mk("b", "222", "Cardio", "sulamerica", "2026-06-02"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b"]));
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: NUNCA usa paciente — mesmo paciente, atendimentos diferentes NÃO reclassificam", () => {
  // Caso clássico: paciente reinternado. Cada atendimento é um caso novo.
  const items: DedupItem[] = [
    mk("a", "1001", "Cardio", "bradesco", "2026-06-01"),
    mk("b", "1002", "Cardio", "bradesco", "2026-06-05"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b"]));
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: item sem atendimento vai para skippedNoKey", () => {
  const items: DedupItem[] = [
    mk("a", null, "Cardio", "bradesco", "2026-06-01"),
    mk("b", "", "Cardio", "bradesco", "2026-06-02"),
    mk("c", "999", "Cardio", "bradesco", "2026-06-03"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b", "c"]));
  assertEquals(r.skippedNoKey.sort(), ["a", "b"]);
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: item sem especialidade vai para skippedNoKey (sem fallback)", () => {
  const items: DedupItem[] = [
    mk("a", "777", null, "amil", "2026-06-01"),
    mk("b", "777", "", "amil", "2026-06-02"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b"]));
  assertEquals(r.skippedNoKey.sort(), ["a", "b"]);
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: itens não confirmados são ignorados", () => {
  const items: DedupItem[] = [
    mk("a", "333", "Cardio", "amil", "2026-06-01"),
    mk("b", "333", "Cardio", "amil", "2026-06-02"),
  ];
  const r = dedupIntraLot(items, new Set(["a"])); // só 'a' confirmado
  assertEquals(r.reclassifiedIds.size, 0);
});

Deno.test("dedup: normaliza atendimento (formatação) e especialidade (acento/case)", () => {
  const items: DedupItem[] = [
    mk("a", "12.345", "Cardiologia", "Bradesco", "2026-06-01"),
    mk("b", "12345", "CARDIOLOGIA", "bradesco", "2026-06-02"),
    mk("c", "1-2-3-4-5", "cardíológia", "BRADESCO", "2026-06-03"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b", "c"]));
  assertEquals([...r.reclassifiedIds].sort(), ["b", "c"]);
});

Deno.test("dedup: motivo da reclassificação cita atendimento+especialidade+convênio, NÃO paciente", () => {
  const items: DedupItem[] = [
    mk("a", "55", "Cardio", "amil", "2026-06-01"),
    mk("b", "55", "Cardio", "amil", "2026-06-02"),
  ];
  const r = dedupIntraLot(items, new Set(["a", "b"]));
  const reason = r.reasonById.get("b") ?? "";
  assertEquals(reason.includes("atendimento+especialidade+convênio"), true);
  assertEquals(reason.toLowerCase().includes("paciente"), false);
});
