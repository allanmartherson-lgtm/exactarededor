/**
 * Fila de aprovações de campanhas para supervisores.
 *
 * Funcionalidades:
 * - Filtra apenas pendentes (com possibilidade de mostrar todos via filtros)
 * - Busca por título, criador, canal, empresa e intervalo de datas
 * - Paginação server-side (20 por página)
 * - Confirmação visual ao aprovar
 * - Motivo OBRIGATÓRIO ao rejeitar (registrado em rejection_reason + e-mail)
 * - Retry automático em falha transitória (até 2 tentativas)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ShieldCheck } from "@/config/icons/navIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Search, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type Campaign = {
  id: string;
  title: string;
  message: string;
  channels: string[];
  audience: { companies?: string[]; doctors?: string[]; specialties?: string[] };
  approval_status: "pending" | "approved" | "rejected";
  created_by: string | null;
  scheduled_for: string | null;
  totals: Record<string, unknown>;
  created_at: string;
};

const PAGE_SIZE = 20;

/** Executa uma RPC com retry simples em erros de rede/transientes + timeout. */
async function rpcWithRetry<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
  maxAttempts = 2,
  timeoutMs = 15000,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let lastErr: { message: string } | null = null;
  for (let i = 1; i <= maxAttempts; i++) {
    const rpc = supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    try {
      const result = await Promise.race([
        rpc(fn, args),
        new Promise<{ data: null; error: { message: string; code?: string } }>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout após ${Math.round(timeoutMs / 1000)}s aguardando ${fn}`)), timeoutMs),
        ),
      ]);
      const { data, error } = result;
      if (!error) return { data: data as T, error: null };
      lastErr = error;
      console.error(`[rpcWithRetry] ${fn} tentativa ${i} falhou`, error);
      const code = (error as { code?: string }).code;
      if (code && !["57014", "08006", "08001"].includes(code)) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[rpcWithRetry] ${fn} tentativa ${i} lançou exceção`, e);
      lastErr = { message: msg };
    }
    await new Promise((r) => setTimeout(r, 600 * i));
  }
  return { data: null, error: lastErr };
}

export default function CampaignApprovalQueue() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isSupervisor = hasRole("admin") || hasRole("diretor") || hasRole("validador");

  // dados
  const [items, setItems] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [creators, setCreators] = useState<Record<string, string>>({});
  const [companyMap, setCompanyMap] = useState<Record<string, string>>({});

  // ui state
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // filtros
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // dialogs
  const [approveTarget, setApproveTarget] = useState<Campaign | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Campaign | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!isSupervisor) navigate("/comunicacao/massa", { replace: true });
  }, [isSupervisor, navigate]);

  // carrega criadores e empresas para filtros (uma vez)
  useEffect(() => {
    void (async () => {
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const creatorRows = await fetchAllPaginated<{ created_by: string }>((from, to) =>
        supabase
          .from("comm_campaigns" as never)
          .select("created_by")
          .not("created_by", "is", null)
          .range(from, to),
      );
      const ids = Array.from(new Set(creatorRows.map((r) => r.created_by)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name").in("id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: { id: string; full_name: string | null }) => {
          map[p.id] = p.full_name ?? "—";
        });
        setCreators(map);
      }
      const comps = await fetchAllPaginated<{ id: string; name: string }>((from, to) =>
        supabase
          .from("companies").select("id, name").eq("active", true).order("name").range(from, to),
      );
      const cmap: Record<string, string> = {};
      comps.forEach((c) => { cmap[c.id] = c.name; });
      setCompanyMap(cmap);
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("comm_campaigns" as never)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") q = q.eq("approval_status", statusFilter);
    if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
    if (channelFilter !== "all") q = q.contains("channels", [channelFilter]);
    if (creatorFilter !== "all") q = q.eq("created_by", creatorFilter);
    if (companyFilter !== "all") q = q.contains("audience", { companies: [companyFilter] });
    if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);

    const from = page * PAGE_SIZE;
    const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);

    if (error) {
      toast({ title: "Erro ao carregar fila", description: error.message, variant: "destructive" });
      setItems([]); setTotal(0);
    } else {
      setItems((data ?? []) as unknown as Campaign[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("comm-campaigns-approval-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comm_campaigns" },
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, search, channelFilter, creatorFilter, companyFilter, dateFrom, dateTo]);

  const doApprove = async () => {
    if (!approveTarget) return;
    const id = approveTarget.id;
    setBusyId(id);
    setApproveTarget(null);
    const { error } = await rpcWithRetry("approve_campaign", { _campaign_id: id });
    if (error) {
      void load();
      setBusyId(null);
      toast({
        title: "Falha ao aprovar",
        description: `${error.message}. Tentamos 2 vezes.`,
        variant: "destructive",
      });
      return;
    }
    setBusyId(null);
    toast({ title: "Campanha aprovada", description: "Notificações e disparo serão processados automaticamente." });
    void load();
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 5) {
      toast({
        title: "Motivo obrigatório",
        description: "Descreva o motivo em pelo menos 5 caracteres.",
        variant: "destructive",
      });
      return;
    }
    const id = rejectTarget.id;
    setBusyId(id);
    setRejectTarget(null);
    setRejectReason("");
    const { error } = await rpcWithRetry("reject_campaign", {
      _campaign_id: id, _reason: reason,
    });
    if (error) {
      void load();
      setBusyId(null);
      toast({
        title: "Falha ao rejeitar",
        description: `${error.message}. Tentamos 2 vezes.`,
        variant: "destructive",
      });
      return;
    }
    setBusyId(null);
    toast({ title: "Campanha rejeitada", description: "Motivo registrado e notificação processada automaticamente." });
    void load();
  };

  const clearFilters = () => {
    setSearch(""); setStatusFilter("pending"); setChannelFilter("all");
    setCreatorFilter("all"); setCompanyFilter("all");
    setDateFrom(""); setDateTo(""); setPage(0);
  };

  const rows = useMemo(() => items, [items]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Aprovações pendentes"
        icon={ShieldCheck as never}
        description="Comunicados em massa criados por analistas que aguardam decisão do supervisor antes do disparo."
      />

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[220px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Buscar título</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Título da campanha…"
              className="pl-7 h-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1 w-[140px]">
          <Label className="text-[11px] text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(0); }}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="approved">Aprovado</SelectItem>
              <SelectItem value="rejected">Rejeitado</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 w-[130px]">
          <Label className="text-[11px] text-muted-foreground">Canal</Label>
          <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="portal">Portal</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 w-[200px]">
          <Label className="text-[11px] text-muted-foreground">Criador</Label>
          <Select value={creatorFilter} onValueChange={(v) => { setCreatorFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(creators).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 w-[220px]">
          <Label className="text-[11px] text-muted-foreground">Empresa no público-alvo</Label>
          <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(companyMap).map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Criada de</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="h-9 w-[150px]" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">até</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="h-9 w-[150px]" />
        </div>

        <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
          <X className="h-3.5 w-3.5" /> Limpar
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Criada por</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agendada para</TableHead>
              <TableHead>Público-alvo</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  Nada por aqui com esses filtros. ✨
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const aud = c.audience ?? {};
              const audStr = [
                aud.companies?.length ? `${aud.companies.length} emp.` : null,
                aud.doctors?.length ? `${aud.doctors.length} méd.` : null,
                aud.specialties?.length ? `${aud.specialties.length} esp.` : null,
              ].filter(Boolean).join(" + ") || "—";
              const isPending = c.approval_status === "pending";
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-w-[260px]">
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.message.slice(0, 80)}
                    </div>
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {c.created_by ? (creators[c.created_by] ?? "—") : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {c.channels.map((ch) => (
                        <Badge key={ch} variant="outline" className="text-[10px] uppercase">{ch}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        c.approval_status === "approved" ? "default" :
                        c.approval_status === "rejected" ? "destructive" : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {c.approval_status === "approved" ? "Aprovada" :
                       c.approval_status === "rejected" ? "Rejeitada" : "Pendente"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {c.scheduled_for
                      ? format(new Date(c.scheduled_for), "dd/MM/yy HH:mm", { locale: ptBR })
                      : "Manual"}
                  </TableCell>
                  <TableCell className="text-[12px]">{audStr}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {format(new Date(c.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1.5 justify-end">
                      {isPending && (
                        <>
                          <Button
                            size="sm" variant="default" disabled={busyId === c.id}
                            onClick={() => setApproveTarget(c)}
                          >
                            {busyId === c.id && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                            Aprovar
                          </Button>
                          <Button
                            size="sm" variant="outline" disabled={busyId === c.id}
                            onClick={() => { setRejectTarget(c); setRejectReason(""); }}
                          >
                            Rejeitar
                          </Button>
                        </>
                      )}
                      {!isPending && (
                        <span className="text-[11px] text-muted-foreground italic">decidida</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Paginação */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-muted/30">
          <span className="text-[12px] text-muted-foreground">
            {total === 0 ? "0 resultados" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </Button>
            <span className="text-[12px] text-muted-foreground">
              Página {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmação de aprovação */}
      <AlertDialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">"{approveTarget?.title}"</span> será liberada
              para disparo imediato ou na data agendada. O analista será notificado por e-mail e na inbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doApprove()}>Aprovar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejeição com motivo obrigatório */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar campanha</DialogTitle>
            <DialogDescription>
              Descreva o motivo para o analista. O texto será registrado no histórico e enviado por e-mail.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label className="text-[12px]">Motivo (mínimo 5 caracteres) *</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex: revisar a mensagem antes de enviar, faltam dados de contato…"
              rows={4}
              autoFocus
            />
            <span className={`text-[11px] ${rejectReason.trim().length >= 5 ? "text-muted-foreground" : "text-destructive"}`}>
              {rejectReason.trim().length}/5 caracteres mínimos
            </span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 5}
              onClick={() => void doReject()}
            >
              Rejeitar e notificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
