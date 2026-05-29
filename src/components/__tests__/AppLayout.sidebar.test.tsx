/**
 * ESTE TESTE É RÍGIDO POR DESIGN.
 * Se você adicionar/remover/reordenar item no menu (NAV_ITEMS),
 * atualize EXPECTED_ORDER e o toHaveLength(...) juntos.
 * É proposital travar isso aqui pra capturar mudanças não-intencionais no menu.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock contexts before importing AppLayout
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => {
    const roles = ["admin", "diretor", "validador", "analista"];
    return {
      user: { email: "admin@example.com" },
      roles,
      hasRole: (r: string) => roles.includes(r),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
  },
}));

vi.mock("@/contexts/NavLayoutContext", () => ({
  useNavLayout: () => ({ layout: "side", toggleLayout: vi.fn(), setLayout: vi.fn() }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() }),
}));

import { AppLayout } from "@/components/AppLayout";

const EXPECTED_ORDER = [
  "Dashboard",
  "Meu Perfil",
  "Pagamentos",
  "Pedidos de NF",
  "Ciclo de NF",
  "Glosas e Conciliação",
  "KPIs",
  "Executivo",
    "DRE & Posição em Aberto",
  "Recebíveis",
  "Inteligência Financeira",
  "Regras de Pagamento",
  "Regras de Validação",
  "Simulador de Regras",
  "Tabelas de referência",
  "Empresas",
  "Médicos",
  "Mapa Especialidades",
  "Setores",
  "Centros de custo",
  "Tipos de pagamento",
  "Pools de rateio",
  "Relatório de pools",
  "Prazos e SLA",
  "Usuários",
  "Produtividade da Equipe",
  "Saúde do Motor",
  "Auditoria",
  "Anomalias de status",
  "Insights de Observações",
  "Versões e Releases",
  "Feature Flags",
  "Avisos do Sistema",
  "Livro Contábil",
  "Sobre o Exacta",
];

const EXPECTED_COUNT = EXPECTED_ORDER.length;

function renderLayout() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("AppLayout sidebar navigation", () => {
  it("renders all nav items in the fixed order for admin", () => {
    renderLayout();
    const sidebar = screen.getByLabelText(/navegação lateral/i);
    const nav = sidebar.querySelector("nav") as HTMLElement;
    const links = within(nav).getAllByRole("link");
    const labels = links.map((l) => l.textContent?.trim());
    expect(labels).toEqual(EXPECTED_ORDER);
    expect(labels).toHaveLength(EXPECTED_COUNT);
  });

  it("preserves the fixed order without omissions", () => {
    renderLayout();
    const sidebar = screen.getByLabelText(/navegação lateral/i);
    const nav = sidebar.querySelector("nav") as HTMLElement;
    EXPECTED_ORDER.forEach((label) => {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    });
  });
});
