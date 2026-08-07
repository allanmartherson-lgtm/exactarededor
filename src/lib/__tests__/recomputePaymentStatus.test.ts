/**
 * Garante que o status do lote calculado é consistente entre analista e
 * validador — i.e., uma única função determinística retorna o mesmo status
 * para qualquer perfil que olhe o lote, sem precisar de refresh manual.
 *
 * Cobre o bug em que `concluida_analista` deixava o lote travado em
 * `revisao_analista` para o validador enquanto o analista via
 * `aguardando_validacao`.
 */
import { describe, it, expect } from "vitest";
import {
  recomputePaymentStatus,
  type GroupStatus,
} from "../recomputePaymentStatus";
import type { PaymentStatus } from "../status";

const profiles: Array<{ name: string; current: PaymentStatus }> = [
  { name: "analista", current: "revisao_analista" },
  { name: "validador", current: "aguardando_validacao" },
  { name: "diretor", current: "aguardando_aprovacao" },
];

function runForAllProfiles(groups: GroupStatus[]) {
  return profiles.map((p) => ({
    profile: p.name,
    status: recomputePaymentStatus({ groupStatuses: groups, currentStatus: p.current }),
  }));
}

describe("recomputePaymentStatus — consistência analista↔validador", () => {
  it("retorna null quando não há grupos", () => {
    expect(
      recomputePaymentStatus({ groupStatuses: [], currentStatus: "rascunho" }),
    ).toBeNull();
  });

  it("todos os grupos concluida_analista ⇒ aguardando_validacao para todos os perfis", () => {
    const groups: GroupStatus[] = ["concluida_analista", "concluida_analista", "concluida_analista"];
    const out = runForAllProfiles(groups);
    for (const o of out) expect(o.status).toBe("aguardando_validacao");
  });

  it("mistura concluida_analista + aguardando_validacao ⇒ aguardando_validacao", () => {
    const groups: GroupStatus[] = ["concluida_analista", "aguardando_validacao"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("aguardando_validacao");
    }
  });

  it("qualquer grupo em revisao_analista ⇒ revisao_analista (mesmo com outros concluídos)", () => {
    const groups: GroupStatus[] = ["concluida_analista", "revisao_analista", "aguardando_validacao"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("revisao_analista");
    }
  });

  it("validador devolve para analista ⇒ devolvido_analista para todos", () => {
    const groups: GroupStatus[] = ["devolvido_analista", "concluida_analista"];
    // Caveat: revisao tem prioridade — aqui não há revisao, então devolvido vence concluida.
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("devolvido_analista");
    }
  });

  it("analista devolve novamente para validação ⇒ aguardando_validacao para todos os perfis", () => {
    // Cenário do bug reportado: analista assumiu lote devolvido e re-enviou.
    const groups: GroupStatus[] = ["concluida_analista", "concluida_analista"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("aguardando_validacao");
    }
  });

  it("em_analise_ia em qualquer grupo ⇒ em_analise_ia", () => {
    const groups: GroupStatus[] = ["em_analise_ia", "aguardando_validacao", "aprovado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("em_analise_ia");
    }
  });

  it("job em andamento + status inicial ⇒ em_analise_ia (override)", () => {
    const groups: GroupStatus[] = ["concluida_analista", "concluida_analista"];
    expect(
      recomputePaymentStatus({
        groupStatuses: groups,
        currentStatus: "revisao_analista",
        hasActiveJob: true,
      }),
    ).toBe("em_analise_ia");
  });

  it("job em andamento NÃO sobrescreve status pós-validação", () => {
    const groups: GroupStatus[] = ["aguardando_aprovacao"];
    expect(
      recomputePaymentStatus({
        groupStatuses: groups,
        currentStatus: "aguardando_aprovacao",
        hasActiveJob: true,
      }),
    ).toBe("aguardando_aprovacao");
  });

  it("aguardando_aprovacao / em_questionamento ⇒ aguardando_aprovacao", () => {
    for (const groups of [
      ["aguardando_aprovacao"] as GroupStatus[],
      ["em_questionamento", "aguardando_aprovacao"] as GroupStatus[],
    ]) {
      for (const o of runForAllProfiles(groups)) {
        expect(o.status).toBe("aguardando_aprovacao");
      }
    }
  });

  it("revisao_pos_aprovacao / aprovado_em_revisao ⇒ revisao_pos_aprovacao", () => {
    const groups: GroupStatus[] = ["aprovado_em_revisao", "aprovado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("revisao_pos_aprovacao");
    }
  });

  it("concluido_validacao (módulo validação, sem etapa de diretor) ⇒ concluido_validacao", () => {
    const groups: GroupStatus[] = ["concluido_validacao", "concluido_validacao"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("concluido_validacao");
    }
  });

  it("concluido_validacao tem prioridade sobre pedido_nf_enviado (mesmo degrau de revisao_pos_aprovacao)", () => {
    const groups: GroupStatus[] = ["concluido_validacao", "pedido_nf_enviado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("concluido_validacao");
    }
  });

  it("revisao_pos_aprovacao tem prioridade sobre concluido_validacao (não deveriam coexistir na prática, mas a ordem é determinística)", () => {
    const groups: GroupStatus[] = ["aprovado_em_revisao", "concluido_validacao"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("revisao_pos_aprovacao");
    }
  });

  it("pedido_nf_enviado / nf_recebida ⇒ pedido_nf_enviado", () => {
    for (const groups of [
      ["pedido_nf_enviado"] as GroupStatus[],
      ["nf_recebida", "aprovado"] as GroupStatus[],
    ]) {
      for (const o of runForAllProfiles(groups)) {
        expect(o.status).toBe("pedido_nf_enviado");
      }
    }
  });

  it("todos arquivados ⇒ arquivado", () => {
    const groups: GroupStatus[] = ["arquivado", "arquivado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("arquivado");
    }
  });

  it("nf_conciliada coberta + restos terminais ⇒ nf_conciliada", () => {
    const groups: GroupStatus[] = ["nf_conciliada", "nf_conciliada", "pago", "cancelado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("nf_conciliada");
    }
  });

  it("todos pago ⇒ pago", () => {
    const groups: GroupStatus[] = ["pago", "pago"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("pago");
    }
  });

  it("lancado/pago + restos terminais ⇒ lancado", () => {
    const groups: GroupStatus[] = ["lancado", "pago", "cancelado", "arquivado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("lancado");
    }
  });

  it("fallback final ⇒ aguardando_aprovacao", () => {
    const groups: GroupStatus[] = ["aprovado", "cancelado", "rejeitado"];
    for (const o of runForAllProfiles(groups)) {
      expect(o.status).toBe("aguardando_aprovacao");
    }
  });

  // Propriedade-chave: o resultado independe do `currentStatus` (exceto pelo
  // override de job ativo). Garante que analista e validador SEMPRE veem o
  // mesmo status calculado para a mesma combinação de grupos.
  it("determinismo: mesmo conjunto de grupos ⇒ mesmo status para qualquer perfil", () => {
    const combos: GroupStatus[][] = [
      ["concluida_analista"],
      ["concluida_analista", "aguardando_validacao"],
      ["revisao_analista", "concluida_analista"],
      ["devolvido_analista"],
      ["aguardando_aprovacao", "aprovado"],
      ["nf_conciliada", "pago"],
      ["pago", "pago", "pago"],
      ["aprovado", "rejeitado", "cancelado"],
    ];
    for (const groups of combos) {
      const results = runForAllProfiles(groups).map((r) => r.status);
      const unique = new Set(results);
      expect(unique.size).toBe(1);
    }
  });
});
