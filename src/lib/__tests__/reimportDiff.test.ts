import { describe, expect, it } from "vitest";
import {
  computeReimportDiff,
  hasAnyChange,
  type ExistingItemRow,
  type ParsedItemRow,
} from "@/lib/reimportDiff";

/**
 * `computeReimportDiff` é o que o analista vê antes de autorizar uma
 * reimportação — operação destrutiva (apaga os itens do lote e reinsere).
 * Se este diff mentir, alguém aprova a perda de linhas achando que nada mudou.
 *
 * Chave canônica: atendimento | TUSS (8 dígitos) | médico normalizado | arquivo.
 */

function ex(over: Partial<ExistingItemRow> = {}): ExistingItemRow {
  return {
    attendance_number: "A1",
    procedure_code: "10101012",
    doctor_name: "João Silva",
    source_file_name: "base.xlsx",
    gross_amount: 100,
    ...over,
  };
}

function pa(over: Partial<ParsedItemRow> = {}): ParsedItemRow {
  return {
    attendance_number: "A1",
    procedure_code: "10101012",
    doctor_name: "João Silva",
    source_file_name: "base.xlsx",
    gross_amount: 100,
    ...over,
  };
}

describe("computeReimportDiff — casos básicos", () => {
  it("nada de um lado e nada do outro => diff vazio", () => {
    const d = computeReimportDiff([], []);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(0);
    expect(d.changed).toEqual([]);
    expect(d.totalBefore).toBe(0);
    expect(d.totalAfter).toBe(0);
    expect(hasAnyChange(d)).toBe(false);
  });

  it("linha igual dos dois lados não aparece como mudança", () => {
    const d = computeReimportDiff([ex()], [pa()]);
    expect(hasAnyChange(d)).toBe(false);
    expect(d.totalBefore).toBe(100);
    expect(d.totalAfter).toBe(100);
  });

  it("linha só no arquivo novo => adicionada", () => {
    const d = computeReimportDiff([], [pa({ gross_amount: 250 })]);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(0);
    expect(d.addedSample[0].after).toBe(250);
    expect(hasAnyChange(d)).toBe(true);
  });

  it("linha só no lote atual => removida", () => {
    const d = computeReimportDiff([ex({ gross_amount: 250 })], []);
    expect(d.removedCount).toBe(1);
    expect(d.addedCount).toBe(0);
    expect(d.removedSample[0].before).toBe(250);
  });

  it("mesma chave com valor diferente => changed com antes/depois", () => {
    const d = computeReimportDiff([ex({ gross_amount: 100 })], [pa({ gross_amount: 175.5 })]);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(0);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].before).toBe(100);
    expect(d.changed[0].after).toBe(175.5);
  });

  it("diferença de meio centavo fica dentro da tolerância", () => {
    const igual = computeReimportDiff([ex({ gross_amount: 100 })], [pa({ gross_amount: 100.004 })]);
    expect(igual.changed).toHaveLength(0);
    const difere = computeReimportDiff([ex({ gross_amount: 100 })], [pa({ gross_amount: 100.02 })]);
    expect(difere.changed).toHaveLength(1);
  });

  it("null de valor conta como zero na comparação", () => {
    const d = computeReimportDiff([ex({ gross_amount: null })], [pa({ gross_amount: 0 })]);
    expect(d.changed).toHaveLength(0);
  });
});

describe("computeReimportDiff — normalização da chave", () => {
  it("médico casa ignorando acento, caixa e espaço extra", () => {
    const d = computeReimportDiff(
      [ex({ doctor_name: "JOÃO   SILVA" })],
      [pa({ doctor_name: "joao silva" })],
    );
    expect(hasAnyChange(d)).toBe(false);
  });

  it("TUSS casa ignorando pontuação e zeros à esquerda (8 dígitos)", () => {
    const d = computeReimportDiff(
      [ex({ procedure_code: "1.01.01.012" })],
      [pa({ procedure_code: "10101012" })],
    );
    expect(hasAnyChange(d)).toBe(false);
  });

  it("TUSS curto é preenchido à esquerda até 8 dígitos", () => {
    const d = computeReimportDiff([ex({ procedure_code: "31012" })], [pa({ procedure_code: "00031012" })]);
    expect(hasAnyChange(d)).toBe(false);
  });

  it("arquivos diferentes NÃO se misturam (mesma linha em dois arquivos)", () => {
    const d = computeReimportDiff(
      [ex({ source_file_name: "jan.xlsx" })],
      [pa({ source_file_name: "fev.xlsx" })],
    );
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
  });

  it("médicos diferentes no mesmo atendimento/TUSS são linhas distintas", () => {
    const d = computeReimportDiff(
      [ex({ doctor_name: "João Silva" })],
      [pa({ doctor_name: "Ana Souza" })],
    );
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
  });
});

describe("computeReimportDiff — totais e amostras", () => {
  it("totais somam TODAS as linhas, não só as chaves distintas", () => {
    const existing = [ex({ attendance_number: "A1" }), ex({ attendance_number: "A2" })];
    const parsed = [pa({ attendance_number: "A1" }), pa({ attendance_number: "A2", gross_amount: 300 })];
    const d = computeReimportDiff(existing, parsed);
    expect(d.totalBefore).toBe(200);
    expect(d.totalAfter).toBe(400);
  });

  it("amostras de adicionadas/removidas são limitadas a 50", () => {
    const parsed = Array.from({ length: 120 }, (_, i) => pa({ attendance_number: `N${i}` }));
    const existing = Array.from({ length: 120 }, (_, i) => ex({ attendance_number: `V${i}` }));
    const d = computeReimportDiff(existing, parsed);
    expect(d.addedCount).toBe(120);
    expect(d.removedCount).toBe(120);
    expect(d.addedSample).toHaveLength(50);
    expect(d.removedSample).toHaveLength(50);
  });
});

describe("computeReimportDiff — chaves duplicadas (comportamento atual)", () => {
  /**
   * A indexação é feita em Map, então linhas com a MESMA chave canônica
   * colapsam (a última vence). Já `totalBefore`/`totalAfter` somam o array
   * inteiro. Os testes abaixo fixam esse comportamento como ele é hoje —
   * ver a nota no fim do arquivo sobre a consequência prática.
   */

  it("duplicatas idênticas nos dois lados: contadores zerados, totais dobrados", () => {
    const d = computeReimportDiff([ex(), ex()], [pa(), pa()]);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(0);
    expect(d.changed).toHaveLength(0);
    expect(d.totalBefore).toBe(200);
    expect(d.totalAfter).toBe(200);
  });

  it("perder uma duplicata NÃO aparece nos contadores — só nos totais", () => {
    // Lote tem a mesma linha 2x (R$ 100 cada); o arquivo novo traz só 1.
    const d = computeReimportDiff([ex(), ex()], [pa()]);
    // Nenhum contador acusa a perda, porque a chave continua existindo:
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(0);
    expect(d.changed).toHaveLength(0);
    expect(hasAnyChange(d)).toBe(false);
    // A diferença só é visível nos totais — que o modal exibe.
    expect(d.totalBefore).toBe(200);
    expect(d.totalAfter).toBe(100);
    expect(d.totalBefore - d.totalAfter).toBe(100);
  });
});

/**
 * NOTA sobre o caso acima (não é uma regressão introduzida por estes testes):
 *
 * Quando o lote tem linhas repetidas com a mesma chave canônica
 * (atendimento + TUSS + médico + arquivo), `hasAnyChange` devolve `false`
 * mesmo com linhas sendo perdidas. O modal de diff usa `hasAnyChange` para
 * destacar mudanças, mas exibe `totalBefore`/`totalAfter` — então a perda
 * aparece no valor, não na contagem.
 *
 * Se linhas duplicadas legítimas forem comuns na operação (mesmo médico,
 * mesmo procedimento, mesmo atendimento, mesmo arquivo), vale contar
 * ocorrências por chave em vez de sobrescrever no Map.
 */
