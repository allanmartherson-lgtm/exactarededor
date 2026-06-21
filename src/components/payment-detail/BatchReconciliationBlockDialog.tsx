/**
 * Dialog mostrado quando o trigger de divergência pedido × regra barra um
 * envio em LOTE (analista→validador, validador→diretor, diretor→aprovar).
 *
 * Diferente do ReconciliationBlockDialog (que trata uma empresa por vez,
 * baseado no payload do erro), este consulta diretamente a view
 * vw_group_rule_totals para TODOS os group_ids do lote e lista todas as
 * empresas divergentes. Permite:
 *
 *  - Liberar todas com UMA justificativa (insere override por empresa,
 *    depois re-executa o envio).
 *  - Devolver todas ao analista com UM motivo (somente p/ validador/diretor).
 *  - Ações individuais por empresa (abrir, liberar só ela, devolver só ela).
 *
 * Quando a lista vier vazia (lote já regularizado entre o clique e o
 * dialog abrir), só permite "Tentar novamente".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ExternalLink, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Row = {
  group_id: string;
  payment_id: string;
  hospital_id: string;
  company_id: string;
  company_name: string;
  bruto_pedido: number;
  bruto_regra: number;
  diferenca: number;
  diff_pct: number;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  /** IDs dos grupos que o usuário tentou enviar. */
  targetGroupIds: string[];
  actorRole: "analista" | "validador" | "diretor";
  currentUserId: string;
  currentUserName: string;
  onResolved: () => void | Promise<void>;
  /** Re-executa o envio original depois das liberações. Obrigatório. */
  retryAfterRelease: () => Promise<void> | void;
};

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function BatchReconciliationBlockDialog({
  open,
  onOpenChange,
  paymentId,
  targetGroupIds,
  actorRole,
  currentUserId,
  currentUserName,
  onResolved,
  retryAfterRelease,
}: Props) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [justification, setJustification] = useState("");
  const [returnMsg, setReturnMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [thresholds, setThresholds] = useState<{ block_pct: number; block_abs: number }>({
    block_pct: 0.5,
    block_abs: 1.0,
  });

  const canReturn = actorRole !== "analista";
  const canRelease = hasRole("validador") || hasRole("diretor") || hasRole("admin");

  const reload = useCallback(async () => {
    if (!open || targetGroupIds.length === 0) return;
    setLoading(true);
    const [{ data: totals }, { data: groups }, { data: overrides }, { data: cfg }] = await Promise.all([
      supabase
        .from("vw_group_rule_totals")
        .select("group_id,payment_id,company_id,hospital_id,bruto_pedido_total,bruto_regra_total,diferenca,diferenca_pct")
        .in("group_id", targetGroupIds),
      supabase
        .from("payment_company_groups")
        .select("id,company_name")
        .in("id", targetGroupIds),
      supabase
        .from("payment_group_reconciliation_overrides")
        .select("group_id,bruto_regra_snapshot,bruto_pedido_snapshot")
        .in("group_id", targetGroupIds),
      supabase
        .from("system_configurations")
        .select("value")
        .eq("key", "divergence_thresholds")
        .maybeSingle(),
    ]);

    const v = ((cfg?.value as Record<string, unknown> | null) ?? {});
    const block_pct = Number(v.group_block_pct ?? 0.5);
    const block_abs = Number(v.group_block_abs ?? 1.0);
    setThresholds({ block_pct, block_abs });

    const nameById = new Map<string, string>(
      (groups ?? []).map((g: { id: string; company_name: string | null }) => [g.id, g.company_name ?? "(sem nome)"]),
    );

    const overridesByGroup = new Map<string, Array<{ r: number; p: number }>>();
    (overrides ?? []).forEach((o: { group_id: string; bruto_regra_snapshot: number; bruto_pedido_snapshot: number }) => {
      const arr = overridesByGroup.get(o.group_id) ?? [];
      arr.push({ r: Number(o.bruto_regra_snapshot), p: Number(o.bruto_pedido_snapshot) });
      overridesByGroup.set(o.group_id, arr);
    });

    const divergent: Row[] = [];
    (totals ?? []).forEach((t: {
      group_id: string;
      payment_id: string | null;
      company_id: string | null;
      hospital_id: string | null;
      bruto_pedido_total: number | null;
      bruto_regra_total: number | null;
      diferenca: number | null;
      diferenca_pct: number | null;
    }) => {
      const bp = Number(t.bruto_pedido_total ?? 0);
      const br = Number(t.bruto_regra_total ?? 0);
      const d = Number(t.diferenca ?? 0);
      const pct = Number(t.diferenca_pct ?? 0);
      const absD = Math.abs(d);
      const absPct = Math.abs(pct);
      // mesma regra do useGroupReconciliation
      const conciliado = absD <= block_abs || absPct <= block_pct;
      if (conciliado) return;
      const liberado = (overridesByGroup.get(t.group_id) ?? []).some(
        (s) => Math.abs(s.r - br) < 0.01 && Math.abs(s.p - bp) < 0.01,
      );
      if (liberado) return;
      divergent.push({
        group_id: t.group_id,
        payment_id: t.payment_id ?? paymentId,
        hospital_id: t.hospital_id ?? "",
        company_id: t.company_id ?? "",
        company_name: nameById.get(t.group_id) ?? "(sem nome)",
        bruto_pedido: bp,
        bruto_regra: br,
        diferenca: d,
        diff_pct: pct,
      });
    });
    divergent.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
    setRows(divergent);
    setSelected(new Set(divergent.map((r) => r.group_id)));
    setLoading(false);
  }, [open, targetGroupIds, paymentId]);

  useEffect(() => { void reload(); }, [reload]);

  // Reset textos ao reabrir.
  useEffect(() => {
    if (open) {
      setJustification("");
      setReturnMsg("");
    }
  }, [open]);

  const totalDiff = useMemo(
    () => rows.reduce((acc, r) => acc + Math.abs(r.diferenca), 0),
    [rows],
  );

  const toggle = (gid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.group_id)));
  };

  const doReleaseSelected = async () => {
    if (!canRelease) return;
    if (selected.size === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    if (justification.trim().length < 10) {
      toast({ title: "Justificativa muito curta", description: "Mínimo de 10 caracteres.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = rows
      .filter((r) => selected.has(r.group_id))
      .map((r) => ({
        group_id: r.group_id,
        hospital_id: r.hospital_id,
        bruto_regra_snapshot: r.bruto_regra,
        bruto_pedido_snapshot: r.bruto_pedido,
        diferenca_snapshot: r.bruto_pedido - r.bruto_regra,
        justification: justification.trim(),
        approved_by: currentUserId,
      }));
    const { error } = await supabase
      .from("payment_group_reconciliation_overrides")
      .insert(payload);
    if (error) {
      setBusy(false);
      toast({ title: "Falha ao registrar liberações", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${payload.length} empresa(s) liberada(s)` });
    try {
      await retryAfterRelease();
    } catch (e) {
      console.error("[BatchReconciliationBlockDialog] retry falhou", e);
    } finally {
      setBusy(false);
      onOpenChange(false);
      void onResolved();
    }
  };

  const doReturnSelected = async () => {
    if (!canReturn) return;
    if (selected.size === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    const msg = returnMsg.trim();
    if (msg.length < 10) {
      toast({ title: "Mensagem muito curta", description: "Mínimo de 10 caracteres.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const ids = rows.filter((r) => selected.has(r.group_id)).map((r) => r.group_id);
    const { error } = await supabase.rpc("return_groups_to_analyst", {
      p_payment_id: paymentId,
      p_group_ids: ids,
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_message: msg,
      p_lot_level: ids.length > 1,
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${ids.length} empresa(s) devolvida(s) ao analista` });
    onOpenChange(false);
    await onResolved();
  };

  const openCompany = (r: Row) => {
    navigate(`/pagamentos/${r.payment_id}#group-${r.group_id}`);
    onOpenChange(false);
  };

  const defaultReturnMsg = useMemo(() => {
    if (rows.length === 0) return "";
    const lines = rows
      .filter((r) => selected.has(r.group_id))
      .slice(0, 5)
      .map((r) =>
        `• ${r.company_name}: pedido ${fmt(r.bruto_pedido)} vs regra ${fmt(r.bruto_regra)} (${fmt(r.diferenca)} / ${r.diff_pct.toFixed(2)}%)`,
      )
      .join("\n");
    const extra = selected.size > 5 ? `\n…e mais ${selected.size - 5} empresa(s).` : "";
    return `Divergência pedido × regra detectada nas empresas abaixo. Por favor revise os cálculos antes de reenviar.\n\n${lines}${extra}`;
  }, [rows, selected]);

  // Pré-preenche o motivo de devolução quando o usuário muda a seleção.
  useEffect(() => {
    if (open && returnMsg.trim().length === 0) {
      setReturnMsg(defaultReturnMsg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows.length]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Envio bloqueado — divergências pedido × regra
          </DialogTitle>
          <DialogDescription>
            {loading
              ? "Carregando empresas divergentes do lote…"
              : rows.length === 0
              ? "Nenhuma divergência ativa encontrada. O lote pode ter sido regularizado — tente reenviar."
              : `${rows.length} empresa(s) com bruto do pedido diferente do bruto calculado pela regra. Tolerância: ${thresholds.block_pct}% ou ${fmt(thresholds.block_abs)}.`}
          </DialogDescription>
        </DialogHeader>

        {rows.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button
                type="button"
                className="flex items-center gap-2 hover:text-foreground"
                onClick={toggleAll}
              >
                <Checkbox checked={selected.size === rows.length && rows.length > 0} />
                <span>{selected.size}/{rows.length} selecionada(s)</span>
              </button>
              <span>Soma das diferenças: <strong className="text-destructive">{fmt(totalDiff)}</strong></span>
            </div>

            <ScrollArea className="max-h-[280px] rounded-md border">
              <div className="divide-y">
                {rows.map((r) => (
                  <div key={r.group_id} className="flex items-center gap-3 p-3 text-sm">
                    <Checkbox
                      checked={selected.has(r.group_id)}
                      onCheckedChange={() => toggle(r.group_id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.company_name}</div>
                      <div className="text-xs text-muted-foreground">
                        Pedido {fmt(r.bruto_pedido)} · Regra {fmt(r.bruto_regra)}
                      </div>
                    </div>
                    <Badge variant="destructive" className="shrink-0">
                      {fmt(r.diferenca)} ({r.diff_pct.toFixed(2)}%)
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => openCompany(r)}
                      title="Abrir empresa"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {canRelease && (
              <div className="space-y-2">
                <Label htmlFor="bulk-just">Justificativa (para liberar as selecionadas)</Label>
                <Textarea
                  id="bulk-just"
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Ex.: divergências aceitas pela diretoria — acordo retroativo aprovado por e-mail em DD/MM."
                />
              </div>
            )}

            {canReturn && (
              <div className="space-y-2">
                <Label htmlFor="bulk-return">Motivo (para devolver as selecionadas ao analista)</Label>
                <Textarea
                  id="bulk-return"
                  rows={3}
                  value={returnMsg}
                  onChange={(e) => setReturnMsg(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Fechar
          </Button>
          <div className="flex flex-col sm:flex-row gap-2">
            {rows.length === 0 && (
              <Button
                onClick={async () => {
                  setBusy(true);
                  try { await retryAfterRelease(); } finally {
                    setBusy(false);
                    onOpenChange(false);
                    void onResolved();
                  }
                }}
                disabled={busy}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" /> Tentar reenviar
              </Button>
            )}
            {canReturn && rows.length > 0 && (
              <Button
                variant="outline"
                onClick={doReturnSelected}
                disabled={busy || selected.size === 0}
                className="gap-2"
              >
                <Undo2 className="h-4 w-4" />
                Devolver selecionadas
              </Button>
            )}
            {canRelease && rows.length > 0 && (
              <Button
                onClick={doReleaseSelected}
                disabled={busy || selected.size === 0}
                className="gap-2"
              >
                <ShieldCheck className="h-4 w-4" />
                Liberar selecionadas e reenviar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
