import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, Unlock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGroupReconciliation } from "@/hooks/useGroupReconciliation";
import { ReleaseDivergenceDialog } from "./ReleaseDivergenceDialog";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  groupId: string;
  hospitalId: string;
  compact?: boolean;
};

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GroupReconciliationGate({ groupId, hospitalId, compact }: Props) {
  const { totals, overrides, thresholds, loading, status, reload } = useGroupReconciliation(groupId);
  const [openDialog, setOpenDialog] = useState(false);
  const { hasRole } = useAuth();
  const canRelease = hasRole("diretor") || hasRole("admin");

  if (loading || !totals) {
    return (
      <Card><CardContent className="py-3 text-xs text-muted-foreground">Carregando conciliação…</CardContent></Card>
    );
  }

  const pedido = Number(totals.bruto_pedido_total ?? 0);
  const regra = Number(totals.bruto_regra_total ?? 0);
  const diff = Number(totals.diferenca ?? 0);
  const pct = Number(totals.diferenca_pct ?? 0);

  const tone =
    status === "conciliado"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : status === "liberado"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-destructive/50 bg-destructive/5";

  const badge =
    status === "conciliado" ? (
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Conciliado
      </Badge>
    ) : status === "liberado" ? (
      <Badge className="gap-1 bg-amber-600 hover:bg-amber-600">
        <ShieldCheck className="h-3 w-3" /> Liberado com justificativa
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Aprovação bloqueada
      </Badge>
    );

  const lastOverride = overrides[0];

  return (
    <>
      <Card className={tone}>
        <CardContent className={compact ? "py-3" : "py-4"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {badge}
              <span className="text-xs text-muted-foreground">
                Tolerância: {thresholds.block_pct}% ou {fmt(thresholds.block_abs)}
              </span>
            </div>
            {status === "divergente" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenDialog(true)}
                disabled={!canRelease}
                title={!canRelease ? "Apenas diretor ou admin podem liberar" : undefined}
                className="gap-1"
              >
                <Unlock className="h-3 w-3" /> Liberar com justificativa
              </Button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Bruto do pedido" value={fmt(pedido)} />
            <Stat label="Bruto da regra" value={fmt(regra)} />
            <Stat
              label="Diferença"
              value={`${fmt(diff)}${pedido ? ` (${pct.toFixed(2)}%)` : ""}`}
              emphasis={status === "divergente" ? "danger" : status === "liberado" ? "warn" : "ok"}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Itens: {totals.itens_total ?? 0}</span>
            <span>Sem regra: {totals.itens_sem_regra ?? 0}</span>
            <span>Divergentes: {totals.itens_divergentes ?? 0}</span>
          </div>

          {status === "liberado" && lastOverride && (
            <div className="mt-3 rounded-md border bg-background/60 p-2 text-xs">
              <div className="font-medium">Liberação registrada</div>
              <div className="text-muted-foreground">
                {new Date(lastOverride.created_at).toLocaleString("pt-BR")} — {lastOverride.justification}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ReleaseDivergenceDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        groupId={groupId}
        hospitalId={hospitalId}
        brutoRegra={regra}
        brutoPedido={pedido}
        onReleased={reload}
      />
    </>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "ok" | "warn" | "danger";
}) {
  const color =
    emphasis === "danger"
      ? "text-destructive"
      : emphasis === "warn"
      ? "text-amber-600"
      : emphasis === "ok"
      ? "text-emerald-600"
      : "";
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}
