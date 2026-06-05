import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, MessageCircleQuestion, Plus, Building2, Lock, Search, X, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/status";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  payment_id: string;
  company_group_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_type: "interno" | "empresa";
  message: string;
  status: "pendente" | "respondida" | "encerrada";
  created_at: string;
};

type Group = { id: string; company_name: string };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  paymentId: string;
  groups: Group[];
  currentUserId: string;
  currentUserName: string;
  currentRole: "analista" | "validador" | "diretor" | "admin";
  paymentStatus?: string | null;
  /** Quando definido e o painel é (re)aberto, abre o composer já com a empresa pré-selecionada. */
  initialCompose?: { groupId?: string | null; companyName?: string | null } | null;
  /** Notifica o pai para que ele zere o `initialCompose` controlado. */
  onComposeConsumed?: () => void;
};

const STATUS_LABEL: Record<Row["status"], string> = {
  pendente: "Aberto",
  respondida: "Respondido",
  encerrada: "Encerrado",
};

const STATUS_CLASS: Record<Row["status"], string> = {
  pendente: "bg-warning-soft text-warning border-warning/30",
  respondida: "bg-info-soft text-info border-info/30",
  encerrada: "bg-muted text-muted-foreground border-border",
};

export function InternalThreadsSheet({
  open,
  onOpenChange,
  paymentId,
  groups,
  currentUserId,
  currentUserName,
  currentRole,
  paymentStatus,
  initialCompose,
  onComposeConsumed,
}: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"abertos" | "todos" | "encerrados">("abertos");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filtros avançados
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all"); // group_id | "all" | "lote"
  const [userFilter, setUserFilter] = useState<string>("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Composer inline (chat-like) para abrir nova conversa sem sair do painel.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeGroupId, setComposeGroupId] = useState<string>("lote"); // "lote" | group.id
  const [composeMessage, setComposeMessage] = useState("");
  const [composing, setComposing] = useState(false);

  // Quando o pai pede para abrir o composer com escopo pré-definido.
  useEffect(() => {
    if (!open || !initialCompose) return;
    setComposeOpen(true);
    setComposeGroupId(initialCompose.groupId ?? "lote");
    setComposeMessage("");
    onComposeConsumed?.();
  }, [open, initialCompose, onComposeConsumed]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_questions")
      .select("*")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [paymentId]);

  useEffect(() => {
    if (!open) return;
    load();
    const ch = supabase
      .channel(`its-${paymentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions", filter: `payment_id=eq.${paymentId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [open, paymentId, load]);

  const groupName = useCallback(
    (gid: string | null) => groups.find((g) => g.id === gid)?.company_name ?? "Lote",
    [groups],
  );

  // Lista única de autores envolvidos.
  const authors = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (!map.has(r.author_id)) map.set(r.author_id, r.author_name); });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const normalizedQuery = query.trim().toLowerCase();
  const hasAdvancedFilter =
    !!normalizedQuery || companyFilter !== "all" || userFilter !== "all";

  const threads = useMemo(() => {
    const roots = rows.filter((r) => !r.parent_id);
    const childrenByParent = new Map<string, Row[]>();
    rows.forEach((r) => {
      if (r.parent_id) {
        const arr = childrenByParent.get(r.parent_id) ?? [];
        arr.push(r);
        childrenByParent.set(r.parent_id, arr);
      }
    });
    return roots
      .map((root) => ({ root, replies: childrenByParent.get(root.id) ?? [] }))
      .filter((t) => {
        if (filter === "abertos" && t.root.status === "encerrada") return false;
        if (filter === "encerrados" && t.root.status !== "encerrada") return false;

        if (companyFilter === "lote" && t.root.company_group_id !== null) return false;
        if (companyFilter !== "all" && companyFilter !== "lote" &&
            t.root.company_group_id !== companyFilter) return false;

        if (userFilter !== "all") {
          const involved = t.root.author_id === userFilter ||
            t.replies.some((r) => r.author_id === userFilter);
          if (!involved) return false;
        }

        if (normalizedQuery) {
          const haystack = [
            t.root.message,
            t.root.author_name,
            groupName(t.root.company_group_id),
            ...t.replies.map((r) => `${r.message} ${r.author_name}`),
          ].join(" ").toLowerCase();
          if (!haystack.includes(normalizedQuery)) return false;
        }

        return true;
      })
      .sort((a, b) => (a.root.status === "encerrada" ? 1 : 0) - (b.root.status === "encerrada" ? 1 : 0) ||
        new Date(b.root.created_at).getTime() - new Date(a.root.created_at).getTime());
  }, [rows, filter, companyFilter, userFilter, normalizedQuery, groupName]);

  const openCount = useMemo(
    () => rows.filter((r) => !r.parent_id && r.status !== "encerrada").length,
    [rows],
  );
  const totalRoots = useMemo(() => rows.filter((r) => !r.parent_id).length, [rows]);

  const clearFilters = () => {
    setQuery("");
    setCompanyFilter("all");
    setUserFilter("all");
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const sendReply = async (root: Row) => {
    const text = (replies[root.id] ?? "").trim();
    if (text.length < 2) return;
    setBusyId(root.id);
    const { error } = await supabase.from("payment_questions").insert({
      payment_id: paymentId,
      company_group_id: root.company_group_id,
      parent_id: root.id,
      author_id: currentUserId,
      author_name: currentUserName,
      author_type: "interno",
      message: `[${currentRole}] ${text}`,
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Falha ao responder", description: error.message, variant: "destructive" });
      return;
    }
    setReplies((p) => ({ ...p, [root.id]: "" }));
    toast({ title: "Resposta enviada" });
  };

  const closeThread = async (root: Row) => {
    setBusyId(root.id);
    const { error } = await supabase
      .from("payment_questions")
      .update({ status: "encerrada" })
      .eq("id", root.id);
    setBusyId(null);
    if (error) {
      toast({ title: "Falha ao encerrar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Conversa encerrada" });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
            Conversas do lote
            {openCount > 0 && (
              <Badge variant="outline" className={STATUS_CLASS.pendente}>
                {openCount} {openCount === 1 ? "aberta" : "abertas"}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Acompanhe perguntas e respostas por empresa até a conclusão.
          </SheetDescription>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="abertos">Abertos</TabsTrigger>
                <TabsTrigger value="todos">Todos</TabsTrigger>
                <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant={composeOpen ? "secondary" : "default"}
              onClick={() => {
                setComposeOpen((v) => !v);
                if (!composeOpen) {
                  setComposeGroupId("lote");
                  setComposeMessage("");
                }
              }}
            >
              <Plus className={cn("h-4 w-4 mr-1.5 transition-transform", composeOpen && "rotate-45")} />
              {composeOpen ? "Cancelar" : "Nova pergunta"}
            </Button>
          </div>

          {/* Busca + filtros avançados */}
          <div className="pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por palavra, autor ou empresa..."
                  className="pl-8 h-9 text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Limpar busca"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                variant={advancedOpen || hasAdvancedFilter ? "secondary" : "outline"}
                size="sm"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="h-9"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                Filtros
                {hasAdvancedFilter && (
                  <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px] bg-primary/10 text-primary border-primary/30">
                    on
                  </Badge>
                )}
              </Button>
            </div>

            {advancedOpen && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as empresas</SelectItem>
                    <SelectItem value="lote">Somente do lote (sem empresa)</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Usuário" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os usuários</SelectItem>
                    {authors.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasAdvancedFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="col-span-2 h-8 text-xs text-muted-foreground hover:text-foreground justify-start"
                  >
                    <X className="h-3 w-3 mr-1" /> Limpar filtros
                  </Button>
                )}
              </div>
            )}

            {(hasAdvancedFilter || filter !== "abertos") && !loading && (
              <p className="text-[11px] text-muted-foreground">
                Mostrando <strong>{threads.length}</strong> de {totalRoots} conversa(s).
              </p>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : threads.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {hasAdvancedFilter
                ? "Nenhuma conversa corresponde aos filtros."
                : `Nenhuma conversa ${filter === "abertos" ? "aberta" : filter === "encerrados" ? "encerrada" : ""}.`}
            </div>
          ) : (
            threads.map(({ root, replies: rep }) => {
              const isOpen = expanded.has(root.id) || !!normalizedQuery;
              const closed = root.status === "encerrada";
              return (
                <div
                  key={root.id}
                  className={cn(
                    "rounded-lg border bg-card transition-colors",
                    closed ? "border-border" : "border-primary/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(root.id)}
                    className="w-full text-left p-3 flex items-start gap-3 hover:bg-muted/40 rounded-lg"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-[10px]">
                        {root.author_name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{root.author_name}</span>
                        <Badge variant="outline" className={cn("text-[10px] h-5", STATUS_CLASS[root.status])}>
                          {STATUS_LABEL[root.status]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] h-5 gap-1">
                          <Building2 className="h-2.5 w-2.5" />
                          {groupName(root.company_group_id)}
                        </Badge>
                        {rep.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {rep.length} {rep.length === 1 ? "resposta" : "respostas"}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatDate(root.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground line-clamp-2 whitespace-pre-wrap">
                        {root.message}
                      </p>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/60">
                      {rep.map((r) => (
                        <div key={r.id} className="flex gap-2 pt-3">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarFallback className="text-[10px]">
                              {r.author_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-medium">{r.author_name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatDate(r.created_at)}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{r.message}</p>
                          </div>
                        </div>
                      ))}

                      {closed ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                          <Lock className="h-3 w-3" /> Conversa encerrada.
                        </div>
                      ) : (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <Textarea
                              rows={2}
                              placeholder="Responder..."
                              value={replies[root.id] ?? ""}
                              onChange={(e) =>
                                setReplies((p) => ({ ...p, [root.id]: e.target.value }))
                              }
                              className="text-sm"
                            />
                            <div className="flex justify-between items-center">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => closeThread(root)}
                                disabled={busyId === root.id}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Encerrar
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => sendReply(root)}
                                disabled={busyId === root.id || (replies[root.id] ?? "").trim().length < 2}
                              >
                                Enviar resposta
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
