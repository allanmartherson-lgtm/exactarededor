/**
 * Fila de aprovações de campanhas para supervisores.
 *
 * Mostra somente comunicados em massa com approval_status='pending',
 * para o supervisor decidir aprovar ou rejeitar antes do disparo.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ShieldCheck } from "@/config/icons/navIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

type Campaign = {
  id: string;
  title: string;
  message: string;
  channels: string[];
  audience: Record<string, unknown>;
  allow_reply: boolean;
  approval_status: "pending" | "approved" | "rejected";
  created_by: string | null;
  scheduled_for: string | null;
  totals: Record<string, unknown>;
  created_at: string;
};

export default function CampaignApprovalQueue() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isSupervisor = hasRole("admin") || hasRole("diretor");
  const [items, setItems] = useState<Campaign[]>([]);
  const [creators, setCreators] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupervisor) navigate("/comunicacao/massa", { replace: true });
  }, [isSupervisor, navigate]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("comm_campaigns" as never)
      .select("*")
      .eq("approval_status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar fila", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      const rows = (data ?? []) as unknown as Campaign[];
      setItems(rows);
      const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: { id: string; full_name: string | null }) => {
          map[p.id] = p.full_name ?? "—";
        });
        setCreators(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("comm-campaigns-approval")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comm_campaigns" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  const notify = async (campaign_id: string, decision: "approved" | "rejected", reason?: string) => {
    try {
      await supabase.functions.invoke("notify-campaign-decision", {
        body: { campaign_id, decision, reason },
      });
    } catch {
      /* não bloqueia o fluxo de aprovação */
    }
  };

  const approve = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase.rpc("approve_campaign", { _campaign_id: id });
    if (error) {
      setBusyId(null);
      toast({ title: "Falha ao aprovar", description: error.message, variant: "destructive" });
      return;
    }
    await notify(id, "approved");
    setBusyId(null);
    toast({ title: "Campanha aprovada", description: "Analista notificado por e-mail." });
    void load();
  };

  const reject = async (id: string) => {
    const reason = window.prompt("Motivo da rejeição (opcional):") ?? "";
    setBusyId(id);
    const { error } = await supabase.rpc("reject_campaign", { _campaign_id: id, _reason: reason });
    if (error) {
      setBusyId(null);
      toast({ title: "Falha ao rejeitar", description: error.message, variant: "destructive" });
      return;
    }
    await notify(id, "rejected", reason);
    setBusyId(null);
    toast({ title: "Campanha rejeitada", description: "Analista notificado por e-mail." });
    void load();
  };

  const rows = useMemo(() => items, [items]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Aprovações pendentes"
        icon={ShieldCheck as never}
        description="Comunicados em massa criados por analistas que aguardam decisão do supervisor antes do disparo."
      />

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Criada por</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Agendada para</TableHead>
              <TableHead>Pública-alvo</TableHead>
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
                  Nada na fila. Tudo aprovado por aqui. ✨
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const aud = c.audience as {
                companies?: string[];
                doctors?: string[];
                specialties?: string[];
              };
              const audStr = [
                aud?.companies?.length ? `${aud.companies.length} empresa(s)` : null,
                aud?.doctors?.length ? `${aud.doctors.length} médico(s)` : null,
                aud?.specialties?.length ? `${aud.specialties.length} especialidade(s)` : null,
              ].filter(Boolean).join(" + ") || "—";
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-w-[280px]">
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
                        <Badge key={ch} variant="outline" className="text-[10px] uppercase">
                          {ch}
                        </Badge>
                      ))}
                    </div>
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
                      <Button
                        size="sm"
                        variant="default"
                        disabled={busyId === c.id}
                        onClick={() => void approve(c.id)}
                      >
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === c.id}
                        onClick={() => void reject(c.id)}
                      >
                        Rejeitar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
