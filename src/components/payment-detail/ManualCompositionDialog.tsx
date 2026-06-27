/**
 * Editor da "ficha de composição" de um item manual.
 *
 * Por que existir: pagamentos como nefrologia, plantão fechado e coordenação
 * vêm de planilhas externas que misturam várias rubricas (horas × valor hora,
 * sessões CRRT × valor, pareceres × valor, coordenação rateada, etc.). O
 * analista informa o valor final do item, mas pode opcionalmente descrever
 * COMO chegou nele em rubricas. O sistema só guarda — não calcula.
 *
 * Soma das rubricas vs total do item: só aviso visual, não bloqueia.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatBRL } from "@/lib/financialStats";
import { cn } from "@/lib/utils";

export type CompositionRow = {
  rubrica: string;
  qtd?: number | null;
  unit?: number | null;
  total: number;
  obs?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemTotal: number;
  initial: CompositionRow[] | null | undefined;
  onSave: (rows: CompositionRow[]) => void;
}

const EMPTY: CompositionRow = { rubrica: "", qtd: null, unit: null, total: 0, obs: "" };

export default function ManualCompositionDialog({
  open,
  onOpenChange,
  itemTotal,
  initial,
  onSave,
}: Props) {
  const [rows, setRows] = useState<CompositionRow[]>([]);

  useEffect(() => {
    if (open) setRows(initial && initial.length ? initial.map((r) => ({ ...r })) : [{ ...EMPTY }]);
  }, [open, initial]);

  const sum = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0), [rows]);
  const diff = sum - itemTotal;
  const ok = Math.abs(diff) < 0.01;

  const update = (idx: number, patch: Partial<CompositionRow>) => {
    setRows((prev) => {
      const next = [...prev];
      const merged = { ...next[idx], ...patch };
      // Auto-calc total = qtd × unit se ambos preenchidos e total não foi tocado nesta edição
      if ("qtd" in patch || "unit" in patch) {
        const q = Number(merged.qtd);
        const u = Number(merged.unit);
        if (!Number.isNaN(q) && !Number.isNaN(u) && q && u) {
          merged.total = Number((q * u).toFixed(2));
        }
      }
      next[idx] = merged;
      return next;
    });
  };

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    const clean = rows
      .map((r) => ({
        rubrica: (r.rubrica || "").trim(),
        qtd: r.qtd == null || r.qtd === ("" as any) ? null : Number(r.qtd),
        unit: r.unit == null || r.unit === ("" as any) ? null : Number(r.unit),
        total: Number(r.total) || 0,
        obs: (r.obs || "").trim() || null,
      }))
      .filter((r) => r.rubrica || r.total);
    onSave(clean);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ficha de composição</DialogTitle>
          <DialogDescription>
            Descreva como o valor do item foi formado (horas, sessões, coordenação, pareceres…). Apenas
            registro — não altera o valor pago. Total do item:{" "}
            <span className="font-medium text-foreground">{formatBRL(itemTotal)}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto -mx-6 px-6 max-h-[55vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-2 text-left w-[36%]">Rubrica</th>
                <th className="py-2 px-2 text-right w-[14%]">Qtd</th>
                <th className="py-2 px-2 text-right w-[16%]">Unitário</th>
                <th className="py-2 px-2 text-right w-[18%]">Total</th>
                <th className="py-2 pl-2 text-left">Obs</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    <Input
                      value={r.rubrica}
                      onChange={(e) => update(idx, { rubrica: e.target.value })}
                      placeholder="Ex.: Horas CRRT, Coordenação, Pareceres…"
                      className="h-8"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={r.qtd ?? ""}
                      onChange={(e) => update(idx, { qtd: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-8 text-right"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={r.unit ?? ""}
                      onChange={(e) => update(idx, { unit: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-8 text-right"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={r.total ?? 0}
                      onChange={(e) => update(idx, { total: Number(e.target.value) || 0 })}
                      className="h-8 text-right font-medium"
                    />
                  </td>
                  <td className="py-1 pl-2">
                    <Input
                      value={r.obs ?? ""}
                      onChange={(e) => update(idx, { obs: e.target.value })}
                      placeholder="—"
                      className="h-8"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar rubrica
          </Button>
          <div
            className={cn(
              "text-xs flex items-center gap-1.5 rounded-md border px-2.5 py-1.5",
              ok
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
            )}
          >
            {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Soma das rubricas: <span className="font-medium">{formatBRL(sum)}</span>
            {!ok && (
              <>
                {" · diferença "}
                <span className="font-medium">{formatBRL(diff)}</span>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>Salvar composição</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
