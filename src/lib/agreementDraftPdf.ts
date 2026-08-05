/**
 * PDF informal do Cadastro de Acordos.
 *
 * Diferente do PDF formal de aprovação (`agreementPdf.ts`, com assinaturas e
 * decisões por hospital), este usa o mesmo modelo neutro dos exportadores
 * Word/Excel e fica disponível em qualquer etapa — serve para apresentar o
 * estado atual do acordo. Segue o template padrão de relatório do Exacta
 * (drawReportHeader + autoTable).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawReportHeader } from "@/lib/brandLogo";
import {
  agreementFileBaseName,
  type AgreementExportModel,
  type AgreementExportRow,
} from "@/lib/agreementExport";

const HEAD_FILL: [number, number, number] = [30, 64, 175];
const MARGIN_X = 14;

const lastY = (doc: jsPDF) =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

const section = (doc: jsPDF, startY: number, title: string, rows: AgreementExportRow[]) => {
  if (rows.length === 0) return startY;
  autoTable(doc, {
    startY,
    head: [[title, ""]],
    body: rows.map((r) => [r.label, r.value || "—"]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: HEAD_FILL },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } },
    margin: { left: MARGIN_X, right: MARGIN_X },
  });
  return lastY(doc) + 6;
};

export async function generateAgreementDraftPdf(model: AgreementExportModel): Promise<jsPDF> {
  const doc = new jsPDF();
  let y = await drawReportHeader(doc, {
    title: `Acordo ${model.code}`,
    subtitle: `${model.companyName} · ${model.statusLabel}`,
    marginX: MARGIN_X,
  });
  y += 2;

  y = section(doc, y, "Identificação", model.identification);
  y = section(doc, y, "Abrangência", model.scope);
  y = section(doc, y, "Cálculo de pagamento", model.paymentTable);

  if (model.clinicalStaff.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Médico", "CRM", "Empresa (PJ)", "CNPJ", "E-mail", "Telefone"]],
      body: model.clinicalStaff.map((s) => [s.doctor, s.crm, s.company, s.cnpj, s.email, s.phone]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: HEAD_FILL },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    y = lastY(doc) + 6;
  }


  if (model.hospitals.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Hospital", "Situação", "Diretor", "Data", "Regra"]],
      body: model.hospitals.map((h) => [h.name, h.status, h.director, h.approvedAt, h.rule]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: HEAD_FILL },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    y = lastY(doc) + 6;
  }

  if (model.extraItems.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Item extra", "Valor"]],
      body: model.extraItems.map((i) => [i.label, i.value]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: HEAD_FILL },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    y = lastY(doc) + 6;
  }

  y = section(doc, y, "Histórico", model.timeline);

  if (model.freeNotes.trim()) {
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text("Observações livres", MARGIN_X, y);
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(doc.splitTextToSize(model.freeNotes, 180), MARGIN_X, y + 5);
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Documento informativo · Gerado em ${new Date().toLocaleString("pt-BR")} · Acordo ${model.code} · Página ${p}/${pageCount}`,
      MARGIN_X,
      290,
    );
  }
  return doc;
}

export async function exportAgreementPdf(model: AgreementExportModel): Promise<void> {
  const doc = await generateAgreementDraftPdf(model);
  doc.save(`${agreementFileBaseName(model)}.pdf`);
}
