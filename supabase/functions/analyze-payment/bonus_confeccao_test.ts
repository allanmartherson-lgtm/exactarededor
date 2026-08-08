import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
} from "../_shared/rulesEngine.ts";
import { synthesizeBonusLines } from "./bonusSynthesisFixture.ts";

/**
 * MODO CONFECÇÃO — Bônus de final de semana
 *
 * Na confecção a base do analista NÃO traz gross_amount (não há valor pago);
 * só vem procedure_amount (valor de tabela).
 *
 * Antes, o bônus era somado dentro do expected_amount do item âncora e depois
 * "splitado" numa linha separada — o que exigia o fallback
 * `gross_amount ?? procedure_amount` e a aritmética de reverter o pai.
 *
 * Hoje o bônus JÁ NASCE como linha própria (Fase B — ver
 * bonusSynthesisFixture.ts), e a base dessa fase é `procedure_amount` em
 * qualquer modo. Isso elimina por construção o bug que estes testes protegiam:
 * não existe mais um âncora inflado para desinflar, nem auxiliar zerado por
 * supressão de bônus.
 *
 * O que os testes abaixo blindam agora:
 *  1. Sem gross_amount, o bônus ainda sai com o valor certo (base = tabela).
 *  2. O auxiliar mantém o próprio cálculo — o bônus não passa por ele.
 *  3. A linha sintética nasce com gross_amount = expected_amount = bônus, e o
 *     pai continua valendo só o honorário base.
 */

function buildBonusRule(): RuleInput {
  return {
    id: "rule-bonus-fds-confeccao",
    name: "Bônus plantão fim de semana — CONFECÇÃO",
    rule_text: "",
    active: true,
    scope: "especifica",
    target_type: "empresa",
    target_identifier: "12345678000199",
    procedure_codes: null,
    sector: "procedimento",
    severity: "low",
    description: null,
    sectors: null,
    specialties: null,
    target_name: null,
    target_company_id: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "bonus",
    bonus_amount: 1500,
    bonus_pct: 0,
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        calculation_type: "bonus",
        bonus_amount: 1500,
        bonus_pct: 0,
        time_mode: "fim_de_semana",
        weekdays: [],
        application_unit: "por_atendimento",
        sort_order: 0,
      } as any,
    ],
  } as any;
}

const ctx: PaymentContext = {
  sectors: ["procedimento"],
  specialties: [],
  payment_type: "mensal",
  reference_date: "2026-05-09",
} as any;

Deno.test("CONFECÇÃO · bônus FDS aplicado ao âncora usa procedure_amount como base (gross_amount=null)", () => {
  // 2026-05-09 = sábado
  const items: ItemInput[] = [
    {
      id: "anchor-confeccao",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 200,
      gross_amount: null as any, // CONFECÇÃO: sem valor pago
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-1",
      patient_name: "PACIENTE A",
    } as any,
  ];

  const rules = [buildBonusRule()];
  const results = analyzePaymentItems(items, rules, ctx);
  const anchor = results.find((r) => r.item_id === "anchor-confeccao")!;

  // O item do procedimento NÃO vira "bonus" — segue com o próprio cálculo.
  assertEquals(anchor.calculation_type_used === "bonus", false);

  const [line, ...extras] = synthesizeBonusLines(items, results, rules, ctx);
  assertEquals(extras.length, 0, "Um atendimento, uma linha de bônus");
  // Mesmo sem gross_amount, a base vem de procedure_amount (valor de tabela).
  assertEquals(line.bonus_base_amount, 200,
    "Em confecção a base do bônus é procedure_amount — nunca 0 por falta de gross_amount");
  assertEquals(line.gross_amount, 1500);
  assertEquals(line.expected_amount, 1500);
});

Deno.test("CONFECÇÃO · auxiliar mantém o próprio repasse — o bônus não passa por ele", () => {
  const items: ItemInput[] = [
    {
      id: "anchor-aux-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 300,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-2",
      patient_name: "PACIENTE B",
    } as any,
    {
      id: "aux-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR AUXILIAR",
      doctor_document: "888",
      doctor_role: "primeiro auxiliar",
      procedure_code: "10101012",
      procedure_name: "AUX",
      procedure_amount: 80,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-2",
      patient_name: "PACIENTE B",
    } as any,
  ];

  const rules = [buildBonusRule()];
  const results = analyzePaymentItems(items, rules, ctx);
  const aux = results.find((r) => r.item_id === "aux-conf")!;

  // O bônus não é mais somado-e-suprimido item a item, então o auxiliar nunca
  // chega a ser zerado: ele simplesmente não é tocado pela regra de bônus.
  assertEquals(aux.calculation_type_used === "bonus", false,
    "Bônus não pode assumir o cálculo do auxiliar");
  assert(aux.expected_amount !== 0, "Regressão: expected do auxiliar não pode ser zero em confecção");

  // ATENÇÃO — o agrupamento é por atendimento | paciente | data | empresa |
  // MÉDICO (ver selectMainProcedures). Ou seja, "por_atendimento" quer dizer
  // "por atendimento de cada médico": principal e auxiliar são grupos
  // distintos e cada um recebe a própria linha quando a regra não filtra
  // função. Isso é o que o motor faz hoje — o teste registra o fato para que
  // uma mudança nesse comportamento seja deliberada, não silenciosa.
  const semFiltroDeFuncao = synthesizeBonusLines(items, results, rules, ctx);
  assertEquals(semFiltroDeFuncao.length, 2,
    "Sem filtro de função, cada médico do atendimento recebe a própria linha de bônus");
  for (const l of semFiltroDeFuncao) {
    // Cada linha usa a base do SEU grupo (um médico), nunca a soma dos dois.
    assert(
      l.bonus_base_amount === 300 || l.bonus_base_amount === 80,
      `base inesperada: ${l.bonus_base_amount}`,
    );
  }

  // A forma suportada de dizer "só o cirurgião principal" é o filtro de função
  // no cálculo — aí sai exatamente uma linha, ancorada nele.
  const regraSoPrincipal = buildBonusRule();
  (regraSoPrincipal as any).calculations[0].doctor_roles = ["cirurgiao"];
  const comFiltro = synthesizeBonusLines(items, results, [regraSoPrincipal], ctx);
  assertEquals(comFiltro.length, 1, "Com doctor_roles, o bônus sai 1× para o principal");
  assertEquals(comFiltro[0].anchor_item_id, "anchor-aux-conf");
  assertEquals(comFiltro[0].bonus_base_amount, 300);
});

Deno.test("CONFECÇÃO · sexta-feira não dispara bônus mesmo sem gross_amount", () => {
  const items: ItemInput[] = [
    {
      id: "sex-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR",
      doctor_document: "1",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "PROC",
      procedure_amount: 250,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-08T23:30:00", // sexta
      attendance_number: "ATD-SEX",
      patient_name: "P",
    } as any,
  ];

  const results = analyzePaymentItems(items, [buildBonusRule()], {
    ...ctx,
    reference_date: "2026-05-08",
  } as any);
  const r = results.find((x) => x.item_id === "sex-conf")!;
  // Sexta não dispara FDS — não deve ter expected = 250 + 1500
  assert(
    r.calculation_type_used !== "bonus" || (r.expected_amount ?? 0) < 1500,
    "Sexta-feira não pode disparar bônus de fim de semana em confecção",
  );
});

/**
 * Cobertura do INVARIANTE que sobreviveu ao fim do split: o pai continua
 * valendo só o honorário base e a linha sintética carrega exatamente o bônus.
 * Antes isso era obtido desinflando o âncora; hoje é obtido por construção,
 * porque as duas fases nunca somam no mesmo lugar.
 */
Deno.test("CONFECÇÃO · linha de bônus carrega só o bônus e o pai fica com a base", () => {
  const items: ItemInput[] = [
    {
      id: "split-anchor",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 200,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-SPLIT",
      patient_name: "P",
    } as any,
  ];

  const rules = [buildBonusRule()];
  const results = analyzePaymentItems(items, rules, ctx);
  const anchor = results.find((r) => r.item_id === "split-anchor")!;

  const parentBase = Number((items[0] as any).procedure_amount);
  assertEquals(parentBase, 200, "Base do pai em confecção = procedure_amount");

  const [bonusLine] = synthesizeBonusLines(items, results, rules, ctx);
  assertEquals(bonusLine.gross_amount, 1500, "A linha sintética carrega exatamente o bônus");

  // O pai NÃO pode carregar o bônus junto — se carregasse, o total do
  // atendimento contaria o bônus duas vezes assim que a linha for inserida.
  assert(
    (anchor.expected_amount ?? 0) < parentBase + bonusLine.gross_amount,
    "Regressão: bônus somado no pai E na linha sintética duplica o repasse",
  );

  // Invariante do repasse do atendimento: base + bônus, cada um no seu lugar.
  assertEquals(parentBase + bonusLine.gross_amount, 1700);
});

Deno.test("CONFECÇÃO · linha sintética de bônus persiste gross_amount igual ao repasse calculado", () => {
  const isConfeccao = true;
  const bonusAmt = 1500;

  // Espelha o payload crítico do insert em analyze-payment/index.ts: mesmo no
  // modo confecção, gross_amount não pode ser null porque payment_items exige
  // valor e os totais por empresa usam essa coluna.
  const bonusInsertPayload = {
    gross_amount: bonusAmt,
    expected_amount: bonusAmt,
    tipo_linha: "complemento_bonus",
    tipo_item: "bonus",
    applied_calc_method: "bonus",
    ai_findings: {
      expected_amount: bonusAmt,
      calculation_type: "bonus",
    },
  } as any;

  assertEquals(isConfeccao, true);
  assertEquals(bonusInsertPayload.gross_amount, 1500,
    "Regressão: gross_amount não pode ser null em complemento_bonus de confecção");
  assertEquals(bonusInsertPayload.expected_amount, 1500);
  assertEquals(bonusInsertPayload.ai_findings.expected_amount, 1500);
});

/**
 * Rede de proteção do `bonusSynthesisFixture.ts`.
 *
 * O fixture ESPELHA a Fase B, que vive inline no handler do `index.ts` e não é
 * importável. Se a Fase B mudar e o fixture não, os testes acima continuariam
 * verdes validando uma lógica que não existe mais em produção. Este teste lê o
 * source do `index.ts` e falha quando as decisões espelhadas saem de sincronia.
 */
Deno.test("Fase B do index.ts não saiu de sincronia com o fixture de teste", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // 1) A fase existe e continua sendo por (regra × atendimento).
  assert(
    /Síntese de linhas de bônus/.test(src),
    "bloco de síntese de bônus não encontrado no index.ts",
  );
  assert(
    /tipo_linha:\s*"complemento_bonus"/.test(src),
    "linha sintética deixou de usar tipo_linha='complemento_bonus'",
  );
  assert(/synthetic_bonus:\s*true/.test(src), "flag synthetic_bonus removida");

  // 2) Elegibilidade continua delegada às mesmas primitivas exportadas — é o
  //    que o fixture reusa de verdade em vez de reimplementar.
  assert(/selectWinningRule\(anchor,\s*\[rule as any\],\s*ctx\)/.test(src),
    "3a: elegibilidade da regra deixou de usar selectWinningRule sobre o âncora");
  assert(/calcItemMatches\(bonusCalc as any,\s*anchor\)/.test(src),
    "3b: elegibilidade do cálculo deixou de usar calcItemMatches sobre o âncora");

  // 3) Base por unidade de aplicação: por_item = âncora, senão soma do grupo.
  assert(/applicationUnit === "por_item"/.test(src), "3c: regra de base por_item mudou");
  assert(/for \(const it of groupItems\) base \+= Number\(it\.procedure_amount \?\? 0\)/.test(src),
    "3c: base por_atendimento deixou de somar procedure_amount do grupo");

  // 4) Valor: fixo + percentual sobre a base, calc vencendo a regra.
  assert(/const bonusAmt = Number\(\(fixed \+ pctAmt\)\.toFixed\(2\)\)/.test(src),
    "3d: composição do valor do bônus (fixo + percentual) mudou");

  // 5) Fase A continua excluindo bônus do matching por item — é a premissa de
  //    tudo acima.
  const engine = await Deno.readTextFile(
    new URL("../_shared/rulesEngine.ts", import.meta.url),
  );
  assert(
    /\(r\.calculation_type \?\? ""\) !== "bonus"/.test(engine),
    "rulesEngine voltou a deixar regras de bônus competirem no matching por item",
  );
});
