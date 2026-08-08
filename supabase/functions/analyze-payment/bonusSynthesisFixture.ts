/**
 * Fixture de TESTE que espelha a **Fase B** de `analyze-payment/index.ts` —
 * a síntese das linhas de bônus.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * Regras de bônus deixaram de competir no matching por-item (Fase A, dentro de
 * `analyzePaymentItems`). O motor filtra `calculation_type === "bonus"` logo na
 * entrada, porque deixar um bônus vencer um TUSS rotulava o item como "bonus"
 * na conciliação e sequestrava o cálculo original do procedimento.
 *
 * O bônus passou a ser emitido como uma LINHA PRÓPRIA
 * (`tipo_linha='complemento_bonus'`, `synthetic_bonus=true`), 1× por
 * (regra × atendimento), ancorada no cirurgião principal.
 *
 * Essa síntese vive inline dentro do handler HTTP do `index.ts` e não é
 * importável. Este fixture reproduz a MESMA sequência de decisões usando as
 * primitivas exportadas do motor (`selectWinningRule`, `calcItemMatches`), de
 * forma que os testes exercitem a lógica real de elegibilidade e só o
 * "encanamento" seja replicado.
 *
 * ⚠️ ESTE ARQUIVO PODE SAIR DE SINCRONIA COM O index.ts.
 * A rede de proteção contra isso é o teste de contrato de source em
 * `bonus_confeccao_test.ts` ("Fase B do index.ts não saiu de sincronia..."),
 * que lê o index.ts e falha se os trechos espelhados aqui mudarem.
 *
 * NÃO é usado em produção — só por testes.
 */
import {
  calcItemMatches,
  selectWinningRule,
  type AnalysisResult,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "../_shared/rulesEngine.ts";

export interface SyntheticBonusLine {
  /** Chave do atendimento que originou a linha. */
  attendance_group_key: string;
  /** Item âncora (cirurgião principal do procedimento principal). */
  anchor_item_id: string;
  applied_rule_id: string | null;
  application_unit: string;
  /** Base usada no percentual — soma do grupo ou só o âncora. */
  bonus_base_amount: number;
  bonus_fixed_amount: number;
  bonus_pct_amount: number;
  /** Valor final da linha — vai para gross_amount E expected_amount. */
  gross_amount: number;
  expected_amount: number;
  tipo_linha: "complemento_bonus";
  tipo_item: "bonus";
  synthetic_bonus: true;
}

const isCirurgiaoPrincipal = (role: string | null | undefined): boolean => {
  const s = String(role ?? "").toLowerCase();
  return /cirurg/.test(s) && !/aux/.test(s) && !/instrument/.test(s);
};

/**
 * Roda a Fase B sobre os itens e o resultado da Fase A.
 *
 * @param items      itens do lote (mesma lista passada ao `analyzePaymentItems`)
 * @param results    saída da Fase A — fornece attendance_group_key / is_main_procedure
 * @param rules      todas as regras (as de bônus são selecionadas aqui dentro)
 */
export function synthesizeBonusLines(
  items: ItemInput[],
  results: AnalysisResult[],
  rules: RuleInput[],
  ctx?: PaymentContext,
): SyntheticBonusLine[] {
  const out: SyntheticBonusLine[] = [];

  // 1) Regras de bônus — no nível da regra OU de algum cálculo.
  const activeBonusRules = rules.filter((r) => {
    if (((r as { calculation_type?: string }).calculation_type ?? "") === "bonus") return true;
    const cs = Array.isArray(r.calculations) ? r.calculations : [];
    return cs.some((c) => ((c as { calculation_type?: string })?.calculation_type ?? "") === "bonus");
  });
  if (activeBonusRules.length === 0) return out;

  // 2) Agrupa por attendance_group_key (fallback attendance_number).
  const resultByItemId = new Map<string, AnalysisResult>();
  for (const r of results) resultByItemId.set(r.item_id, r);

  const groupKeyFor = (it: ItemInput): string | null => {
    const r = resultByItemId.get((it as { id: string }).id);
    const gk = (r?.attendance_group_key as string | undefined) ?? it.attendance_number ?? null;
    return gk && String(gk).trim() ? String(gk).trim() : null;
  };

  const buckets = new Map<string, ItemInput[]>();
  for (const it of items) {
    const gk = groupKeyFor(it);
    if (!gk) continue;
    const arr = buckets.get(gk) ?? [];
    arr.push(it);
    buckets.set(gk, arr);
  }

  // Âncora: procedimento principal + cirurgião principal, com degraus de fallback.
  const groups = new Map<string, { anchor: ItemInput; groupItems: ItemInput[] }>();
  for (const [gk, arr] of buckets) {
    const withMeta = arr.map((it) => ({ it, res: resultByItemId.get((it as { id: string }).id) }));
    const anchor =
      withMeta.find((x) => x.res?.is_main_procedure && isCirurgiaoPrincipal(x.it.doctor_role)) ??
      withMeta.find((x) => x.res?.is_main_procedure) ??
      withMeta.find((x) => isCirurgiaoPrincipal(x.it.doctor_role)) ??
      withMeta[0];
    if (anchor?.it) groups.set(gk, { anchor: anchor.it, groupItems: arr });
  }

  // 3) regra × grupo.
  for (const rule of activeBonusRules) {
    const calcs = Array.isArray(rule.calculations) ? rule.calculations : [];
    const bonusCalc =
      calcs.find((c) => ((c as { calculation_type?: string })?.calculation_type ?? "") === "bonus") ?? null;

    for (const [gk, { anchor, groupItems }] of groups) {
      // 3a) elegibilidade da REGRA no âncora (escopo, convênio, setor, vias…).
      let ruleApplies = false;
      try {
        const sel = selectWinningRule(anchor, [rule], ctx as never);
        ruleApplies = !!sel?.rule && sel.rule.id === rule.id;
      } catch { ruleApplies = false; }
      if (!ruleApplies) continue;

      // 3b) elegibilidade do CÁLCULO (time_mode, weekdays, funções, feriado…).
      if (bonusCalc) {
        try {
          if (!calcItemMatches(bonusCalc, anchor).ok) continue;
        } catch { continue; }
      }

      // 3c) base conforme a unidade de aplicação.
      const applicationUnit =
        (bonusCalc as { application_unit?: string | null } | null)?.application_unit ??
        (rule as { application_unit?: string | null }).application_unit ??
        "por_atendimento";
      let base = 0;
      if (applicationUnit === "por_item") {
        base = Number(anchor.procedure_amount ?? 0);
      } else {
        for (const it of groupItems) base += Number(it.procedure_amount ?? 0);
      }

      // 3d) valor — cálculo vence a regra.
      const fixed = Number(
        ((bonusCalc as { bonus_amount?: number } | null)?.bonus_amount ??
          (rule as { bonus_amount?: number }).bonus_amount) ?? 0,
      );
      const pct = Number(
        ((bonusCalc as { bonus_pct?: number } | null)?.bonus_pct ??
          (rule as { bonus_pct?: number }).bonus_pct) ?? 0,
      );
      if (!fixed && !pct) continue; // regra mal configurada — não emite
      const pctAmt = Number((base * (pct / 100)).toFixed(2));
      const bonusAmt = Number((fixed + pctAmt).toFixed(2));
      if (!(bonusAmt > 0)) continue;

      out.push({
        attendance_group_key: gk,
        anchor_item_id: (anchor as { id: string }).id,
        applied_rule_id: rule.id ?? null,
        application_unit: applicationUnit,
        bonus_base_amount: Number(base.toFixed(2)),
        bonus_fixed_amount: Number(fixed.toFixed(2)),
        bonus_pct_amount: pctAmt,
        gross_amount: bonusAmt,
        expected_amount: bonusAmt,
        tipo_linha: "complemento_bonus",
        tipo_item: "bonus",
        synthetic_bonus: true,
      });
    }
  }

  return out;
}
