// Preview de regra para itens "Faltou pagar" (TVR).
//
// Estima o valor que a regra prevista pagaria HOJE para um item que não
// apareceu no lote — usando a última regra aplicada para (médico + TUSS).
// É intencionalmente conservador: só devolve valor quando os dados básicos
// permitem um cálculo determinístico. Caso contrário, devolve null e o
// consumidor cai para o fallback (valor bruto TASY).
//
// Escopo desta fase:
//   · percentual_sobre_convenio → convenio_percentage × valor_total_tasy
//     (com role auxiliar respeitando aux_first/aux_second/instrumentador)
//   · valor_fixo                → fixed_amount × qtd_tasy
//   · exclusao                  → 0
//   · pacote / tabela_diferenciada / bonus → não suportado (undefined)
//
// Fase 2 cobrirá pacote/tabela_diferenciada (dependem de reference table
// + porte do convênio). Por enquanto, esses casos mantêm o fallback bruto.

export type TvrRulePreviewInput = {
  calculation_type?: string | null;
  fixed_amount?: number | null;
  convenio_percentage?: number | null;
  auxiliary_pct?: number | null;
  aux_first_pct?: number | null;
  aux_second_pct?: number | null;
  instrumentador_pct?: number | null;
  valor_total_tasy: number;
  qtd_tasy: number;
  funcao?: string | null;
};

export type TvrRulePreviewOutput = {
  valor: number | null;
  tipo_analise: "valor" | "quantidade" | null;
  source: "regra" | "bruto";
  reason?: string;
};

type RoleKind = "principal" | "primeiro_aux" | "segundo_aux" | "instrumentador" | "auxiliar_generico";

/** Mapeia a string de função do TASY para um papel canônico. */
export function classifyRoleForPreview(funcao?: string | null): RoleKind {
  const raw = (funcao ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!raw) return "principal";
  if (raw.includes("instrument")) return "instrumentador";
  if (raw.includes("1") && raw.includes("aux")) return "primeiro_aux";
  if (raw.includes("primeiro") && raw.includes("aux")) return "primeiro_aux";
  if (raw.includes("2") && raw.includes("aux")) return "segundo_aux";
  if (raw.includes("segundo") && raw.includes("aux")) return "segundo_aux";
  if (raw.includes("aux")) return "auxiliar_generico";
  // Cirurgião, principal, anestesista, etc → tratamos como principal para
  // percentual do convênio (convenio_percentage já reflete o papel principal).
  return "principal";
}

/**
 * Retorna o percentual do convênio que se aplica ao papel do médico.
 * Devolve null se o percentual necessário não estiver cadastrado — nunca chuta.
 */
function pctForRole(input: TvrRulePreviewInput, role: RoleKind): number | null {
  const num = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  switch (role) {
    case "principal":
      return num(input.convenio_percentage);
    case "primeiro_aux":
      // Preferimos aux_first_pct; caímos para auxiliary_pct genérico se não houver.
      return num(input.aux_first_pct) ?? num(input.auxiliary_pct);
    case "segundo_aux":
      return num(input.aux_second_pct) ?? num(input.auxiliary_pct);
    case "instrumentador":
      return num(input.instrumentador_pct) ?? num(input.auxiliary_pct);
    case "auxiliar_generico":
      return num(input.auxiliary_pct);
  }
}

export function computeTvrRulePreview(input: TvrRulePreviewInput): TvrRulePreviewOutput {
  const type = (input.calculation_type ?? "").toLowerCase();

  if (!type) {
    return { valor: null, tipo_analise: null, source: "bruto", reason: "sem calculation_type" };
  }

  if (type === "exclusao") {
    return { valor: 0, tipo_analise: "valor", source: "regra" };
  }

  if (type === "percentual_sobre_convenio" || type === "percentual_convenio") {
    const role = classifyRoleForPreview(input.funcao);
    const pct = pctForRole(input, role);
    if (pct == null || !Number.isFinite(input.valor_total_tasy)) {
      return {
        valor: null,
        tipo_analise: "valor",
        source: "bruto",
        reason: `sem percentual cadastrado para papel ${role}`,
      };
    }
    // pct vem em %, normalizamos aqui.
    const valor = (pct / 100) * input.valor_total_tasy;
    return { valor: round2(valor), tipo_analise: "valor", source: "regra" };
  }

  if (type === "valor_fixo") {
    const fixed = typeof input.fixed_amount === "number" ? input.fixed_amount : null;
    if (fixed == null || !Number.isFinite(fixed)) {
      return { valor: null, tipo_analise: "quantidade", source: "bruto", reason: "sem fixed_amount" };
    }
    const qtd = Number.isFinite(input.qtd_tasy) && input.qtd_tasy > 0 ? input.qtd_tasy : 1;
    return { valor: round2(fixed * qtd), tipo_analise: "quantidade", source: "regra" };
  }

  // pacote / tabela_diferenciada / bonus: dependem de reference_table +
  // porte do convênio ou distribuição por papel. Não estimamos.
  return {
    valor: null,
    tipo_analise: "quantidade",
    source: "bruto",
    reason: `tipo ${type} não estimado nesta fase`,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
