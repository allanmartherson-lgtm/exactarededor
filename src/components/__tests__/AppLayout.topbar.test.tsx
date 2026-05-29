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
 * Top-level entries in fixed order. Leaves (Dashboard, Meu Perfil) render
 * as NavLinks; groups render as buttons that open dropdown menus.
 */
const EXPECTED_TOPBAR_TOP_LEVEL = [
  "Dashboard",
  "Meu Perfil",
  "Financeiro",
  "Relatórios",
  "Inteligência de Regras",
  "Cadastros",
  "Parametrização",
  "Acesso",
  "Sistema",
];

const EXPECTED_GROUP_CHILDREN: Record<string, string[]> = {
  Financeiro: ["Pagamentos", "Pedidos de NF", "Ciclo de NF", "Glosas e Conciliação"],
  Relatórios: ["KPIs", "Executivo", "Recebíveis", "Inteligência Financeira"],
  "Inteligência de Regras": [
    "Regras de Pagamento",
    "Regras de Validação",
    "Simulador de Regras",
    "Tabelas de referência",
  ],
  Cadastros: [
    "Empresas",
    "Médicos",
    "Mapa Especialidades",
    "Setores",
    "Centros de custo",
    "Tipos de pagamento",
  ],
  Parametrização: ["Pools de rateio", "Relatório de pools", "Prazos e SLA"],
  Acesso: [
    "Usuários",
    "Produtividade da Equipe",
    "Saúde do Motor",
    "Auditoria",
    "Anomalias de status",
    "Insights de Observações",
  ],
  Sistema: [
    "Versões e Releases",
    "Feature Flags",
    "Avisos do Sistema",
    "Sobre o Exacta",
  ],
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
    const links = within(nav).getAllByRole("link");
    const buttons = within(nav).getAllByRole("button");
    const labels = [
      ...links.map((l) => l.textContent?.trim()),
      ...buttons.map((b) => b.textContent?.trim()),
    ];
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

    const collected: string[] = ["Dashboard", "Meu Perfil"];

    for (const groupLabel of Object.keys(EXPECTED_GROUP_CHILDREN)) {
      const trigger = within(nav).getByRole("button", { name: new RegExp(`^${groupLabel}$`) });
      fireEvent.click(trigger);
      const menu = within(nav).getByRole("menu");
      const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim() ?? "");
      collected.push(...items);
      fireEvent.click(trigger);
    }

    expect(collected).toEqual([
      "Dashboard",
      "Meu Perfil",
      "Pagamentos",
      "Pedidos de NF",
      "Ciclo de NF",
      "Glosas e Conciliação",
      "KPIs",
      "Executivo",
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
      "Sobre o Exacta",
    ]);
    expect(collected).toHaveLength(33);
  });
});
