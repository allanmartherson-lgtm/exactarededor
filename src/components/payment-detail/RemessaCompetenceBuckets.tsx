import { useEffect, useMemo, useState } from "react";
import { CalendarRange, AlertTriangle, CheckCircle2, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Row = {
  id: string;
  doctor_name: string | null;
  procedure_name: string | null;
  attendance_number: string | null;
  raw_data: any;
};

interface Props {
  paymentId: string;
  competenceRegime: string | null;
}

const PT_MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function fmtCompetence(iso: string): string {
  // iso = "2026-01-01"
  const [y, m] = iso.split("-");
  const mIdx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${PT_MONTHS[mIdx]}/${y}`;
}

export default function RemessaCompetenceBuckets({ paymentId, competenceRegime }: Props) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<{ competence: string | null; count: number }[]>([]);
  const [semDataItems, setSemDataItems] = useState<Row[]>([]);
  const [editingItem, setEditingItem] = useState<Row | null>(null);
  const [manualCompetence, setManualCompetence] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isRemessa = competenceRegime === "remessa";

  const load = async () => {
    if (!isRemessa) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Distribuição agregada
    const { data: agg } = await supabase
      .from("payment_items")
      .select("item_competence")
      .eq("payment_id", paymentId);

    const map = new Map<string | null, number>();
    (agg ?? []).forEach((r: any) => {
      const k = r.item_competence ? String(r.item_competence).slice(0, 10) : null;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    const arr = Array.from(map.entries())
      .map(([competence, count]) => ({ competence, count }))
      .sort((a, b) => {
        if (a.competence === null) return 1;
        if (b.competence === null) return -1;
        return b.competence.localeCompare(a.competence);
      });
    setBuckets(arr);

    // Lista de itens sem data (até 100 para revisão)
    const { data: pending } = await supabase
      .from("payment_items")
      .select("id, doctor_name, procedure_name, attendance_number, raw_data")
      .eq("payment_id", paymentId)
      .eq("competence_source", "sem_data")
      .limit(100);
    setSemDataItems((pending ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, competenceRegime]);

  const semDataCount = useMemo(
    () => buckets.find((b) => b.competence === null)?.count ?? 0,
    [buckets]
  );

  if (!isRemessa) return null;
  if (loading) return null;

  const totalWithCompetence = buckets
    .filter((b) => b.competence)
    .reduce((s, b) => s + b.count, 0);

  const openEdit = (item: Row) => {
    setEditingItem(item);
    setManualCompetence("");
  };

  const saveManual = async () => {
    if (!editingItem || !manualCompetence) return;
    // input "YYYY-MM" → primeira data do mês
    const iso = `${manualCompetence}-01`;
    setSaving(true);
    const { error } = await supabase
      .from("payment_items")
      .update({
        item_competence: iso as any,
        competence_source: "manual" as any,
      } as any)
      .eq("id", editingItem.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Competência definida", description: `Item movido para ${fmtCompetence(iso)}` });
    setEditingItem(null);
    void load();
  };

  return (
    <Card className="border-info/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-info" />
          Competências detectadas na remessa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {buckets
            .filter((b) => b.competence)
            .map((b) => (
              <Badge key={b.competence!} variant="secondary" className="gap-1.5 py-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                <span className="font-medium">{fmtCompetence(b.competence!)}</span>
                <span className="text-muted-foreground">· {b.count} {b.count === 1 ? "item" : "itens"}</span>
              </Badge>
            ))}
          {totalWithCompetence === 0 && semDataCount === 0 && (
            <span className="text-xs text-muted-foreground">Nenhum item processado ainda.</span>
          )}
        </div>

        {semDataCount > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning-soft/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {semDataCount} {semDataCount === 1 ? "item sem competência" : "itens sem competência"}
            </div>
            <p className="text-xs text-foreground/80">
              Esses itens não tinham data de procedimento válida na base.
              Reveja se o <span className="font-medium">mapeamento da coluna de data</span> está correto
              ou defina a competência manualmente em cada linha. O lote continua avançando normalmente.
            </p>
            <div className="space-y-1 max-h-64 overflow-auto rounded border border-border bg-background/60">
              {semDataItems.slice(0, 20).map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs border-b border-border/60 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-medium">{it.doctor_name ?? "—"}</span>
                      <span className="text-muted-foreground"> · {it.procedure_name ?? "—"}</span>
                    </div>
                    <div className="text-muted-foreground truncate">
                      Atend. {it.attendance_number ?? "—"}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => openEdit(it)}>
                    <Pencil className="h-3 w-3" />
                    Definir
                  </Button>
                </div>
              ))}
              {semDataItems.length > 20 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  + {semDataItems.length - 20} outros itens. Resolva os principais primeiro ou reimporte com a coluna de data correta.
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir competência do item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-3">
              <div className="rounded border border-border bg-muted/30 p-2 text-xs">
                <div><span className="text-muted-foreground">Médico:</span> {editingItem.doctor_name ?? "—"}</div>
                <div><span className="text-muted-foreground">Procedimento:</span> {editingItem.procedure_name ?? "—"}</div>
                <div><span className="text-muted-foreground">Atendimento:</span> {editingItem.attendance_number ?? "—"}</div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-comp">Mês de competência</Label>
                <Input
                  id="manual-comp"
                  type="month"
                  value={manualCompetence}
                  onChange={(e) => setManualCompetence(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Esta definição é manual e não será sobrescrita pelo motor em reanálises.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingItem(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={saveManual} disabled={!manualCompetence || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Salvar competência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
