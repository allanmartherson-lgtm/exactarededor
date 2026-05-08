/**
 * ESTE TESTE É RÍGIDO POR DESIGN.
 * Se você adicionar/remover/reordenar item no menu (NAV_ITEMS),
 * atualize EXPECTED juntos.
 * É proposital travar isso aqui pra capturar mudanças não-intencionais no menu.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

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

const EXPECTED = [
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

function renderLayout() {
  return render(
    // delayDuration=0 makes tooltips appear immediately, suitable for jsdom.
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
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

describe("AppLayout sidebar accessibility", () => {
  it("each sidebar item exposes a correct accessible name (aria-label)", () => {
    renderLayout();
    const sidebar = screen.getByLabelText(/navegação lateral/i);
    const nav = sidebar.querySelector("nav") as HTMLElement;

    EXPECTED.forEach((label) => {
      const link = within(nav).getByRole("link", { name: label });
      expect(link).toHaveAttribute("aria-label", label);
    });
  });

  it.each(EXPECTED)(
    "shows tooltip with the expected text for '%s'",
    async (label) => {
      renderLayout();
      const sidebar = screen.getByLabelText(/navegação lateral/i);
      const nav = sidebar.querySelector("nav") as HTMLElement;
      const link = within(nav).getByRole("link", { name: label });

      // Radix Tooltip opens on pointer enter / focus. Use both for robustness.
      fireEvent.pointerEnter(link);
      fireEvent.focus(link);

      // Tooltip content lands in a portal under document.body with role="tooltip".
      await waitFor(() => {
        const tooltips = screen.getAllByRole("tooltip");
        expect(tooltips.some((t) => t.textContent?.trim() === label)).toBe(true);
      });
    },
  );
});
