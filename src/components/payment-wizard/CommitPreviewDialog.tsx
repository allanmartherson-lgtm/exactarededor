import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export type CommitPreviewData = {
  totalRows: number;
  distinctCompanies: number;
  distinctDoctors: number;
  grossTotal: number;
  sectors: string[];
  convenios: string[];
  newSectors?: string[];
  newConvenios?: string[];
  reference: string;
  competenceMonths: string[];
};

type Props = {
  open: boolean;
  data: CommitPreviewData | null;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

/**
 * Dry-run visual do commit de payment_items. Não altera nenhuma lógica de
 * gravação — apenas antecipa ao analista o que será enviado ao RPC
 * `bulk_insert_new_payment_items`, permitindo abortar antes de qualquer
 * write no banco.
 */
export function CommitPreviewDialog({ open, data, submitting, onConfirm, onCancel }: Props) {
  if (!data) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !submitting) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar antes de gravar</DialogTitle>
          <DialogDescription>
            Confira o resumo do lote <span className="font-medium">"{data.reference || "sem referência"}"</span> antes de enviar para o motor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Linhas" value={data.totalRows.toLocaleString("pt-BR")} />
          <Kpi label="PJs" value={data.distinctCompanies.toLocaleString("pt-BR")} />
          <Kpi label="Médicos" value={data.distinctDoctors.toLocaleString("pt-BR")} />
          <Kpi label="Bruto total" value={brl(data.grossTotal)} highlight />
        </div>

        <div className="space-y-3 mt-2 max-h-[45vh] overflow-y-auto pr-1">
          <Section
            title={`Setores (${data.sectors.length})`}
            items={data.sectors}
            newItems={data.newSectors}
            emptyLabel="Nenhum setor identificado."
          />
          <Section
            title={`Convênios (${data.convenios.length})`}
            items={data.convenios}
            newItems={data.newConvenios}
            emptyLabel="Nenhum convênio identificado."
          />
          {data.competenceMonths.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Competências</div>
              <div className="flex flex-wrap gap-1">
                {data.competenceMonths.map((m) => (
                  <Badge key={m} variant="secondary">{m}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Voltar para revisão
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Confirmar e gravar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function Section({
  title,
  items,
  newItems,
  emptyLabel,
}: {
  title: string;
  items: string[];
  newItems?: string[];
  emptyLabel: string;
}) {
  const newSet = new Set((newItems ?? []).map((s) => s.toLowerCase()));
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{emptyLabel}</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => {
            const isNew = newSet.has(it.toLowerCase());
            return (
              <Badge key={it} variant={isNew ? "default" : "outline"} className={isNew ? "bg-amber-500 hover:bg-amber-500" : ""}>
                {it}{isNew ? " · novo" : ""}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
