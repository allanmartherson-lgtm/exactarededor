import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemsDataGrid } from "../ItemsDataGrid";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

// Mock useSectorAliases — não precisamos resolver setores nestes testes
vi.mock("@/hooks/useSectorAliases", () => ({
  useSectorAliases: () => null,
}));

// Mock AuthContext — ItemsDataGrid usa useAuth() para gating de ações
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "admin@example.com" },
    roles: ["admin", "diretor", "validador", "analista"],
    hasRole: () => true,
    signOut: vi.fn(),
  }),
}));

// Mock supabase usado por outros caminhos indiretos
vi.mock("@/integrations/supabase/client", () => {
  // `then` precisa resolver de verdade: hooks como useManualInterventionReasons
  // chamam .then() direto no builder do PostgREST. Devolver undefined aqui
  // derrubava a renderização com "then is not a function".
  const chain: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: (r: unknown) => void) => resolve({ data: [], error: null });
      if (prop === "single" || prop === "maybeSingle") return vi.fn(() => Promise.resolve({ data: null, error: null }));
      return vi.fn(() => chain);
    },
    apply() { return chain; },
  });
  return {
    supabase: {
      from: vi.fn(() => chain),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
  };
});

const makeItem = (over: Partial<PaymentItemRow> & Record<string, any>): PaymentItemRow =>
  ({
    id: over.id ?? `it-${Math.random()}`,
    payment_id: "pay-1",
    company_id: "c1",
    company_name: "EMPRESA X",
    doctor_name: over.doctor_name ?? "DR FULANO",
    doctor_document: "1",
    doctor_role: "cirurgiao principal",
    procedure_code: over.procedure_code ?? "30502314",
    procedure_name: over.procedure_name ?? "Procedimento Teste",
    description: null,
    access_route: null,
    quantity: 1,
    gross_amount: 1000,
    procedure_amount: 1000,
    procedure_date: "2026-05-09T10:00:00",
    attendance_number: over.attendance_number ?? "ATD-1",
    patient_name: over.patient_name ?? "Paciente Um",
    agreement_text: "Sul América",
    sector: "centro cirurgico",
    raw_data: null,
    ai_status: "aprovado",
    ai_findings: over.ai_findings ?? { expected_amount: 1000 },
    created_at: "2026-05-09T10:00:00Z",
    updated_at: "2026-05-09T10:00:00Z",
    ...over,
  } as unknown as PaymentItemRow);

const renderGrid = (items: PaymentItemRow[]) =>
  render(
    <MemoryRouter>
      <ItemsDataGrid items={items} groupStatus="em_analise_ia" rulesIndex={{}} rulesByName={{}} />
    </MemoryRouter>,
  );

describe("ItemsDataGrid - separador de bônus removido", () => {
  const items: PaymentItemRow[] = [
    makeItem({ id: "parent", attendance_number: "ATD-1", gross_amount: 2000, procedure_amount: 2000 }),
    makeItem({
      id: "bonus",
      attendance_number: "ATD-1",
      gross_amount: 1500,
      procedure_amount: 0,
      procedure_code: null,
      procedure_name: "Bônus Final de Semana",
      tipo_linha: "complemento_bonus",
      tipo_item: "bonus",
      ai_findings: null,
    } as any),
    makeItem({ id: "other", attendance_number: "ATD-2", patient_name: "Paciente Dois" }),
  ];

  it("nunca renderiza o separador 'Bônus de final de semana'", () => {
    renderGrid(items);
    // texto exato e variações com/sem capitalização
    expect(screen.queryByText(/Bônus de final de semana/i)).toBeNull();
  });

  it("renderiza o badge de bônus com aria-label acessível", () => {
    renderGrid(items);
    // badges com role="img"/"status" e aria-label descritivo
    expect(screen.getAllByLabelText(/bônus de plantão de final de semana/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/status: bônus aplicado/i)).toBeInTheDocument();
  });

  it("totais do footer incluem o gross_amount das linhas de bônus", () => {
    renderGrid(items);
    // 2000 (parent) + 1500 (bônus) + 1000 (other) = 4500
    // formatCurrency BR usa R$ 4.500,00
    const footer = screen.getByText(/Total \(3 itens\)/i).closest("tr")!;
    expect(within(footer).getByText(/R\$\s*4\.500,00/)).toBeInTheDocument();
  });

  it("linha de bônus aparece imediatamente após o item pai (sem separador)", () => {
    renderGrid(items);
    const rows = document.querySelectorAll("tr[data-row-id]");
    const ids = Array.from(rows).map((r) => r.getAttribute("data-row-id"));
    // parent precede bonus, sem nenhum row separador entre eles
    const pIdx = ids.indexOf("parent");
    const bIdx = ids.indexOf("bonus");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBe(pIdx + 1);
  });

  it("ordenação por Paciente reorganiza não-bônus e mantém bônus colado ao pai", () => {
    renderGrid(items);
    const header = screen.getByRole("button", { name: /Ordenar por Paciente/i });
    fireEvent.click(header); // asc
    const rows = document.querySelectorAll("tr[data-row-id]");
    const ids = Array.from(rows).map((r) => r.getAttribute("data-row-id"));
    // 'Paciente Dois' deve vir depois de 'Paciente Um' em asc
    const pIdx = ids.indexOf("parent");
    const oIdx = ids.indexOf("other");
    const bIdx = ids.indexOf("bonus");
    // 'Paciente Dois' (other) < 'Paciente Um' (parent) em asc
    expect(oIdx).toBeLessThan(pIdx);
    expect(bIdx).toBe(pIdx + 1); // bônus ainda colado ao pai
  });
});
