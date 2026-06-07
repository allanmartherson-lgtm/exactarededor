import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato — conversas por empresa (Confecção e Análise).
 *
 * Cobre:
 *  1) "Fazer questionamento" não aparece no banner do card de empresa do lote.
 *  2) FAB "Conversas" e thread inline são as únicas entradas — auto-roteadas pela PJ.
 *  3) Ação rápida "Chamar supervisor" existe na thread, chama RPC `call_supervisor`
 *     com o `stage` correto (confeccao/analise) e nenhum dos modos afeta o outro.
 */
const groupCard = readFileSync(
  resolve(__dirname, "../PaymentGroupCard.tsx"),
  "utf8",
);
const thread = readFileSync(
  resolve(__dirname, "../CompanyQuestionsThread.tsx"),
  "utf8",
);
const companyPage = readFileSync(
  resolve(__dirname, "../../../pages/CompanyAnalysis.tsx"),
  "utf8",
);

describe("PaymentGroupCard · sem 'Fazer questionamento'", () => {
  it("não renderiza botão 'Fazer questionamento' no banner da empresa", () => {
    // Permite apenas em comentários ({/* ... */} ou //); proíbe JSX visível.
    const stripped = groupCard
      .replace(/\/\*[\s\S]*?\*\//g, "") // /* ... */
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // {/* JSX comments */}
      .replace(/^\s*\/\/.*$/gm, ""); // // line comments
    expect(stripped).not.toMatch(/Fazer questionamento/);
  });

  it("não importa nem usa MessageCircleQuestion para esse botão", () => {
    expect(groupCard).not.toMatch(/<MessageCircleQuestion[^>]*\/?>\s*\n?\s*Fazer questionamento/);
  });
});

describe("CompanyAnalysis · auto-roteamento de conversa pela PJ", () => {
  it("monta CompanyQuestionsThread com companyGroupId={groupId} (PJ correta)", () => {
    expect(companyPage).toMatch(
      /<CompanyQuestionsThread[\s\S]*?paymentId=\{id\}[\s\S]*?companyGroupId=\{groupId\}/,
    );
  });

  it("propaga analysisMode='confeccao' quando em modo confecção, 'analise' caso contrário", () => {
    expect(companyPage).toMatch(/analysisMode=\{isConfeccao\s*\?\s*"confeccao"\s*:\s*"analise"\}/);
  });

  it("FAB QuestionsFab é único entry-point de conversa por empresa", () => {
    expect(companyPage).toMatch(/<QuestionsFab[\s\S]*?onClick=\{scrollToQuestions\}/);
  });

  it("thread inline existe sempre (hideIfEmpty=false) — analista pode iniciar conversa", () => {
    expect(companyPage).toMatch(/<CompanyQuestionsThread[\s\S]*?hideIfEmpty=\{false\}/);
  });
});

describe("CompanyQuestionsThread · ação 'Chamar supervisor'", () => {
  it("expõe botão 'Chamar supervisor' (data-testid=call-supervisor-btn)", () => {
    expect(thread).toMatch(/data-testid="call-supervisor-btn"/);
    expect(thread).toMatch(/Chamar supervisor/);
  });

  it("invoca RPC `call_supervisor` com payment_id, company_group_id e stage", () => {
    expect(thread).toMatch(/\.rpc\(\s*"call_supervisor"\s*,\s*\{[\s\S]*?p_payment_id:[\s\S]*?p_company_group_id:[\s\S]*?p_stage:\s*analysisMode/);
  });

  it("aceita analysisMode 'confeccao' | 'analise' (sem default que mascare o modo)", () => {
    expect(thread).toMatch(/analysisMode\?:\s*"confeccao"\s*\|\s*"analise"/);
  });

  it("mostra etapa atual na descrição do diálogo (Confecção/Análise)", () => {
    expect(thread).toMatch(/analysisMode === "confeccao" \? "Confecção" : "Análise"/);
  });

  it("permite que analista responda na thread (não fica restrito a validador/diretor)", () => {
    expect(thread).toMatch(/canReply\s*=[\s\S]*?roles\.includes\("analista"\)/);
  });

  it("destaca mensagens de acionamento com badge 'Supervisor acionado'", () => {
    expect(thread).toMatch(/SUPERVISOR_PREFIX_RE\s*=\s*\/\^\\\[Supervisor acionado · \(Confecção\|Análise\)\\\]/);
    expect(thread).toMatch(/Supervisor acionado<\/Badge>|>\s*Supervisor acionado\s*</);
  });
});

describe("Não-regressão · modo análise não é contaminado", () => {
  it("nenhuma referência a 'confeccao' aparece nas linhas que decidem disparar RPC ou autorização", () => {
    // analysisMode é passado como prop; o componente não muda comportamento por modo
    // além do label/stage enviado ao backend. Não pode haver gating extra do tipo
    // "if (isConfeccao) skipReply" etc.
    expect(thread).not.toMatch(/if\s*\(\s*analysisMode\s*===\s*"confeccao"\s*\)\s*return/);
    expect(thread).not.toMatch(/analysisMode\s*===\s*"confeccao"\s*&&\s*!canReply/);
  });
});
