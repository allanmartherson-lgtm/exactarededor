import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mock contexts before importing AppLayout
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "admin@example.com" },
    roles: ["admin", "diretor", "validador", "analista"],
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
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
  "Regras",
  "Tabelas de referência",
  "Empresas",
  "Centros de custo",
  "Usuários",
  "Auditoria",
];

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout sidebar navigation", () => {
  it("renders exactly 10 nav items in the fixed order for admin", () => {
    renderLayout();
    const sidebar = screen.getByRole("navigation", { name: /navegação lateral/i });
    const links = within(sidebar).getAllByRole("link");
    const labels = links.map((l) => l.textContent?.trim());
    expect(labels).toEqual(EXPECTED_ORDER);
    expect(labels).toHaveLength(10);
  });

  it("preserves the fixed order without omissions", () => {
    renderLayout();
    const sidebar = screen.getByRole("navigation", { name: /navegação lateral/i });
    EXPECTED_ORDER.forEach((label) => {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    });
  });
});