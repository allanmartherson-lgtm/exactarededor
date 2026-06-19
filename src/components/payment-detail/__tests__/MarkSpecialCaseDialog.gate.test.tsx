import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkSpecialCaseDialog } from "../MarkSpecialCaseDialog";

// Mock supabase client to control rule-count and payment-hospital lookups.
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
    if (table === "rules") {
      // Chainable builder that ultimately resolves with { count }
      const builder: any = {
        eq: () => builder,
        not: () => builder,
        then: (resolve: any) => Promise.resolve(rulesCountMock()).then(resolve),
      };
      return {
        select: () => builder,
      };
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
  paymentSingleMock.mockReset();
  paymentSingleMock.mockResolvedValue({ data: { hospital_id: "hosp-1" } });
});

describe("MarkSpecialCaseDialog — gate por regra com special_case_filter", () => {
  it("NÃO renderiza o botão quando nenhuma regra do hospital possui special_case_filter", async () => {
    rulesCountMock.mockResolvedValue({ count: 0 });
    const { container } = render(<MarkSpecialCaseDialog paymentId="pay-1" />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /caso especial/i })).toBeNull();
  });

  it("renderiza o botão quando existe ao menos 1 regra ativa com special_case_filter", async () => {
    rulesCountMock.mockResolvedValue({ count: 3 });
    render(<MarkSpecialCaseDialog paymentId="pay-1" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /caso especial/i })).toBeInTheDocument();
    });
  });
});
