import * as XLSX from "xlsx-js-style";
import {
  applyBrandTypography,
  prependBrandHeader,
  buildBrandSubtitle,
  fmtDateBR,
} from "../lib/excelBrandStyle";

self.onmessage = async (e) => {
  const {
    summary,
    companyGroups,
    filteredItems,
    fileName,
    hospitalName,
    competence,
  } = e.data;

  const subtitle = buildBrandSubtitle({
    hospitalName,
    competence,
  });

  try {
    const wb = XLSX.utils.book_new();

    // -----------------------------------------------------------------
    // Aba 1: Resumo
    // -----------------------------------------------------------------
    const summaryData = [
      ["Critério", "Itens", "Valor", "% do Total"],
      ["Aprovados", summary.approved.count, summary.approved.value, `${summary.approved.pct.toFixed(1)}%`],
      ["Alertas", summary.alert.count, summary.alert.value, `${summary.alert.pct.toFixed(1)}%`],
      ["Reprovados", summary.rejected.count, summary.rejected.value, `${summary.rejected.pct.toFixed(1)}%`],
      ["Acatados", summary.accepted?.count ?? 0, summary.accepted?.value ?? 0, `${(summary.accepted?.pct ?? 0).toFixed(1)}%`],
      ["", "", "", ""],
      ["Valor em Risco", "", summary.riskValue, `${((summary.riskValue / summary.totalValue) * 100 || 0).toFixed(1)}%`],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 14 }];
    const summaryHeaderRow = prependBrandHeader(wsSummary, {
      title: "Resumo do Lote",
      subtitle,
      columnsCount: 4,
    });
    applyBrandTypography(wsSummary, { headerRow: summaryHeaderRow });
    XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo");

    // -----------------------------------------------------------------
    // Aba 2: Por Empresa (mantém cores de status na coluna Status)
    // -----------------------------------------------------------------
    const companyData = companyGroups.map((g: any) => ({
      "Empresa": g.name,
      "Status": g.counts.reprovado > 0 ? "Com reprovações" : g.counts.alerta > 0 ? "Com alertas" : "Limpa",
      "✓ Aprovados": g.counts.aprovado,
      "⚠ Alertas": g.counts.alerta,
      "✗ Reprovados": g.counts.reprovado,
      "● Acatados": g.counts.acatado ?? 0,
      "Valor Total": g.totalValue,
      "Valor em Risco (R$)": g.riskValue,
      "Valor em Risco (%)": g.totalValue > 0 ? `${((g.riskValue / g.totalValue) * 100).toFixed(1)}%` : "0%",
    }));
    const wsCompanies = XLSX.utils.json_to_sheet(companyData);
    wsCompanies["!cols"] = [
      { wch: 44 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
      { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 18 },
    ];

    const companyRange = XLSX.utils.decode_range(wsCompanies["!ref"] || "A1:I1");
    for (let R = companyRange.s.r + 1; R <= companyRange.e.r; ++R) {
      const statusCell = wsCompanies[XLSX.utils.encode_cell({ r: R, c: 1 })];
      if (statusCell && statusCell.v) {
        const val = statusCell.v;
        let bgColor = "";
        if (val === "Limpa") bgColor = "D1FAE5";
        else if (val === "Com alertas") bgColor = "FEF3C7";
        else if (val === "Com reprovações") bgColor = "FEE2E2";
        if (bgColor) statusCell.s = { fill: { fgColor: { rgb: bgColor } } };
      }
    }
    const companyHeaderRow = prependBrandHeader(wsCompanies, {
      title: "Consolidado por Empresa",
      subtitle,
      columnsCount: 9,
    });
    applyBrandTypography(wsCompanies, { headerRow: companyHeaderRow });
    XLSX.utils.book_append_sheet(wb, wsCompanies, "Por Empresa");

    // -----------------------------------------------------------------
    // Aba 3: Detalhe dos Itens (mantém cores por status no Status)
    // -----------------------------------------------------------------
    const detailHeaders = [
      "Atendimento", "Data", "Empresa", "Convênio", "Setor", "Paciente",
      "Médico", "CRM", "Especialidade",
      "Código", "Procedimento", "Qtd", "Valor Repasse", "Valor Esperado",
      "Divergência (R$)", "Piso Aplicado", "Método Piso",
      "Status", "Regra", "Motivo", "Validação Assistencial",
      "Memória de cálculo",
    ];

    const detailRows = filteredItems.map((it: any) => {
      const findings = it.ai_findings || {};
      const status = it.ai_status;
      let statusStyle: any = {};
      if (status === "aprovado") statusStyle = { fill: { fgColor: { rgb: "D1FAE5" } } };
      else if (status === "alerta") statusStyle = { fill: { fgColor: { rgb: "FEF3C7" } } };
      else if (status === "reprovado") statusStyle = { fill: { fgColor: { rgb: "FEE2E2" } } };
      else if (status === "acatado") statusStyle = { fill: { fgColor: { rgb: "DBEAFE" } } };

      let validationCol: string = typeof it.validation_summary === "string" ? it.validation_summary : "";
      if (!validationCol) {
        const vfRaw = Array.isArray(it.validation_findings) ? it.validation_findings : [];
        validationCol = vfRaw
          .map((f: any) => {
            const name = f?.rule_name || f?.kind || "Validação";
            const ci = f?.conflicting_item;
            let conflictDetail = "";
            if (ci) {
              const parts: string[] = [];
              if (ci.doctor_name) parts.push(`Médico: ${ci.doctor_name}`);
              if (ci.company_name) parts.push(`Empresa: ${ci.company_name}`);
              if (ci.attendance_number) parts.push(`Atend: ${ci.attendance_number}`);
              if (parts.length > 0) conflictDetail = ` → conflita com [${parts.join(" · ")}]`;
            }
            const msg = f?.message || "";
            if (conflictDetail) return `${name}: ${msg}${conflictDetail}`;
            return msg ? `${name}: ${msg}` : name;
          })
          .join(" | ");
      }

      const expectedVal = it.expected_amount ?? findings?.expected_amount ?? "";
      const expectedNum = Number(expectedVal ?? 0);
      const pisoMetodo = it.piso_metodo_vencedor === "piso"
        ? "Piso"
        : it.piso_metodo_vencedor === "convenio"
          ? "Convênio"
          : "";
      return [
        it.attendance_number,
        it.procedure_date,
        it.company_name,
        it.agreement_text ?? it.convenio_slug ?? "",
        it.sector_name ?? "",
        it.patient_name,
        it.doctor_name,
        it.doctor_document ?? "",
        it.specialty,
        it.procedure_code,
        it.procedure_name,
        it.quantity ?? 1,
        it.gross_amount,
        expectedVal,
        Number((Number(it.gross_amount ?? 0) - expectedNum).toFixed(2)),
        it.piso_aplicado_valor != null ? Number(it.piso_aplicado_valor) : "",
        pisoMetodo,
        { v: status, s: statusStyle },
        it.rule_summary || "",
        findings?.alerts?.join(" | ") || findings?.engine?.ai_note || "",
        validationCol,
        findings?.calculation_explanation || "",
      ];
    });

    const wsDetails = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
    wsDetails["!cols"] = [
      { wch: 14 }, { wch: 12 }, { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 28 },
      { wch: 28 }, { wch: 12 }, { wch: 20 },
      { wch: 12 }, { wch: 36 }, { wch: 6 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 28 }, { wch: 36 }, { wch: 40 }, { wch: 40 },
    ];

    const detailHeaderRow = prependBrandHeader(wsDetails, {
      title: "Detalhe dos Itens",
      subtitle,
      columnsCount: detailHeaders.length,
    });
    applyBrandTypography(wsDetails, { headerRow: detailHeaderRow });
    XLSX.utils.book_append_sheet(wb, wsDetails, "Detalhe dos Itens");

    // -----------------------------------------------------------------
    // Aba 4: Alertas Assistenciais — tabela comparativa lado a lado
    // -----------------------------------------------------------------
    const alertItems = filteredItems.filter((it: any) =>
      Array.isArray(it.validation_findings) && it.validation_findings.length > 0
    );

    if (alertItems.length > 0) {
      const alertHeaders = [
        "Tipo de Alerta",
        "Médico (Original)", "Empresa (Original)", "Atendimento (Original)",
        "Especialidade (Original)", "Paciente (Original)", "Data (Original)", "Valor (Original)",
        "↔",
        "Médico (Conflitante)", "Empresa (Conflitante)", "Atendimento (Conflitante)",
        "Especialidade (Conflitante)", "Paciente (Conflitante)", "Data (Conflitante)", "Valor (Conflitante)",
      ];

      const alertRows: any[][] = [];
      for (const it of alertItems) {
        const findings = (it as any).validation_findings as any[];
        for (const f of findings) {
          const ci = f?.conflicting_item;
          alertRows.push([
            f?.rule_name || f?.kind || "Validação",
            it.doctor_name || "",
            it.company_name || "",
            it.attendance_number || "",
            it.specialty || "",
            it.patient_name || "",
            fmtDateBR(it.procedure_date),
            Number(it.gross_amount ?? 0),
            "",
            ci?.doctor_name || "",
            ci?.company_name || "",
            ci?.attendance_number || "",
            ci?.specialty || "",
            ci?.patient_name || "",
            fmtDateBR(ci?.procedure_date),
            ci?.gross_amount != null ? Number(ci.gross_amount) : "",
          ]);
        }
      }

      const wsAlerts = XLSX.utils.aoa_to_sheet([alertHeaders, ...alertRows]);

      // Separador visual entre bloco Original e Conflitante (coluna "↔").
      for (let R = 1; R <= alertRows.length; ++R) {
        const cell = wsAlerts[XLSX.utils.encode_cell({ r: R, c: 8 })];
        if (cell) cell.s = { alignment: { horizontal: "center" }, font: { bold: true } };
      }

      wsAlerts["!cols"] = [
        { wch: 24 },
        { wch: 26 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
        { wch: 3 },
        { wch: 26 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
      ];

      const alertHeaderRow = prependBrandHeader(wsAlerts, {
        title: "Alertas Assistenciais",
        subtitle,
        columnsCount: alertHeaders.length,
      });
      applyBrandTypography(wsAlerts, { headerRow: alertHeaderRow });
      XLSX.utils.book_append_sheet(wb, wsAlerts, "Alertas Assistenciais");
    }

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    self.postMessage({ type: "success", buffer: excelBuffer, fileName });
  } catch (error: any) {
    self.postMessage({ type: "error", error: error?.message ?? String(error) });
  }
};
