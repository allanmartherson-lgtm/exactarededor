/**
 * Histórico de notificações enviadas para uma pendência (auditoria).
 *
 * Mostra cada vez que algum usuário foi notificado sobre esta pendência:
 * data/hora, destinatário, papel, prioridade no momento, motivo e canal.
 *
 * Lê de `pendencia_notification_log` (alimentado client-side pelo
 * useQueueNotifications quando o toast/sino dispara).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { BellRing } from "lucide-react";

type LogRow = {
  id: string;
  recipient_user_id: string;
  recipient_role: string;
  priority: string;
  reason: string;
  channel: string;
  created_at: string;
};

const REASON_LABEL: Record<string, string> = {
  nova_pendencia: "Nova pendência",
  nova_pendencia_alta: "Nova pendência (alta)",
};

export function NotificationHistoryPanel({ pendenciaId }: { pendenciaId: string }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("pendencia_notification_log" as never)
        .select("id, recipient_user_id, recipient_role, priority, reason, channel, created_at")
        .eq("pendencia_id", pendenciaId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!active) return;
      const list = (data as unknown as LogRow[]) ?? [];
      setRows(list);
      const ids = Array.from(new Set(list.map((r) => r.recipient_user_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
          map[p.id] = p.full_name || p.email || p.id.slice(0, 8);
        });
        if (active) setNames(map);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [pendenciaId]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <BellRing className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold text-foreground">Histórico de notificações</h2>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma notificação registrada para esta pendência ainda.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-foreground">
                  {names[r.recipient_user_id] ?? r.recipient_user_id.slice(0, 8)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {r.recipient_role}
                </Badge>
                <Badge
                  variant={r.priority === "alta" ? "destructive" : "secondary"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {r.priority}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {REASON_LABEL[r.reason] ?? r.reason} · {r.channel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
