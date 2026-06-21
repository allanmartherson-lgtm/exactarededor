import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronUp, ChevronDown, Download, RotateCcw } from "lucide-react";

export type ExportColumnDef = {
  id: string;
  label: string;
  isMoney?: boolean;
  width?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allColumns: ExportColumnDef[];
  defaultOrder: string[];
  storageKey?: string;
  onConfirm: (orderedIds: string[]) => void;
};

export function ExportColumnPickerDialog({
  open,
  onOpenChange,
  allColumns,
  defaultOrder,
  storageKey = "confeccao-export-columns",
  onConfirm,
}: Props) {
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultOrder));

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { order: string[]; selected: string[] };
        // mantém apenas IDs ainda existentes; novos vão para o final
        const known = new Set(allColumns.map((c) => c.id));
        const savedOrder = saved.order.filter((id) => known.has(id));
        const missing = allColumns.map((c) => c.id).filter((id) => !savedOrder.includes(id));
        setOrder([...savedOrder, ...missing]);
        setSelected(new Set(saved.selected.filter((id) => known.has(id))));
        return;
      }
    } catch {}
    setOrder(defaultOrder);
    setSelected(new Set(defaultOrder));
  }, [open, storageKey, allColumns, defaultOrder]);

  const move = (id: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setOrder(defaultOrder);
    setSelected(new Set(defaultOrder));
  };

  const handleConfirm = () => {
    const ids = order.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ order, selected: Array.from(selected) }));
    } catch {}
    onConfirm(ids);
    onOpenChange(false);
  };

  const byId = new Map(allColumns.map((c) => [c.id, c]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Colunas do Excel</DialogTitle>
          <DialogDescription>
            Marque as colunas que devem sair e use as setas para definir a ordem.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
          {order.map((id, idx) => {
            const col = byId.get(id);
            if (!col) return null;
            const checked = selected.has(id);
            return (
              <div key={id} className="flex items-center gap-2 px-3 py-2">
                <Checkbox checked={checked} onCheckedChange={() => toggle(id)} />
                <span className={`flex-1 text-sm ${checked ? "" : "text-muted-foreground line-through"}`}>
                  {col.label}
                </span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(id, -1)} disabled={idx === 0}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(id, 1)} disabled={idx === order.length - 1}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 mr-auto">
            <RotateCcw className="h-4 w-4" />
            Restaurar padrão
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={selected.size === 0} className="gap-1.5">
            <Download className="h-4 w-4" />
            Exportar ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
