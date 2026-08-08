import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkSpecialCaseDialog } from "../MarkSpecialCaseDialog";

// Mock supabase: o gate agora conta regras ativas cujo CÁLCULO tem
// special_case_filter (rule_calculations), não mais rules.special_case_filter.
const ruleCalcsMock = vi.fn();
const rulesCountMock = vi.fn();
const paymentSingleMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    if (table === "payments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => paymentSingleMock(),
          }),
        }),
      };
    }
    if (table === "rule_calculations") {
      return {
        select: () => ({
          not: () => Promise.resolve(ruleCalcsMock()),
        }),
      };
    }
    if (table === "rules") {
      const builder: any = {
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        then: (resolve: any) => Promise.resolve(rulesCountMock()).then(resolve),
      };
      return { select: () => builder };
    }
    if (table === "special_case_types") {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [] }),
          }),
        }),
      };
    }
    return { select: () => ({}) };
  };
  return { supabase: { from, functions: { invoke: vi.fn() } } };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  rulesCountMock.mockReset();
  ruleCalcsMock.mockReset();
  paymentSingleMock.mockReset();
  paymentSingleMock.mockResolvedValue({ data: { hospital_id: "hosp-1" } });
  ruleCalcsMock.mockResolvedValue({ data: [{ rule_id: "r1" }] });
});

describe("MarkSpecialCaseDialog — gate por cálculo com special_case_filter", () => {
  it("NÃO renderiza quando nenhum cálculo tem special_case_filter", async () => {
    ruleCalcsMock.mockResolvedValue({ data: [] });
    rulesCountMock.mockResolvedValue({ count: 0 });
    const { container } = render(<MarkSpecialCaseDialog paymentId="pay-1" />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /caso especial/i })).toBeNull();
  });

  it("NÃO renderiza quando o cálculo existe mas nenhuma regra ativa do hospital bate", async () => {
    rulesCountMock.mockResolvedValue({ count: 0 });
    const { container } = render(<MarkSpecialCaseDialog paymentId="pay-1" />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renderiza quando existe regra ativa com cálculo de caso especial", async () => {
    rulesCountMock.mockResolvedValue({ count: 3 });
    render(<MarkSpecialCaseDialog paymentId="pay-1" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /caso especial/i })).toBeInTheDocument();
    });
  });
});
