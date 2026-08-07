import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { type PagRow, brl, num } from "@/lib/tvr";
import { cn } from "@/lib/utils";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { type ReconRow } from "./reconTypes";

export function LoteScopeFilter({
  recon,
  pagRows,
  onChanged,
}: {
  recon: ReconRow | null;
  pagRows: PagRow[];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  // Agrupa itens carregados por lote (payment_id) — conta linhas, atendimentos
  // distintos, quantidade total e valores base/acordo. Serve tanto para o filtro
  // (checkboxes) quanto para o resumo por lote mostrado abaixo.
  const lotesLoaded = useMemo(() => {
    const map = new Map<string, {
      id: string;
      label: string;
      count: number;
      atendimentos: Set<string>;
      qtd_total: number;
      valor_base: number;
      valor_com_acordo: number;
    }>();
    for (const r of pagRows) {
      const pid = (r.pag_payment_id ?? "").trim();
      if (!pid) continue;
      const label = (r.pag_lote ?? "").trim() || pid.slice(0, 8);
      const qtd = num(r.pag_qtd) || 1;
      const vb = num(r.pag_valor_base);
      const va = num(r.pag_valor_com_acordo);
      const att = (r.pag_atendimento ?? "").trim();
      const cur = map.get(pid);
      if (cur) {
        cur.count += 1;
        cur.qtd_total += qtd;
        cur.valor_base += vb;
        cur.valor_com_acordo += va;
        if (att) cur.atendimentos.add(att);
      } else {
        const atts = new Set<string>();
        if (att) atts.add(att);
        map.set(pid, {
          id: pid,
          label,
          count: 1,
          atendimentos: atts,
          qtd_total: qtd,
          valor_base: vb,
          valor_com_acordo: va,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [pagRows]);

  const persistedIds = useMemo(
    () => new Set((recon?.summary?.selected_payment_ids ?? []).filter(Boolean)),
    [recon?.summary?.selected_payment_ids],
  );

  if (lotesLoaded.length <= 1 && persistedIds.size === 0) {
    // Só um lote e nenhum filtro salvo — nada a decidir.
    return null;
  }

  const toggleLote = async (pid: string, include: boolean) => {
    if (!recon) return;
    if (persistedIds.size === 0) {
      toast({
        title: "Filtro de lote não salvo",
        description: "Volte e crie a apuração selecionando o lote; não vamos inferir escopo por linhas carregadas.",
        variant: "destructive",
      });
      return;
    }
    const currentIds = persistedIds.size > 0
      ? new Set(persistedIds)
      : new Set(lotesLoaded.map((l) => l.id));
    if (include) currentIds.add(pid);
    else currentIds.delete(pid);
    if (currentIds.size === 0) {
      toast({ title: "Selecione ao menos um lote", variant: "destructive" });
      return;
    }
    const nextIds = Array.from(currentIds);
    const nextLabels = lotesLoaded
      .filter((l) => currentIds.has(l.id))
      .map((l) => l.label);
    setSaving(true);
    try {
      const nextSummary = {
        ...(recon.summary ?? {}),
        selected_payment_ids: nextIds,
        selected_payment_labels: nextLabels,
      };
      const { error } = await supabase
        .from("retroactive_reconciliations" as never)
        .update({ summary: nextSummary } as never)
        .eq("id", recon.id);
      if (error) throw error;
      // Muta o recon local para o próximo loadPaymentItems ler o filtro novo.
      // Isso evita depender de round-trip do estado antes do reload.
      (recon as ReconRow).summary = nextSummary as ReconRow["summary"];
      onChanged();
    } catch (e) {
      toast({
        title: "Erro ao salvar filtro de lote",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasFilter = persistedIds.size > 0;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-foreground">Lotes no escopo desta apuração</span>
        {hasFilter ? (
          <Badge variant="default" className="text-[10px]">Filtro ativo · {persistedIds.size} lote(s)</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Sem filtro · todos os lotes da competência</Badge>
        )}
        {saving && <span className="text-[10px] text-muted-foreground">salvando…</span>}
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Desmarque os lotes que não devem entrar na análise. O motor recarrega o Passo 2 com o novo escopo
        (impede que itens de outros lotes do mesmo mês contaminem os totais).
        Os valores abaixo já refletem <strong>somente os itens carregados</strong> — se um lote for desmarcado
        e recarregado, ele some da conta.
      </p>
      {(() => {
        // Totais consolidados: soma apenas dos lotes que estão dentro do escopo
        // atual (para o analista ver de onde vem o "total final" da análise).
        const inScope = lotesLoaded.filter((l) => (hasFilter ? persistedIds.has(l.id) : true));
        const tot = inScope.reduce(
          (acc, l) => {
            acc.count += l.count;
            acc.qtd += l.qtd_total;
            acc.atts += l.atendimentos.size;
            acc.base += l.valor_base;
            acc.acordo += l.valor_com_acordo;
            return acc;
          },
          { count: 0, qtd: 0, atts: 0, base: 0, acordo: 0 },
        );
        return (
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Incluir</th>
                    <th className="text-left px-2 py-1.5 font-medium">Lote</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Linhas de payment_items">Itens</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Atendimentos distintos">Atend.</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma das quantidades">Qtd</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma de procedure_amount (base 100%, sem acordo)">Valor Base</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma de expected_amount (valor efetivo com % do acordo)">Vlr c/ Acordo</th>
                  </tr>
                </thead>
                <tbody>
                  {lotesLoaded.map((l) => {
                    const isIn = hasFilter ? persistedIds.has(l.id) : true;
                    return (
                      <tr key={l.id} className={cn("border-t border-border", !isIn && "opacity-50")}>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void toggleLote(l.id, !isIn)}
                            className={cn(
                              "inline-flex items-center justify-center h-5 w-5 rounded border transition-colors",
                              isIn
                                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                                : "border-border bg-background hover:bg-muted",
                            )}
                            title={isIn ? "Remover este lote do escopo" : "Incluir este lote no escopo"}
                            aria-label={isIn ? `Remover lote ${l.label}` : `Incluir lote ${l.label}`}
                          >
                            {isIn ? <CheckIcon className="h-3 w-3" /> : <PlusIcon className="h-3 w-3" />}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 font-mono max-w-[220px] truncate" title={l.label}>{l.label}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.count.toLocaleString("pt-BR")}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.atendimentos.size.toLocaleString("pt-BR")}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.qtd_total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{brl(l.valor_base)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{brl(l.valor_com_acordo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/40 font-semibold text-foreground">
                  <tr className="border-t border-border">
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5">
                      Total no escopo ({inScope.length}/{lotesLoaded.length} lote{lotesLoaded.length === 1 ? "" : "s"})
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.count.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.atts.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{brl(tot.base)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{brl(tot.acordo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

