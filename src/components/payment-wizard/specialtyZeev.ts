// Lógica pura do Zeev para sugerir especialidade em três níveis:
// 1) Lote inteiro — quando todos os médicos têm UMA única especialidade cadastrada e ela é a MESMA.
// 2) Por médico — quando o médico tem uma única especialidade cadastrada.
// 3) Por item — fallback explícito quando varia dentro do mesmo médico (analista decide).
//
// Mantida em arquivo separado (sem React) para ser testável e reutilizável.

export type ZeevPendingRow = {
  rowKey: string;
  doctor_name: string | null;
};

export type ZeevSuggestion =
  | { level: "lot"; specialty: string; doctors: string[] }
  | { level: "doctor"; perDoctor: Record<string, string> }
  | { level: "item"; reason: "varies_per_doctor" | "no_registry" };

const normDoctor = (name: string | null | undefined) =>
  (name ?? "").trim().toLowerCase();

/**
 * Calcula a sugestão do Zeev a partir das linhas pendentes e das especialidades
 * cadastradas por médico (chave = nome normalizado).
 */
export function computeZeevSuggestion(
  rows: ZeevPendingRow[],
  suggestionsByDoctor: Record<string, string[]> | undefined,
): ZeevSuggestion {
  const doctors = Array.from(
    new Set(rows.map((r) => normDoctor(r.doctor_name)).filter(Boolean)),
  );
  if (doctors.length === 0 || !suggestionsByDoctor) {
    return { level: "item", reason: "no_registry" };
  }

  const specsPerDoctor = doctors.map((d) => suggestionsByDoctor[d] ?? []);

  // Nível 1 — lote inteiro: todos os médicos têm exatamente 1 especialidade E é a mesma.
  if (specsPerDoctor.every((s) => s.length === 1)) {
    const unique = Array.from(new Set(specsPerDoctor.map((s) => s[0])));
    if (unique.length === 1) {
      return { level: "lot", specialty: unique[0], doctors };
    }
  }

  // Nível 2 — por médico: ao menos um médico tem 1 única especialidade cadastrada.
  const perDoctor: Record<string, string> = {};
  doctors.forEach((d, i) => {
    const specs = specsPerDoctor[i];
    if (specs.length === 1) perDoctor[d] = specs[0];
  });
  if (Object.keys(perDoctor).length > 0) {
    return { level: "doctor", perDoctor };
  }

  // Nível 3 — item a item: nenhum sinal forte, analista decide caso a caso.
  return { level: "item", reason: "varies_per_doctor" };
}
