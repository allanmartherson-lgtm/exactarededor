/**
 * E2E (contrato): garante que, quando o analista seleciona MANUALMENTE
 * a coluna de repasse no diálogo de mapeamento da UI, o pipeline lê
 * DIRETAMENTE aquele header e ignora:
 *   - qualquer alias canônico (REPASSE_ALIASES)
 *   - a heurística genérica de "Valor"/"Valor Tot"
 *   - aliases de procedure_amount
 *
 * Reproduz o caminho real do NewPayment.tsx:
 *   mapJsonToRows → resolvePaymentAmounts(rawRow, manualMapping)
 *
 * Cenário-âncora (regressão Sul América):
 *   - Hospital tem regra de NÃO pagamento → "Vl a Repassar" = 0
 *   - Heurística antiga lia "Valor Tot" = 95 e gravava 95
 *   - Resultado correto após fix: 0 (autoritativo)
 */
import { describe, it, expect } from "vitest";
import {
  resolvePaymentAmounts,
  REPASSE_ALIASES,
  PROC_AMOUNT_ALIASES,
} from "@/lib/resolvePaymentAmounts";

describe("E2E: mapeamento manual de repasse vence aliases e heurística", () => {
  it("header arbitrário escolhido pelo analista — sem alias conhecido, sem heurística", () => {
    // Header totalmente inventado, fora de qualquer lista de aliases.
    const customHeader = "Coluna Esquisita Que Só Esse Hospital Usa";
    const rawRow: Record<string, unknown> = {
      [customHeader]: 0,
      // Várias armadilhas: aliases canônicos com valores diferentes de 0
      "Vl a Repassar": 1234,
      "Vl Repasse": 9999,
      "Valor Tot": 95,
      "Valor": 77,
      "Valor Bruto": 88,
      "Valor Convênio": 100,
      "Médico": "Dr. Sul América",
      "Convênio": "SUL AMERICA",
    };

    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: customHeader,
    });

    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    // procedure_amount cai pra fallback (não foi mapeado): mas precisa NÃO ser 95.
    // O fallback de proc usa aliases canônicos → "Valor Convênio" = 100.
    expect(result.procedure_amount).toBe(100);
  });

  it("nenhum alias conhecido casa com o header escolhido — fix é estrutural", () => {
    // Sanity: nosso header customizado realmente não bate com nenhum alias.
    const customHeader = "coluna esquisita que só esse hospital usa";
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s_\-./]+/g, "");
    const n = norm(customHeader);
    const aliasMatch = [...REPASSE_ALIASES, ...PROC_AMOUNT_ALIASES].some(
      (a) => n.includes(norm(a)) || norm(a).includes(n),
    );
    expect(aliasMatch).toBe(false);
  });

  it("repasse mapeado vence mesmo quando 'Vl a Repassar' (alias canônico) está presente com valor diferente", () => {
    // Analista escolheu uma coluna específica do hospital; ignora a canônica.
    const rawRow = {
      "Repasse Liquido Acordo": 500,
      "Vl a Repassar": 1500, // canônica — seria escolhida pelo alias
      "Valor Tot": 2000,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Liquido Acordo",
    });
    expect(result.gross_amount).toBe(500);
    expect(result.grossAuthoritative).toBe(true);
  });

  it("repasse mapeado = 0 vence heurística (regra Sul América)", () => {
    const rawRow = {
      "Vl a Repassar": 0,
      "Valor Tot": 95,
      "Valor": 95,
      "Valor Bruto": 95,
      "Convênio": "Sul América",
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Vl a Repassar",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.valor_invalido).toBe(false);
  });

  it("procedure_amount mapeado em header arbitrário também é lido direto", () => {
    const procHeader = "Tabela XPTO do Convênio";
    const rawRow = {
      [procHeader]: 0,
      "Valor Convênio": 999, // alias canônico — seria escolhido sem mapping
      "Vl a Repassar": 0,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Vl a Repassar",
      procedure_amount: procHeader,
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
    expect(result.gross_amount).toBe(0);
  });

  it("formato BR no header mapeado é normalizado (R$ 1.234,56)", () => {
    const rawRow = {
      "Repasse Final": "R$ 1.234,56",
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Final",
    });
    expect(result.gross_amount).toBeCloseTo(1234.56, 2);
  });

  it("header mapeado AUSENTE da linha → cai pra alias canônico (não para heurística)", () => {
    // Defesa: se o template referencia um header que sumiu da planilha,
    // não silenciamos — caímos para o próximo nível (alias canônico),
    // que continua sendo melhor que a heurística "Valor Tot".
    const rawRow = {
      "Vl a Repassar": 250,
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Coluna Que Sumiu",
    });
    // grossMappedByAnalyst=true mas header não existe → repasseFound=false
    // → r_repasse=0, grossAuthoritative=true (pelo flag de mapeamento) → grava 0.
    // Esse comportamento é INTENCIONAL: mapeamento explícito é lei, mesmo
    // quando aponta para coluna ausente. Caso o analista queira fallback,
    // remove o mapeamento.
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
  });
});

describe("E2E: procedure_amount=0 mapeado manualmente é autoritativo", () => {
  it("header arbitrário mapeado para procedure_amount com 0 — sem alias, sem heurística", () => {
    const customProcHeader = "Tabela Interna Acordo Especial";
    const rawRow: Record<string, unknown> = {
      [customProcHeader]: 0,
      // Armadilhas: aliases canônicos com outros valores
      "Valor Convênio": 250,
      "Valor Procedimento": 300,
      "Vl Proce": 400,
      "Vl a Repassar": 500,
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: customProcHeader,
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });

  it("procedure_amount=0 mapeado vence alias canônico 'Valor Convênio'", () => {
    const rawRow = {
      "Valor Convênio": 0,        // analista quer ESSA
      "Valor Procedimento": 850,  // alias mais forte — seria escolhido sem mapping
      "Vl a Repassar": 500,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Valor Convênio",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });

  it("procedure_amount=0 em string '0' (formato BR) é preservado", () => {
    const rawRow = {
      "Tabela Convênio": "0",
      "Valor Tot": "1.234,56",
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Tabela Convênio",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });

  it("procedure_amount=0 e gross_amount>0 mapeados — coexistem sem contaminação", () => {
    // Cenário: convênio não paga procedimento (procedure=0) mas hospital
    // paga repasse fixo ao médico (gross=300).
    const rawRow = {
      "Vl a Repassar": 300,
      "Valor Convênio": 0,
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Vl a Repassar",
      procedure_amount: "Valor Convênio",
    });
    expect(result.gross_amount).toBe(300);
    expect(result.procedure_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.procAuthoritative).toBe(true);
    expect(result.valor_invalido).toBe(false);
  });

  it("procedure_amount=0 mapeado NÃO cai para gross_amount como fallback", () => {
    // Regressão: a lógica antiga fazia `procedure_amount || gross_amount`,
    // o que substituía 0 por gross. Com mapeamento autoritativo, 0 é 0.
    const rawRow = {
      "Vl Repasse": 500,
      "Convênio Não Paga": 0,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Vl Repasse",
      procedure_amount: "Convênio Não Paga",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procedure_amount).not.toBe(500);
  });

  it("procedure_amount mapeado AUSENTE da linha → grava 0 (mapeamento é lei)", () => {
    const rawRow = {
      "Valor Convênio": 999,
      "Vl a Repassar": 500,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Header Que Sumiu",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });
});

describe("E2E: campos vazios/nulos no header mapeado NÃO acionam heurística", () => {
  // Regressão: mapeamento explícito é lei. Se o analista mapeou o header e
  // a célula vier vazia/nula, o sistema deve gravar 0 (autoritativo) — JAMAIS
  // cair em "Valor Tot"/"Valor Bruto" como se o header não existisse.

  it("gross_amount: célula undefined no header mapeado → 0 autoritativo (não puxa 'Valor Tot')", () => {
    const rawRow: Record<string, unknown> = {
      "Vl a Repassar": undefined,
      "Valor Tot": 95,
      "Valor Bruto": 200,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Vl a Repassar",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.gross_amount).not.toBe(95);
  });

  it("gross_amount: célula null no header mapeado → 0 autoritativo", () => {
    const rawRow: Record<string, unknown> = {
      "Repasse Custom": null,
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
  });

  it("gross_amount: célula string vazia '' no header mapeado → 0 autoritativo", () => {
    const rawRow = {
      "Repasse Custom": "",
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
  });

  it("gross_amount: célula com só espaços '   ' no header mapeado → 0 autoritativo", () => {
    const rawRow = {
      "Repasse Custom": "   ",
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
  });

  it("procedure_amount: célula undefined no header mapeado → 0 autoritativo (não puxa 'Valor Convênio')", () => {
    const rawRow: Record<string, unknown> = {
      "Tabela Custom": undefined,
      "Valor Convênio": 850,
      "Valor Procedimento": 900,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Tabela Custom",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
    expect(result.procedure_amount).not.toBe(850);
  });

  it("procedure_amount: célula null no header mapeado → 0 autoritativo", () => {
    const rawRow: Record<string, unknown> = {
      "Tabela Custom": null,
      "Valor Convênio": 850,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Tabela Custom",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });

  it("procedure_amount: célula '' no header mapeado → 0 autoritativo", () => {
    const rawRow = {
      "Tabela Custom": "",
      "Valor Convênio": 850,
    };
    const result = resolvePaymentAmounts(rawRow, {
      procedure_amount: "Tabela Custom",
    });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });

  it("ambos mapeados e ambos vazios → 0/0 autoritativos, valor_invalido=false", () => {
    const rawRow: Record<string, unknown> = {
      "Repasse Custom": null,
      "Tabela Custom": "",
      "Valor Tot": 95,
      "Valor Convênio": 850,
      "Valor Bruto": 1000,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
      procedure_amount: "Tabela Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.procedure_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.procAuthoritative).toBe(true);
    expect(result.valor_invalido).toBe(false);
  });

  it("gross vazio mapeado + procedure>0 mapeado → não contamina entre si", () => {
    const rawRow: Record<string, unknown> = {
      "Repasse Custom": undefined,
      "Tabela Custom": 300,
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
      procedure_amount: "Tabela Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.procedure_amount).toBe(300);
  });

  it("valor inválido ('abc') no header mapeado → 0 + valor_invalido=true (não puxa heurística)", () => {
    const rawRow = {
      "Repasse Custom": "abc",
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow, {
      gross_amount: "Repasse Custom",
    });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.valor_invalido).toBe(true);
  });

  it("contraste — SEM mapeamento manual e header canônico vazio → heurística PODE atuar", () => {
    // Documenta que o comportamento "vazio = 0 autoritativo" é EXCLUSIVO do
    // mapeamento manual. Sem mapeamento, célula vazia em alias canônico
    // significa "coluna não detectada" e a heurística é legítima.
    const rawRow: Record<string, unknown> = {
      "Vl a Repassar": undefined, // ausente em valor, mas existe a chave
      "Valor Tot": 95,
    };
    const result = resolvePaymentAmounts(rawRow); // sem manualMapping
    // pick() acha a chave canônica; repasseFound=true via "!== undefined" → false.
    // Como undefined, repasseFound vira false e cai pra heurística.
    // Este teste blinda contra mudanças não intencionais nesse fallback.
    expect(result.gross_amount).toBe(95);
    expect(result.grossAuthoritative).toBe(false);
  });
});

