import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { parseYmdLocal } from "@/lib/dateUtils";
import { brl } from "@/lib/tvr";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { type ReconRow } from "./reconTypes";

export function ListView({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [items, setItems] = useState<ReconRow[]>([]);
  const [doctors, setDoctors] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<ReconRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("retroactive_reconciliations" as never)
      .select(
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, source_payment_id, cost_center_code, analysis_mode",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    const list = (data ?? []) as unknown as ReconRow[];
    setItems(list);
    const docIds = Array.from(new Set(list.map((r) => r.doctor_id).filter(Boolean))) as string[];
    const compIds = Array.from(new Set(list.map((r) => r.company_id).filter(Boolean))) as string[];
    if (docIds.length > 0) {
      const { data: docs } = await supabase.from("doctors").select("id, full_name").in("id", docIds);
      const m: Record<string, string> = {};
      (docs ?? []).forEach((d: { id: string; full_name: string }) => { m[d.id] = d.full_name; });
      setDoctors(m);
    }
    if (compIds.length > 0) {
      const { data: cs } = await supabase.from("companies").select("id, name").in("id", compIds);
      const m: Record<string, string> = {};
      (cs ?? []).forEach((c: { id: string; name: string }) => { m[c.id] = c.name; });
      setCompanies(m);
    }
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  const canDelete = (r: ReconRow) =>
    r.status !== "concluida" && (!r.adjustment_ids || r.adjustment_ids.length === 0);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    // Delete items first (FK), then the recon
    await supabase
      .from("retroactive_reconciliation_items" as never)
      .delete()
      .eq("reconciliation_id", toDelete.id);
    const { error } = await supabase
      .from("retroactive_reconciliations" as never)
      .delete()
      .eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Apuração excluída" });
    setToDelete(null);
    await reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Conciliação retroativa</h3>
          <p className="text-sm text-muted-foreground">
            Apure faltas alegadas pelo médico ou PJ em competências anteriores cruzando com o que já foi pago.
          </p>
        </div>
        <Button onClick={onNew} size="sm">
          <PlusIcon className="h-4 w-4 mr-1" /> Nova apuração
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aberta em</TableHead>
              <TableHead>Apuração</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>A complementar</TableHead>
              <TableHead>A descontar</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  Nenhuma apuração retroativa ainda.
                </TableCell>
              </TableRow>
            )}
            {!loading && items.map((r) => {
              const isMultiScope = r.summary?.scope === "multi_pj";
              const multiCompanyCount = r.summary?.multi_company_ids?.length ?? 0;
              const multiDoctorCount = r.summary?.multi_doctor_ids?.length ?? 0;
              const scope = isMultiScope
                ? `Múltiplas empresas · ${multiCompanyCount} PJ${multiCompanyCount === 1 ? "" : "s"}${multiDoctorCount > 0 ? ` · ${multiDoctorCount} médico${multiDoctorCount === 1 ? "" : "s"}` : ""}`
                : [
                    r.doctor_id ? doctors[r.doctor_id] ?? "Médico" : null,
                    r.company_id ? companies[r.company_id] ?? "PJ" : null,
                  ].filter(Boolean).join(" · ");
              const deletable = canDelete(r);
              return (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(r.id)}>
                  <TableCell className="text-[12.5px] whitespace-nowrap">
                    {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="max-w-[340px]">
                    {r.title?.trim() ? (
                      <>
                        <div className="font-medium truncate" title={r.title}>{r.title}</div>
                        {scope && (
                          <div className="text-[11.5px] text-muted-foreground truncate" title={scope}>{scope}</div>
                        )}
                      </>
                    ) : (
                      <span className="font-medium">{scope || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[12.5px]">
                    {format(parseYmdLocal(r.period_start), "dd/MM/yy")} → {format(parseYmdLocal(r.period_end), "dd/MM/yy")}
                  </TableCell>
                  <TableCell>{r.summary?.total ?? 0}</TableCell>
                  <TableCell className="font-semibold text-warning">{brl(r.summary?.total_gap)}</TableCell>
                  <TableCell className="font-semibold text-destructive">{brl(r.summary?.total_excess)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "concluida" ? "outline" : "default"}>
                      {r.status === "concluida" ? "Concluída" : r.status === "cancelada" ? "Cancelada" : "Em análise"}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!deletable}
                      title={deletable ? "Excluir apuração" : "Apuração com ajuste gerado não pode ser excluída"}
                      onClick={() => setToDelete(r)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir apuração retroativa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a apuração e todos os itens cruzados. Não afeta pagamentos já existentes.
              Apurações com ajuste de complemento já gerado não podem ser excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------- NEW -------------------------- */
