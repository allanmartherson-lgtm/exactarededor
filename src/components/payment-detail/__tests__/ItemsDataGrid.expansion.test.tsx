import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemsDataGrid } from "../ItemsDataGrid";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

vi.mock("@/hooks/useSectorAliases", () => ({ useSectorAliases: () => null }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "admin@example.com" },
    roles: ["admin", "diretor", "validador", "analista"],
    hasRole: () => true,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: any) => resolve({ data: [], error: null });
      if (prop === "single" || prop === "maybeSingle")
        return vi.fn(() => Promise.resolve({ data: null, error: null }));
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
    doctor_name: "DR FULANO",
    doctor_document: "1",
    doctor_role: "cirurgiao principal",
    procedure_code: "30502314",
    procedure_name: "Procedimento Teste",
    description: null,
    access_route: null,
    quantity: 1,
    gross_amount: 1000,
    procedure_amount: 1000,
    procedure_date: "2026-05-09T10:00:00",
    attendance_number: "ATD-1",
    patient_name: "Paciente Um",
    agreement_text: "Sul América",
    sector: "centro cirurgico",
    raw_data: null,
    ai_status: "aprovado",
    ai_findings: { expected_amount: 1000 },
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

const setViewport = (w: number, h: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
};

const clickFirstRow = (id: string) => {
  const row = document.querySelector(`tr[data-row-id="${id}"]`) as HTMLElement;
  expect(row).toBeTruthy();
  fireEvent.doubleClick(row);
};

describe("ItemsDataGrid — painel de detalhes e altura adaptativa", () => {
  beforeEach(() => {
    // jsdom não implementa scrollBy/scrollIntoView; mockamos para inspecionar.
    Element.prototype.scrollBy = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  // O detalhe do item deixou de ser uma <tr> expandida embaixo da linha
  // (data-expanded-row) e passou a abrir no ItemDetailsPanel, um Sheet lateral
  // com navegação anterior/próximo. Os testes abaixo cobrem o comportamento
  // atual: duplo clique abre, duplo clique na mesma linha fecha.
  it("duplo clique abre o painel de detalhes do item", async () => {
    renderGrid([
      makeItem({ id: "row-a", attendance_number: "ATD-1" }),
      makeItem({ id: "row-b", attendance_number: "ATD-2", patient_name: "Paciente Dois" }),
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    clickFirstRow("row-a");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("duplo clique na mesma linha fecha o painel", async () => {
    renderGrid([
      makeItem({ id: "row-a", attendance_number: "ATD-1" }),
      makeItem({ id: "row-b", attendance_number: "ATD-2", patient_name: "Paciente Dois" }),
    ]);
    clickFirstRow("row-a");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    clickFirstRow("row-a");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("aplica baseline min-h 640 para diferentes tipos de regra e tamanhos de tela", () => {
    const findWrapper = () => document.querySelector<HTMLElement>('[class*="min-h-[640px]"]');

    const small = [makeItem({ id: "s1" }), makeItem({ id: "s2", attendance_number: "ATD-2" })];
    const { unmount: u1 } = renderGrid(small);
    expect(findWrapper()).toBeTruthy();
    u1();

    // grupo de pacote (RAMO 3)
    const pkg = [
      makeItem({ id: "p1", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
      makeItem({ id: "p2", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
      makeItem({ id: "p3", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
    ];
    const { unmount: u2 } = renderGrid(pkg);
    expect(findWrapper()).toBeTruthy();
    u2();

    // regra percentual (RAMO 2)
    const pct = [
      makeItem({ id: "r1", applied_calc_method: "percentual_convenio" } as any),
      makeItem({ id: "r2", attendance_number: "ATD-2", applied_calc_method: "percentual_convenio" } as any),
    ];
    const { unmount: u3 } = renderGrid(pct);
    expect(findWrapper()).toBeTruthy();
    u3();

    // viewport mobile não colapsa o baseline
    setViewport(390, 700);
    renderGrid(small);
    expect(findWrapper()).toBeTruthy();
  });
});

