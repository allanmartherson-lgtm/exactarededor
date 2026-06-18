/**
 * Constrói o filtro PostgREST `.or(...)` que define QUAIS regras carregar
 * quando o motor está analisando UMA empresa específica do pagamento.
 *
 * Regra de ouro: o motor (`selectWinningRule` em `rulesEngine.ts`) é quem decide
 * o match final via `targetsDoctor` / `targetsCompany` / `targetsGroup`. Esta
 * função SÓ pode descartar regras que comprovadamente NUNCA poderiam vencer
 * para essa empresa. Quando em dúvida → CARREGA.
 *
 * Branches carregadas:
 *  1. master                  → regras globais (motor decide por setor/sem setor)
 *  2. grupo                   → TODAS, pois `group_doctors` segue o médico em
 *                               qualquer PJ; `group_company_links` é checado
 *                               pelo motor.
 *  3. especifica/medico       → TODAS (sem filtro por PJ), pois uma regra
 *                               específica de médico vale independentemente
 *                               da PJ pela qual ele esteja faturando
 *                               (ex.: "Repasse Dra Joana" sem target_company_id).
 *                               O motor decide via `targetsDoctor` (id/CRM/nome).
 *  4. especifica/empresa      → APENAS as cujo `target_company_id` casa.
 *
 * IMPORTANTE: NÃO adicione filtros por `calculation_type` aqui — `informativo`
 * NÃO deve ser excluído no SELECT (a regra pode ter cálculos filhos 1:N com
 * tipos calculáveis; `applyCalculation` resolve o vencedor).
 *
 * Use também em qualquer outro ponto que recarregue `rules` para o mesmo
 * escopo (snapshot do cache, retry, etc.) — duplicar o OR à mão é a causa
 * raiz de regressões silenciosas vistas no histórico do projeto.
 */
export function buildScopedRulesOr(scopedCompanyId: string): string {
  return [
    "scope.eq.master",
    "scope.eq.grupo",
    "and(scope.eq.especifica,target_type.eq.medico)",
    `and(scope.eq.especifica,target_company_id.eq.${scopedCompanyId})`,
  ].join(",");
}
