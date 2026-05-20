import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCheck, Users } from "lucide-react";
import type { AssignmentRow } from "@/hooks/usePaymentDetailData";
import { formatDateTimeBR } from "@/lib/dateUtils";

/**
 * Card de responsável atual + histórico de assumiu/transferiu para o lote.
 * - Mostra quem é o analista atualmente responsável (último registro).
 * - Lista as transferências em ordem cronológica (mais recente no topo).
 * - Botão "Assumir" registra explicitamente quando o usuário corrente quer
 *   assumir o lote (manual). O auto-claim na 1ª ação é feito no PaymentDetail.
 */
export function AssignmentCard({
  assignments,
  profiles,
  currentUserId,
  canAssume,
  onAssume,
}: {
  assignments: AssignmentRow[];
  profiles: Record<string, string>;
  currentUserId: string | null;
  canAssume: boolean;
  onAssume: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const last = assignments[0] ?? null; // já vem desc por created_at
  const currentResponsibleId = last?.analyst_id ?? null;
  const currentResponsibleName = currentResponsibleId
    ? profiles[currentResponsibleId] || "—"
    : null;
  const isMe = currentResponsibleId && currentResponsibleId === currentUserId;

  const handleAssume = async () => {
    setBusy(true);
    try { await onAssume(); } finally { setBusy(false); }
  };

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Responsável atual:</span>
            {currentResponsibleName ? (
              <span className="font-medium">{currentResponsibleName}</span>
            ) : (
              <span className="italic text-muted-foreground">Ninguém assumiu ainda</span>
            )}
            {isMe && <Badge variant="secondary" className="ml-1">você</Badge>}
          </div>
          {canAssume && !isMe && (
            <Button size="sm" variant="outline" onClick={handleAssume} disabled={busy}>
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
              {currentResponsibleId ? "Transferir para mim" : "Assumir lote"}
            </Button>
          )}
        </div>

        {assignments.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Histórico de atribuições ({assignments.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {assignments.map((a) => {
                const who = profiles[a.analyst_id] || "—";
                const prev = a.previous_analyst_id ? profiles[a.previous_analyst_id] || "—" : null;
                return (
                  <li key={a.id} className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="uppercase tracking-wide rounded px-1 py-0.5 bg-muted text-foreground/80 text-[10px]">
                        {a.action}
                      </span>
                      <span className="font-medium">{who}</span>
                      {a.action === "transferiu" && prev && (
                        <span className="text-muted-foreground">de <span className="text-foreground">{prev}</span></span>
                      )}
                      {a.source === "auto" && (
                        <span className="text-[10px] text-muted-foreground">(automático)</span>
                      )}
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {new Date(a.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {a.note && <p className="mt-0.5 text-muted-foreground">{a.note}</p>}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
