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
  "Pagamentos",
  "Notas Fiscais",
  "KPIs",
  "Regras de Pagamento",
  "Regras de Validação",
  "Tabelas de referência",
  "Empresas",
  "Apelidos aprendidos",
  "Médicos",
  "Mapa Especialidades",
  "Centros de custo",
  "Prazos e SLA",
  "Usuários",
  "Auditoria",
  "Anomalias de status",
];

const EXPECTED_COUNT = 16;

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
  it("renders exactly 16 nav items in the fixed order for admin", () => {
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
