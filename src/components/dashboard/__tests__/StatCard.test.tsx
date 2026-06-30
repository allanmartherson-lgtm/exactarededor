import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { StatCard, StatCardSkeleton } from "../StatCard";
import { StatCardsGrid } from "../StatCardsGrid";

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("StatCardsGrid — invariantes de layout", () => {
  it("mantém grid responsivo com altura uniforme", () => {
    render(
      <StatCardsGrid>
        <div />
      </StatCardsGrid>,
    );
    const grid = screen.getByTestId("stat-cards-grid");
    expect(grid).toHaveClass("grid", "grid-cols-2", "lg:grid-cols-4", "items-stretch", "auto-rows-fr");
  });
});

describe("StatCard — estrutura e hierarquia", () => {
  const baseProps = {
    icon: Sparkles,
    label: "Suas bases",
    value: 3,
    tone: "info" as const,
  };

  const expectsCoreStructure = () => {
    const card = screen.getByTestId("stat-card");
    expect(card).toHaveClass("h-full");
    expect(screen.getByTestId("stat-card-value")).toBeInTheDocument();
    expect(screen.getByTestId("stat-card-footer")).toBeInTheDocument();
  };

  it("renderiza label, valor e placeholder de rodapé sem hint/badge", () => {
    renderWithRouter(<StatCard {...baseProps} />);
    expectsCoreStructure();
    expect(screen.getByTestId("stat-card-label")).toHaveTextContent("Suas bases");
    expect(screen.getByTestId("stat-card-value")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-card-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("stat-card-hint")).toBeNull();
    expect(screen.queryByTestId("stat-card-badge")).toBeNull();
  });

  it("renderiza hint quando informado", () => {
    renderWithRouter(<StatCard {...baseProps} hint="2 no time" />);
    expectsCoreStructure();
    expect(screen.getByTestId("stat-card-hint")).toHaveTextContent("2 no time");
    expect(screen.queryByTestId("stat-card-placeholder")).toBeNull();
  });

  it("badge 'Sua vez' tem prioridade sobre hint", () => {
    renderWithRouter(<StatCard {...baseProps} hint="2 no time" mine />);
    expectsCoreStructure();
    expect(screen.getByTestId("stat-card-badge")).toHaveTextContent("Sua vez");
    expect(screen.queryByTestId("stat-card-hint")).toBeNull();
  });

  it("trunca label longo sem quebrar layout (line-clamp + min-h)", () => {
    renderWithRouter(
      <StatCard
        {...baseProps}
        label="Um label muito muito muito longo que não deveria estourar o card"
      />,
    );
    const label = screen.getByTestId("stat-card-label");
    expect(label.className).toMatch(/line-clamp-/);
    expect(label.className).toMatch(/min-h-\[/);
  });

  it("envolve com Link mantendo área clicável completa quando 'to' é passado", () => {
    renderWithRouter(<StatCard {...baseProps} to="/algum-lugar" hint="2 no time" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/algum-lugar");
    expect(link).toHaveAccessibleName(/Suas bases.*valor 3.*2 no time/);
  });

  it("rotula corretamente quando o card é 'sua vez'", () => {
    renderWithRouter(<StatCard {...baseProps} to="/x" mine />);
    expect(screen.getByRole("link")).toHaveAccessibleName(/Suas bases.*valor 3.*sua vez/);
  });

  it("ícone é decorativo (aria-hidden)", () => {
    const { container } = renderWithRouter(<StatCard {...baseProps} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("StatCardSkeleton", () => {
  it("renderiza o esqueleto com testid", () => {
    render(<StatCardSkeleton />);
    expect(screen.getByTestId("stat-card-skeleton")).toBeInTheDocument();
  });
});
