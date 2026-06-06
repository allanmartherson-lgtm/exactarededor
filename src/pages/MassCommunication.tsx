/**
 * Comunicação em Massa.
 *
 * Permite à equipe interna criar campanhas direcionadas a empresas,
 * especialidades ou médicos, escolhendo canais (portal/email/whatsapp)
 * e agendamento.
 *
 * As mensagens NÃO criam threads de chat — broadcast é one-way por padrão.
 * Se a campanha tiver `allow_reply=true`, eventuais respostas geram uma
 * pendência separada (fluxo futuro; no MVP só registra a marca na campanha).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Megaphone } from "@/config/icons/navIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Send } from "lucide-react";
import { MassCampaignDialog } from "@/components/comm/MassCampaignDialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

type Campaign = {
  id: string;
  title: string;
  message: string;
  channels: string[];
  audience: Record<string, unknown>;
  allow_reply: boolean;
  status: "rascunho" | "agendada" | "enviando" | "concluida" | "cancelada" | "falhou";
  approval_status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  scheduled_for: string | null;
  dispatched_at: string | null;
  totals: Record<string, unknown>;
  created_at: string;
};

const STATUS_VARIANT: Record<Campaign["status"], "default" | "secondary" | "destructive" | "outline"> = {
  rascunho: "outline",
  agendada: "secondary",
  enviando: "secondary",
  concluida: "default",
  cancelada: "outline",
  falhou: "destructive",
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando…",
  concluida: "Concluída",
  cancelada: "Cancelada",
  falhou: "Falhou",
};

const APPROVAL_VARIANT: Record<Campaign["approval_status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

const APPROVAL_LABEL: Record<Campaign["approval_status"], string> = {
  pending: "Aguarda aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
};

export default function MassCommunication() {
  const { hasRole } = useAuth();
  const isSupervisor = hasRole("admin") || hasRole("diretor");
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("comm_campaigns" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar campanhas", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      setItems((data ?? []) as unknown as Campaign[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("comm-campaigns")
      .on("postgres_changes", { event: "*", schema: "public", table: "comm_campaigns" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  const dispatchNow = async (id: string) => {
    setSendingId(id);
    const { data, error } = await supabase.functions.invoke("dispatch-broadcast", {
      body: { campaign_id: id },
    });
    setSendingId(null);
    if (error) {
      toast({ title: "Falha ao disparar", description: error.message, variant: "destructive" });
      return;
    }
    const totals = (data as { totals?: { recipients?: number } } | null)?.totals;
    toast({
      title: "Campanha disparada",
      description: `${totals?.recipients ?? 0} destinatário(s) processados.`,
    });
    void load();
  };

  const approve = async (id: string) => {
    setApprovingId(id);
    const { error } = await supabase.rpc("approve_campaign", { _campaign_id: id });
    setApprovingId(null);
    if (error) {
      toast({ title: "Falha ao aprovar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Campanha aprovada" });
    void load();
  };

  const reject = async (id: string) => {
    const reason = window.prompt("Motivo da rejeição (opcional):") ?? "";
    setApprovingId(id);
    const { error } = await supabase.rpc("reject_campaign", { _campaign_id: id, _reason: reason });
    setApprovingId(null);
    if (error) {
      toast({ title: "Falha ao rejeitar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Campanha rejeitada" });
    void load();
  };

  const rows = useMemo(() => items, [items]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Comunicação em massa"
        icon={Megaphone as never}
        description="Envie comunicados para empresas, médicos ou grupos por especialidade. Disparo via portal, e-mail e/ou WhatsApp."
        actions={
          <Button onClick={() => setOpenDialog(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nova campanha
          </Button>
        }
      />

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agendada para</TableHead>
              <TableHead>Destinatários</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  Nenhuma campanha criada ainda.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const totals = c.totals as { recipients?: number; email_sent?: number; email_failed?: number; whatsapp_sent?: number; whatsapp_failed?: number };
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-w-[280px]">
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.message.slice(0, 80)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {c.channels.map((ch) => (
                        <Badge key={ch} variant="outline" className="text-[10px] uppercase">
                          {ch}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {c.scheduled_for
                      ? format(new Date(c.scheduled_for), "dd/MM/yy HH:mm", { locale: ptBR })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {typeof totals?.recipients === "number" ? (
                      <span>
                        {totals.recipients}
                        {(totals.email_failed ?? 0) + (totals.whatsapp_failed ?? 0) > 0 && (
                          <span className="ml-1 text-destructive">
                            (·{(totals.email_failed ?? 0) + (totals.whatsapp_failed ?? 0)} falhas)
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {format(new Date(c.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    {(c.status === "rascunho" || c.status === "agendada" || c.status === "falhou") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={sendingId === c.id}
                        onClick={() => void dispatchNow(c.id)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {sendingId === c.id ? "Disparando…" : "Disparar agora"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <MassCampaignDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        onCreated={() => {
          setOpenDialog(false);
          void load();
        }}
      />
    </div>
  );
}
