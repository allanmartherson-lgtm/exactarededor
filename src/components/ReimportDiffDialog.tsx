// Modal de preview do diff de reimportação. Mostra +novas / −removidas /
// alteradas antes do commit. Se todos os arquivos tiverem SHA-256 idêntico
// ao já registrado em payment_source_files, oferece o botão "Pular".
//
// Este modal é APENAS UI: recebe o diff pronto e delega a decisão.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowRight, ChevronDown, ChevronRight, FileCheck2, Plus, Minus, Pencil } from "lucide-react";
import type { ReimportDiff } from "@/lib/reimportDiff";
import { IGNORED_REASON_LABELS, type IgnoredRowInfo } from "@/lib/importRowFilter";

const currency = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

type Props = {
  open: boolean;
  diff: ReimportDiff | null;
  sha256Matched: boolean; // true = todos os arquivos batem com hash já registrado
  ignoredRows?: IgnoredRowInfo[]; // linhas descartadas por não serem item
  busy?: boolean;
  /** Erro da última tentativa de commit — exibido no rodapé do modal. */
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onSkip: () => void;
};

export function ReimportDiffDialog({ open, diff, sha256Matched, ignoredRows = [], busy, errorMessage, onCancel, onConfirm, onSkip }: Props) {
  const [openChanged, setOpenChanged] = useState(true);
  const [openAdded, setOpenAdded] = useState(false);
  const [openRemoved, setOpenRemoved] = useState(false);

  if (!diff) return null;

  const noChanges = diff.addedCount === 0 && diff.removedCount === 0 && diff.changed.length === 0;
  const deltaTotal = diff.totalAfter - diff.totalBefore;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onCancel(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Resumo da reimportação</DialogTitle>
          <DialogDescription>
            Compare com a base atual do lote antes de gravar. A reimportação substitui os itens existentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* KPI cards — cada tipo de mudança com sua cor semântica, gradient suave
              e ícone à esquerda para leitura rápida. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-success/40 bg-gradient-to-br from-success-soft/80 to-success-soft/40 p-3 flex items-start gap-2">
              <div className="rounded-md bg-success/15 p-1.5">
                <Plus className="h-4 w-4 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-success-text font-semibold">Novas linhas</p>
                <p className="text-2xl font-bold text-success-text leading-tight">+{diff.addedCount}</p>
              </div>
            </div>
            <div className="rounded-md border border-destructive/40 bg-gradient-to-br from-destructive-soft to-destructive-soft/50 p-3 flex items-start gap-2">
              <div className="rounded-md bg-destructive/15 p-1.5">
                <Minus className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-destructive-text font-semibold">Não estão mais no arquivo</p>
                <p className="text-2xl font-bold text-destructive-text leading-tight">−{diff.removedCount}</p>
              </div>
            </div>
            <div className="rounded-md border border-warning/40 bg-gradient-to-br from-warning-soft to-warning-soft/50 p-3 flex items-start gap-2">
              <div className="rounded-md bg-warning/20 p-1.5">
                <Pencil className="h-4 w-4 text-warning-text" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-warning-text font-semibold">Valor alterado</p>
                <p className="text-2xl font-bold text-warning-text leading-tight">{diff.changed.length}</p>
              </div>
            </div>
          </div>

          {/* Totais */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-t border-border pt-2">
            <span>Bruto anterior: <strong className="text-foreground">{currency(diff.totalBefore)}</strong></span>
            <ArrowRight className="h-3 w-3" />
            <span>Bruto novo: <strong className="text-foreground">{currency(diff.totalAfter)}</strong></span>
            <Badge
              className={
                "ml-auto " +
                (Math.abs(deltaTotal) < 0.01
                  ? "bg-muted text-muted-foreground hover:bg-muted"
                  : deltaTotal > 0
                    ? "bg-success text-success-foreground hover:bg-success"
                    : "bg-destructive text-destructive-foreground hover:bg-destructive")
              }
            >
              Δ {currency(deltaTotal)}
            </Badge>
          </div>

          {ignoredRows.length > 0 && (
            <details className="rounded-md border border-warning/40 bg-warning-soft/50 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-warning-text">
                {ignoredRows.length} linha(s) ignorada(s) (totalizadores/sem identificação)
              </summary>
              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {ignoredRows.slice(0, 50).map((ig, i) => (
                  <li key={i} className="text-muted-foreground">
                    {ig.rowNumber ? `L${ig.rowNumber} · ` : ""}
                    {ig.preview} — {IGNORED_REASON_LABELS[ig.reason]}
                    {ig.value ? ` · ${currency(ig.value)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {sha256Matched && (
            <div className="rounded-md border border-info/30 bg-info-soft/40 p-3 flex items-start gap-2">
              <FileCheck2 className="h-4 w-4 text-info mt-0.5" />
              <div className="text-xs">
                <p className="font-medium text-foreground">Arquivo idêntico ao já processado</p>
                <p className="text-muted-foreground">O SHA-256 é o mesmo de uma importação anterior. Você pode pular para evitar reprocessar.</p>
              </div>
            </div>
          )}

          {noChanges && !sha256Matched && (
            <div className="rounded-md border border-muted bg-muted/30 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Nenhuma diferença detectada em relação aos itens atuais. Você ainda pode reimportar para forçar recálculo do motor.
              </p>
            </div>
          )}

          {/* Detalhamentos colapsáveis */}
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {diff.changed.length > 0 && (
              <Section
                open={openChanged}
                setOpen={setOpenChanged}
                title={`Linhas com valor alterado (${diff.changed.length})`}
                variant="warning"
              >
                <table className="w-full text-[11px]">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1 pr-2">Atendimento</th>
                      <th className="text-left py-1 pr-2">TUSS</th>
                      <th className="text-left py-1 pr-2">Médico</th>
                      <th className="text-right py-1 pr-2">Antes</th>
                      <th className="text-right py-1">Novo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.changed.slice(0, 200).map((r) => (
                      <tr key={r.key} className="border-t border-border/60">
                        <td className="py-1 pr-2">{r.attendance_number ?? "—"}</td>
                        <td className="py-1 pr-2">{r.procedure_code ?? "—"}</td>
                        <td className="py-1 pr-2 truncate max-w-[220px]">{r.doctor_name ?? "—"}</td>
                        <td className="py-1 pr-2 text-right text-destructive">{currency(r.before)}</td>
                        <td className="py-1 text-right text-success">{currency(r.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {diff.changed.length > 200 && (
                  <p className="text-[10px] text-muted-foreground italic mt-1">…mostrando as primeiras 200 de {diff.changed.length}.</p>
                )}
              </Section>
            )}

            {diff.addedSample.length > 0 && (
              <Section
                open={openAdded}
                setOpen={setOpenAdded}
                title={`Amostra de novas linhas (${diff.addedSample.length}/${diff.addedCount})`}
                variant="success"
              >
                <MiniList rows={diff.addedSample} showValueLabel="Valor" showValueSide="after" />
              </Section>
            )}

            {diff.removedSample.length > 0 && (
              <Section
                open={openRemoved}
                setOpen={setOpenRemoved}
                title={`Amostra de linhas removidas (${diff.removedSample.length}/${diff.removedCount})`}
                variant="destructive"
              >
                <MiniList rows={diff.removedSample} showValueLabel="Valor anterior" showValueSide="before" />
              </Section>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          {sha256Matched && (
            <Button variant="secondary" onClick={onSkip} disabled={busy}>
              Pular — arquivo já processado
            </Button>
          )}
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Reimportando…" : "Confirmar reimportação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SectionProps = {
  open: boolean;
  setOpen: (v: boolean) => void;
  title: string;
  variant: "success" | "destructive" | "warning";
  children: React.ReactNode;
};

function Section({ open, setOpen, title, variant, children }: SectionProps) {
  const border =
    variant === "success" ? "border-success/30" : variant === "destructive" ? "border-destructive/30" : "border-warning/30";
  return (
    <div className={`rounded-md border ${border} bg-background`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs font-medium hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function MiniList({
  rows,
  showValueLabel,
  showValueSide,
}: {
  rows: { key: string; attendance_number: string | null; procedure_code: string | null; doctor_name: string | null; before?: number | null; after?: number | null }[];
  showValueLabel: string;
  showValueSide: "before" | "after";
}) {
  return (
    <table className="w-full text-[11px]">
      <thead className="text-muted-foreground">
        <tr>
          <th className="text-left py-1 pr-2">Atendimento</th>
          <th className="text-left py-1 pr-2">TUSS</th>
          <th className="text-left py-1 pr-2">Médico</th>
          <th className="text-right py-1">{showValueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border/60">
            <td className="py-1 pr-2">{r.attendance_number ?? "—"}</td>
            <td className="py-1 pr-2">{r.procedure_code ?? "—"}</td>
            <td className="py-1 pr-2 truncate max-w-[240px]">{r.doctor_name ?? "—"}</td>
            <td className="py-1 text-right">{currency(showValueSide === "before" ? r.before : r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
