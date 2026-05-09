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
    
    // Click "Validar e revisar"
    const validateBtn = screen.getByText("Validar e revisar");
    fireEvent.click(validateBtn);

    // 3. Validation Step
    await waitFor(() => {
      expect(screen.queryByText(/3\. Validação/)).not.toBeNull();
    });

    expect(screen.getByText("Amostra do que será importado")).toBeDefined();

    // Check the sample data
    const samplePre = screen.getByText((content, element) => {
      return element?.tagName.toLowerCase() === 'pre' && content.includes('"value": 5687.4');
    });
    
    const sampleText = samplePre.textContent || "";
    const sampleData = JSON.parse(sampleText);

    expect(sampleData).toHaveLength(4); // L5 has "abc" which is invalid, so it might be filtered or kept with null
    
    // Actually, validateRows will push it to valid but with value null, 
    // UNLESS it's required and null is considered missing.
    // In ImportWizard: missing = requiredKeys.filter((k) => r[k] == null || r[k] === "" ...)
    // So "abc" -> null -> missing -> error.
    
    // Check conversions for valid ones
    expect(sampleData[0].value).toBe(5687.4);
    expect(sampleData[1].value).toBe(5687.4);
    expect(sampleData[2].value).toBe(5687.4);
    expect(sampleData[3].value).toBe(5687);

    // Check that Doc 5 is in errors
    expect(screen.getByText(/Linhas com erro \(1\)/)).toBeDefined();
    expect(screen.getByText(/Campos obrigatórios ausentes: value/)).toBeDefined();
    expect(screen.getByText("L")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();



  });
});
