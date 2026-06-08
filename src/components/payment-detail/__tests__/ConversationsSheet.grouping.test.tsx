import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MessageRow, Thread } from "../conversations/types";

// --- mock useConversations to feed deterministic threads ---
const useConversationsMock = vi.fn();
vi.mock("../conversations/useConversations", () => ({
  useConversations: (...args: unknown[]) => useConversationsMock(...args),
}));

// Avoid heavy supabase client init
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }) },
}));

import { ConversationsSheet } from "../conversations/ConversationsSheet";

function makeMsg(over: Partial<MessageRow>): MessageRow {
  return {
    id: over.id ?? crypto.randomUUID(),
    payment_id: "pay-1",
    company_group_id: over.company_group_id ?? null,
    parent_id: null,
    author_id: "user-1",
    author_name: over.author_name ?? "Analista X",
    author_type: "interno",
    message: over.message ?? "msg",
    status: over.status ?? "pendente",
    assigned_to: null,
    hospital_id: null,
    created_at: over.created_at ?? new Date().toISOString(),
    ...over,
  };
}

function makeThread(root: MessageRow, replies: MessageRow[] = []): Thread {
  return {
    root,
    replies,
    events: [],
    attachmentsByMessage: {},
    unreadForMe: 0,
    participantIds: new Set([root.author_id]),
    lastActivityAt: replies.at(-1)?.created_at ?? root.created_at,
  };
}

const baseProps = {
  open: true,
  onOpenChange: () => {},
  paymentId: "pay-1",
  paymentLabel: "Lote 01/2026",
  paymentStatus: "em_analise",
  groups: [
    { id: "g1", company_name: "PJ Alfa" },
    { id: "g2", company_name: "PJ Beta" },
  ],
  profiles: { "user-1": "Analista X" },
  currentUserId: "user-1",
  currentUserName: "Analista X",
  currentRole: "analista" as const,
};

beforeEach(() => {
  useConversationsMock.mockReset();
});

describe("ConversationsSheet — visual grouping (lote vs empresa)", () => {
  it("renders both section headers with counts matching backend threads", () => {
    const threads: Thread[] = [
      makeThread(makeMsg({ id: "t1", company_group_id: null, message: "Devolvido lote" })),
      makeThread(makeMsg({ id: "t2", company_group_id: null, message: "Outra obs lote" })),
      makeThread(makeMsg({ id: "t3", company_group_id: "g1", message: "PJ Alfa pergunta" })),
      makeThread(makeMsg({ id: "t4", company_group_id: "g2", message: "PJ Beta pergunta" })),
      makeThread(makeMsg({ id: "t5", company_group_id: "g2", message: "PJ Beta 2" })),
    ];
    useConversationsMock.mockReturnValue({
      loading: false,
      threads,
      readsByMessage: new Map(),
      sendMessage: vi.fn(),
      markThreadRead: vi.fn(),
      assignTo: vi.fn(),
      closeThread: vi.fn(),
      reopenThread: vi.fn(),
      getSignedUrl: vi.fn(),
    });

    render(<ConversationsSheet {...baseProps} />);

    const loteHeader = screen.getByText("Observações do lote").closest("li")!;
    const empresaHeader = screen.getByText("Por empresa").closest("li")!;

    // counts match backend split
    expect(within(loteHeader).getByText("2")).toBeInTheDocument();
    expect(within(empresaHeader).getByText("3")).toBeInTheDocument();

    // backend total reflected in "Todas" tab badge
    expect(screen.getByRole("button", { name: /Todas/ })).toHaveTextContent("5");

    // each thread row labels the correct scope badge
    const loteBadges = screen.getAllByText("Lote");
    expect(loteBadges.length).toBe(2);
    const empresaBadges = screen.getAllByText("Empresa");
    expect(empresaBadges.length).toBe(3);
  });

  it("hides the lote section when backend returns no lot-level threads", () => {
    useConversationsMock.mockReturnValue({
      loading: false,
      threads: [
        makeThread(makeMsg({ id: "t1", company_group_id: "g1" })),
        makeThread(makeMsg({ id: "t2", company_group_id: "g2" })),
      ],
      readsByMessage: new Map(),
      sendMessage: vi.fn(),
      markThreadRead: vi.fn(),
      assignTo: vi.fn(),
      closeThread: vi.fn(),
      reopenThread: vi.fn(),
      getSignedUrl: vi.fn(),
    });

    render(<ConversationsSheet {...baseProps} />);

    expect(screen.queryByText("Observações do lote")).not.toBeInTheDocument();
    const empresaHeader = screen.getByText("Por empresa").closest("li")!;
    expect(within(empresaHeader).getByText("2")).toBeInTheDocument();
  });

  it("hides the empresa section when backend returns only lot-level threads", () => {
    useConversationsMock.mockReturnValue({
      loading: false,
      threads: [
        makeThread(makeMsg({ id: "t1", company_group_id: null })),
      ],
      readsByMessage: new Map(),
      sendMessage: vi.fn(),
      markThreadRead: vi.fn(),
      assignTo: vi.fn(),
      closeThread: vi.fn(),
      reopenThread: vi.fn(),
      getSignedUrl: vi.fn(),
    });

    render(<ConversationsSheet {...baseProps} />);

    expect(screen.queryByText("Por empresa")).not.toBeInTheDocument();
    const loteHeader = screen.getByText("Observações do lote").closest("li")!;
    expect(within(loteHeader).getByText("1")).toBeInTheDocument();
  });

  it("renders lote section above empresa section (DOM order)", () => {
    useConversationsMock.mockReturnValue({
      loading: false,
      threads: [
        makeThread(makeMsg({ id: "t-emp", company_group_id: "g1" })),
        makeThread(makeMsg({ id: "t-lot", company_group_id: null })),
      ],
      readsByMessage: new Map(),
      sendMessage: vi.fn(),
      markThreadRead: vi.fn(),
      assignTo: vi.fn(),
      closeThread: vi.fn(),
      reopenThread: vi.fn(),
      getSignedUrl: vi.fn(),
    });

    render(<ConversationsSheet {...baseProps} />);

    const lote = screen.getByText("Observações do lote");
    const empresa = screen.getByText("Por empresa");
    // compareDocumentPosition: 4 = empresa follows lote
    expect(lote.compareDocumentPosition(empresa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
