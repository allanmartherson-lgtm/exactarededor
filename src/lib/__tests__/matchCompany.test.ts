/**
 * Testes da guarda de TOKEN DISTINTIVO no matchCompany.
 *
 * Contexto: analistas relatam falsos-positivos quando o nome do arquivo
 * contém um token incomum (ex.: "OTOEX", "CHAIN") e o motor de match
 * sugere uma PJ cujos tokens significativos NÃO contêm esse termo. O
 * sistema deve, nesses casos, NÃO empurrar uma sugestão automática —
 * deve ficar abaixo do MATCH_REVIEW_THRESHOLD para que o painel peça
 * seleção manual, evitando que o analista gaste tempo desfazendo
 * sugestões obviamente erradas.
 */
import { describe, it, expect } from "vitest";
import {
  matchCompany,
  similarity,
  MATCH_AUTO_THRESHOLD,
  MATCH_REVIEW_THRESHOLD,
  stripPaymentTypeTerms,
  type CompanyRow,
} from "../parsePaymentFile";

const companies: CompanyRow[] = [
  { id: "c-bsb", name: "BSB Otorrino Servicos de Saude LTDA", aliases: [] },
  { id: "c-cordeiro", name: "Cordeiro e Moura Servicos Medicos LTDA", aliases: [] },
  { id: "c-castro", name: "Castro Almeida Ortopedia e Traumatologia LTDA", aliases: [] },
  { id: "c-chain", name: "Chain Villar LTDA", aliases: [] },
];

describe("matchCompany — guarda de token distintivo", () => {
  it('não auto-sugere quando o token âncora do arquivo ("OTOEX") não existe em NENHUM candidato', () => {
    const { company, score } = matchCompany("Otoex Clinica Servicos Medicos", companies);
    // Pode existir um best (não-nulo), mas o score precisa ficar abaixo do
    // limiar de revisão — força painel de seleção manual.
    expect(score).toBeLessThan(MATCH_REVIEW_THRESHOLD);
    if (company) expect(company.id).not.toBe("c-bsb");
  });

  it('não auto-sugere "CHAIN VILLAR" como "Cordeiro e Moura"', () => {
    const s = similarity(
      "CHAIN VILLAR LTDA",
      "Cordeiro e Moura Servicos Medicos LTDA",
    );
    expect(s).toBeLessThan(MATCH_REVIEW_THRESHOLD);
  });

  it('match exato continua sendo auto-aceito ("CHAIN VILLAR LTDA" → c-chain)', () => {
    const { company, score } = matchCompany("CHAIN VILLAR LTDA", companies);
    expect(company?.id).toBe("c-chain");
    expect(score).toBeGreaterThanOrEqual(MATCH_AUTO_THRESHOLD);
  });

  it("alias cadastrado resgata mesmo nomes muito distintos", () => {
    const withAlias: CompanyRow[] = [
      { id: "c-bsb", name: "BSB Otorrino Servicos de Saude LTDA", aliases: ["OTOEX"] },
    ];
    const { company, score } = matchCompany("OTOEX", withAlias);
    expect(company?.id).toBe("c-bsb");
    expect(score).toBeGreaterThanOrEqual(MATCH_AUTO_THRESHOLD);
  });

  it("variações ortográficas leves não passam mais no automático nem geram sugestão sem alias exato", () => {
    // "Otorrino" ≈ "Otorhino" via Levenshtein em tokens ≥6 chars — score fica
    // acima do antigo REVIEW (0.55) mas abaixo do novo (0.90). Política atual:
    // sem alias explícito, o arquivo cai como "sem PJ" (stand-by) e o analista
    // vincula manualmente para evitar falso-positivo silencioso.
    const s = similarity(
      "BSB Otorhino Servicos Saude",
      "BSB Otorrino Servicos de Saude LTDA",
    );
    expect(s).toBeLessThan(MATCH_AUTO_THRESHOLD);
    expect(s).toBeLessThan(MATCH_REVIEW_THRESHOLD);
  });
});

describe("extractCompanyFromFilename — sufixo de conteúdo", () => {
  it('remove "- Parecer Adulto" para não colidir com alias de outra marca', async () => {
    const { extractCompanyFromFilename } = await import("../parsePaymentFile");
    expect(
      extractCompanyFromFilename("CABRAL LENZA SERVICOS MEDICOS LTDA - Parecer Adulto.xlsx"),
    ).toBe("CABRAL LENZA SERVICOS MEDICOS LTDA");
  });

  it("marca distinta com o mesmo sufixo não vira sugestão automática", async () => {
    const { extractCompanyFromFilename } = await import("../parsePaymentFile");
    const raw = extractCompanyFromFilename("CABRAL LENZA SERVICOS MEDICOS LTDA - Parecer Adulto.xlsx");
    const { score } = matchCompany(raw, [
      {
        id: "c-canto",
        name: "CANTO NERY SERVICOS MEDICOS LTDA",
        aliases: ["CANTO NERY SERVICOS MEDICOS LTDA - Parecer Adulto"],
      },
    ]);
    expect(score).toBeLessThan(MATCH_REVIEW_THRESHOLD);
  });
});

describe("stripPaymentTypeTerms — tipo de pagamento não entra no match", () => {
  const companies = [
    { id: "1", name: "CABRAL LENZA SERVICOS MEDICOS LTDA", document: null, aliases: [] },
    { id: "2", name: "CANTO NERY SERVICOS MEDICOS LTDA", document: null, aliases: [] },
  ] as never;

  it("remove o tipo em prefixo, meio e sufixo", () => {
    expect(stripPaymentTypeTerms("PARECER ADULTO CABRAL LENZA")).toBe("CABRAL LENZA");
    expect(stripPaymentTypeTerms("CABRAL LENZA VISITA")).toBe("CABRAL LENZA");
    expect(stripPaymentTypeTerms("CABRAL - CENTRO CIRURGICO - LENZA")).toBe("CABRAL LENZA");
  });

  it("nunca devolve vazio quando o nome é só tipo de pagamento", () => {
    expect(stripPaymentTypeTerms("Parecer Adulto")).toBe("Parecer Adulto");
  });

  it("casa a PJ real mesmo com o tipo colado no nome do arquivo", () => {
    const r = matchCompany("PARECER ADULTO CABRAL LENZA 03-2026.xlsx", companies);
    expect(r.company?.id).toBe("1");
    expect(r.score).toBeGreaterThanOrEqual(0.9);
  });

  it("não infla score entre PJs distintas que compartilham o tipo", () => {
    const r = matchCompany("PARECER ADULTO NOME QUE NAO EXISTE LTDA.xlsx", companies);
    expect(r.score).toBeLessThan(0.9);
  });
});
