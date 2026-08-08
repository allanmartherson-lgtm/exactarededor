import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Testes de contrato — leem o source para garantir que o grid em modo
 * confecção esconde colunas de comparação e renomeia o cabeçalho.
 * Esses asserts são à prova de regressão silenciosa (renomear/inverter
 * a flag quebra o teste).
 */
const grid = readFileSync(
  resolve(__dirname, "../ItemsDataGrid.tsx"),
  "utf8",
);

describe("ItemsDataGrid · modo confecção · contrato", () => {
  it("esconde a coluna 'Valor Repasse' (gross) em confecção", () => {
    expect(grid).toMatch(/const\s+showGrossColumn\s*=\s*!isConfeccao/);
  });

  it("esconde a coluna 'Diferença' em confecção", () => {
    expect(grid).toMatch(/showDiferencaCol[^=]*=[^;]*!isConfeccao/);
  });

  it("renomeia 'Esperado' para 'Repasse calculado' em confecção", () => {
    expect(grid).toMatch(/isConfeccao\s*\?\s*"Repasse calculado"\s*:\s*"Esperado"/);
  });

  it("usa largura ampliada (>= 160) para a coluna de repasse calculado", () => {
    expect(grid).toMatch(/expectedColWidth\s*=\s*isConfeccao\s*\?\s*16[0-9]/);
  });

  it("aplica expectedColWidth no <col> da tabela", () => {
    // A largura passou a ser resolvida por `colStyle(colKey, default)`, que
    // respeita o redimensionamento manual da coluna. O que importa aqui segue
    // sendo que a coluna "esperado" tire a largura de `expectedColWidth`.
    expect(grid).toMatch(/<col\s+style=\{colStyle\("esperado",\s*expectedColWidth\)\}/);
  });
});

describe("CompanyAnalysis · integração com modo", () => {
  const page = readFileSync(
    resolve(__dirname, "../../../pages/CompanyAnalysis.tsx"),
    "utf8",
  );

  it("repassa mode='confeccao' ao ItemsDataGrid quando payment.analysis_mode === 'confeccao'", () => {
    expect(page).toMatch(
      /mode=\{\(payment as any\)\.analysis_mode === "confeccao" \? "confeccao" : "analise"\}/,
    );
  });

  it("renderiza a aba 'Auditoria de cálculo' apenas no modo confecção", () => {
    expect(page).toMatch(/analysis_mode === "confeccao"[\s\S]*?Auditoria de cálculo/);
    expect(page).toMatch(/value="confeccao-audit"/);
  });

  it("renomeia o título da primeira aba para 'Confecção' quando no modo confecção", () => {
    expect(page).toMatch(/analysis_mode === "confeccao" \? "Confecção" : "Análise"/);
  });

  it("monta ConfeccaoAuditPanel apenas no TabsContent de confecção", () => {
    expect(page).toMatch(/<ConfeccaoAuditPanel\s+items=\{items\}\s+rulesIndex=\{rulesIndex\}/);
  });
});
