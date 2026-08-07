import { type DraftItem } from "./reconTypes";

export function emptyDraft(): DraftItem {
  return {
    _localId: crypto.randomUUID(),
    source: "form",
    attendance: "",
    tuss_code: "",
    procedure_date: "",
    patient_name: "",
    function_label: "",
    procedure_name: "",
    claimed_amount: "",
    claimed_quantity: "",
  };
}

/** Parser heurístico para texto colado (linhas com tab, ; ou múltiplos espaços) */
export function parsePastedText(raw: string): DraftItem[] {
  const out: DraftItem[] = [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = line
      .split(/\t|;|\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 1) continue;
    // Heurística: [atendimento] [data?] [paciente?] [tuss?] [função?] [valor?]
    const d = emptyDraft();
    d.source = "paste";
    d.attendance = cols[0] ?? "";
    for (const c of cols.slice(1)) {
      const dateMatch = c.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})$/);
      const tussMatch = c.match(/^\d{6,10}$/);
      const moneyMatch = c.match(
        /^R?\$?\s?-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(\.\d+)?$/,
      );
      if (dateMatch && !d.procedure_date) {
        const yr = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
        d.procedure_date = `${yr}-${dateMatch[2]}-${dateMatch[1]}`;
      } else if (tussMatch && !d.tuss_code) {
        d.tuss_code = c;
      } else if (moneyMatch && !d.claimed_amount) {
        d.claimed_amount = c
          .replace(/[^\d,.-]/g, "")
          .replace(/\.(?=\d{3}(\D|$))/g, "")
          .replace(",", ".");
      } else if (!d.patient_name) {
        d.patient_name = c;
      } else if (!d.function_label) {
        d.function_label = c;
      }
    }
    out.push(d);
  }
  return out;
}
