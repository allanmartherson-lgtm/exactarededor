import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PaymentDetail from "@/pages/PaymentDetail";
import { usePaymentDetailData } from "@/hooks/usePaymentDetailData";
import { AuthContext } from "@/contexts/AuthContext";

// Mock do hook de dados
vi.mock("@/hooks/usePaymentDetailData", () => ({
  usePaymentDetailData: vi.fn(),
}));

// Mock do supabase client
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            abortSignal: vi.fn(() => Promise.resolve({ data: [] })),
          })),
          abortSignal: vi.fn(() => Promise.resolve({ data: [] })),
        })),
        abortSignal: vi.fn(() => Promise.resolve({ data: [] })),
      })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

const mockUser = { id: "user-1", email: "test@example.com" };

const renderPaymentDetail = () => {
  return render(
    <AuthContext.Provider
      value={{
        user: mockUser,
        session: null,
        loading: false,
        signOut: async () => {},
        hasRole: () => true,
        roles: ["admin"],
      } as any}
    >
      <MemoryRouter initialEntries={["/pagamentos/batch-1"]}>
        <Routes>
          <Route path="/pagamentos/:id" element={<PaymentDetail />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
};

describe("Filtro de Aprovados no Detalhe do Pagamento", () => {
  it("deve esconder empresas com alertas mesmo quando o nome da empresa casa com a busca", async () => {
    const mockItems = [
      {
        id: "item-1",
        company_name: "Empresa Alerta",
        ai_status: "alerta",
        ai_findings: { alerts: ["Divergência detectada"] },
        gross_amount: 100,
        doctor_name: "Dr. Teste",
      },
      {
        id: "item-2",
        company_name: "Empresa Limpa",
        ai_status: "aprovado",
        ai_findings: { alerts: [], engine: { diff_pct: 0 } },
        gross_amount: 200,
        doctor_name: "Dr. Limpo",
      },
    ];

    const mockGroups = [
      { id: "group-1", company_name: "Empresa Alerta", status: "revisao_analista", items_count: 1, total_amount: 100 },
      { id: "group-2", company_name: "Empresa Limpa", status: "revisao_analista", items_count: 1, total_amount: 200 },
    ];

    (usePaymentDetailData as any).mockReturnValue({
      payment: { id: "batch-1", status: "revisao_analista" },
      items: mockItems,
      groups: mockGroups,
      obs: [],
      profiles: {},
      aiVersions: [],
      invoices: [],
      questions: [],
      assignments: [],
      rulesIndex: {},
      rulesByName: {},
      expandedGroups: new Set(),
      setExpandedGroups: vi.fn(),
      load: vi.fn(),
    });

    renderPaymentDetail();

    // Inicialmente ambas aparecem
    expect(screen.getByText("Empresa Alerta")).toBeInTheDocument();
    expect(screen.getByText("Empresa Limpa")).toBeInTheDocument();

    // Ativa filtro "Aprovado"
    const approvedBtn = screen.getByRole("button", { name: /aprovado/i });
    fireEvent.click(approvedBtn);

    // Agora "Empresa Alerta" deve sumir (mesmo sem busca)
    expect(screen.queryByText("Empresa Alerta")).not.toBeInTheDocument();
    expect(screen.getByText("Empresa Limpa")).toBeInTheDocument();

    // Faz busca por "Alerta"
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    fireEvent.change(searchInput, { target: { value: "Alerta" } });

    // "Empresa Alerta" ainda não deve aparecer pois o filtro de status é soberano
    expect(screen.queryByText("Empresa Alerta")).not.toBeInTheDocument();
    expect(screen.queryByText("Empresa Limpa")).not.toBeInTheDocument(); // Limpa some porque o nome não casa
    
    expect(screen.getByText(/Nenhum grupo ou item casa com os filtros selecionados/i)).toBeInTheDocument();
  });
});
