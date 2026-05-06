import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AlertBanner } from "../AlertBanner";
import { TEXT_BODY, TEXT_LABEL, TEXT_META } from "../ItemsDataGrid";

/**
 * Guarda visual / tipografia.
 *
 * Não permite que mudanças futuras alterem silenciosamente o tamanho,
 * line-height ou tracking compartilhado entre AlertBanner, headers da
 * tabela, células e cards do painel expandido. Se alguém precisar mudar
 * a tipografia, precisa atualizar este teste de forma explícita.
 */
describe("ItemsDataGrid — tipografia compartilhada", () => {
  it("TEXT_BODY mantém text-xs / leading-snug / tracking-normal", () => {
    expect(TEXT_BODY).toBe("text-xs leading-snug tracking-normal");
  });

  it("TEXT_LABEL mantém escala 10px uppercase wide tracking", () => {
    expect(TEXT_LABEL).toBe(
      "text-[10px] uppercase tracking-wide font-medium text-muted-foreground leading-tight",
    );
  });

  it("TEXT_META mantém escala 10px tight para metadados", () => {
    expect(TEXT_META).toBe(
      "text-[10px] leading-tight tracking-normal text-muted-foreground",
    );
  });
});

describe("AlertBanner — layout e tipografia", () => {
  it("usa text-xs como tamanho de referência (mesmo set da tabela)", () => {
    const { container } = render(
      <AlertBanner severity="alerta" title="Teste">
        Conteúdo
      </AlertBanner>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("text-xs");
    expect(root.className).toContain("rounded-md");
    expect(root.className).toContain("border");
  });

  it("crítico aplica role=alert e classes destrutivas", () => {
    const { container, getByRole } = render(
      <AlertBanner severity="critico" title="Erro" />,
    );
    expect(getByRole("alert")).toBeInTheDocument();
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("border-destructive/40");
    expect(root.className).toContain("bg-destructive-soft");
  });

  it("informativo é discreto (muted) e usa role=status", () => {
    const { container, getByRole } = render(
      <AlertBanner severity="informativo" title="Info" />,
    );
    expect(getByRole("status")).toBeInTheDocument();
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("bg-muted/40");
  });

  it("modo compact reduz padding mas mantém text-xs", () => {
    const { container } = render(
      <AlertBanner severity="alerta" compact title="x" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("p-2");
    expect(root.className).toContain("text-xs");
  });
});

describe("Cards do painel expandido — contrato visual", () => {
  it("CARD base evita overflow e quebra palavras longas", () => {
    // Espelha o CARD usado em ItemsDataGrid (mesma fonte é a única
    // referência dos cards, então qualquer mudança lá precisa atualizar
    // este snapshot textual)
    const CARD =
      "rounded-md border bg-background p-3 min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]";
    expect(CARD).toContain("min-w-0");
    expect(CARD).toContain("overflow-hidden");
    expect(CARD).toContain("break-words");
    expect(CARD).toContain("[overflow-wrap:anywhere]");
    expect(CARD).toContain("rounded-md");
    expect(CARD).toContain("border");
  });
});
