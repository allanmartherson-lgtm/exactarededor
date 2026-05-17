import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { StatCard, StatCardSkeleton } from "../StatCard";
import { StatCardsGrid } from "../StatCardsGrid";

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("StatCardsGrid (invariantes de layout)", () => {
  it("mantém grid responsivo com altura uniforme", () => {
    render(
      <StatCardsGrid>
        <div />
      </StatCardsGrid>,
    );
    const grid = screen.getByTestId("stat-cards-grid");
    expect(grid).toHaveClass("grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).toHaveClass("lg:grid-cols-4");
    expect(grid).toHaveClass("items-stretch");
    expect(grid).toHaveClass("auto-rows-fr");
  });
});

describe("StatCard (hierarquia visual)", () => {
  const baseProps = {
    icon: Sparkles,
    label: "Suas bases",
    value: 3,
    tone: "info" as const,
  };

  const heightInvariants = (testId: string) => {
    const card = screen.getByTestId(testId);
    expect(card).toHaveClass("h-full");
    const content = card.querySelector(":scope > div");
    expect(content).not.toBeNull();
    expect(content).toHaveClass("h-full");
    expect(content).toHaveClass("flex");
    expect(content).toHaveClass("flex-col");
    expect(content).toHaveClass("gap-3");
  };

  it("sem hint nem badge: usa placeholder pra preservar altura do footer", () => {
    renderWithRouter(<StatCard {...baseProps} />);
    heightInvariants("stat-card");

    const label = screen.getByTestId("stat-card-label");
    expect(label).toHaveClass("min-h-[2lh]");
    expect(label).toHaveClass("line-clamp-2");

    const footer = screen.getByTestId("stat-card-footer");
    expect(footer).toHaveClass("mt-auto");
    expect(footer).toHaveClass("min-h-[20px]");

    expect(screen.getByTestId("stat-card-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("stat-card-hint")).toBeNull();
    expect(screen.queryByTestId("stat-card-badge")).toBeNull();
  });

  it("renderiza hint mantendo a estrutura do footer", () => {
    renderWithRouter(<StatCard {...baseProps} hint="2 no time" />);
    heightInvariants("stat-card");
    const hint = screen.getByTestId("stat-card-hint");
    expect(hint).toHaveTextContent("2 no time");
    expect(hint).toHaveClass("line-clamp-1");
    expect(screen.queryByTestId("stat-card-placeholder")).toBeNull();
    expect(screen.queryByTestId("stat-card-badge")).toBeNull();
  });

  it("badge 'Sua vez' tem prioridade sobre hint", () => {
    renderWithRouter(<StatCard {...baseProps} hint="2 no time" mine />);
    heightInvariants("stat-card");
    const badge = screen.getByTestId("stat-card-badge");
    expect(badge).toHaveTextContent("Sua vez");
    expect(screen.queryByTestId("stat-card-hint")).toBeNull();
    expect(screen.queryByTestId("stat-card-placeholder")).toBeNull();
  });

  it("aplica tipografia consistente no valor", () => {
    renderWithRouter(<StatCard {...baseProps} value={42} />);
    const value = screen.getByTestId("stat-card-value");
    expect(value).toHaveClass("text-3xl");
    expect(value).toHaveClass("sm:text-4xl");
    expect(value).toHaveClass("font-semibold");
    expect(value).toHaveClass("tabular-nums");
    expect(value).toHaveClass("leading-none");
    expect(value).toHaveTextContent("42");
  });

  it("trunca label longo em 2 linhas sem mudar a altura do header", () => {
    renderWithRouter(
      <StatCard
        {...baseProps}
        label="Um label muito muito muito longo que não deveria estourar o card"
      />,
    );
    const label = screen.getByTestId("stat-card-label");
    expect(label).toHaveClass("line-clamp-2");
    expect(label).toHaveClass("min-h-[2lh]");
    expect(label).toHaveClass("break-words");
  });

  it("envolve com Link mantendo área clicável completa e foco visível", () => {
    renderWithRouter(<StatCard {...baseProps} to="/algum-lugar" hint="2 no time" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/algum-lugar");
    // Área clicável: o Link cobre o card inteiro.
    expect(link).toHaveClass("block");
    expect(link).toHaveClass("h-full");
    // Foco visível consistente.
    expect(link).toHaveClass("focus-visible:ring-2");
    expect(link).toHaveClass("focus-visible:ring-ring");
    expect(link).toHaveClass("focus-visible:ring-offset-2");
    expect(link).toHaveClass("rounded-lg");
    // Rótulo acessível agrega label + valor + hint.
    expect(link).toHaveAccessibleName(/Suas bases.*valor 3.*2 no time/);
  });

  it("rotula corretamente quando o card é 'sua vez'", () => {
    renderWithRouter(<StatCard {...baseProps} to="/x" mine />);
    const link = screen.getByRole("link");
    expect(link).toHaveAccessibleName(/Suas bases.*valor 3.*sua vez/);
  });

  it("usa role=group com aria-label quando não é navegável", () => {
    renderWithRouter(<StatCard {...baseProps} hint="2 no time" />);
    const group = screen.getByRole("group", { name: /Suas bases.*valor 3.*2 no time/ });
    expect(group).toBeInTheDocument();
    // Sem 'to', não deve haver link.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ícone decorativo é escondido de leitores de tela", () => {
    const { container } = renderWithRouter(<StatCard {...baseProps} />);
    const iconWrapper = container.querySelector('[aria-hidden="true"]');
    expect(iconWrapper).not.toBeNull();
  });
});

describe("StatCardSkeleton (mesma estrutura do StatCard)", () => {
  it("preserva h-full, flex-col, gap e min-h do header/footer", () => {
    render(<StatCardSkeleton />);
    const sk = screen.getByTestId("stat-card-skeleton");
    expect(sk).toHaveClass("h-full");
    const content = sk.querySelector(":scope > div");
    expect(content).toHaveClass("h-full");
    expect(content).toHaveClass("flex");
    expect(content).toHaveClass("flex-col");
    expect(content).toHaveClass("gap-3");
  });

  it("é anunciado como status carregando para leitores de tela", () => {
    render(<StatCardSkeleton />);
    const sk = screen.getByRole("status", { name: /carregando/i });
    expect(sk).toHaveAttribute("aria-busy", "true");
  });
});
