import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KEY_AUDIT_SOURCE_LABEL, KEY_AUDIT_SOURCE_TONE, type TvrResult } from "@/lib/tvr";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

export function KeyAuditDialog({
  open,
  onOpenChange,
  results,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  results: TvrResult[] | null;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | keyof typeof KEY_AUDIT_SOURCE_LABEL>("all");
  const [search, setSearch] = useState("");

  const list = results ?? [];
  const counts = useMemo(() => {
    const c = { repasse_id: 0, name_to_id: 0, name_only: 0, missing: 0 } as Record<keyof typeof KEY_AUDIT_SOURCE_LABEL, number>;
    for (const r of list) {
      const src = r.key_audit?.doctor.source ?? "missing";
      c[src]++;
    }
    return c;
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (sourceFilter !== "all" && (r.key_audit?.doctor.source ?? "missing") !== sourceFilter) return false;
      if (!q) return true;
      const hay = `${r.key_audit?.att ?? ""} ${r.key_audit?.date ?? ""} ${r.key_audit?.tuss8 ?? ""} ${r.key_audit?.doctor.name_raw ?? ""} ${r.key_audit?.doctor.name_norm ?? ""} ${r.key_audit?.doctor.id ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [list, sourceFilter, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Auditoria da chave de cruzamento</DialogTitle>
          <DialogDescription>
            Composição da chave canônica por linha reconciliada: <b>Atendimento + Data (Y-M-D) + TUSS (8d) + Médico</b>.
            Quando o TASY não trazia <code>doctor_id</code>, marcamos o fallback <b>Nome → doctor_id</b> (índice construído a partir dos itens do Repasse).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          {(Object.keys(KEY_AUDIT_SOURCE_LABEL) as Array<keyof typeof KEY_AUDIT_SOURCE_LABEL>).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSourceFilter((cur) => (cur === k ? "all" : k))}
              className={cn(
                "text-[11px] px-2 py-1 rounded border transition-all",
                KEY_AUDIT_SOURCE_TONE[k],
                sourceFilter === k ? "ring-2 ring-offset-1 ring-primary" : "opacity-90 hover:opacity-100",
              )}
            >
              {KEY_AUDIT_SOURCE_LABEL[k]}: <b>{counts[k]}</b>
            </button>
          ))}
          {sourceFilter !== "all" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSourceFilter("all")}>
              Limpar filtro
            </Button>
          )}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar atend., TUSS, médico…"
            className="h-8 w-[280px] text-xs ml-auto"
          />
        </div>

        <div className="max-h-[60vh] overflow-auto rounded border border-border">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="text-[11px]">Atendimento</TableHead>
                <TableHead className="text-[11px]">Data (Y-M-D)</TableHead>
                <TableHead className="text-[11px]">TUSS (8d)</TableHead>
                <TableHead className="text-[11px]">Médico (bruto)</TableHead>
                <TableHead className="text-[11px]">Nome normalizado</TableHead>
                <TableHead className="text-[11px]">doctor_id resolvido</TableHead>
                <TableHead className="text-[11px]">Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-xs">
                    Nenhuma linha corresponde aos filtros.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const a = r.key_audit;
                const src = a?.doctor.source ?? "missing";
                return (
                  <TableRow key={r.key}>
                    <TableCell className="text-xs font-mono">{a?.att || "—"}</TableCell>
                    <TableCell className={cn("text-xs font-mono", !a?.date && "text-red-600")}>{a?.date || "faltando"}</TableCell>
                    <TableCell className={cn("text-xs font-mono", (a?.tuss8?.length ?? 0) < 8 && "text-amber-700")}>
                      {a?.tuss8 || "—"}
                      {a?.tuss8 && a.tuss8.length < 8 && (
                        <span className="ml-1 text-[10px] text-amber-700">({a.tuss8.length}d)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{a?.doctor.name_raw || "—"}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{a?.doctor.name_norm || "—"}</TableCell>
                    <TableCell className="text-[11px] font-mono">{a?.doctor.id ? a.doctor.id.slice(0, 8) + "…" : "—"}</TableCell>
                    <TableCell>
                      <span className={cn("inline-block text-[10px] px-1.5 py-0.5 rounded border", KEY_AUDIT_SOURCE_TONE[src])}>
                        {KEY_AUDIT_SOURCE_LABEL[src]}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <div className="text-[11px] text-muted-foreground mr-auto">
            {filtered.length} de {list.length} linha(s) · Chave = <code>Atend | Data | TUSS8 | Médico</code>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Filtro de lotes na tela de análise TASY vs Repasse. Permite ao analista
 * restringir quais lotes (payment_id) fazem parte da apuração — sem isso,
 * apurações criadas sem lote fixo caem no fallback por competência do mês
 * e misturam outros lotes na conta.
 *
 * Persiste em `summary.selected_payment_ids` e dispara reload do Passo 2.
 */
