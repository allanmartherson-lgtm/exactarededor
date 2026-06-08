import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";

/**
 * Contrato — devolução do lote ao analista (completa vs parcial).
 *
 * Garante que:
 *  1) A RPC `return_groups_to_analyst` recebeu a coluna `p_lot_level` e que
 *     o corpo da função grava UMA observação (nível do lote) quando
 *     `p_lot_level = true` e UMA POR EMPRESA quando false. Sem isso, devolver
 *     um lote de 100+ empresas polui a caixa de Conversas com mensagens
 *     idênticas em cada thread.
 *  2) O front-end (`PaymentBatchActionsFooter`) passa `p_lot_level: true`
 *     quando o usuário escolheu modo "completo" e `false` quando escolheu
 *     "parcial".
 *  3) O front-end navega para `/pagamentos` após aprovar/devolver (ações
 *     terminais do perfil atual). Questionar NÃO navega — mantém o usuário
 *     na conversa.
 *  4) O painel `ConversationsSheet` separa visualmente as threads do LOTE
 *     (company_group_id = null) das threads POR EMPRESA, com link de "Abrir
 *     empresa/lote" no header da conversa.
 */

const root = resolve(__dirname, "../../../..");

const footer = readFileSync(
  resolve(__dirname, "../PaymentBatchActionsFooter.tsx"),
  "utf8",
);

const sheet = readFileSync(
  resolve(__dirname, "../conversations/ConversationsSheet.tsx"),
  "utf8",
);

// Pega a migration mais recente que define return_groups_to_analyst.
function findMigrationWithReturnRpc(): string {
  const dir = resolve(root, "supabase/migrations");
  const files = readdirSync(dir).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(resolve(dir, files[i]!), "utf8");
    if (/CREATE OR REPLACE FUNCTION\s+public\.return_groups_to_analyst/i.test(body)) {
      return body;
    }
  }
  throw new Error("return_groups_to_analyst migration not found");
}

const migration = findMigrationWithReturnRpc();

describe("RPC return_groups_to_analyst — comportamento lote vs por empresa", () => {
  it("aceita parâmetro p_lot_level (boolean DEFAULT false)", () => {
    expect(migration).toMatch(/p_lot_level\s+boolean\s+DEFAULT\s+false/i);
  });

  it("quando p_lot_level=true, grava UMA observação com company_group_id NULL", () => {
    // Bloco do IF: insere VALUES com NULL como company_group_id.
    expect(migration).toMatch(
      /IF\s+p_lot_level\s+THEN[\s\S]*?INSERT INTO public\.payment_questions[\s\S]*?VALUES\s*\(\s*p_payment_id\s*,\s*NULL/i,
    );
  });

  it("quando p_lot_level=false, grava UMA observação por empresa (unnest)", () => {
    expect(migration).toMatch(
      /ELSE[\s\S]*?INSERT INTO public\.payment_questions[\s\S]*?FROM\s+unnest\(\s*p_group_ids\s*\)/i,
    );
  });

  it("muda status de TODAS as empresas selecionadas para devolvido_analista", () => {
    expect(migration).toMatch(
      /UPDATE public\.payment_company_groups[\s\S]*?SET\s+status\s*=\s*'devolvido_analista'[\s\S]*?WHERE\s+id\s*=\s*ANY\(p_group_ids\)/i,
    );
  });
});

describe("PaymentBatchActionsFooter · payload da RPC", () => {
  it("passa p_lot_level = (retMode === 'completo')", () => {
    expect(footer).toMatch(/p_lot_level:\s*retMode\s*===\s*["']completo["']/);
  });

  it("usa todos os IDs quando completo, e seleção do usuário quando parcial", () => {
    expect(footer).toMatch(
      /const\s+ids\s*=\s*retMode\s*===\s*["']completo["']\s*\?\s*groups\.map\(\(g\)\s*=>\s*g\.id\)\s*:\s*Array\.from\(retSelected\)/,
    );
  });

  it("não envia observação duplicada — exige mensagem mínima antes de chamar RPC", () => {
    // Garante que se a mensagem for curta, NÃO chamamos rpc — evita criar
    // múltiplas mensagens vazias por engano.
    expect(footer).toMatch(/retMessage\.trim\(\)\.length\s*<\s*10/);
  });
});

describe("PaymentBatchActionsFooter · handoff de perfil", () => {
  it("navega para /pagamentos após devolução", () => {
    // doReturn deve chamar navigate("/pagamentos") depois do toast.
    const slice = footer.slice(footer.indexOf("const doReturn"));
    expect(slice).toMatch(/navigate\(["']\/pagamentos["']\)/);
  });

  it("navega para /pagamentos após aprovação/encaminhamento", () => {
    const slice = footer.slice(footer.indexOf("const doApprove"));
    expect(slice).toMatch(/navigate\(["']\/pagamentos["']\)/);
  });

  it("NÃO navega após questionar — usuário permanece na conversa", () => {
    const slice = footer.slice(footer.indexOf("const doQuestion"), footer.indexOf("const doReturn"));
    expect(slice).not.toMatch(/navigate\(["']\/pagamentos["']\)/);
  });

  it("importa useNavigate de react-router-dom", () => {
    expect(footer).toMatch(/import\s*\{\s*useNavigate\s*\}\s*from\s*["']react-router-dom["']/);
  });
});

describe("ConversationsSheet · separação visual lote vs empresa", () => {
  it("separa filteredThreads em loteThreads e empresaThreads", () => {
    expect(sheet).toMatch(/loteThreads\s*=\s*filteredThreads\.filter\(\(t\)\s*=>\s*!t\.root\.company_group_id\)/);
    expect(sheet).toMatch(/empresaThreads\s*=\s*filteredThreads\.filter\(\(t\)\s*=>\s*!!t\.root\.company_group_id\)/);
  });

  it("renderiza section header 'Observações do lote' quando há thread de lote", () => {
    expect(sheet).toMatch(/Observações do lote/);
  });

  it("renderiza section header 'Por empresa' quando há thread por empresa", () => {
    expect(sheet).toMatch(/Por empresa/);
  });

  it("oferece link 'Abrir empresa →' / 'Abrir lote →' no header da conversa", () => {
    expect(sheet).toMatch(/Abrir empresa →/);
    expect(sheet).toMatch(/Abrir lote →/);
  });

  it("link aponta para rota correta: /pagamentos/:id/empresa/:groupId quando há company_group_id", () => {
    expect(sheet).toMatch(/\/pagamentos\/\$\{paymentId\}\/empresa\/\$\{thread\.root\.company_group_id\}/);
  });
});
