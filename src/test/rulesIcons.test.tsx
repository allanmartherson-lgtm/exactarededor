import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_ITEMS, isGroup, type NavLeaf } from "@/config/navItems";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHeader } from "@/components/PageHeader";
import { BadgeDollarSign, ShieldCheck } from "lucide-react";

function findLeaf(label: string): NavLeaf {
  for (const item of NAV_ITEMS) {
    if (isGroup(item)) {
      const leaf = item.children.find((c) => c.label === label);
      if (leaf) return leaf;
    } else if (item.label === label) {
      return item;
    }
  }
  throw new Error(`Leaf not found: ${label}`);
}

const PAG = "Regras de Pagamento";
const VAL = "Regras de Validação";

describe("Ícones de Regras de Pagamento vs Validação", () => {
  const pag = findLeaf(PAG);
  const val = findLeaf(VAL);

  it("config: iconName diferente entre as duas regras", () => {
    expect(pag.iconName).toBe("BadgeDollarSign");
    expect(val.iconName).toBe("ShieldCheck");
    expect(pag.iconName).not.toBe(val.iconName);
  });

  it("sidebar/lista: componentes renderizam svg com classes lucide distintas", () => {
    const PagIcon = pag.icon;
    const ValIcon = val.icon;
    const { container } = render(
      <ul>
        <li><PagIcon data-testid="icon-pag" /></li>
        <li><ValIcon data-testid="icon-val" /></li>
      </ul>
    );
    const pagSvg = container.querySelector('[data-testid="icon-pag"]');
    const valSvg = container.querySelector('[data-testid="icon-val"]');
    expect(pagSvg).toBeInTheDocument();
    expect(valSvg).toBeInTheDocument();
    expect(pagSvg?.classList.contains("lucide-badge-dollar-sign")).toBe(true);
    expect(valSvg?.classList.contains("lucide-shield-check")).toBe(true);
    expect(pagSvg?.getAttribute("class")).not.toBe(valSvg?.getAttribute("class"));
  });

  it("breadcrumbs: rota de Regras de Pagamento mostra o label correspondente", () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={["/regras/pagamento"]}>
        <Breadcrumbs />
      </MemoryRouter>
    );
    expect(getByText(PAG)).toBeInTheDocument();
  });

  it("breadcrumbs: rota de Regras de Validação mostra o label correspondente", () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={["/regras/validacao"]}>
        <Breadcrumbs />
      </MemoryRouter>
    );
    expect(getByText(VAL)).toBeInTheDocument();
  });

  it("PageHeader aceita ícone e renderiza svg distinto para cada seção", () => {
    const { container: cPag } = render(
      <MemoryRouter>
        <PageHeader title={PAG} icon={BadgeDollarSign} showBack={false} />
      </MemoryRouter>
    );
    const { container: cVal } = render(
      <MemoryRouter>
        <PageHeader title={VAL} icon={ShieldCheck} showBack={false} />
      </MemoryRouter>
    );
    expect(cPag.querySelector(".lucide-badge-dollar-sign")).toBeInTheDocument();
    expect(cVal.querySelector(".lucide-shield-check")).toBeInTheDocument();
    expect(cPag.querySelector(".lucide-shield-check")).toBeNull();
    expect(cVal.querySelector(".lucide-badge-dollar-sign")).toBeNull();
  });
});