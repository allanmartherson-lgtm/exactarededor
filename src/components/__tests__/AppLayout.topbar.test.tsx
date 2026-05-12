/**
 * ESTE TESTE É RÍGIDO POR DESIGN.
 * Se você adicionar/remover/reordenar item no menu (NAV_ITEMS),
 * atualize EXPECTED_TOPBAR_TOP_LEVEL, EXPECTED_GROUP_CHILDREN e o
 * array final do "flattened topbar" juntos. É proposital travar isso
 * aqui pra capturar mudanças não-intencionais no menu.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock contexts BEFORE importing AppLayout.
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
  useNavLayout: () => ({ layout: "top", toggleLayout: vi.fn(), setLayout: vi.fn() }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() }),
}));

import { AppLayout } from "@/components/AppLayout";

/**
 * Topbar shows top-level entries in this exact order. Leaves with siblings
 * are grouped under a button that opens a dropdown menu.
 */
const EXPECTED_TOPBAR_TOP_LEVEL = [
  "Dashboard",
  "Financeiro",
  "Configurações",
  "Acesso",
];

/**
 * For each group, the children must appear in this exact order within the
 * dropdown menu. This guarantees the fixed sidebar ordering is preserved
 * across modes (topbar groups → flatten in sidebar order).
 */
const EXPECTED_GROUP_CHILDREN: Record<string, string[]> = {
  Financeiro: ["Pagamentos", "Notas Fiscais", "KPIs"],
  Configurações: [
    "Regras de Pagamento",
    "Regras de Validação",
    "Simulador de Regras",
    "Tabelas de referência",
    "Empresas",
    "Apelidos aprendidos",
    "Médicos",
    "Mapa Especialidades",
    "Centros de custo",
    "Prazos e SLA",
  ],
  Acesso: ["Usuários", "Auditoria", "Anomalias de status"],
};

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

describe("AppLayout topbar navigation", () => {
  it("renders the top-level entries in the fixed order without omissions", () => {
    renderLayout();
    const nav = screen.getByRole("navigation", { name: /navegação principal/i });
    // Top-level: Dashboard is a NavLink (role=link); groups are buttons.
    const link = within(nav).getByRole("link");
    const buttons = within(nav).getAllByRole("button");
    const labels = [link.textContent?.trim(), ...buttons.map((b) => b.textContent?.trim())];
    expect(labels).toEqual(EXPECTED_TOPBAR_TOP_LEVEL);
    expect(labels).toHaveLength(EXPECTED_TOPBAR_TOP_LEVEL.length);
  });

  it.each(Object.entries(EXPECTED_GROUP_CHILDREN))(
    "group '%s' opens and shows its children in the fixed order",
    (groupLabel, expectedChildren) => {
      renderLayout();
      const nav = screen.getByRole("navigation", { name: /navegação principal/i });
      const trigger = within(nav).getByRole("button", { name: new RegExp(`^${groupLabel}$`) });
      fireEvent.click(trigger);

      const menu = within(nav).getByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      const labels = items.map((i) => i.textContent?.trim());
      expect(labels).toEqual(expectedChildren);
      expect(labels).toHaveLength(expectedChildren.length);
    },
  );

  it("flattened topbar leaves match the fixed sidebar order (no omissions)", () => {
    renderLayout();
    const nav = screen.getByRole("navigation", { name: /navegação principal/i });

    // Dashboard (direct link) is the first leaf.
    const collected: string[] = ["Dashboard"];

    // Open each group sequentially and collect its menuitems in order.
    for (const groupLabel of ["Financeiro", "Configurações", "Acesso"]) {
      const trigger = within(nav).getByRole("button", { name: new RegExp(`^${groupLabel}$`) });
      fireEvent.click(trigger);
      const menu = within(nav).getByRole("menu");
      const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim() ?? "");
      collected.push(...items);
      // Close by clicking trigger again so only one menu is open at a time.
      fireEvent.click(trigger);
    }

    expect(collected).toEqual([
      "Dashboard",
      "Pagamentos",
      "Notas Fiscais",
      "KPIs",
      "Regras de Pagamento",
      "Regras de Validação",
      "Simulador de Regras",
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
    ]);
    expect(collected).toHaveLength(17);
  });
});