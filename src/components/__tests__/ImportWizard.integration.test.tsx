import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportWizard, type ImportProfile } from "../ImportWizard";
import * as XLSX from "xlsx";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Mock XLSX
vi.mock("xlsx", async () => {
  return {
    read: vi.fn(),
    utils: {
      sheet_to_json: vi.fn(),
    },
  };
});

const mockProfile: ImportProfile = {
  entity: "doctors",
  fields: [
    { key: "name", label: "Nome", required: true, type: "text" },
    { key: "value", label: "Valor", required: true, type: "number" },
  ],
};

describe("ImportWizard Integration - Numeric Normalization", () => {
  beforeAll(() => {
    // Ensure File.prototype.arrayBuffer exists in jsdom
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = async function() {
        return new ArrayBuffer(0);
      };
    }
  });

  it("should correctly normalize numeric values during the import process", async () => {
    const mockRows = [
      { "Nome": "Doc 1", "Valor": "5687,4" },
      { "Nome": "Doc 2", "Valor": "5.687,40" },
      { "Nome": "Doc 3", "Valor": "5687.40" },
      { "Nome": "Doc 4", "Valor": "5.687" },
      { "Nome": "Doc 5", "Valor": "abc" },
    ];


    (XLSX.read as any).mockReturnValue({
      SheetNames: ["Sheet1"],
      Sheets: {
        Sheet1: {},
      },
    });

    (XLSX.utils.sheet_to_json as any).mockReturnValue(mockRows);

    render(
      <ImportWizard
        open={true}
        onOpenChange={() => {}}
        title="Importar Médicos"
        profile={mockProfile}
      />
    );

    // 1. Upload Step
    const file = new File(["test"], "test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const input = document.querySelector('input[type="file"]');
    
    if (!input) throw new Error("File input not found");
    
    fireEvent.change(input, { target: { files: [file] } });

    // 2. Mapping Step (Preview)
    // The title should change to "Importar Médicos · 2. Mapeamento"
    await waitFor(() => {
      expect(screen.queryByText(/2\. Mapeamento/)).not.toBeNull();
    }, { timeout: 3000 });

    // Verify mapping is suggested or set it manually
    expect(screen.getByText("Mapeamento de colunas")).toBeDefined();
    
    // Click "Continuar" → may go to role_config or directly to validate
    fireEvent.click(screen.getByText("Continuar"));
    // If role_config step appears, advance with "Validar registros"
    await waitFor(() => {
      const validateBtn = screen.queryByText("Validar registros");
      if (validateBtn) fireEvent.click(validateBtn);
      expect(
        screen.queryByText(/3\. Validação/) || screen.queryByText("Validar registros"),
      ).not.toBeNull();
    }, { timeout: 3000 });

    // 3. Validation Step
    await waitFor(() => {
      expect(screen.queryByText(/3\. Validação/)).not.toBeNull();
    });

    // Aguarda render do step de validação (com Stat "Total")
    await waitFor(() => {
      expect(screen.queryByText("Total")).not.toBeNull();
    }, { timeout: 3000 });

    // 4 das 5 linhas são numericamente válidas; "abc" → erro de obrigatório
    expect(screen.getByText(/Linhas com erro \(1\)/)).toBeDefined();
    expect(screen.getByText(/Campos obrigatórios ausentes:/)).toBeDefined();
    expect(screen.getByText(/L\s*6/)).toBeDefined();
  });
});
