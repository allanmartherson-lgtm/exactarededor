/**
 * Exportação do Cadastro de Acordos em Word (.docx) e Excel (.xlsx).
 *
 * Diferente do PDF formal de aprovação, estes formatos ficam disponíveis em
 * qualquer etapa do fluxo: o Setor de Contratos leva uma versão editável /
 * apresentável para validação externa antes de formalizar internamente.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import {
  AGREEMENT_HOSPITAL_STATUS_LABEL,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_TYPE_LABEL,
  PAYMENT_TABLE_BASE_LABEL,
  buildAgreementTimeline,
  type AgreementEventRow,
  type AgreementFlowFields,
  type AgreementHospitalRow,
  type AgreementRegistration,
} from "@/lib/agreementRegistrations";

export interface AgreementExportRow {
  label: string;
  value: string;
}

export interface AgreementExportHospital {
  name: string;
  status: string;
  director: string;
  approvedAt: string;
  rule: string;
}

export interface AgreementExportParty {
  company: string;
  doctors: string;
}

/** Linha da tabela "Corpo clínico e empresas vinculadas ao acordo". */
export interface AgreementExportStaff {
  doctor: string;
  crm: string;
  company: string;
  cnpj: string;
  email: string;
  phone: string;
}

/** Modelo neutro consumido pelos dois exportadores (Word e Excel). */
export interface AgreementExportModel {
  code: string;
  companyName: string;
  statusLabel: string;
  identification: AgreementExportRow[];
  scope: AgreementExportRow[];
  paymentTable: AgreementExportRow[];
  parties: AgreementExportParty[];
  /** Médicos efetivamente incluídos no acordo (não a lista de exceções). */
  clinicalStaff: AgreementExportStaff[];
  hospitals: AgreementExportHospital[];
  extraItems: AgreementExportRow[];
  timeline: AgreementExportRow[];
  freeNotes: string;
}

/**
 * Resolve o corpo clínico do acordo a partir das PJs envolvidas.
 * `includedDoctorIds = null` significa "todos os médicos vinculados à PJ".
 */
export async function loadAgreementClinicalStaff(
  entries: Array<{ companyId: string | null; includedDoctorIds: string[] | null }>,
): Promise<AgreementExportStaff[]> {
  const valid = entries.filter((e): e is { companyId: string; includedDoctorIds: string[] | null } => !!e.companyId);
  if (valid.length === 0) return [];
  const companyIds = [...new Set(valid.map((e) => e.companyId))];

  const [companiesRes, linksRes] = await Promise.all([
    supabase.from("companies").select("id,name,document").in("id", companyIds),
    supabase.from("doctor_companies").select("doctor_id,company_id,end_date").in("company_id", companyIds),
  ]);
  const companyById = new Map(
    ((companiesRes.data ?? []) as Array<{ id: string; name: string; document: string | null }>).map((c) => [c.id, c]),
  );
  const activeLinks = ((linksRes.data ?? []) as Array<{ doctor_id: string; company_id: string; end_date: string | null }>)
    .filter((l) => !l.end_date);

  const doctorIds = [
    ...new Set([
      ...activeLinks.map((l) => l.doctor_id),
      ...valid.flatMap((e) => e.includedDoctorIds ?? []),
    ]),
  ];
  const doctorsRes = doctorIds.length
    ? await supabase.from("doctors").select("id,full_name,crm,crm_uf,email,phone").in("id", doctorIds)
    : { data: [] };
  const doctorById = new Map(
    ((doctorsRes.data ?? []) as Array<{
      id: string; full_name: string; crm: string | null; crm_uf: string | null;
      email: string | null; phone: string | null;
    }>).map((d) => [d.id, d]),
  );

  const seen = new Set<string>();
  const rows: AgreementExportStaff[] = [];
  for (const entry of valid) {
    const company = companyById.get(entry.companyId);
    const ids = entry.includedDoctorIds
      ?? activeLinks.filter((l) => l.company_id === entry.companyId).map((l) => l.doctor_id);
    for (const id of ids) {
      const key = `${entry.companyId}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = doctorById.get(id);
      rows.push({
        doctor: d?.full_name ?? "—",
        crm: d?.crm ? `${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : "—",
        company: company?.name ?? "—",
        cnpj: company?.document ?? "—",
        email: d?.email ?? "—",
        phone: d?.phone ?? "—",
      });
    }
  }
  return rows.sort((a, b) => a.company.localeCompare(b.company) || a.doctor.localeCompare(b.doctor));
}

/** Campos que só fazem sentido quando o acordo não é exclusivamente de valor fixo. */
export const FIXED_ONLY_HIDDEN_LABELS = new Set([
  "Método de cálculo",
  "Sujeito a glosa",
  "Condições de glosa",
  "Diferenciação por urgência",
  "Adicional fim de semana/feriado",
  "Possui valores fixos",
  "Valores fixos com urgência diferenciada",
  "Considera via de acesso",
]);

/** Remove do documento os campos que não se aplicam a acordos só de valor fixo. */
export const filterFixedOnlyRows = (rows: AgreementExportRow[], onlyFixedValue: boolean) =>
  onlyFixedValue ? rows.filter((r) => !FIXED_ONLY_HIDDEN_LABELS.has(r.label)) : rows;


export const fmtExportDate = (v: string | null | undefined) =>
  v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
export const fmtExportDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR") : "—";
const yn = (b: boolean | null | undefined) => (b ? "Sim" : "Não");
const pct = (n: number | null | undefined) => (n != null ? `${n}%` : "—");

// ---------------------------------------------------------------------------
// Montagem do modelo a partir de um acordo já salvo
// ---------------------------------------------------------------------------

type FullAgreement = AgreementRegistration & Partial<AgreementFlowFields>;

export async function buildAgreementExportModel(
  agreement: FullAgreement,
  hospitals: AgreementHospitalRow[],
  events: AgreementEventRow[] = [],
): Promise<AgreementExportModel> {
  const hospitalIds = hospitals.map((h) => h.hospital_id);
  const doctorIds = agreement.doctor_exceptions ?? [];

  const [companyRes, hospRes, doctorsRes, profilesRes, partiesRes] = await Promise.all([
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
    supabase
      .from("agreement_registration_parties")
      .select("company_id,doctor_id")
      .eq("agreement_id", agreement.id),
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
  const who = (id: string | null | undefined) => (id ? (people.get(id) ?? "—") : "—");

  // PJs do acordo de equipe: resolve nomes de empresas e médicos em um só lote
  const partyRows = (partiesRes.data ?? []) as Array<{ company_id: string; doctor_id: string | null }>;
  const partyCompanyIds = [...new Set(partyRows.map((p) => p.company_id))];
  const partyDoctorIds = [...new Set(partyRows.map((p) => p.doctor_id).filter((v): v is string => !!v))];
  const [partyCompaniesRes, partyDoctorsRes] = await Promise.all([
    partyCompanyIds.length
      ? supabase.from("companies").select("id,name").in("id", partyCompanyIds)
      : Promise.resolve({ data: [] }),
    partyDoctorIds.length
      ? supabase.from("doctors").select("id,full_name").in("id", partyDoctorIds)
      : Promise.resolve({ data: [] }),
  ]);
  const partyCompanyNames = new Map(
    ((partyCompaniesRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );
  const partyDoctorNames = new Map(
    ((partyDoctorsRes.data ?? []) as Array<{ id: string; full_name: string }>).map((d) => [d.id, d.full_name]),
  );
  const partiesByCompany = new Map<string, string[]>();
  for (const p of partyRows) {
    const list = partiesByCompany.get(p.company_id) ?? [];
    if (p.doctor_id) list.push(partyDoctorNames.get(p.doctor_id) ?? p.doctor_id);
    partiesByCompany.set(p.company_id, list);
  }

  // Corpo clínico: PJs do acordo de equipe ou, no modo simples, a PJ única
  // menos os médicos desabilitados (doctor_exceptions).
  const staffEntries = partyRows.length
    ? [...partiesByCompany.keys()].map((cid) => {
        const docs = partyRows.filter((p) => p.company_id === cid && p.doctor_id).map((p) => p.doctor_id as string);
        return { companyId: cid, includedDoctorIds: docs.length ? docs : null };
      })
    : [
        {
          companyId: agreement.company_id ?? null,
          includedDoctorIds: agreement.applies_to_all_doctors ? null : null,
        },
      ];
  const clinicalStaffRaw = await loadAgreementClinicalStaff(staffEntries);
  const excluded = new Set(doctorNames);
  const clinicalStaff = partyRows.length
    ? clinicalStaffRaw
    : clinicalStaffRaw.filter((r) => !excluded.has(r.doctor));

  // Acordo exclusivamente de "Valor fixo" oculta os campos de produção
  const modelIds = (agreement as unknown as { payment_model_ids?: string[] }).payment_model_ids ?? [];
  let onlyFixedValue = false;
  if (modelIds.length > 0) {
    const { data: modelRows } = await supabase.from("payment_models").select("id,code").in("id", modelIds);
    const codes = ((modelRows ?? []) as Array<{ code: string }>).map((m) => m.code);
    onlyFixedValue = codes.length > 0 && codes.every((c) => c === "valor_fixo");
  }

  const timeline = buildAgreementTimeline(agreement, hospitals, events, hospitalNames).map((t) => ({
    label: t.label,
    value: [fmtExportDateTime(t.at), t.detail].filter(Boolean).join(" — ") || "—",
  }));


  return {
    code: agreement.code,
    companyName: company?.name ?? "Clínica não informada",
    statusLabel: AGREEMENT_STATUS_LABEL[agreement.status] ?? agreement.status,
    identification: [
      { label: "Código", value: agreement.code },
      {
        label: "Tipo de comunicado",
        value: AGREEMENT_TYPE_LABEL[agreement.registration_type] ?? agreement.registration_type,
      },
      { label: "Clínica (PJ)", value: company?.name ?? "—" },
      { label: "CNPJ", value: company?.document ?? "—" },
      {
        label: "Vigência",
        value: `${fmtExportDate(agreement.effective_from)} a ${fmtExportDate(agreement.effective_to)}`,
      },
      { label: "Situação", value: AGREEMENT_STATUS_LABEL[agreement.status] ?? agreement.status },
      { label: "Referência", value: agreement.reference_note ?? "—" },
      { label: "Responsável pelo preenchimento", value: who(agreement.filled_by) },
      {
        label: "Supervisor",
        value: `${who(agreement.supervisor_id)} (${fmtExportDateTime(agreement.supervisor_validated_at)})`,
      },
    ],
    scope: filterFixedOnlyRows(
      [
        { label: "Todos os convênios", value: yn(agreement.applies_to_all_convenios) },
        {
          label: "Convênios de exceção",
          value: (agreement.convenio_exceptions ?? []).length ? agreement.convenio_exceptions.join(", ") : "—",
        },
        { label: "Todos os médicos da PJ", value: yn(agreement.applies_to_all_doctors) },
        { label: "Médicos de exceção", value: doctorNames.length ? doctorNames.join(", ") : "—" },
        { label: "Inclui auxiliares", value: yn(agreement.includes_auxiliary) },
        { label: "Considera via de acesso", value: yn(agreement.includes_access_route) },
      ],
      onlyFixedValue,
    ),
    paymentTable: filterFixedOnlyRows(
      [
        {
          label: "Tabela base",
          value: agreement.payment_table_base
            ? (PAYMENT_TABLE_BASE_LABEL[agreement.payment_table_base] ?? agreement.payment_table_base)
            : "—",
        },
        { label: "Percentual de repasse", value: pct(agreement.payment_percentage) },
        { label: "Sujeito a glosa", value: yn(agreement.has_glosa) },
        { label: "Condições de glosa", value: agreement.glosa_conditions ?? "—" },
        {
          label: "Diferenciação por urgência",
          value: `${yn(agreement.urgency_differentiation)} ${pct(agreement.urgency_addition_pct)}`,
        },
        {
          label: "Adicional fim de semana/feriado",
          value: `${yn(agreement.weekend_holiday_addition)} ${pct(agreement.weekend_holiday_addition_pct)}`,
        },
        { label: "Possui valores fixos", value: yn(agreement.has_fixed_values) },
        {
          label: "Valores fixos com urgência diferenciada",
          value: yn(agreement.fixed_value_urgency_differentiation),
        },
        { label: "Exclusões", value: agreement.exclusions_notes ?? "—" },
      ],
      onlyFixedValue,
    ),
    parties: [...partiesByCompany.entries()].map(([cid, docs]) => ({
      company: partyCompanyNames.get(cid) ?? cid,
      doctors: docs.length ? docs.join(", ") : "Todos os médicos da PJ",
    })),
    clinicalStaff,

    hospitals: hospitals.map((h) => ({
      name: `${hospitalNames.get(h.hospital_id) ?? h.hospital_id}${h.is_primary ? " (origem)" : ""}`,
      status: AGREEMENT_HOSPITAL_STATUS_LABEL[h.status] ?? h.status,
      director: who(h.director_id),
      approvedAt: fmtExportDateTime(h.director_approved_at),
      rule: h.linked_rule_id ? "Cadastrada" : "Pendente",
    })),
    extraItems: (agreement.extra_items ?? []).map((i) => ({ label: i.label, value: i.value })),
    timeline,
    freeNotes: (agreement.free_notes ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Nome de arquivo
// ---------------------------------------------------------------------------

/** Padrão "ACD-00001 - <nome da clínica>" sem caracteres inválidos de sistema de arquivos. */
export function agreementFileBaseName(model: AgreementExportModel): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return `${clean(model.code || "Acordo")} - ${clean(model.companyName || "Sem clínica")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

const CONTENT_WIDTH = 9360; // US Letter com margens de 1"
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: "D0D5DD" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

function cell(text: string, opts: { bold?: boolean; width: number; fill?: string }) {
  return new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: text || "—", bold: opts.bold })] })],
  });
}

function keyValueTable(rows: AgreementExportRow[]) {
  const widths = [3400, CONTENT_WIDTH - 3400];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            cell(r.label, { bold: true, width: widths[0], fill: "F2F4F7" }),
            cell(r.value, { width: widths[1] }),
          ],
        }),
    ),
  });
}

function gridTable(headers: string[], rows: string[][]) {
  const each = Math.floor(CONTENT_WIDTH / headers.length);
  const widths = headers.map((_, i) => (i === headers.length - 1 ? CONTENT_WIDTH - each * (headers.length - 1) : each));
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, { bold: true, width: widths[i], fill: "E8EEF9" })),
      }),
      ...rows.map(
        (r) => new TableRow({ children: r.map((v, i) => cell(v, { width: widths[i] })) }),
      ),
    ],
  });
}

const sectionTitle = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial" })],
  });

export async function exportAgreementDocx(model: AgreementExportModel): Promise<void> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `Acordo ${model.code}`, bold: true, size: 32, font: "Arial" })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `${model.companyName} · ${model.statusLabel}`, size: 22, color: "475467" }),
      ],
    }),
    sectionTitle("Identificação"),
    keyValueTable(model.identification),
    sectionTitle("Abrangência"),
    keyValueTable(model.scope),
    sectionTitle("Tabela e condições de pagamento"),
    keyValueTable(model.paymentTable),
  ];

  if (model.parties.length > 0) {
    children.push(
      sectionTitle("PJs e médicos vinculados"),
      gridTable(["PJ", "Médicos"], model.parties.map((p) => [p.company, p.doctors])),
    );
  }

  if (model.extraItems.length > 0) {
    children.push(
      sectionTitle("Itens extras"),
      gridTable(["Item", "Valor"], model.extraItems.map((i) => [i.label, i.value])),
    );
  }

  if (model.hospitals.length > 0) {
    children.push(
      sectionTitle("Hospitais de abrangência"),
      gridTable(
        ["Hospital", "Situação", "Diretor", "Data", "Regra"],
        model.hospitals.map((h) => [h.name, h.status, h.director, h.approvedAt, h.rule]),
      ),
    );
  }

  if (model.timeline.length > 0) {
    children.push(sectionTitle("Linha do tempo da aprovação"), keyValueTable(model.timeline));
  }

  if (model.freeNotes) {
    children.push(
      sectionTitle("Observações"),
      ...model.freeNotes.split(/\n+/).map(
        (line) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun(line)] }),
      ),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: `Documento gerado em ${new Date().toLocaleString("pt-BR")} — versão de trabalho, não substitui o PDF formal de aprovação.`,
          size: 16,
          color: "98A2B3",
          italics: true,
        }),
      ],
    }),
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${agreementFileBaseName(model)}.docx`);
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export function exportAgreementXlsx(model: AgreementExportModel): void {
  const wb = XLSX.utils.book_new();

  const resumo: string[][] = [
    ["Acordo", model.code],
    ["Clínica (PJ)", model.companyName],
    ["Situação", model.statusLabel],
    [],
    ["IDENTIFICAÇÃO", ""],
    ...model.identification.map((r) => [r.label, r.value]),
    [],
    ["ABRANGÊNCIA", ""],
    ...model.scope.map((r) => [r.label, r.value]),
    [],
    ["TABELA E CONDIÇÕES", ""],
    ...model.paymentTable.map((r) => [r.label, r.value]),
    [],
    ["OBSERVAÇÕES", model.freeNotes || "—"],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = [{ wch: 42 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const wsParties = XLSX.utils.aoa_to_sheet([
    ["PJ", "Médicos"],
    ...model.parties.map((p) => [p.company, p.doctors]),
  ]);
  wsParties["!cols"] = [{ wch: 40 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsParties, "PJs e médicos");

  const wsExtra = XLSX.utils.aoa_to_sheet([
    ["Item extra", "Valor"],
    ...model.extraItems.map((i) => [i.label, i.value]),
  ]);
  wsExtra["!cols"] = [{ wch: 45 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsExtra, "Itens extras");

  const wsHosp = XLSX.utils.aoa_to_sheet([
    ["Hospital", "Situação", "Diretor", "Data", "Regra"],
    ...model.hospitals.map((h) => [h.name, h.status, h.director, h.approvedAt, h.rule]),
  ]);
  wsHosp["!cols"] = [{ wch: 38 }, { wch: 20 }, { wch: 28 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsHosp, "Hospitais");

  const wsTimeline = XLSX.utils.aoa_to_sheet([
    ["Etapa", "Detalhe"],
    ...model.timeline.map((t) => [t.label, t.value]),
  ]);
  wsTimeline["!cols"] = [{ wch: 40 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsTimeline, "Linha do tempo");

  XLSX.writeFile(wb, `${agreementFileBaseName(model)}.xlsx`);
}
