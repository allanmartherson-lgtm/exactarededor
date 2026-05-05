import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OverflowAudit from "@/pages/OverflowAudit";

/**
 * Smoke test do diagnóstico de overflow.
 *
 * A medição real de scrollWidth/clientWidth depende de layout do navegador
 * (jsdom não faz layout). Este teste garante apenas que a página de
 * auditoria está disponível e cobre as larguras esperadas — a checagem
 * visual em si roda em /diagnostico/overflow no preview.
 */
describe("OverflowAudit", () => {
  it("renderiza com larguras alvo cobrindo mobile → desktop", () => {
    render(
      <MemoryRouter>
        <OverflowAudit />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Auditoria de overflow horizontal/i)).toBeInTheDocument();
    // Larguras mínimas obrigatórias na grade.
    for (const w of ["320×568", "375×812", "768×1024", "1280×720", "1920×1080"]) {
      expect(screen.getAllByText(w).length).toBeGreaterThan(0);
    }
  });
});
