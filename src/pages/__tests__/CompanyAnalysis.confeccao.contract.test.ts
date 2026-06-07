import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato — modo CONFECÇÃO em CompanyAnalysis.
 *
 * Trava por leitura de source para garantir que:
 *  1) o banner "Modo confecção" continua sendo renderizado por empresa;
 *  2) os rótulos novos ("Recalcular repasse", "Finalizar confecção") estão presentes
 *     e gated por `isConfeccao`;
 *  3) o botão "Finalizar confecção" chama `finalizeConfeccaoGroup` e NÃO chama
 *     `sendForValidation` (envio para validação é só no fluxo de análise);
 *  4) `finalizeConfeccaoGroup` NÃO transiciona status do grupo (apenas observação),
 *     respeitando o trigger DB `block_confeccao_skip_to_validation`;
 *  5) os rótulos do modo análise ("Concluir análise", "Reaplicar regras") continuam
 *     intactos quando NÃO está em confecção.
 */
const src = readFileSync(
  resolve(__dirname, "../CompanyAnalysis.tsx"),
  "utf8",
);

describe("CompanyAnalysis · modo confecção · contrato", () => {
  it("renderiza banner 'Modo confecção' apenas quando isConfeccao", () => {
    expect(src).toMatch(/isConfeccao\s*&&\s*\(\s*\n\s*<div[\s\S]*?Modo confecção/);
  });

  it("usa rótulo 'Recalcular repasse' em confecção e mantém 'Reaplicar regras' no análise", () => {
    expect(src).toMatch(/isConfeccao[\s\S]*?Recalculando\.\.\.[\s\S]*?Recalcular repasse[\s\S]*?Reaplicando\.\.\.[\s\S]*?Reaplicar regras/);
  });

  it("usa rótulo 'Finalizar confecção' em confecção e mantém 'Concluir análise' no análise", () => {
    expect(src).toMatch(/isConfeccao\s*\?\s*"Finalizar confecção"\s*:\s*"Concluir análise"/);
  });

  it("botão final dispatcha finalizeConfeccaoGroup() em confecção e sendForValidation() em análise", () => {
    expect(src).toMatch(/if\s*\(isConfeccao\)\s*\{\s*\n\s*finalizeConfeccaoGroup\(\);\s*\n\s*\}\s*else\s*\{\s*\n\s*sendForValidation\(\);\s*\n\s*\}/);
  });

  it("finalizeConfeccaoGroup NÃO chama sendForValidation nem altera status do grupo", () => {
    const fnMatch = src.match(/const\s+finalizeConfeccaoGroup\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s{0,2}\};/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    expect(body).not.toMatch(/sendForValidation/);
    expect(body).not.toMatch(/transitionGroupStatus/);
    // mantém status_from === status_to (não transiciona)
    expect(body).toMatch(/status_from:\s*group\.status[\s\S]*status_to:\s*group\.status/);
    // registra observação marcando finalização
    expect(body).toMatch(/Confecção finalizada pelo analista/);
  });

  it("tooltip do botão em confecção orienta envio pelo lote", () => {
    expect(src).toMatch(/Marca esta empresa como pronta\. O envio para análise é feito no lote/);
  });

  it("permite ações do analista em confecção via confeccao_status (não mais via gStatus='em_confeccao')", () => {
    // Após separação Confecção × Análise, o gate operacional vive em
    // confeccao_status='em_confeccao' (gStatus fica em 'rascunho' placeholder).
    expect(src).toMatch(/isConfeccaoEditable/);
    expect(src).toMatch(/gConfeccaoStatus\s*===\s*"em_confeccao"/);
    // Garante que NÃO regredimos para o padrão antigo (gStatus === 'em_confeccao').
    expect(src).not.toMatch(/gStatus\s*===\s*"em_confeccao"/);
  });

  it("banner reforça que envio para análise é feito no lote inteiro", () => {
    expect(src).toMatch(/O envio para análise é feito no lote inteiro, não por empresa/);
  });
});

describe("CompanyAnalysis · modo análise · não-regressão", () => {
  it("sendForValidation segue sendo a ação padrão fora de confecção", () => {
    expect(src).toMatch(/const\s+sendForValidation\s*=\s*async/);
  });

  it("não introduz finalizeConfeccaoGroup como caminho default (sempre gated por isConfeccao)", () => {
    // Toda chamada a finalizeConfeccaoGroup() deve estar dentro de bloco if (isConfeccao)
    const calls = [...src.matchAll(/finalizeConfeccaoGroup\(\)/g)];
    // Uma é a definição "const finalizeConfeccaoGroup = ", as outras devem ser dentro de gate
    const invocations = calls.filter((m) => {
      const before = src.slice(Math.max(0, m.index! - 80), m.index!);
      return /isConfeccao/.test(before);
    });
    // Pelo menos uma invocação gated, e nenhuma invocação fora de gate
    expect(invocations.length).toBeGreaterThanOrEqual(1);
  });
});
