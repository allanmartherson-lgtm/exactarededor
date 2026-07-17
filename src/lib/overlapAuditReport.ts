import * as XLSX from "xlsx";
import type {
  OverlapAuditResult,
  OverlapAttendanceRow,
  OverlapComboRow,
  OverlapPatientRow,
} from "@/hooks/useOverlapAudit";

/**
 * Exporta o resultado da auditoria de sobreposição assistencial em .xlsx
 * com três abas: Combinações, Pacientes, Atendimentos.
 */
export function exportOverlapAuditExcel(
  data: OverlapAuditResult,
  filename = `sobreposicao-assistencial-${new Date().toISOString().slice(0, 10)}.xlsx`,
): void {
  const wb = XLSX.utils.book_new();

  const combos = data.by_specialty_combo.map((r: OverlapComboRow) => ({
    "Combinação": r.combo_label,
    "Pacientes": r.patients,
    "Dias": r.days,
    "Atendimentos": r.attendances,
    "Lançamentos": r.items,
    "Último dia": r.last_day ?? "",
    "Exemplos (atendimentos)": (r.sample_attendances ?? []).slice(0, 10).join(", "),
  }));

  const pacs = data.by_patient.map((r: OverlapPatientRow) => ({
    "Paciente": r.patient_name,
    "Dias com sobreposição": r.days,
    "Atendimentos": r.attendances,
    "Especialidades": (r.specialties ?? []).join(", "),
    "Último dia": r.last_day ?? "",
  }));

  const atts = data.by_attendance.map((r: OverlapAttendanceRow) => ({
    "Data": r.pdate,
    "Paciente": r.patient_name,
    "Atendimentos": (r.attendances ?? []).join(", "),
    "Médicos": (r.doctors ?? []).join(", "),
    "Especialidades": (r.specialties ?? []).join(", "),
    "Lançamentos": r.items,
    "Valor pago (R$)": Number(r.total_gross ?? 0),
    "Lotes": (r.payment_ids ?? []).length,
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(combos), "Combinações");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pacs), "Pacientes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(atts), "Atendimentos");

  XLSX.writeFile(wb, filename);
}
