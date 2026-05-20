import * as XLSX from "xlsx-js-style";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}


self.onmessage = async (e) => {
  const { summary, companyGroups, filteredItems, fileName } = e.data;

  try {
    const wb = XLSX.utils.book_new();

    // Aba 1: Resumo
    const summaryData = [
      ["Critério", "Itens", "Valor", "% do Total"],
      ["Aprovados", summary.approved.count, summary.approved.value, `${summary.approved.pct.toFixed(1)}%`],
      ["Alertas", summary.alert.count, summary.alert.value, `${summary.alert.pct.toFixed(1)}%`],
      ["Reprovados", summary.rejected.count, summary.rejected.value, `${summary.rejected.pct.toFixed(1)}%`],
      ["", "", "", ""],
      ["Valor em Risco", "", summary.riskValue, `${((summary.riskValue / summary.totalValue) * 100 || 0).toFixed(1)}%`],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo");

    // Aba 2: Por Empresa
    const companyData = companyGroups.map(g => ({
      "Empresa": g.name,
      "Status": g.counts.reprovado > 0 ? "Com reprovações" : g.counts.alerta > 0 ? "Com alertas" : "Limpa",
      "✓ Aprovados": g.counts.aprovado,
      "⚠ Alertas": g.counts.alerta,
      "✗ Reprovados": g.counts.reprovado,
      "Valor Total": g.totalValue,
      "Valor em Risco (R$)": g.riskValue,
      "Valor em Risco (%)": g.totalValue > 0 ? `${((g.riskValue / g.totalValue) * 100).toFixed(1)}%` : "0%",
    }));
    const wsCompanies = XLSX.utils.json_to_sheet(companyData);
    
    // Formatação na aba Por Empresa
    const companyRange = XLSX.utils.decode_range(wsCompanies["!ref"] || "A1:H1");
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
    XLSX.utils.book_append_sheet(wb, wsCompanies, "Por Empresa");

    // Aba 3: Detalhe dos Itens
    const detailHeaders = [
      "Atendimento", "Data", "Empresa", "Paciente", "Médico", "Especialidade",
      "Código", "Procedimento", "Valor Repasse", "Valor Esperado",
      "Divergência (R$)", "Status", "Regra", "Motivo", "Validação Assistencial"
    ];
    
    const detailRows = filteredItems.map(it => {
      const findings = it.ai_findings || {};
      const status = it.ai_status;
      let statusStyle = {};
      if (status === "aprovado") statusStyle = { fill: { fgColor: { rgb: "D1FAE5" } } };
      else if (status === "alerta") statusStyle = { fill: { fgColor: { rgb: "FEF3C7" } } };
      else if (status === "reprovado") statusStyle = { fill: { fgColor: { rgb: "FEE2E2" } } };

      // Validação assistencial: usa o resumo pré-calculado no modal (que tem
      // acesso a rulesIndex e replica a mesma lógica do popover, incluindo
      // regras sintetizadas com action=informar). Fallback: monta a partir
      // de validation_findings caso o resumo não venha.
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

      return [
        it.attendance_number,
        it.procedure_date,
        it.company_name,
        it.patient_name,
        it.doctor_name,
        it.specialty,
        it.procedure_code,
        it.procedure_name,
        it.gross_amount,
        findings?.expected_amount ?? "",
        (Number(it.gross_amount ?? 0) - Number(findings?.expected_amount ?? 0)).toFixed(2),
        { v: status, s: statusStyle },
        it.rule_summary || "",
        findings?.alerts?.join(" | ") || findings?.engine?.ai_note || "",
        validationCol,
      ];
    });

    const wsDetails = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
    XLSX.utils.book_append_sheet(wb, wsDetails, "Detalhe dos Itens");

    // Aba 4: Alertas Assistenciais — tabela comparativa lado a lado
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
            fmtDate(it.procedure_date),

            Number(it.gross_amount ?? 0),
            "",
            ci?.doctor_name || "",
            ci?.company_name || "",
            ci?.attendance_number || "",
            ci?.specialty || "",
            fmtDate(ci?.procedure_date),

            ci?.procedure_date || "",
            ci?.gross_amount != null ? Number(ci.gross_amount) : "",
          ]);
        }
      }

      const wsAlerts = XLSX.utils.aoa_to_sheet([alertHeaders, ...alertRows]);

      const alertRange = XLSX.utils.decode_range(wsAlerts["!ref"] || "A1:P1");
      for (let C = alertRange.s.c; C <= alertRange.e.c; ++C) {
        const cell = wsAlerts[XLSX.utils.encode_cell({ r: 0, c: C })];
        if (cell) {
          cell.s = {
            fill: { fgColor: { rgb: C < 8 ? "EFF6FF" : C === 8 ? "FFFFFF" : "FFF7ED" } },
            font: { bold: true, sz: 9 },
          };
        }
      }

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

      XLSX.utils.book_append_sheet(wb, wsAlerts, "Alertas Assistenciais");
    }



    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    self.postMessage({ type: 'success', buffer: excelBuffer, fileName });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
