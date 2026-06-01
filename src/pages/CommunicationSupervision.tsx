import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { StatTileGrid } from "@/components/ui/stat-tile-grid";
import { StatCard } from "@/components/dashboard/StatCard";
import { Clock, AlertTriangle, MessageCircle, Timer, UserCheck, ArrowRightCircle, Lock } from "lucide-react";
import {
  CHANNEL_LABEL, SLA_LEVEL_BADGE,
  evaluateCommSla, type CommChannel, type CommSlaSetting, type CommSlaLevel,
} from "@/lib/commSla";
import { formatDate } from "@/lib/status";

interface ThreadRow {
  channel: CommChannel;
  thread_id: string;
  subject_ref: string;
  hospital_id: string | null;
  assigned_to: string | null;
  status: string;
  opened_at: string;
  last_message_at: string;
  last_author_type: string;
  first_response_at: string | null;
  read_at: string | null;
  answered_at: string | null;
  author_name: string | null;
  preview: string | null;
  payment_id: string | null;
}

export default function CommunicationSupervision() {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [settings, setSettings] = useState<Record<CommChannel, CommSlaSetting | null>>({
    doctor: null, company_payment: null, company_invoice: null,
  });
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("pendente");
  const [filterSla, setFilterSla] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [replyDialog, setReplyDialog] = useState<ThreadRow | null>(null);
  const [replyText, setReplyText] = useState("");
  const [analysts, setAnalysts] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [onBehalfOf, setOnBehalfOf] = useState<string>("");

  const canSupervise = roles.includes("admin") || roles.includes("diretor");

  useEffect(() => { document.title = "Supervisão de Atendimento | MedPay"; }, []);

  const load = async () => {
    setLoading(true);
    const [{ data: threads }, { data: slaCfg }, { data: profs }] = await Promise.all([
      supabase.from("communication_threads_v" as any).select("*").order("opened_at", { ascending: false }).limit(500),
      supabase.from("communication_sla_settings").select("*").is("hospital_id", null),
      supabase.from("profiles").select("id,full_name,email").order("full_name"),
    ]);
    setRows((threads ?? []) as ThreadRow[]);
    const map: any = { doctor: null, company_payment: null, company_invoice: null };
    (slaCfg ?? []).forEach((s: any) => { map[s.channel] = s; });
    setSettings(map);
    setAnalysts((profs ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const setting = settings[r.channel];
      const sla = setting && setting.active
        ? evaluateCommSla({
            openedAt: new Date(r.opened_at),
            firstResponseAt: r.first_response_at ? new Date(r.first_response_at) : null,
            setting,
          })
        : null;
      return { row: r, sla };
    });
  }, [rows, settings]);

  const filtered = useMemo(() => {
    return enriched.filter(({ row, sla }) => {
      if (filterChannel !== "all" && row.channel !== filterChannel) return false;
      if (filterStatus !== "all" && row.status !== filterStatus) return false;
      if (filterSla !== "all" && sla?.level !== filterSla) return false;
      if (search && !(row.preview ?? "").toLowerCase().includes(search.toLowerCase())
                 && !(row.author_name ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [enriched, filterChannel, filterStatus, filterSla, search]);

  const stats = useMemo(() => {
    const pendentes = enriched.filter(e => e.row.status === "pendente").length;
    const vencidos = enriched.filter(e => e.sla?.level === "vencido" && e.row.status !== "encerrada").length;
    const preventivo = enriched.filter(e => e.sla?.level === "preventivo").length;
    const respondidas = enriched.filter(e => e.row.first_response_at);
    const avg = respondidas.length
      ? respondidas.reduce((s, e) => s + (e.sla?.hoursElapsed ?? 0), 0) / respondidas.length
      : 0;
    return { pendentes, vencidos, preventivo, avg };
  }, [enriched]);

  const assignToMe = async (r: ThreadRow) => {
    if (!user) return;
    const { error } = await supabase.rpc("comm_thread_assign" as any, {
      p_channel: r.channel, p_thread_id: r.thread_id, p_assignee: user.id,
    });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Atribuído a você" });
    load();
  };

  const closeThread = async (r: ThreadRow) => {
    const { error } = await supabase.rpc("comm_thread_close" as any, {
      p_channel: r.channel, p_thread_id: r.thread_id,
    });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Conversa encerrada" });
    load();
  };

  const sendReply = async () => {
    if (!replyDialog || !onBehalfOf || replyText.trim().length < 1) return;
    const { error } = await supabase.rpc("comm_reply_on_behalf" as any, {
      p_channel: replyDialog.channel,
      p_thread_id: replyDialog.thread_id,
      p_message: replyText.trim(),
      p_on_behalf_of: onBehalfOf,
    });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Resposta enviada em nome do analista" });
    setReplyDialog(null); setReplyText(""); setOnBehalfOf("");
    load();
  };

  const openThread = (r: ThreadRow) => {
    if (r.channel === "company_payment" && r.payment_id) navigate(`/pagamentos/${r.payment_id}`);
    else if (r.channel === "company_invoice" && r.payment_id) navigate(`/pagamentos/${r.payment_id}`);
    else if (r.channel === "doctor") navigate("/conversas");
  };

  if (!canSupervise) {
    return (
      <>
        <PageHeader title="Supervisão de Atendimento" />
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Lock className="h-4 w-4" /> Acesso restrito a administradores e diretores.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Supervisão de Atendimento" description="Fila unificada de conversas com médicos e empresas — SLA em horas úteis." />
      <div className="p-6 space-y-4">
        <StatTileGrid>
          <StatCard label="Pendentes" value={String(stats.pendentes)} icon={MessageCircle} />
          <StatCard label="Vencidos SLA" value={String(stats.vencidos)} icon={AlertTriangle} tone={stats.vencidos > 0 ? "destructive" : undefined} />
          <StatCard label="Em atenção" value={String(stats.preventivo)} icon={Clock} tone={stats.preventivo > 0 ? "warning" : undefined} />
          <StatCard label="Tempo médio resp." value={`${stats.avg.toFixed(1)}h`} icon={Timer} />
        </StatTileGrid>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Select value={filterChannel} onValueChange={setFilterChannel}>
                <SelectTrigger><SelectValue placeholder="Canal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  <SelectItem value="doctor">Médico</SelectItem>
                  <SelectItem value="company_payment">Empresa · Lote</SelectItem>
                  <SelectItem value="company_invoice">Empresa · NF</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="respondida">Respondida</SelectItem>
                  <SelectItem value="encerrada">Encerrada</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSla} onValueChange={setFilterSla}>
                <SelectTrigger><SelectValue placeholder="SLA" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Qualquer SLA</SelectItem>
                  <SelectItem value="ok">No prazo</SelectItem>
                  <SelectItem value="preventivo">Atenção</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Buscar autor ou texto…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground py-10 text-center">Carregando…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">Nenhuma conversa encontrada com os filtros atuais.</p>
            ) : (
              <div className="border rounded-md divide-y">
                {filtered.map(({ row, sla }) => {
                  const badge = sla ? SLA_LEVEL_BADGE[sla.level] : null;
                  return (
                    <div key={`${row.channel}-${row.thread_id}`} className="p-3 grid grid-cols-1 md:grid-cols-[140px_1fr_140px_140px_auto] gap-3 items-center">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="w-fit">{CHANNEL_LABEL[row.channel]}</Badge>
                        <span className="text-[10px] text-muted-foreground">{formatDate(row.opened_at)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{row.author_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2">{row.preview}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Badge variant={row.status === "pendente" ? "destructive" : row.status === "respondida" ? "secondary" : "outline"}>
                          {row.status}
                        </Badge>
                        {row.assigned_to && <span className="text-[10px] text-muted-foreground">atribuído</span>}
                      </div>
                      <div className="flex flex-col gap-1">
                        {badge && (
                          <Badge variant={badge.tone === "destructive" ? "destructive" : badge.tone === "warning" ? "secondary" : "outline"}>
                            {badge.label}
                          </Badge>
                        )}
                        {sla && <span className="text-[10px] text-muted-foreground">{sla.hoursElapsed.toFixed(1)}h úteis</span>}
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        <Button size="sm" variant="outline" onClick={() => openThread(row)}>
                          <ArrowRightCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => assignToMe(row)} title="Atribuir a mim">
                          <UserCheck className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setReplyDialog(row); setOnBehalfOf(row.assigned_to ?? ""); }}>
                          Responder
                        </Button>
                        {row.status !== "encerrada" && (
                          <Button size="sm" variant="ghost" onClick={() => closeThread(row)}>Encerrar</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!replyDialog} onOpenChange={(o) => { if (!o) { setReplyDialog(null); setReplyText(""); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Responder em nome do analista</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Em nome de</Label>
              <Select value={onBehalfOf} onValueChange={setOnBehalfOf}>
                <SelectTrigger><SelectValue placeholder="Selecione o analista" /></SelectTrigger>
                <SelectContent>
                  {analysts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.full_name ?? a.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem</Label>
              <Textarea rows={5} value={replyText} onChange={e => setReplyText(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              A resposta é registrada com seu nome + “(em nome de {`<analista>`})” e fica em auditoria.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyDialog(null)}>Cancelar</Button>
            <Button onClick={sendReply} disabled={!onBehalfOf || replyText.trim().length === 0}>Enviar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
