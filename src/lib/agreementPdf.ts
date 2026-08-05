/**
 * PDF único do Cadastro de Acordo (agreement_registrations).
 * Gerado quando o acordo está aprovado/cadastrado — serve como prova
 * auditável do que foi acordado e de quem aprovou em cada hospital.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawReportHeader } from "@/lib/brandLogo";
import { supabase } from "@/integrations/supabase/client";
import {
  AGREEMENT_HOSPITAL_STATUS_LABEL,
  AGREEMENT_STATUS_LABEL,
  PAYMENT_TABLE_BASE_LABEL,
  type AgreementFlowFields,
  type AgreementHospitalRow,
  type AgreementRegistration,
} from "@/lib/agreementRegistrations";

type FullAgreement = AgreementRegistration & Partial<AgreementFlowFields>;

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR") : "—";
const yn = (b: boolean | null | undefined) => (b ? "Sim" : "Não");
const pct = (n: number | null | undefined) => (n != null ? `${n}%` : "—");

export async function generateAgreementPdf(
  agreement: FullAgreement,
  hospitals: AgreementHospitalRow[],
): Promise<jsPDF> {
  const hospitalIds = hospitals.map((h) => h.hospital_id);
  const doctorIds = agreement.doctor_exceptions ?? [];
  const [companyRes, hospRes, doctorsRes, profilesRes] = await Promise.all([
    agreement.company_id
      ? supabase.from("companies").select("name,document").eq("id", agreement.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    hospitalIds.length
      ? supabase.from("hospitals").select("id,name").in("id", hospitalIds)
      : Promise.resolve({ data: [] }),
    doctorIds.length
      ? supabase.from("doctors").select("id,full_name").in("id", doctorIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("profiles")
      .select("id,full_name")
      .in(
        "id",
        [agreement.filled_by, agreement.supervisor_id, agreement.analyst_id]
          .concat(hospitals.map((h) => h.director_id))
          .filter((v): v is string => !!v),
      ),
  ]);

  const company = companyRes.data as { name: string; document: string | null } | null;
  const hospitalNames = new Map(
    ((hospRes.data ?? []) as Array<{ id: string; name: string }>).map((h) => [h.id, h.name]),
  );
  const doctorNames = ((doctorsRes.data ?? []) as Array<{ full_name: string }>).map((d) => d.full_name);
  const people = new Map(
    ((profilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
      p.id,
      p.full_name ?? "—",
    ]),
  );
  const who = (id: string | null | undefined) => (id ? people.get(id) ?? "—" : "—");

  const doc = new jsPDF();
  const marginX = 14;
  let y = await drawReportHeader(doc, {
    title: `Acordo ${agreement.code}`,
    subtitle: `${company?.name ?? "Clínica não informada"} · ${AGREEMENT_STATUS_LABEL[agreement.status] ?? agreement.status}`,
    marginX,
  });
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [["Identificação", ""]],
    body: [
      ["Código", agreement.code],
      ["Clínica (PJ)", company?.name ?? "—"],
      ["CNPJ", company?.document ?? "—"],
      ["Vigência", `${fmtDate(agreement.effective_from)} a ${fmtDate(agreement.effective_to)}`],
      ["Responsável pelo preenchimento", who(agreement.filled_by)],
      ["Supervisor", `${who(agreement.supervisor_id)} (${fmtDateTime(agreement.supervisor_validated_at)})`],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175] },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } },
    margin: { left: marginX, right: marginX },
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
    head: [["Abrangência", ""]],
    body: [
      ["Todos os convênios", yn(agreement.applies_to_all_convenios)],
      [
        "Convênios de exceção",
        (agreement.convenio_exceptions ?? []).length ? agreement.convenio_exceptions.join(", ") : "—",
      ],
      ["Todos os médicos da PJ", yn(agreement.applies_to_all_doctors)],
      ["Médicos de exceção", doctorNames.length ? doctorNames.join(", ") : "—"],
      ["Inclui auxiliares", yn(agreement.includes_auxiliary)],
      ["Considera via de acesso", yn(agreement.includes_access_route)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175] },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } },
    margin: { left: marginX, right: marginX },
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
    head: [["Tabela e condições", ""]],
    body: [
      [
        "Tabela base",
        agreement.payment_table_base
          ? PAYMENT_TABLE_BASE_LABEL[agreement.payment_table_base] ?? agreement.payment_table_base
          : "—",
      ],
      ["Percentual de repasse", pct(agreement.payment_percentage)],
      ["Sujeito a glosa", yn(agreement.has_glosa)],
      ["Condições de glosa", agreement.glosa_conditions ?? "—"],
      ["Diferenciação por urgência", `${yn(agreement.urgency_differentiation)} ${pct(agreement.urgency_addition_pct)}`],
      [
        "Adicional fim de semana/feriado",
        `${yn(agreement.weekend_holiday_addition)} ${pct(agreement.weekend_holiday_addition_pct)}`,
      ],
      ["Possui valores fixos", yn(agreement.has_fixed_values)],
      ["Valores fixos com urgência diferenciada", yn(agreement.fixed_value_urgency_differentiation)],
      ["Exclusões", agreement.exclusions_notes ?? "—"],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175] },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } },
    margin: { left: marginX, right: marginX },
  });

  if (agreement.extra_items.length > 0) {
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
      head: [["Item extra", "Valor"]],
      body: agreement.extra_items.map((i) => [i.label, i.value]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175] },
      margin: { left: marginX, right: marginX },
    });
  }

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
    head: [["Hospital", "Situação", "Diretor", "Data", "Regra"]],
    body: hospitals.map((h) => [
      `${hospitalNames.get(h.hospital_id) ?? h.hospital_id}${h.is_primary ? " (origem)" : ""}`,
      AGREEMENT_HOSPITAL_STATUS_LABEL[h.status] ?? h.status,
      who(h.director_id),
      fmtDateTime(h.director_approved_at),
      h.linked_rule_id ? "Cadastrada" : "Pendente",
    ]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175] },
    margin: { left: marginX, right: marginX },
  });

  if ((agreement.free_notes ?? "").trim()) {
    const startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text("Observações livres", marginX, startY);
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(doc.splitTextToSize(agreement.free_notes ?? "", 180), marginX, startY + 5);
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")}  ·  Acordo ${agreement.code}  ·  Página ${p}/${pageCount}`,
      marginX,
      290,
    );
  }
  return doc;
}

/**
 * Gera o PDF, sobe no bucket privado `approval-pdfs` e grava o caminho em
 * `agreement_registrations.pdf_url`. Retorna o caminho salvo.
 */
export async function generateAndStoreAgreementPdf(
  agreement: FullAgreement,
  hospitals: AgreementHospitalRow[],
): Promise<string> {
  const doc = await generateAgreementPdf(agreement, hospitals);
  const blob = doc.output("blob");
  const path = `agreements/${agreement.hospital_id}/${agreement.code}-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("approval-pdfs")
    .upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Falha ao subir o PDF: ${upErr.message}`);
  const { error: updErr } = await supabase
    .from("agreement_registrations")
    .update({ pdf_url: path })
    .eq("id", agreement.id);
  if (updErr) throw new Error(`PDF gerado, mas falhou ao salvar a referência: ${updErr.message}`);
  return path;
}

/** Abre o PDF já armazenado usando URL assinada (bucket privado). */
export async function openStoredAgreementPdf(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from("approval-pdfs").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível abrir o PDF");
  window.open(data.signedUrl, "_blank", "noopener");
}
