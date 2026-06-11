import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemsDataGrid } from "../ItemsDataGrid";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

vi.mock("@/hooks/useSectorAliases", () => ({ useSectorAliases: () => null }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "single" || prop === "maybeSingle")
        return vi.fn(() => Promise.resolve({ data: null, error: null }));
      return vi.fn(() => chain);
    },
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
  fireEvent.click(row);
};

describe("ItemsDataGrid — expansão inline e altura adaptativa", () => {
  beforeEach(() => {
    // jsdom não implementa scrollBy/scrollIntoView; mockamos para inspecionar.
    Element.prototype.scrollBy = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("abre o painel inline ao clicar e marca data-expanded-row", async () => {
    renderGrid([
      makeItem({ id: "row-a", attendance_number: "ATD-1" }),
      makeItem({ id: "row-b", attendance_number: "ATD-2", patient_name: "Paciente Dois" }),
    ]);
    expect(document.querySelector("[data-expanded-row]")).toBeNull();
    clickFirstRow("row-a");
    const panel = await screen.findByText(/Atendimento/i, { selector: "p,div,span" }).catch(() => null);
    expect(document.querySelector('[data-expanded-row="row-a"]')).toBeTruthy();
    // toggle fecha
    clickFirstRow("row-a");
    expect(document.querySelector("[data-expanded-row]")).toBeNull();
    void panel;
  });

  it("aciona scroll automático para o painel expandido", async () => {
    renderGrid([
      makeItem({ id: "row-a" }),
      makeItem({ id: "row-b", attendance_number: "ATD-2", patient_name: "Paciente Dois" }),
    ]);
    clickFirstRow("row-a");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("altura adaptativa cresce com itens, banner de pacote e expansão", () => {
    const findWrapper = () => document.querySelector<HTMLElement>('[class*="min-h-[640px]"]');

    // Caso A: poucos itens → baseline com min-h 640 e fórmula items*38 + chrome
    const small = [makeItem({ id: "s1" }), makeItem({ id: "s2", attendance_number: "ATD-2" })];
    const { unmount } = renderGrid(small);
    const wrapperA = findWrapper()!;
    expect(wrapperA).toBeTruthy();
    const styleAttrA = wrapperA.getAttribute("style") ?? "";
    expect(styleAttrA).toMatch(/min\(/);
    expect(styleAttrA).toContain("640px");
    // 2 itens * 38 + 0 banners * 44 + 0 expandido + 140 = 216px
    expect(styleAttrA).toContain("216px");

    unmount();

    // Caso B: grupo de pacote adiciona +44px por banner
    const pkg = [
      makeItem({ id: "p1", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
      makeItem({ id: "p2", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
      makeItem({ id: "p3", attendance_number: "PKG-1", applied_calc_method: "pacote" } as any),
    ];
    const r2 = renderGrid(pkg);
    const wrapperB = findWrapper()!;
    // 3*38 + 1*44 + 140 = 298px na fórmula
    expect(wrapperB.getAttribute("style") ?? "").toContain("298px");

    r2.unmount();

    // Caso C: viewport mobile preserva min-h baseline (não colapsa abaixo de 640)
    setViewport(390, 700);
    renderGrid(small);
    expect(findWrapper()).toBeTruthy();
  });

});
