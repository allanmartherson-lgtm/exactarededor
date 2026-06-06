/**
 * Testes do useQueueNotifications.
 *
 * Foco: gating por papel.
 *  - Somente analista (ou admin) recebe toast/sino para:
 *      • novas pendências do prestador
 *      • novos lotes em revisao_analista / devolvido_analista
 *  - Validador só é notificado em aguardando_validacao.
 *  - Diretor só é notificado em aguardando_aprovacao.
 *  - Diretor/validador NÃO são notificados de pendências do prestador
 *    nem de transições de revisao_analista.
 *
 * Estratégia: mockamos supabase.channel para capturar cada handler
 * registrado por (table, event) e disparamos manualmente.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AppRole } from "@/lib/status";

const {
  toastMock,
  navigateMock,
  notificationStoreAdd,
  handlerMap,
  supabaseMock,
  authState,
} = vi.hoisted(() => {
  const toastMock = { info: vi.fn(), warning: vi.fn(), success: vi.fn() };
  const navigateMock = vi.fn();
  const notificationStoreAdd = vi.fn();
  type Handler = (payload: { new: unknown; old?: unknown }) => void;
  const handlerMap = new Map<string, Handler>();
  const channelObj: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channelObj.on.mockImplementation(
    (_evt: string, opts: { table: string; event: string }, cb: Handler) => {
      handlerMap.set(`${opts.table}:${opts.event}`, cb);
      return channelObj;
    },
  );
  channelObj.subscribe.mockImplementation(() => channelObj);

  const fromBuilder = (rows: unknown[] = []) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = vi.fn(chain);
    builder.eq = vi.fn(chain);
    builder.is = vi.fn(chain);
    builder.in = vi.fn(chain);
    builder.order = vi.fn(chain);
    builder.limit = vi.fn(() => Promise.resolve({ data: rows, error: null, count: 0 }));
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: rows[0] ?? null, error: null }),
    );
    builder.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    return builder;
  };

  const supabaseMock = {
    channel: vi.fn(() => channelObj),
    removeChannel: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === "companies") return fromBuilder([{ name: "Empresa X" }]);
      if (table === "payments") return fromBuilder([{ reference: "LOTE-1" }]);
      return fromBuilder([]);
    }),
  };

  const authState: { roles: string[] } = { roles: [] };

  return { toastMock, navigateMock, notificationStoreAdd, handlerMap, supabaseMock, authState };
});

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));
vi.mock("@/lib/notificationStore", () => ({
  notificationStore: { add: notificationStoreAdd },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    hasRole: (r: string) => authState.roles.includes(r),
  }),
}));

import { useQueueNotifications } from "../useQueueNotifications";

const renderWithRoles = (roles: AppRole[]) => {
  authState.roles = roles as unknown as string[];
  handlerMap.clear();
  renderHook(() => useQueueNotifications());
};

const fireStatus = (newStatus: string, oldStatus: string | null = null) => {
  const h = handlerMap.get("payments:UPDATE");
  expect(h, "handler payments:UPDATE não registrado").toBeTruthy();
  h!({
    new: { id: "pay-1", reference: "LOTE-1", status: newStatus },
    old: { status: oldStatus },
  });
};

const firePendencia = (priority: "baixa" | "normal" | "alta" = "normal") => {
  const h = handlerMap.get("pendencias:INSERT");
  expect(h, "handler pendencias:INSERT não registrado").toBeTruthy();
  h!({
    new: {
      id: "pend-1",
      company_id: "co-1",
      subject: "Faltam dados",
      priority,
      created_by_name: "Dr Fulano",
      patient_name: "Paciente",
    },
  });
};

const totalNotified = () =>
  toastMock.info.mock.calls.length +
  toastMock.warning.mock.calls.length +
  toastMock.success.mock.calls.length;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useQueueNotifications — gating por papel", () => {
  beforeEach(() => {
    toastMock.info.mockReset();
    toastMock.warning.mockReset();
    toastMock.success.mockReset();
    notificationStoreAdd.mockReset();
    navigateMock.mockReset();
  });

  describe("nova pendência do prestador", () => {
    it("notifica analista", async () => {
      renderWithRoles(["analista"]);
      firePendencia("normal");
      await flush();
      expect(toastMock.info).toHaveBeenCalledTimes(1);
      expect(notificationStoreAdd).toHaveBeenCalledTimes(1);
    });

    it("usa toast.warning quando prioridade é alta", async () => {
      renderWithRoles(["analista"]);
      firePendencia("alta");
      await flush();
      expect(toastMock.warning).toHaveBeenCalledTimes(1);
      expect(toastMock.info).not.toHaveBeenCalled();
    });

    it("NÃO notifica validador", async () => {
      renderWithRoles(["validador"]);
      firePendencia("alta");
      await flush();
      expect(totalNotified()).toBe(0);
      expect(notificationStoreAdd).not.toHaveBeenCalled();
    });

    it("NÃO notifica diretor", async () => {
      renderWithRoles(["diretor"]);
      firePendencia("alta");
      await flush();
      expect(totalNotified()).toBe(0);
      expect(notificationStoreAdd).not.toHaveBeenCalled();
    });

    it("notifica admin (engloba analista)", async () => {
      renderWithRoles(["admin"]);
      firePendencia("normal");
      await flush();
      expect(toastMock.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("transições de status", () => {
    it("validador é notificado em aguardando_validacao", () => {
      renderWithRoles(["validador"]);
      fireStatus("aguardando_validacao", "revisao_analista");
      expect(toastMock.info).toHaveBeenCalledTimes(1);
    });

    it("validador NÃO é notificado em aguardando_aprovacao", () => {
      renderWithRoles(["validador"]);
      fireStatus("aguardando_aprovacao", "aguardando_validacao");
      expect(totalNotified()).toBe(0);
    });

    it("validador NÃO é notificado em revisao_analista", () => {
      renderWithRoles(["validador"]);
      fireStatus("revisao_analista", "em_analise_ia");
      expect(totalNotified()).toBe(0);
    });

    it("diretor é notificado em aguardando_aprovacao", () => {
      renderWithRoles(["diretor"]);
      fireStatus("aguardando_aprovacao", "aguardando_validacao");
      expect(toastMock.info).toHaveBeenCalledTimes(1);
    });

    it("diretor NÃO é notificado em aguardando_validacao", () => {
      renderWithRoles(["diretor"]);
      fireStatus("aguardando_validacao", "revisao_analista");
      expect(totalNotified()).toBe(0);
    });

    it("diretor NÃO é notificado em revisao_analista", () => {
      renderWithRoles(["diretor"]);
      fireStatus("revisao_analista", "em_analise_ia");
      expect(totalNotified()).toBe(0);
    });

    it("analista é notificado em revisao_analista e devolvido_analista", () => {
      renderWithRoles(["analista"]);
      fireStatus("revisao_analista", "em_analise_ia");
      expect(toastMock.info).toHaveBeenCalledTimes(1);

      fireStatus("devolvido_analista", "aguardando_validacao");
      expect(toastMock.warning).toHaveBeenCalledTimes(1);
    });

    it("analista NÃO é notificado em aguardando_validacao/aguardando_aprovacao", () => {
      renderWithRoles(["analista"]);
      fireStatus("aguardando_validacao", "revisao_analista");
      fireStatus("aguardando_aprovacao", "aguardando_validacao");
      expect(totalNotified()).toBe(0);
    });
  });

  it("usuário sem papel relevante não registra nenhum handler", () => {
    renderWithRoles([]);
    expect(handlerMap.size).toBe(0);
  });
});
