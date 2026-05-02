import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

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

const EXPECTED = [
  "Dashboard",
  "Pagamentos",
  "Notas Fiscais",
  "KPIs",
  "Regras",
  "Tabelas de referência",
  "Empresas",
  "Centros de costo".replace("costo", "custo"), // keep as Centros de custo
  "Usuários",
  "Auditoria",
];

/** Force a narrow viewport + matchMedia(min-width) returning false. */
function setViewport(width: number, height = 800) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      // Parse "(min-width: NNNpx)" / "(max-width: NNNpx)" simply.
      const minMatch = /min-width:\s*(\d+)px/.exec(query);
      const maxMatch = /max-width:\s*(\d+)px/.exec(query);
      let matches = false;
      if (minMatch) matches = width >= Number(minMatch[1]);
      else if (maxMatch) matches = width <= Number(maxMatch[1]);
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
  window.dispatchEvent(new Event("resize"));
}

function renderLayout() {
  return render(
    <TooltipProvider delayDuration={0}>
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

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("AppLayout sidebar responsive integrity", () => {
  // Cover phone, small tablet, narrow laptop and a deliberately tiny width.
  it.each([
    ["mobile portrait", 320],
    ["mobile small", 360],
    ["mobile large", 414],
    ["tablet portrait", 768],
    ["small laptop", 1024],
    ["tiny stress test", 240],
  ])("at %s (%ipx) keeps all 10 items in fixed order", (_label, width) => {
    setViewport(width as number);
    renderLayout();

    const sidebar = screen.getByLabelText(/navegação lateral/i);
    const nav = sidebar.querySelector("nav") as HTMLElement;
    const links = within(nav).getAllByRole("link");
    const labels = links.map((l) => l.getAttribute("aria-label") ?? l.textContent?.trim());

    expect(labels).toEqual(EXPECTED);
    expect(labels).toHaveLength(10);

    // Defensive: ensure no item is hidden via inline display:none / hidden attr.
    links.forEach((link) => {
      expect(link).not.toHaveAttribute("hidden");
      expect(link.getAttribute("style") ?? "").not.toMatch(/display:\s*none/);
    });
  });
});