import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  FileText,
  Lock,
  MessageCircleQuestion,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  type AttachmentRow,
  type EventRow,
  type EventType,
  type Group,
  type MessageRow,
  type Role,
  type Thread,
  avatarHueClass,
  initialsOf,
  stripPrefixes,
} from "./types";
import { useConversations } from "./useConversations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentLabel?: string | null;
  paymentStatus?: string | null;
  groups: Group[];
  profiles: Record<string, string>;
  currentUserId: string;
  currentUserName: string;
  currentRole: Role;
  /** When set, the panel opens with composer pre-scoped to a company. */
  initialCompose?: { groupId?: string | null; companyName?: string | null } | null;
  onComposeConsumed?: () => void;
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

const STATUS_META: Record<MessageRow["status"], { label: string; variant: BadgeVariant }> = {
  pendente: { label: "Pendente", variant: "destructive" },
  respondida: { label: "Respondida", variant: "success" },
  encerrada: { label: "Encerrada", variant: "muted" },
};

const EVENT_LABEL: Record<EventType, (ev: EventRow, profiles: Record<string, string>) => string> = {
  opened: (ev) => `Conversa aberta por ${ev.actor_name ?? "alguém"}`,
  assigned: (ev, profiles) =>
    `${ev.actor_name ?? "Alguém"} atribuiu a conversa para ${
      (ev.payload as any)?.new_assignee_name ??
      profiles[(ev.payload as any)?.new_assignee] ??
      "—"
    }`,
  reassigned: (ev, profiles) =>
    `${ev.actor_name ?? "Alguém"} reatribuiu para ${
      (ev.payload as any)?.new_assignee_name ??
      profiles[(ev.payload as any)?.new_assignee] ??
      "—"
    }`,
  unassigned: (ev) => `${ev.actor_name ?? "Alguém"} removeu a atribuição`,
  closed: (ev) => `Conversa encerrada por ${ev.actor_name ?? "alguém"}`,
  reopened: (ev) => `Conversa reaberta por ${ev.actor_name ?? "alguém"}`,
  answered: (ev) => `Primeira resposta registrada por ${ev.actor_name ?? "alguém"}`,
};

const SLA_HOURS_DEFAULT = 24;

function slaBadge(opened: string, closed: boolean): { label: string; tone: string } | null {
  if (closed) return null;
  const ageMs = Date.now() - new Date(opened).getTime();
  const remainMs = SLA_HOURS_DEFAULT * 3600 * 1000 - ageMs;
  const hrs = Math.round(remainMs / 3600000);
  if (remainMs <= 0) {
    return { label: `SLA -${Math.abs(hrs)}h`, tone: "bg-chat-sla-bad/15 text-chat-sla-bad border-chat-sla-bad/40" };
  }
  if (hrs <= 4) {
    return { label: `SLA ${hrs}h`, tone: "bg-chat-sla-warn/15 text-chat-sla-warn border-chat-sla-warn/40" };
  }
  return { label: `SLA ${hrs}h`, tone: "bg-chat-sla-ok/15 text-chat-sla-ok border-chat-sla-ok/40" };
}

function dateDividerLabel(d: Date): string {
  if (isToday(d)) return `Hoje, ${format(d, "dd MMM yyyy", { locale: ptBR })}`;
  if (isYesterday(d)) return `Ontem, ${format(d, "dd MMM yyyy", { locale: ptBR })}`;
  return format(d, "EEEE, dd MMM yyyy", { locale: ptBR });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConversationsSheet(props: Props) {
  const {
    open,
    onOpenChange,
    paymentId,
    paymentLabel,
    paymentStatus,
    groups,
    profiles,
    currentUserId,
    currentUserName,
    currentRole,
    initialCompose,
    onComposeConsumed,
  } = props;

  const { toast } = useToast();
  const {
    loading,
    threads,
    readsByMessage,
    sendMessage,
    markThreadRead,
    assignTo,
    closeThread,
    reopenThread,
    getSignedUrl,
  } = useConversations({ paymentId, currentUserId, enabled: open });

  const [filter, setFilter] = useState<"abertas" | "todas" | "encerradas">("abertas");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<null | { groupId: string | null; companyName?: string | null }>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  // Honor parent's pre-scope (e.g. "Nova" clicked on a company card).
  useEffect(() => {
    if (!open || !initialCompose) return;
    setSelectedId(null);
    setComposeMode({
      groupId: initialCompose.groupId ?? null,
      companyName: initialCompose.companyName ?? null,
    });
    setMobileShowChat(true);
    onComposeConsumed?.();
  }, [open, initialCompose, onComposeConsumed]);

  const groupName = useCallback(
    (gid: string | null) => groups.find((g) => g.id === gid)?.company_name ?? "Lote inteiro",
    [groups],
  );

  // Filter + sort list.
  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads
      .filter((t) => {
        if (filter === "abertas" && t.root.status === "encerrada") return false;
        if (filter === "encerradas" && t.root.status !== "encerrada") return false;
        if (!q) return true;
        const hay = [
          t.root.message,
          t.root.author_name,
          groupName(t.root.company_group_id),
          ...t.replies.map((r) => `${r.message} ${r.author_name}`),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const ax = a.root.status === "encerrada" ? 1 : 0;
        const bx = b.root.status === "encerrada" ? 1 : 0;
        if (ax !== bx) return ax - bx;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });
  }, [threads, filter, search, groupName]);

  const openCount = threads.filter((t) => t.root.status !== "encerrada").length;
  const unreadOpenCount = threads.filter(
    (t) => t.root.status !== "encerrada" && t.unreadForMe > 0,
  ).length;

  const selectedThread = useMemo(
    () => filteredThreads.find((t) => t.root.id === selectedId) ?? threads.find((t) => t.root.id === selectedId) ?? null,
    [filteredThreads, threads, selectedId],
  );

  // Auto-select first thread on open / when current selection vanishes.
  useEffect(() => {
    if (!open) return;
    if (composeMode) return;
    if (selectedId && threads.some((t) => t.root.id === selectedId)) return;
    const first = filteredThreads[0]?.root.id ?? null;
    setSelectedId(first);
  }, [open, threads, filteredThreads, selectedId, composeMode]);

  // Mark read when thread opens.
  useEffect(() => {
    if (!selectedThread || selectedThread.unreadForMe === 0) return;
    void markThreadRead(selectedThread);
  }, [selectedThread, markThreadRead]);

  const handleSelectThread = (id: string) => {
    setComposeMode(null);
    setSelectedId(id);
    setMobileShowChat(true);
  };

  const handleNewClick = () => {
    setSelectedId(null);
    setComposeMode({ groupId: null });
    setMobileShowChat(true);
  };

  // Internal team members from profiles map.
  const teamMembers = useMemo(() => {
    return Object.entries(profiles)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[820px] xl:max-w-[960px] p-0 bg-chat-bg text-chat-text border-l-chat-border"
      >
        <div className="flex h-full">
          {/* ─────────── LIST PANEL ─────────── */}
          <aside
            className={cn(
              "w-full md:w-[280px] md:shrink-0 flex flex-col border-r border-chat-border bg-chat-surface",
              mobileShowChat ? "hidden md:flex" : "flex",
            )}
          >
            <header className="px-4 pt-5 pb-3 border-b border-chat-border">
              <div className="flex items-center gap-2">
                <MessageCircleQuestion className="h-5 w-5 text-chat-accent" />
                <h2 className="text-base font-semibold">Conversas</h2>
              </div>
              {paymentLabel && (
                <p className="text-xs text-chat-muted mt-0.5 truncate">{paymentLabel}</p>
              )}

              {/* Tabs */}
              <div className="mt-3 flex items-center gap-1 p-0.5 rounded-md bg-chat-bg/60 border border-chat-border">
                {([
                  { id: "abertas", label: "Abertas", badge: unreadOpenCount, tone: "bg-chat-unread text-white" },
                  { id: "todas", label: "Todas", badge: threads.length, tone: "bg-chat-muted/30 text-chat-text" },
                  { id: "encerradas", label: "Encerradas", badge: 0, tone: "" },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilter(t.id)}
                    className={cn(
                      "flex-1 px-2 py-1.5 text-[12px] font-medium rounded-[5px] transition-colors flex items-center justify-center gap-1.5",
                      filter === t.id
                        ? "bg-chat-accent text-chat-accent-foreground"
                        : "text-chat-muted hover:text-chat-text",
                    )}
                  >
                    {t.label}
                    {t.badge > 0 && (
                      <span
                        className={cn(
                          "min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center",
                          filter === t.id ? "bg-chat-accent-foreground/20 text-chat-accent-foreground" : t.tone,
                        )}
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-chat-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="pl-8 h-9 text-sm bg-chat-bg border-chat-border text-chat-text placeholder:text-chat-muted focus-visible:border-chat-accent focus-visible:ring-chat-accent/30"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-chat-muted hover:text-chat-text"
                    aria-label="Limpar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </header>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full bg-chat-bg/50" />
                  ))}
                </div>
              ) : filteredThreads.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-chat-muted">
                  {search ? "Nada encontrado." : "Nenhuma conversa."}
                </p>
              ) : (
                <ul>
                  {filteredThreads.map((t) => {
                    const isSelected = t.root.id === selectedId && !composeMode;
                    const unread = t.unreadForMe > 0;
                    const lastMsg = [t.root, ...t.replies].sort((a, b) =>
                      a.created_at.localeCompare(b.created_at),
                    ).at(-1)!;
                    const preview = stripPrefixes(lastMsg.message).body;
                    const sla = slaBadge(t.root.created_at, t.root.status === "encerrada");
                    return (
                      <li key={t.root.id} className="relative">
                        <button
                          type="button"
                          onClick={() => handleSelectThread(t.root.id)}
                          className={cn(
                            "w-full text-left px-3 py-2.5 border-b border-chat-border/60 transition-colors flex flex-col gap-1",
                            "border-l-2",
                            isSelected
                              ? "bg-chat-bg border-l-chat-accent"
                              : unread
                              ? "hover:bg-chat-bg/60 border-l-chat-unread"
                              : "hover:bg-chat-bg/40 border-l-transparent",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "text-[13px] truncate",
                                unread ? "font-semibold text-chat-text" : "text-chat-text",
                              )}
                            >
                              {groupName(t.root.company_group_id)}
                            </span>
                            <span className="text-[10.5px] text-chat-muted flex-shrink-0">
                              {format(new Date(t.lastActivityAt), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10.5px] font-medium leading-none py-1 px-2 h-5 rounded-full",
                                STATUS_META[t.root.status].tone,
                              )}
                            >
                              {STATUS_META[t.root.status].label}
                            </Badge>
                            {t.root.company_group_id ? (
                              <Badge
                                variant="outline"
                                className="text-[10.5px] font-medium leading-none py-1 px-2 h-5 rounded-full gap-1 bg-primary-soft text-primary-dark border-primary/30"
                              >
                                <Building2 className="h-2.5 w-2.5" /> Empresa
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10.5px] font-medium leading-none py-1 px-2 h-5 rounded-full bg-accent text-accent-foreground border-border"
                              >
                                Lote
                              </Badge>
                            )}
                            {sla && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10.5px] font-medium leading-none py-1 px-2 h-5 rounded-full",
                                  sla.tone,
                                )}
                              >
                                {sla.label}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11.5px] text-chat-muted truncate pr-3">
                            <span className="text-chat-text/70">{lastMsg.author_name}:</span>{" "}
                            {preview || "(sem texto)"}
                          </p>
                          {unread && (
                            <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-chat-unread" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="p-3 border-t border-chat-border">
              <Button
                onClick={handleNewClick}
                className="w-full bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90"
              >
                <Plus className="h-4 w-4 mr-1.5" /> Novo questionamento
              </Button>
            </div>
          </aside>

          {/* ─────────── CHAT PANEL ─────────── */}
          <section
            className={cn(
              "flex-1 min-w-0 flex flex-col bg-chat-bg",
              mobileShowChat ? "flex" : "hidden md:flex",
            )}
          >
            {composeMode ? (
              <NewThreadComposer
                groups={groups}
                initialGroupId={composeMode.groupId}
                currentRole={currentRole}
                paymentStatus={paymentStatus ?? null}
                onCancel={() => {
                  setComposeMode(null);
                  setMobileShowChat(false);
                }}
                onCreated={async (text, groupId, files) => {
                  const messageId = await sendMessage({
                    threadRoot: null,
                    companyGroupId: groupId,
                    authorName: currentUserName,
                    role: currentRole,
                    text,
                    files,
                  });
                  toast({ title: "Conversa aberta", description: "Notificando os destinatários." });
                  setComposeMode(null);
                  setSelectedId(messageId);
                }}
                onBackMobile={() => setMobileShowChat(false)}
              />
            ) : selectedThread ? (
              <ChatView
                thread={selectedThread}
                profiles={profiles}
                teamMembers={teamMembers}
                groupName={groupName}
                readsByMessage={readsByMessage}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentRole={currentRole}
                onAssign={async (assigneeId, assigneeName) => {
                  try {
                    await assignTo(selectedThread, assigneeId, assigneeName, currentUserName);
                  } catch (e) {
                    toast({ title: "Falha ao atribuir", description: (e as Error).message, variant: "destructive" });
                  }
                }}
                onClose={async () => {
                  try {
                    await closeThread(selectedThread, currentUserName);
                    toast({ title: "Conversa encerrada" });
                  } catch (e) {
                    toast({ title: "Falha", description: (e as Error).message, variant: "destructive" });
                  }
                }}
                onReopen={async () => {
                  try {
                    await reopenThread(selectedThread, currentUserName);
                    toast({ title: "Conversa reaberta" });
                  } catch (e) {
                    toast({ title: "Falha", description: (e as Error).message, variant: "destructive" });
                  }
                }}
                onSendReply={async (text, files) => {
                  try {
                    await sendMessage({
                      threadRoot: selectedThread.root,
                      authorName: currentUserName,
                      role: currentRole,
                      text,
                      files,
                    });
                  } catch (e) {
                    toast({ title: "Falha ao enviar", description: (e as Error).message, variant: "destructive" });
                  }
                }}
                onBackMobile={() => setMobileShowChat(false)}
                getSignedUrl={getSignedUrl}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-chat-muted text-sm gap-3 p-8 text-center">
                <MessageCircleQuestion className="h-10 w-10 opacity-40" />
                <p>Selecione uma conversa ou clique em <strong className="text-chat-text">+ Novo questionamento</strong>.</p>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────────
// NEW THREAD COMPOSER (initial pane when "+ Novo" is clicked)
// ──────────────────────────────────────────────────────────────
function NewThreadComposer(props: {
  groups: Group[];
  initialGroupId: string | null;
  currentRole: Role;
  paymentStatus: string | null;
  onCancel: () => void;
  onCreated: (text: string, groupId: string | null, files: File[]) => Promise<void>;
  onBackMobile: () => void;
}) {
  const { groups, initialGroupId, currentRole, paymentStatus, onCancel, onCreated, onBackMobile } = props;
  const [groupId, setGroupId] = useState<string>(initialGroupId ?? "lote");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const recipient = useMemo(() => {
    if (currentRole === "diretor" || currentRole === "admin") return "Analista e Supervisor";
    if (currentRole === "validador") return "Analista";
    return paymentStatus === "aguardando_aprovacao" || paymentStatus === "aprovado_em_revisao"
      ? "Diretor"
      : "Supervisor";
  }, [currentRole, paymentStatus]);

  const handleSend = async () => {
    if (text.trim().length < 10) return;
    setSending(true);
    try {
      await onCreated(text.trim(), groupId === "lote" ? null : groupId, files);
      setText("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <header className="px-5 py-4 border-b border-chat-border flex items-start gap-3">
        <button onClick={onBackMobile} className="md:hidden text-chat-muted hover:text-chat-text">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <MessageCircleQuestion className="h-6 w-6 text-chat-accent mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-chat-text">Novo questionamento</h3>
          <p className="text-[11.5px] text-chat-muted">
            Será notificado: <strong className="text-chat-text">{recipient}</strong>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-chat-muted hover:text-chat-text hover:bg-chat-surface">
          Cancelar
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-chat-muted">Escopo</label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="bg-chat-surface border-chat-border text-chat-text hover:border-chat-accent/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lote">Sobre o lote inteiro</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.company_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-chat-muted">Mensagem</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            autoFocus
            placeholder="Descreva o que você precisa esclarecer..."
            className="bg-chat-surface border-chat-border text-chat-text placeholder:text-chat-muted focus-visible:border-chat-accent focus-visible:ring-chat-accent/30 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
        </div>

        <AttachmentInput files={files} onFiles={setFiles} />
      </div>

      <footer className="px-5 py-3 border-t border-chat-border flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-chat-muted">⌘/Ctrl + Enter para enviar</span>
        <Button
          onClick={handleSend}
          disabled={sending || text.trim().length < 10}
          className="bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90"
        >
          {sending ? "Abrindo..." : (<><Send className="h-4 w-4 mr-1.5" /> Abrir conversa</>)}
        </Button>
      </footer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// CHAT VIEW (selected thread)
// ──────────────────────────────────────────────────────────────
function ChatView(props: {
  thread: Thread;
  profiles: Record<string, string>;
  teamMembers: Array<{ id: string; name: string }>;
  groupName: (gid: string | null) => string;
  readsByMessage: Map<string, Set<string>>;
  currentUserId: string;
  currentUserName: string;
  currentRole: Role;
  onAssign: (assigneeId: string | null, assigneeName: string | null) => Promise<void>;
  onClose: () => Promise<void>;
  onReopen: () => Promise<void>;
  onSendReply: (text: string, files: File[]) => Promise<void>;
  onBackMobile: () => void;
  getSignedUrl: (path: string) => Promise<string | null>;
}) {
  const {
    thread, profiles, teamMembers, groupName, readsByMessage,
    currentUserId, currentUserName, onAssign, onClose, onReopen, onSendReply, onBackMobile, getSignedUrl,
  } = props;

  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Compose merged timeline: events + messages, sorted ascending.
  type Timeline =
    | { kind: "msg"; at: string; msg: MessageRow }
    | { kind: "event"; at: string; ev: EventRow };

  const timeline: Timeline[] = useMemo(() => {
    const items: Timeline[] = [];
    [thread.root, ...thread.replies].forEach((m) => items.push({ kind: "msg", at: m.created_at, msg: m }));
    thread.events.forEach((ev) => items.push({ kind: "event", at: ev.created_at, ev }));
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [thread]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const closed = thread.root.status === "encerrada";
  const assignedToMe = thread.root.assigned_to === currentUserId;
  const assigneeName = thread.root.assigned_to ? profiles[thread.root.assigned_to] ?? "—" : null;

  const handleSend = async () => {
    if (reply.trim().length < 2) return;
    setSending(true);
    try {
      await onSendReply(reply.trim(), files);
      setReply("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  // ── Header ──
  const titleName = groupName(thread.root.company_group_id);
  const openedSince = (() => {
    const ms = Date.now() - new Date(thread.root.created_at).getTime();
    const hrs = Math.floor(ms / 3600000);
    if (hrs < 1) return "há minutos";
    if (hrs < 24) return `há ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `há ${days}d`;
  })();

  // Render messages grouped by date.
  let lastDate = "";
  return (
    <>
      <header className="px-5 py-3 border-b border-chat-border flex items-center gap-3">
        <button onClick={onBackMobile} className="md:hidden text-chat-muted hover:text-chat-text">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className={cn("text-xs font-semibold", avatarHueClass(titleName))}>
            {initialsOf(titleName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-chat-text truncate">{titleName}</h3>
          <p className="text-[11.5px] text-chat-muted truncate">
            Aberto {openedSince} por {thread.root.author_name}
            {assigneeName && <> · atribuído a <span className="text-chat-text">{assigneeName}</span></>}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-chat-accent hover:bg-chat-surface hover:text-chat-accent"
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                {assignedToMe ? "Você" : assigneeName ? "Atribuída" : "Assumir"}
                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Atribuir para</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onAssign(currentUserId, currentUserName)}
                disabled={assignedToMe}
              >
                Assumir comigo ({currentUserName})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {teamMembers
                .filter((m) => m.id !== currentUserId)
                .slice(0, 30)
                .map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => onAssign(m.id, m.name)}>
                    {m.name}
                  </DropdownMenuItem>
                ))}
              {thread.root.assigned_to && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onAssign(null, null)} className="text-chat-muted">
                    Remover atribuição
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {closed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReopen}
              className="text-chat-muted hover:text-chat-text hover:bg-chat-surface"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reabrir
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={!assignedToMe}
              title={!assignedToMe ? "Assuma a conversa primeiro" : "Encerrar"}
              className="text-chat-muted hover:text-chat-text hover:bg-chat-surface disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Encerrar
            </Button>
          )}
        </div>
      </header>

      {/* Participants bar */}
      {thread.participantIds.size > 1 && (
        <div className="px-5 py-2 border-b border-chat-border bg-chat-surface/40 flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wide text-chat-muted shrink-0">Participantes:</span>
          {Array.from(thread.participantIds).map((pid) => {
            const name = profiles[pid] ?? [thread.root, ...thread.replies].find((m) => m.author_id === pid)?.author_name ?? "—";
            return (
              <span key={pid} className="flex items-center gap-1.5 shrink-0">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className={cn("text-[9px] font-semibold", avatarHueClass(name))}>
                    {initialsOf(name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] text-chat-text/80">{name}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        {timeline.map((item, idx) => {
          const d = new Date(item.at);
          const dKey = d.toDateString();
          const showDivider = dKey !== lastDate;
          lastDate = dKey;
          return (
            <div key={idx}>
              {showDivider && <DateDivider date={d} />}
              {item.kind === "event" ? (
                <SystemMessage ev={item.ev} profiles={profiles} />
              ) : (
                <Bubble
                  msg={item.msg}
                  isMine={item.msg.author_id === currentUserId}
                  readers={readsByMessage.get(item.msg.id) ?? new Set()}
                  attachments={thread.attachmentsByMessage[item.msg.id] ?? []}
                  participantIds={thread.participantIds}
                  currentUserId={currentUserId}
                  getSignedUrl={getSignedUrl}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {closed ? (
        <div className="px-5 py-4 border-t border-chat-border flex items-center gap-2 text-xs text-chat-muted bg-chat-surface/40">
          <Lock className="h-3.5 w-3.5" /> Conversa encerrada. Reabra para continuar.
        </div>
      ) : (
        <footer className="border-t border-chat-border bg-chat-surface/40 p-3 space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escreva uma mensagem..."
            rows={1}
            className="min-h-[40px] max-h-[90px] bg-chat-bg border-chat-border text-chat-text placeholder:text-chat-muted focus-visible:border-chat-accent focus-visible:ring-chat-accent/30 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {files.length > 0 && <AttachmentChips files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <FileInputButton onFiles={(fs) => setFiles([...files, ...fs])} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10.5px] text-chat-muted hidden sm:block">
                Enter envia · Shift+Enter quebra linha
              </span>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || reply.trim().length < 2}
                className="bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" /> Enviar
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-chat-muted">
            Visível para: equipe interna (analista · validador · diretor)
          </p>
        </footer>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Bubble, SystemMessage, DateDivider
// ──────────────────────────────────────────────────────────────
function Bubble(props: {
  msg: MessageRow;
  isMine: boolean;
  readers: Set<string>;
  attachments: AttachmentRow[];
  participantIds: Set<string>;
  currentUserId: string;
  getSignedUrl: (path: string) => Promise<string | null>;
}) {
  const { msg, isMine, readers, attachments, participantIds, currentUserId, getSignedUrl } = props;
  const { body, roleTag } = stripPrefixes(msg.message);
  // Read by everyone else?
  const others = Array.from(participantIds).filter((id) => id !== msg.author_id);
  const readByAllOthers = others.length > 0 && others.every((id) => readers.has(id));
  const readBySomeone = Array.from(readers).some((id) => id !== msg.author_id);

  return (
    <div className={cn("flex gap-2", isMine ? "flex-row-reverse" : "flex-row")}>
      <Avatar className="h-7 w-7 shrink-0 mt-5">
        <AvatarFallback className={cn("text-[10px] font-semibold", avatarHueClass(msg.author_name))}>
          {initialsOf(msg.author_name)}
        </AvatarFallback>
      </Avatar>
      <div className={cn("flex flex-col max-w-[78%]", isMine ? "items-end" : "items-start")}>
        <div className="flex items-baseline gap-1.5 mb-0.5 px-1">
          <span className="text-[11px] font-semibold text-chat-text/90">{msg.author_name}</span>
          {roleTag && (
            <span className="text-[9.5px] uppercase tracking-wide text-chat-muted">{roleTag}</span>
          )}
        </div>
        <div
          className={cn(
            "px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words",
            isMine
              ? "bg-chat-bubble-mine text-chat-bubble-mine-foreground rounded-br-sm"
              : "bg-chat-bubble-theirs text-chat-bubble-theirs-foreground rounded-bl-sm",
          )}
        >
          {body || <span className="italic text-chat-muted">(sem texto)</span>}
          {attachments.length > 0 && (
            <div className={cn("mt-2 space-y-1", isMine ? "" : "")}>
              {attachments.map((a) => (
                <AttachmentLink key={a.id} att={a} getSignedUrl={getSignedUrl} isMine={isMine} />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 px-1">
          <span className="text-[10px] text-chat-muted">
            {format(new Date(msg.created_at), "HH:mm")}
          </span>
          {isMine && (
            <CheckCheck
              className={cn(
                "h-3 w-3",
                readByAllOthers ? "text-chat-accent" : readBySomeone ? "text-chat-muted" : "text-chat-muted/40",
              )}
              aria-label={readByAllOthers ? "Lido por todos" : "Enviado"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SystemMessage({ ev, profiles }: { ev: EventRow; profiles: Record<string, string> }) {
  const fn = EVENT_LABEL[ev.event_type];
  if (!fn) return null;
  const label = fn(ev, profiles);
  return (
    <div className="flex justify-center my-2">
      <div className="px-3 py-1 rounded-full bg-chat-system-bg text-chat-system-foreground text-[11px] flex items-center gap-1.5 border border-chat-system-foreground/15">
        <span>🔔</span>
        <span>{label}</span>
        <span className="opacity-60">· {format(new Date(ev.created_at), "HH:mm")}</span>
      </div>
    </div>
  );
}

function DateDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-chat-border" />
      <span className="text-[10.5px] uppercase tracking-wide text-chat-muted">{dateDividerLabel(date)}</span>
      <div className="flex-1 h-px bg-chat-border" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Attachments
// ──────────────────────────────────────────────────────────────
function AttachmentInput({ files, onFiles }: { files: File[]; onFiles: (f: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium uppercase tracking-wide text-chat-muted">Anexos (opcional)</label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="bg-chat-surface border-chat-border text-chat-text hover:bg-chat-surface-2 hover:text-chat-text"
        >
          <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Adicionar arquivo
        </Button>
        <span className="text-[10.5px] text-chat-muted">PDF, imagens, planilhas — até 20MB</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.csv"
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          onFiles([...files, ...list]);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      {files.length > 0 && <AttachmentChips files={files} onRemove={(i) => onFiles(files.filter((_, idx) => idx !== i))} />}
    </div>
  );
}

function AttachmentChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span
          key={`${f.name}-${i}`}
          className="flex items-center gap-1.5 text-[11px] bg-chat-surface border border-chat-border rounded-md px-2 py-1 text-chat-text"
        >
          <FileText className="h-3 w-3 text-chat-muted" />
          <span className="truncate max-w-[160px]">{f.name}</span>
          <span className="text-chat-muted">· {formatBytes(f.size)}</span>
          <button onClick={() => onRemove(i)} className="text-chat-muted hover:text-chat-text">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function FileInputButton({ onFiles }: { onFiles: (f: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => inputRef.current?.click()}
        className="text-chat-muted hover:bg-chat-surface hover:text-chat-text"
        title="Anexar arquivo"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.csv"
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length) onFiles(list);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

function AttachmentLink({
  att,
  getSignedUrl,
  isMine,
}: {
  att: AttachmentRow;
  getSignedUrl: (path: string) => Promise<string | null>;
  isMine: boolean;
}) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    const url = await getSignedUrl(att.storage_path);
    if (url) window.open(url, "_blank");
  };
  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors w-full text-left",
        isMine
          ? "bg-chat-bubble-mine-foreground/10 hover:bg-chat-bubble-mine-foreground/20 text-chat-bubble-mine-foreground"
          : "bg-chat-bg/60 hover:bg-chat-bg text-chat-text",
      )}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="truncate flex-1">{att.file_name}</span>
      <span className="text-[10px] opacity-60">{formatBytes(att.size_bytes)}</span>
      <ArrowRight className="h-3 w-3 opacity-60" />
    </button>
  );
}
