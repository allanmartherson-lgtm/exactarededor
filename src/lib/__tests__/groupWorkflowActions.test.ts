import { describe, it, expect, vi, beforeEach } from "vitest";
import { transitionGroupWorkflow } from "../groupWorkflowActions";

const updateMock = vi.fn();
const eqMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (table: string) => {
        if (table === "payment_company_groups") {
          return {
            update: (payload: unknown) => {
              updateMock(payload);
              return { eq: (col: string, val: string) => eqMock(col, val) };
            },
          };
        }
        return { select: () => ({}) };
      },
    },
  };
});

const recordObservationMock = vi.fn();
vi.mock("@/lib/observations", () => ({
  recordObservation: (input: unknown) => recordObservationMock(input),
}));

const findItemsNeedingManualReasonMock = vi.fn();
vi.mock("@/lib/manualReasonGate", () => ({
  findItemsNeedingManualReason: (paymentId: string, companyId?: string | null) =>
    findItemsNeedingManualReasonMock(paymentId, companyId),
}));

const baseParams = {
  paymentId: "pay-1",
  paymentCreatedBy: "user-creator",
  group: { id: "grp-1", status: "aguardando_validacao" as const, company_id: "co-1", company_name: "Acme" },
  userId: "user-validador",
  message: "ok",
  messagePrefix: "Encaminhado",
};

beforeEach(() => {
  updateMock.mockReset();
  eqMock.mockReset().mockResolvedValue({ error: null });
  recordObservationMock.mockReset().mockResolvedValue({ ok: true, error: "", data: null });
  findItemsNeedingManualReasonMock.mockReset().mockResolvedValue([]);
});

describe("transitionGroupWorkflow — guardas (paridade com o que existia em PaymentDetail.tsx)", () => {
  it("bloqueia quando quem chama é o criador do lote e tenta validar/aprovar (segregação de funções)", async () => {
    const res = await transitionGroupWorkflow({
      ...baseParams,
      paymentCreatedBy: "user-validador", // mesmo id de quem está chamando
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("segregation_of_duties");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("bloqueia transição fora da matriz de paymentFlow.ts (ex.: validador não pode pular pra 'aprovado')", async () => {
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aprovado",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_transition");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("bloqueia quando requireMsg=true e a mensagem está vazia", async () => {
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
      message: "   ",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_message");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("não exige mensagem quando requireMsg=false", async () => {
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
      message: "",
      requireMsg: false,
    });
    expect(res.ok).toBe(true);
  });

  it("chama onManualReasonGateNeeded e bloqueia quando há itens pendentes e o callback foi passado", async () => {
    findItemsNeedingManualReasonMock.mockResolvedValue([{ id: "item-1" }]);
    const onGate = vi.fn();
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
      onManualReasonGateNeeded: onGate,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("manual_reason_gate");
    expect(onGate).toHaveBeenCalledWith([{ id: "item-1" }]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("PULA a checagem de motivo manual quando onManualReasonGateNeeded não é passado (comportamento hoje do CompanyAnalysis.tsx)", async () => {
    findItemsNeedingManualReasonMock.mockResolvedValue([{ id: "item-1" }]);
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
    });
    expect(res.ok).toBe(true);
    expect(findItemsNeedingManualReasonMock).not.toHaveBeenCalled();
  });

  it("chama onBeforeWrite antes do UPDATE", async () => {
    const order: string[] = [];
    eqMock.mockImplementation(async () => {
      order.push("update");
      return { error: null };
    });
    const res = await transitionGroupWorkflow({
      ...baseParams,
      authorType: "validador",
      newStatus: "aguardando_aprovacao",
      onBeforeWrite: async () => {
        order.push("beforeWrite");
      },
    });
    expect(res.ok).toBe(true);
    expect(order).toEqual(["beforeWrite", "update"]);
  });
});

describe("transitionGroupWorkflow — campos gravados por papel/destino (paridade byte-a-byte com o código original)", () => {
  it("validador -> aguardando_aprovacao grava validated_by/validated_at", async () => {
    await transitionGroupWorkflow({ ...baseParams, authorType: "validador", newStatus: "aguardando_aprovacao" });
    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("aguardando_aprovacao");
    expect(payload.validated_by).toBe("user-validador");
    expect(payload.validated_at).toEqual(expect.any(String));
    expect(payload.approved_by).toBeUndefined();
  });

  // NOTA: "diretor -> aprovado" é bloqueado por canTransition() ANTES de
  // chegar no UPDATE — paymentFlow.ts:170-176 só permite
  // diretor: aguardando_aprovacao -> [aprovado_em_revisao, devolvido_analista, rejeitado].
  // Isso reproduz fielmente o código original (transitionGroup/transitionGroupStatus
  // também chamavam/deveriam chamar canTransition antes desse bloco), e é
  // consistente com o achado da auditoria: nada no app hoje escreve
  // status='aprovado' em payment_company_groups — a aprovação real do
  // diretor vai por approve_payment (RPC), que nunca passa por esta função.
  // O bloco condicional approved_by/approved_at para authorType="diretor"
  // dentro deste módulo é, portanto, código mantido por paridade com o
  // original mas inalcançável em runtime através deste caminho.
  it("diretor -> aprovado é bloqueado por canTransition (transição não coberta pela matriz do client)", async () => {
    const res = await transitionGroupWorkflow({
      ...baseParams,
      group: { ...baseParams.group, status: "aguardando_aprovacao" },
      authorType: "diretor",
      newStatus: "aprovado",
      userId: "user-diretor",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_transition");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("diretor -> rejeitado grava rejected_by/rejected_at/rejection_reason", async () => {
    await transitionGroupWorkflow({
      ...baseParams,
      group: { ...baseParams.group, status: "aguardando_aprovacao" },
      authorType: "diretor",
      newStatus: "rejeitado",
      userId: "user-diretor",
      message: "documentação insuficiente",
    });
    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("rejeitado");
    expect(payload.rejected_by).toBe("user-diretor");
    expect(payload.rejection_reason).toBe("documentação insuficiente");
  });

  it("propaga erro do banco sem lançar exceção", async () => {
    eqMock.mockResolvedValue({ error: { message: "RLS negou" } });
    const res = await transitionGroupWorkflow({ ...baseParams, authorType: "validador", newStatus: "aguardando_aprovacao" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("db_error");
      expect(res.message).toBe("RLS negou");
    }
  });

  it("mensagem de observação usa o prefixo + texto, igual ao formato original '[empresa] prefixo: texto'", async () => {
    await transitionGroupWorkflow({ ...baseParams, authorType: "validador", newStatus: "aguardando_aprovacao" });
    const obsInput = recordObservationMock.mock.calls[0][0] as Record<string, unknown>;
    expect(obsInput.message).toBe("[Acme] Encaminhado: ok");
    expect(obsInput.status_from).toBe("aguardando_validacao");
    expect(obsInput.status_to).toBe("aguardando_aprovacao");
  });
});
