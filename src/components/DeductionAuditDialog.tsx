import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, RefreshCw, Search } from "lucide-react";
import {
  fetchDeductionEvents,
  ACTION_LABEL,
  ACTION_TONE,
  type DeductionEventRow,
  type DeductionEventAction,
  type FetchDeductionEventsFilter,
} from "@/lib/deductionAudit";

const TONE_CLASS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  muted: "bg-muted text-muted-foreground",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

interface DeductionAuditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filter: FetchDeductionEventsFilter;
  title?: string;
  /** Map opcional para exibir nome de empresa/lote */
  companyNameById?: Record<string, string>;
  paymentLabelById?: Record<string, string>;
}

export function DeductionAuditDialog({
  open,
  onOpenChange,
  filter,
  title = "Histórico de aplicações",
  companyNameById = {},
  paymentLabelById = {},
}: DeductionAuditDialogProps) {
  const [rows, setRows] = useState<DeductionEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<DeductionEventAction | "all">("all");
  const [text, setText] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchDeductionEvents({ ...filter, limit: 300 });
      setRows(data);
    } catch (err) {
      console.error("[DeductionAuditDialog] load", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filter.hospital_id, filter.company_id, filter.debt_id, filter.payment_id]);

  const filtered = rows.filter(r => {
    if (actionFilter !== "all" && r.action !== actionFilter) return false;
    if (!text.trim()) return true;
    const q = text.toLowerCase();
    return (
      (r.user_email ?? "").toLowerCase().includes(q) ||
      (r.reason ?? "").toLowerCase().includes(q) ||
      (companyNameById[r.company_id ?? ""] ?? "").toLowerCase().includes(q) ||
      (paymentLabelById[r.payment_id ?? ""] ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Buscar por usuário, motivo, PJ, lote…"
              className="pl-7 h-8 text-xs"
            />
          </div>
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as any)}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as ações</SelectItem>
              {(Object.keys(ACTION_LABEL) as DeductionEventAction[]).map(a => (
                <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-1.5">Quando</th>
                <th className="px-2 py-1.5">Ação</th>
                <th className="px-2 py-1.5">Usuário</th>
                <th className="px-2 py-1.5">PJ</th>
                <th className="px-2 py-1.5">Lote</th>
                <th className="px-2 py-1.5">Motivo / Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center py-4 text-muted-foreground">Carregando…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Nenhum evento registrado ainda para este escopo.</td></tr>
              )}
              {!loading && filtered.map(r => {
                const tone = TONE_CLASS[ACTION_TONE[r.action]] ?? TONE_CLASS.muted;
                const meta = r.metadata ?? {};
                const detailsExtra = Object.keys(meta).length
                  ? Object.entries(meta).slice(0, 4).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")
                  : "";
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={`${tone} border-0`} variant="outline">{ACTION_LABEL[r.action]}</Badge>
                    </td>
                    <td className="px-2 py-1.5">{r.user_email ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5">{companyNameById[r.company_id ?? ""] ?? (r.company_id ? r.company_id.slice(0, 8) : "—")}</td>
                    <td className="px-2 py-1.5">{paymentLabelById[r.payment_id ?? ""] ?? (r.payment_id ? r.payment_id.slice(0, 8) : "—")}</td>
                    <td className="px-2 py-1.5">
                      <div>{r.reason ?? <span className="text-muted-foreground">—</span>}</div>
                      {detailsExtra && <div className="text-[10px] text-muted-foreground mt-0.5">{detailsExtra}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <div className="text-[11px] text-muted-foreground mr-auto">
            {filtered.length} evento(s) exibido(s) · máx. 300
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
