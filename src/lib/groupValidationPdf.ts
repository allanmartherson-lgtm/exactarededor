/**
 * PDF de validação por grupo (empresa × pagamento):
 * - Bruto pedido vs Bruto calculado pela regra
 * - Itens divergentes e itens sem regra
 * - Histórico de liberações com justificativa (overrides)
 *
 * Anexável ao fluxo de aprovação como prova auditável.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawReportHeader } from "@/lib/brandLogo";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Totals = {
  group_id: string;
  payment_id: string | null;
  company_id: string | null;
  status: string | null;
  bruto_pedido_total: number;
  bruto_regra_total: number;
  diferenca: number;
  diferenca_pct: number | null;
  itens_total: number | null;
  itens_sem_regra: number | null;
  itens_divergentes: number | null;
};

export async function generateGroupValidationPdf(groupId: string): Promise<jsPDF> {
  const [{ data: totals }, { data: overrides }, { data: cfg }] = await Promise.all([
    supabase.from("vw_group_rule_totals").select("*").eq("group_id", groupId).maybeSingle(),
    supabase
      .from("payment_group_reconciliation_overrides")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false }),
    supabase.from("system_configurations").select("value").eq("key", "divergence_thresholds").maybeSingle(),
  ]);
  const t = (totals ?? null) as Totals | null;
  if (!t) throw new Error("Grupo não encontrado");

  const v = (cfg?.value ?? {}) as Record<string, unknown>;
  const block_pct = Number(v.group_block_pct ?? 0.5);
  const block_abs = Number(v.group_block_abs ?? 1.0);

  const [{ data: payment }, { data: company }, { data: items }] = await Promise.all([
    t.payment_id
      ? supabase
          .from("payments")
          .select(
            "id,reference,competence_month,status,hospital_id,analysis_mode,manual_general_attachment_name",
          )
          .eq("id", t.payment_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    t.company_id
      ? supabase.from("companies").select("id,name,document").eq("id", t.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("payment_items")
      .select(
        "id,doctor_name,patient_name,attendance_number,procedure_code,procedure_name,procedure_date,procedure_date_has_time,quantity,procedure_amount,gross_amount,expected_amount,applied_calc_id,applied_calc_method,validation_findings,specialty,manual_note,manual_source_attachment_path,is_manual_entry",
      )
      .eq("payment_id", t.payment_id ?? "")
      .eq("company_id", t.company_id ?? "")
      .limit(2000),
  ]);

  // Modo MANUAL: relatório enxuto, sem regra/divergência/alerta assistencial.
  if ((payment as any)?.analysis_mode === "manual") {
    return renderManualPdf({
      t,
      payment: payment as any,
      company: company as any,
      items: (items ?? []) as any[],
    });
  }


  const allItems = (items ?? []) as Array<{
    id: string;
    doctor_name: string | null;
    patient_name: string | null;
    attendance_number: string | null;
    procedure_code: string | null;
    procedure_name: string | null;
    procedure_date: string | null;
    procedure_date_has_time: boolean | null;
    quantity: number | null;
    procedure_amount: number | null;
    gross_amount: number | null;
    expected_amount: number | null;
    applied_calc_id: string | null;
    applied_calc_method: string | null;
    validation_findings: unknown;
  }>;

  // Formata data + hora quando a base hospitalar trouxe hora real
  // (procedure_date_has_time=true). Hora sintetizada (default 12h) fica
  // oculta para não induzir aplicação indevida de adicional noturno.
  const fmtDateHora = (iso: string | null, hasHour: boolean | null): string => {
    if (!iso) return "—";
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const base = dm ? `${dm[3]}/${dm[2]}/${dm[1]}` : iso.slice(0, 10);
    if (hasHour === true) {
      const hm = /T(\d{2}):(\d{2})/.exec(iso);
      if (hm) return `${base} ${hm[1]}:${hm[2]}`;
    }
    return base;
  };

  const semRegra = allItems.filter((i) => !i.applied_calc_id);
  const divergentes = allItems.filter((i) => {
    if (!i.applied_calc_id) return false;
    const e = Number(i.expected_amount ?? 0);
    const g = Number(i.gross_amount ?? 0);
    return Math.abs(e - g) > 0.01;
  });

  const absDiff = Math.abs(t.diferenca);
  const pctDiff = Math.abs(Number(t.diferenca_pct ?? 0));
  const conciliado = absDiff <= block_abs || pctDiff <= block_pct;
  const lastOverride = (overrides ?? [])[0] as
    | { bruto_regra_snapshot: number; bruto_pedido_snapshot: number; justification: string; created_at: string; approved_by: string }
    | undefined;
  const liberado =
    !conciliado &&
    !!lastOverride &&
    Math.abs(lastOverride.bruto_regra_snapshot - t.bruto_regra_total) < 0.01 &&
    Math.abs(lastOverride.bruto_pedido_snapshot - t.bruto_pedido_total) < 0.01;

  const situacao = conciliado ? "CONCILIADO" : liberado ? "LIBERADO COM JUSTIFICATIVA" : "APROVAÇÃO BLOQUEADA";

  const doc = new jsPDF();
  const marginX = 14;

  const headerBottomY = await drawReportHeader(doc, {
    title: "Validação de Conciliação — Regra × Pedido",
    subtitle: `Pagamento ${(payment as any)?.reference ?? "—"}  ·  Empresa ${(company as any)?.name ?? "—"}`,
    marginX,
    logoHeightMm: 11,
  });

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  let y = headerBottomY;
  doc.text(`Competência: ${(payment as any)?.competence_month ?? "—"}`, marginX, y); y += 5;
  doc.text(`Status do grupo: ${t.status ?? "—"}`, marginX, y); y += 5;
  doc.text(`Empresa: ${(company as any)?.name ?? "—"}${(company as any)?.document ? ` · CNPJ ${(company as any).document}` : ""}`, marginX, y); y += 5;
  doc.text(`Tolerância configurada: ${block_pct}% ou ${fmt(block_abs)}`, marginX, y); y += 7;

  // Situação box
  const color: [number, number, number] = conciliado ? [22, 163, 74] : liberado ? [217, 119, 6] : [220, 38, 38];
  doc.setFillColor(...color);
  doc.setTextColor(255, 255, 255);
  doc.rect(marginX, y, 182, 8, "F");
  doc.setFontSize(11);
  doc.text(`SITUAÇÃO: ${situacao}`, marginX + 3, y + 5.5);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  y += 13;

  // Totais
  autoTable(doc, {
    startY: y,
    head: [["", "Valor"]],
    body: [
      ["Bruto do pedido (hospital)", fmt(t.bruto_pedido_total)],
      ["Bruto calculado pela regra", fmt(t.bruto_regra_total)],
      ["Diferença", `${fmt(t.diferenca)} (${(t.diferenca_pct ?? 0).toFixed(2)}%)`],
      ["Itens analisados", String(t.itens_total ?? 0)],
      ["Itens sem regra", String(t.itens_sem_regra ?? 0)],
      ["Itens com valor divergente", String(t.itens_divergentes ?? 0)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 64, 175] },
    margin: { left: marginX, right: marginX },
  });
  // @ts-expect-error jspdf-autotable extends doc
  y = (doc.lastAutoTable?.finalY ?? y) + 8;

  // Itens divergentes
  if (divergentes.length > 0) {
    doc.setFontSize(11);
    doc.text(`Itens com valor divergente (${divergentes.length})`, marginX, y);
    y += 3;
    autoTable(doc, {
      startY: y + 2,
      head: [["Atend.", "Médico", "TUSS", "Qtd", "Bruto pago", "Esperado (regra)", "Δ", "Método"]],
      body: divergentes.slice(0, 200).map((i) => {
        const e = Number(i.expected_amount ?? 0);
        const g = Number(i.gross_amount ?? 0);
        return [
          i.attendance_number ?? "—",
          i.doctor_name ?? "—",
          i.procedure_code ?? "—",
          String(i.quantity ?? 1),
          fmt(g),
          fmt(e),
          fmt(g - e),
          i.applied_calc_method ?? "—",
        ];
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 64, 175] },
      margin: { left: marginX, right: marginX },
    });
    // @ts-expect-error
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
    if (divergentes.length > 200) {
      doc.setFontSize(8);
      doc.text(`... e mais ${divergentes.length - 200} itens divergentes.`, marginX, y);
      y += 6;
    }
  }

  // Itens sem regra
  if (semRegra.length > 0) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.text(`Itens sem regra cadastrada (${semRegra.length})`, marginX, y);
    y += 3;
    autoTable(doc, {
      startY: y + 2,
      head: [["Atend.", "Médico", "TUSS", "Qtd", "Bruto pago"]],
      body: semRegra.slice(0, 200).map((i) => [
        i.attendance_number ?? "—",
        i.doctor_name ?? "—",
        i.procedure_code ?? "—",
        String(i.quantity ?? 1),
        fmt(Number(i.gross_amount ?? 0)),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [220, 38, 38] },
      margin: { left: marginX, right: marginX },
    });
    // @ts-expect-error
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }

  // Alertas assistenciais — duplicidade por paciente + data
  type Finding = {
    rule_name?: string;
    kind?: string;
    conflicting_item?: {
      attendance_number?: string | null;
      procedure_name?: string | null;
      procedure_code?: string | null;
      doctor_name?: string | null;
      procedure_date?: string | null;
      payment_reference?: string | null;
    };
  };
  type DupRow = {
    procedure: string;
    doctor: string;
    attendance: string;
    lote: string;
    rule: string;
    valor: number;
    isConflict: boolean;
  };
  const dupGroups = new Map<string, { patient: string; date: string; rows: DupRow[]; total: number; crossBatch: boolean }>();
  const dupSeen = new Set<string>();
  const ownLote = (payment as any)?.reference ?? "Lote atual";
  for (const it of allItems) {
    const findings = Array.isArray(it.validation_findings) ? (it.validation_findings as Finding[]) : [];
    for (const f of findings) {
      const kind = (f.kind ?? "").toLowerCase();
      if (!kind.includes("duplic") && !kind.includes("sobrep") && !kind.includes("visita")) continue;
      const dateKey = (it.procedure_date || "").slice(0, 10);
      const patientKey = (it.patient_name || "").toLowerCase().trim();
      const gkey = `${patientKey}|${dateKey}`;
      let g = dupGroups.get(gkey);
      if (!g) {
        g = { patient: it.patient_name || "Paciente não informado", date: dateKey, rows: [], total: 0, crossBatch: false };
        dupGroups.set(gkey, g);
      }
      const curKey = `cur|${it.id}`;
      if (!dupSeen.has(curKey)) {
        dupSeen.add(curKey);
        const v = Number(it.gross_amount ?? 0);
        g.rows.push({
          procedure: `${it.procedure_name ?? "—"} (${it.procedure_code ?? "—"})`,
          doctor: it.doctor_name ?? "—",
          attendance: it.attendance_number ?? "—",
          lote: ownLote,
          rule: f.rule_name ?? "—",
          valor: v,
          isConflict: false,
        });
        g.total += v;
      }
      const c = f.conflicting_item;
      if (c && (c.attendance_number || c.procedure_name)) {
        const cKey = `conf|${it.id}|${c.attendance_number ?? ""}|${c.procedure_code ?? c.procedure_name ?? ""}|${c.payment_reference ?? ""}`;
        if (!dupSeen.has(cKey)) {
          dupSeen.add(cKey);
          const otherLote = c.payment_reference ?? "outro lote";
          if (otherLote !== ownLote) g.crossBatch = true;
          g.rows.push({
            procedure: `${c.procedure_name ?? "—"} (${c.procedure_code ?? "—"})`,
            doctor: c.doctor_name ?? "—",
            attendance: c.attendance_number ?? "—",
            lote: otherLote,
            rule: f.rule_name ?? "—",
            valor: 0,
            isConflict: true,
          });
        }
      }
    }
  }
  const dupGroupsArr = Array.from(dupGroups.entries())
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.total - a.total);

  if (dupGroupsArr.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.text(`Alertas assistenciais — duplicidade por paciente (${dupGroupsArr.length})`, marginX, y);
    y += 3;
    const body: (string | { content: string; colSpan?: number; styles?: any })[][] = [];
    for (const g of dupGroupsArr.slice(0, 80)) {
      const header = `${g.patient}  ·  ${g.date || "—"}  ·  ${g.rows.length} lançamento(s)  ·  ${fmt(g.total)}${g.crossBatch ? "  ·  ENTRE LOTES" : ""}`;
      body.push([{ content: header, colSpan: 6, styles: { fillColor: [254, 243, 199], fontStyle: "bold", textColor: [120, 53, 15] } }]);
      for (const r of g.rows) {
        body.push([
          r.procedure,
          r.doctor,
          r.attendance,
          r.lote,
          r.rule,
          r.valor ? fmt(r.valor) : "—",
        ]);
      }
    }
    autoTable(doc, {
      startY: y + 2,
      head: [["Procedimento", "Médico", "Atend.", "Lote", "Regra", "Valor"]],
      body: body as any,
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [217, 119, 6] },
      margin: { left: marginX, right: marginX },
    });
    // @ts-expect-error
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
    if (dupGroupsArr.length > 80) {
      doc.setFontSize(8);
      doc.text(`... e mais ${dupGroupsArr.length - 80} grupos de duplicidade.`, marginX, y);
      y += 6;
    }
  }

  // Liberações registradas
  if ((overrides ?? []).length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.text("Liberações registradas (overrides)", marginX, y);
    y += 3;
    // Resolve nomes dos aprovadores
    const ids = Array.from(new Set((overrides ?? []).map((o: any) => o.approved_by).filter(Boolean)));
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id,full_name").in("id", ids as string[])
      : { data: [] as { id: string; full_name: string | null }[] };
    const profMap = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name ?? p.id]));
    autoTable(doc, {
      startY: y + 2,
      head: [["Data", "Aprovador", "Bruto pedido", "Bruto regra", "Diferença", "Justificativa"]],
      body: (overrides as any[]).map((o) => [
        new Date(o.created_at).toLocaleString("pt-BR"),
        profMap.get(o.approved_by) ?? o.approved_by,
        fmt(o.bruto_pedido_snapshot),
        fmt(o.bruto_regra_snapshot),
        fmt(o.diferenca_snapshot),
        o.justification,
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 5: { cellWidth: 70 } },
      headStyles: { fillColor: [217, 119, 6] },
      margin: { left: marginX, right: marginX },
    });
  }

  // Rodapé
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")}  ·  ID grupo: ${t.group_id}  ·  Página ${p}/${pageCount}`,
      marginX,
      290,
    );
  }

  return doc;
}

/**
 * Relatório de validação no modo MANUAL.
 *
 * Pagamentos manuais não têm regra, divergência ou alerta assistencial —
 * o valor de cada linha veio fechado de uma planilha externa. O PDF então é
 * uma planilha auditável: Médico · Especialidade · Observação · Valor +
 * referência do anexo individual (e do anexo geral do lote, se houver).
 */
async function renderManualPdf({
  t,
  payment,
  company,
  items,
}: {
  t: Totals;
  payment: {
    reference?: string | null;
    competence_month?: string | null;
    manual_general_attachment_name?: string | null;
  } | null;
  company: { name?: string | null; document?: string | null } | null;
  items: Array<{
    id: string;
    doctor_name: string | null;
    specialty: string | null;
    manual_note: string | null;
    gross_amount: number | null;
    manual_source_attachment_path: string | null;
    is_manual_entry: boolean | null;
  }>;
}): Promise<jsPDF> {
  const doc = new jsPDF();
  const marginX = 14;

  const headerBottomY = await drawReportHeader(doc, {
    title: "Validação de Pagamento Manual",
    subtitle: `Pagamento ${payment?.reference ?? "—"}  ·  Empresa ${company?.name ?? "—"}`,
    marginX,
    logoHeightMm: 11,
  });

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  let y = headerBottomY;
  doc.text(`Competência: ${payment?.competence_month ?? "—"}`, marginX, y); y += 5;
  doc.text(
    `Empresa: ${company?.name ?? "—"}${company?.document ? ` · CNPJ ${company.document}` : ""}`,
    marginX,
    y,
  ); y += 5;
  doc.text("Tipo: Lançamento manual (sem regra · sem TUSS · sem divergência)", marginX, y); y += 5;
  if (payment?.manual_general_attachment_name) {
    doc.text(`Anexo do lote: ${payment.manual_general_attachment_name}`, marginX, y); y += 5;
  }
  y += 3;

  const manualItems = items.filter((i) => i.is_manual_entry !== false);
  const total = manualItems.reduce((acc, i) => acc + (Number(i.gross_amount) || 0), 0);

  // Bloco de situação simples — manual nunca bloqueia por regra.
  doc.setFillColor(22, 163, 74);
  doc.setTextColor(255, 255, 255);
  doc.rect(marginX, y, 182, 8, "F");
  doc.setFontSize(11);
  doc.text("SITUAÇÃO: VALORES LANÇADOS PELO ANALISTA", marginX + 3, y + 5.5);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  y += 13;

  // Tabela principal: médico · especialidade · observação · valor · anexo
  autoTable(doc, {
    startY: y,
    head: [["Médico", "Especialidade", "Observação", "Valor", "Anexo"]],
    body: manualItems.map((i) => [
      i.doctor_name ?? "—",
      i.specialty ?? "—",
      i.manual_note ?? "—",
      fmt(Number(i.gross_amount) || 0),
      i.manual_source_attachment_path
        ? (i.manual_source_attachment_path.split("/").pop() ?? "anexo")
        : "—",
    ]),
    foot: [["", "", "TOTAL", fmt(total), ""]],
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      2: { cellWidth: 60 },
      3: { halign: "right" },
    },
    headStyles: { fillColor: [30, 64, 175] },
    footStyles: { fillColor: [241, 245, 249], textColor: [17, 24, 39], fontStyle: "bold" },
    margin: { left: marginX, right: marginX },
  });

  // Rodapé
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")}  ·  ID grupo: ${t.group_id}  ·  Página ${p}/${pageCount}`,
      marginX,
      290,
    );
  }
  return doc;
}
