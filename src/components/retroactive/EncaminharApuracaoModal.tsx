import { type TargetField } from "./RetroactiveMappingWizard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { type TvrResult, brl, computeTvrHeadlineTotals, getTvrValorRecuperar } from "@/lib/tvr";
import { useEffect, useMemo, useRef, useState } from "react";

export type GlosaGroupView = {
  doctor_id: string;
  doctor_name: string;
  doctor_crm: string | null;
  company_id: string | null;
  company_name: string | null;
  items: TvrResult[];
};


export type EncaminharModalProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  headline: ReturnType<typeof computeTvrHeadlineTotals>;
  actionable: TvrResult[];
  retirar: TvrResult[];
  groups: GlosaGroupView[];
  unassigned: TvrResult[];
  canGerarGlosa: boolean;
  modoMedicoUnico: boolean;
  busy: boolean;
  onConfirm: (opts: {
    includeComplementar: boolean;
    gerarGlosa: boolean;
    parcelas: number;
    parcelasByDoctor: Record<string, number>;
    selectedDoctorIds: string[];
  }) => void;
  // Escopo do lote de referência para cruzar líquido da PJ.
  // Vem da apuração e casa hospital + centro de custos + trilha (prioritária/habitual).
  refScope: {
    hospital_id: string | null;
    cost_center_code: string | null;
    analysis_mode: string | null;
  };
};


export function EncaminharApuracaoModal({
  open, onOpenChange, headline, actionable, retirar,
  groups, unassigned, canGerarGlosa, modoMedicoUnico, busy, onConfirm, refScope,
}: EncaminharModalProps) {
  const [includeComplementar, setIncludeComplementar] = useState(false);
  const [gerarGlosa, setGerarGlosa] = useState<"agora" | "depois">("agora");
  const [parcelas, setParcelas] = useState<number>(0);
  const [parcelasByDoctor, setParcelasByDoctor] = useState<Record<string, number>>({});
  const [showCompList, setShowCompList] = useState(false);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Sugestão automática de parcelas por porte do débito.
  // Valores pequenos ficam em 1× (não faz sentido parcelar R$ 200);
  // valores maiores vão diluindo para reduzir impacto no próximo lote da PJ.
  const suggestParcelas = (subtotal: number): number => {
    if (subtotal <= 500) return 1;
    if (subtotal <= 2000) return 2;
    if (subtotal <= 5000) return 3;
    if (subtotal <= 15000) return 6;
    if (subtotal <= 30000) return 10;
    return 12;
  };

  // Chave estável dos grupos — evita re-semear o estado a cada render do pai
  // (buildGlosaGroups gera um novo array de referência em toda passagem, o que
  // fazia o efeito abaixo reexecutar e sobrescrever as seleções do usuário,
  // remarcando todos os médicos ao clicar em "Confirmar encaminhamento").
  const groupsKey = useMemo(
    () => groups.map((g) => g.doctor_id).sort().join("|"),
    [groups],
  );

  // Só (re)inicializa quando o modal abre OU quando a composição real de
  // grupos muda enquanto ele já está aberto (ex.: novo médico apareceu).
  const wasOpenRef = useRef(false);
  const lastGroupsKeyRef = useRef<string>("");
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    const groupsChangedWhileOpen = open && wasOpenRef.current && groupsKey !== lastGroupsKeyRef.current;
    wasOpenRef.current = open;
    if (!open) return;
    lastGroupsKeyRef.current = groupsKey;
    if (!justOpened && !groupsChangedWhileOpen) return;

    if (justOpened) {
      // Default por etapa: encaminhar glosa primeiro. Confecção de novo lote
      // fica opt-in — o analista precisa marcar explicitamente para gerar
      // itens a pagar. Item 3 do briefing.
      setIncludeComplementar(false);
      setGerarGlosa(retirar.length > 0 && canGerarGlosa ? "agora" : "depois");
      setParcelas(1);
      setShowCompList(false);
      setExpandedGroups(new Set());
    }
    // Ao abrir: seleciona todos. Se grupos mudarem enquanto aberto: preserva
    // as escolhas atuais e apenas adiciona os novos médicos como selecionados.
    setSelectedDoctorIds((prev) => {
      if (justOpened) return new Set(groups.map((g) => g.doctor_id));
      const next = new Set(prev);
      for (const g of groups) if (!next.has(g.doctor_id)) next.add(g.doctor_id);
      return next;
    });
    setParcelasByDoctor((prev) => {
      const next: Record<string, number> = justOpened ? {} : { ...prev };
      for (const g of groups) {
        if (!justOpened && next[g.doctor_id] != null) continue;
        const subtotal = g.items.reduce((s, r) => s + getTvrValorRecuperar(r), 0);
        next[g.doctor_id] = suggestParcelas(subtotal);
      }
      return next;
    });
  }, [open, groupsKey, actionable.length, retirar.length, canGerarGlosa, groups]);

  // Líquido da PJ no lote vigente, casando hospital + centro de custos + trilha.
  // Chave: company_id → snapshot do lote (referência, competência, líquido).
  // Sem lote → PJ vai para "débito futuro" (fila de espera até nova produção).
  type RefLote = {
    payment_id: string;
    reference: string;
    competence_month: string;
    liquido_total: number;
    status: string;
  };
  const [refLoteByCompany, setRefLoteByCompany] = useState<Record<string, RefLote>>({});
  const [refLoteLoading, setRefLoteLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const companyIds = Array.from(
      new Set(groups.map((g) => g.company_id).filter((v): v is string => !!v)),
    );
    if (
      companyIds.length === 0
      || !refScope.hospital_id
      || !refScope.cost_center_code
      || !refScope.analysis_mode
    ) {
      setRefLoteByCompany({});
      return;
    }
    let cancelled = false;
    setRefLoteLoading(true);
    (async () => {
      // Buscamos todos os pagamentos abertos (não cancelados) do mesmo CC+trilha
      // e cruzamos com payment_company_groups pra achar o líquido da PJ.
      // Ordem: competência mais recente primeiro; ficamos com o 1º por company_id.
      const { data: payments, error: payErr } = await supabase
        .from("payments")
        .select("id, reference, competence_month, status")
        .eq("hospital_id", refScope.hospital_id)
        .eq("cost_center_code", refScope.cost_center_code)
        .eq("analysis_mode", refScope.analysis_mode as never)
        .neq("status", "cancelado" as never)
        .order("competence_month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (payErr || !payments || payments.length === 0) {
        setRefLoteByCompany({});
        setRefLoteLoading(false);
        return;
      }
      const paymentIds = payments.map((p) => p.id as string);
      const { data: pcgs, error: pcgErr } = await supabase
        .from("payment_company_groups")
        .select("payment_id, company_id, liquido_total, status")
        .in("payment_id", paymentIds)
        .in("company_id", companyIds);
      if (cancelled) return;
      if (pcgErr || !pcgs) {
        setRefLoteByCompany({});
        setRefLoteLoading(false);
        return;
      }
      const paymentIndex = new Map(payments.map((p, i) => [p.id as string, i]));
      const bestByCompany = new Map<string, { pcg: typeof pcgs[number]; order: number }>();
      for (const g of pcgs) {
        const order = paymentIndex.get(g.payment_id as string) ?? 999;
        const prev = bestByCompany.get(g.company_id as string);
        if (!prev || order < prev.order) {
          bestByCompany.set(g.company_id as string, { pcg: g, order });
        }
      }
      const out: Record<string, RefLote> = {};
      for (const [companyId, { pcg }] of bestByCompany) {
        const p = payments.find((pp) => pp.id === pcg.payment_id);
        if (!p) continue;
        out[companyId] = {
          payment_id: p.id as string,
          reference: (p.reference as string) ?? "",
          competence_month: (p.competence_month as string) ?? "",
          liquido_total: Number(pcg.liquido_total ?? 0),
          status: String(pcg.status ?? ""),
        };
      }
      setRefLoteByCompany(out);
      setRefLoteLoading(false);
    })().catch(() => { if (!cancelled) setRefLoteLoading(false); });
    return () => { cancelled = true; };
  }, [open, groups, refScope.hospital_id, refScope.cost_center_code, refScope.analysis_mode]);

  // Números aqui vêm literalmente do mesmo objeto que alimenta os cards
  // "Total a complementar" / "Total a retirar" do relatório — o pai calcula
  // uma vez via computeTvrHeadlineTotals(results) e passa pra cá.
  // Divergência é impossível por construção.
  const totalBaseComp = headline.totalComplementar;
  const totalAcordoRet = headline.totalRetirar;


  const toggleDoctor = (id: string) => {
    setSelectedDoctorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2 shrink-0">
          <DialogTitle>Encaminhar apuração</DialogTitle>
          <DialogDescription>
            Revise os dois caminhos antes de confirmar. Ações são executadas em sequência.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-6 py-2 flex-1 min-h-0">
          {/* Caminho A */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                checked={includeComplementar}
                disabled={actionable.length === 0 || busy}
                onCheckedChange={(v) => setIncludeComplementar(!!v)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  ✅ A complementar → novo repasse para confecção
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {actionable.length} item(ns) · Base {brl(totalBaseComp)} (regra aplica acordo na confecção)
                </div>
                {actionable.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-primary mt-1 underline"
                    onClick={() => setShowCompList((v) => !v)}
                  >
                    {showCompList ? "ocultar itens ▴" : "ver itens ▾"}
                  </button>
                )}
                {showCompList && (
                  <div className="mt-2 max-h-40 overflow-auto rounded border border-border bg-background text-[11px]">
                    {actionable.map((r) => (
                      <div key={r.key} className="flex justify-between gap-2 px-2 py-1 border-b border-border last:border-b-0">
                        <span className="truncate">{r.atendimento}/{r.tuss} · {r.procedimento || "—"}</span>
                        <span className="font-mono">{brl(r.status === "nao_pago" ? r.valor_total_tasy : Math.max(0, r.dif_valor))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Caminho B */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 text-base">⚠️</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  A retirar → Glosa de auditoria {modoMedicoUnico ? "" : "(por médico)"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {retirar.length} item(ns) · <span className="font-semibold text-destructive">C/ acordo {brl(totalAcordoRet)}</span>
                  {!modoMedicoUnico && groups.length > 0 && ` · ${groups.length} médico(s)`}
                </div>
                {!canGerarGlosa && retirar.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    {modoMedicoUnico
                      ? "Apuração precisa ter PJ e médico vinculados para gerar a glosa."
                      : "Apuração precisa ter PJ vinculada e itens com médico identificado nos pagamentos para gerar a glosa."}
                  </div>
                )}
                {unassigned.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    {unassigned.length} item(ns) sem médico identificado no pagamento — não atribuíveis e serão ignorados.
                  </div>
                )}
                <RadioGroup
                  value={gerarGlosa}
                  onValueChange={(v) => setGerarGlosa(v as "agora" | "depois")}
                  className="mt-2"
                  disabled={busy || retirar.length === 0}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="g-agora" value="agora" disabled={!canGerarGlosa || retirar.length === 0} />
                    <Label htmlFor="g-agora" className="text-xs font-normal">
                      Gerar glosa agora
                    </Label>
                  </div>
                  {gerarGlosa === "agora" && groups.length > 0 && (
                    <div className="ml-6 mt-2 space-y-2">

                      {!modoMedicoUnico && (
                        <div className="flex items-center justify-between gap-2 text-[11px] rounded border border-border bg-muted/30 px-2 py-1.5">
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{selectedDoctorIds.size}</span> de {groups.length} médico(s) selecionado(s)
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="text-primary underline disabled:opacity-40 disabled:no-underline"
                              disabled={busy || selectedDoctorIds.size === groups.length}
                              onClick={() => setSelectedDoctorIds(new Set(groups.map((g) => g.doctor_id)))}
                            >
                              Selecionar todos
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground underline disabled:opacity-40 disabled:no-underline"
                              disabled={busy || selectedDoctorIds.size === 0}
                              onClick={() => setSelectedDoctorIds(new Set())}
                            >
                              Limpar
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground rounded border border-dashed border-border bg-background/60 px-2 py-1.5 leading-snug">
                        Cada débito fica <span className="font-semibold text-foreground">ativo</span> por médico e é abatido
                        automaticamente no próximo lote da PJ. Médicos sem pagamento em aberto entram na fila e são
                        cobrados assim que houver produção — não precisa tratar em separado.
                      </div>
                      <div className="rounded border border-border bg-background divide-y divide-border">
                        {(() => {
                          // Agrupa visualmente por PJ — sempre tratamos a PJ primeiro,
                          // depois os médicos vinculados a ela. PJs ambíguas ficam por último.
                          const byPj = new Map<string, { key: string; company_name: string; items: typeof groups }>();
                          for (const g of groups) {
                            const key = g.company_id ?? "__ambigua__";
                            const label = g.company_name ?? "PJ a resolver no envio (múltiplas ativas)";
                            const bucket = byPj.get(key) ?? { key, company_name: label, items: [] };
                            bucket.items.push(g);
                            byPj.set(key, bucket);
                          }
                          const pjList = Array.from(byPj.values()).sort((a, b) => {
                            if (a.key === "__ambigua__") return 1;
                            if (b.key === "__ambigua__") return -1;
                            return a.company_name.localeCompare(b.company_name);
                          });
                          return pjList.map((pj) => {
                            const pjSubtotal = pj.items.reduce(
                              (s, g) => s + g.items.reduce((ss, r) => ss + getTvrValorRecuperar(r), 0),
                              0,
                            );
                            const pjDoctorIds = pj.items.map((g) => g.doctor_id);
                            const pjAllSel = pjDoctorIds.every((id) => selectedDoctorIds.has(id));
                            const pjSomeSel = pjDoctorIds.some((id) => selectedDoctorIds.has(id));
                            const refLote = pj.key !== "__ambigua__" ? refLoteByCompany[pj.key] : undefined;
                            // Somamos o parcelamento previsto por médico dentro da PJ
                            // pra estimar quanto entra no PRÓXIMO lote (1ª parcela).
                            const proximaParcelaPJ = pj.items
                              .filter((g) => selectedDoctorIds.has(g.doctor_id))
                              .reduce((s, g) => {
                                const sub = g.items.reduce((ss, r) => ss + getTvrValorRecuperar(r), 0);
                                const n = Math.max(1, parcelasByDoctor[g.doctor_id] ?? 1);
                                return s + sub / n;
                              }, 0);
                            const liquido = refLote?.liquido_total ?? 0;
                            const cabe = refLote ? proximaParcelaPJ <= liquido + 0.005 : false;
                            const faltando = refLote ? Math.max(0, proximaParcelaPJ - liquido) : 0;
                            const fitParcelas = (): void => {
                              // Ajusta cada médico da PJ pra que a soma das 1ªs parcelas caiba no líquido.
                              // Distribuímos proporcionalmente ao subtotal de cada médico.
                              if (!refLote || liquido <= 0) return;
                              setParcelasByDoctor((prev) => {
                                const next = { ...prev };
                                for (const g of pj.items) {
                                  if (!selectedDoctorIds.has(g.doctor_id)) continue;
                                  const sub = g.items.reduce((ss, r) => ss + getTvrValorRecuperar(r), 0);
                                  if (sub <= 0) continue;
                                  const share = (sub / pjSubtotal) * liquido;
                                  const nCalc = Math.ceil(sub / Math.max(share, 0.01));
                                  next[g.doctor_id] = Math.min(24, Math.max(1, nCalc));
                                }
                                return next;
                              });
                            };
                            return (
                              <div key={pj.key}>
                                <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40 text-[11px] font-semibold sticky top-0">
                                  <Checkbox
                                    checked={pjAllSel ? true : pjSomeSel ? "indeterminate" : false}
                                    disabled={busy}
                                    onCheckedChange={() => {
                                      // Alterna todos os médicos da PJ de uma vez.
                                      setSelectedDoctorIds((prev) => {
                                        const next = new Set(prev);
                                        if (pjAllSel) {
                                          for (const id of pjDoctorIds) next.delete(id);
                                        } else {
                                          for (const id of pjDoctorIds) next.add(id);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="flex-1 min-w-0 truncate uppercase tracking-wide text-[10px] text-muted-foreground">
                                    PJ · <span className="text-foreground normal-case tracking-normal">{pj.company_name}</span>
                                  </span>
                                  <span className="text-muted-foreground font-normal">{pj.items.length} médico(s)</span>
                                  <span className="font-mono w-24 text-right">{brl(pjSubtotal)}</span>
                                </div>
                                {/* UI de parcelamento/fit removida: encaminhar
                                    é só encaminhar. Débito ativa e é abatido
                                    integralmente no próximo lote da PJ. */}
                                {pj.items.map((g) => {
                                  const subtotal = g.items.reduce((s, r) => s + getTvrValorRecuperar(r), 0);
                                  const isExpanded = expandedGroups.has(g.doctor_id);
                                  const isSel = selectedDoctorIds.has(g.doctor_id);
                                  return (
                                    <div key={g.doctor_id} className="px-2 py-1.5 pl-6 text-[11px] border-t border-border/40">
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          checked={isSel}
                                          disabled={busy}
                                          onCheckedChange={() => toggleDoctor(g.doctor_id)}
                                        />
                                        <div className="flex-1 min-w-0 truncate">
                                          <span className="font-medium">{g.doctor_name}</span>
                                          {g.doctor_crm && <span className="text-muted-foreground"> ({g.doctor_crm})</span>}
                                        </div>
                                        <span className="text-muted-foreground">{g.items.length} itens</span>
                                        <span className="font-mono w-24 text-right">{brl(subtotal)}</span>
                                        {/* Select de parcelas removido — encaminhamento é sempre 1× */}
                                        <button
                                          type="button"
                                          className="text-[10px] text-destructive underline"
                                          onClick={() => toggleGroupExpand(g.doctor_id)}
                                        >
                                          {isExpanded ? "ocultar" : "ver itens"}
                                        </button>
                                      </div>
                                      {isExpanded && (
                                        <div className="mt-1 ml-6 max-h-32 overflow-auto rounded bg-muted/40">
                                          {g.items.map((r) => (
                                            <div key={r.key} className="flex justify-between gap-2 px-2 py-1 border-b border-border/50 last:border-b-0">
                                              <span className="truncate">{r.atendimento}/{r.tuss} · {r.procedimento || "—"}</span>
                                              <span className="font-mono">{brl(getTvrValorRecuperar(r))}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="g-depois" value="depois" />
                    <Label htmlFor="g-depois" className="text-xs font-normal">
                      Não gerar — tratar depois
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-3 border-t shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm({
              includeComplementar,
              gerarGlosa: gerarGlosa === "agora" && retirar.length > 0 && canGerarGlosa && selectedDoctorIds.size > 0,
              parcelas: parcelas > 0 ? parcelas : 1,
              parcelasByDoctor,
              selectedDoctorIds: Array.from(selectedDoctorIds),
            })}
            disabled={
              busy ||
              (!includeComplementar &&
                (gerarGlosa !== "agora" || retirar.length === 0 || selectedDoctorIds.size === 0))
            }
          >
            {busy ? "Processando..." : "Confirmar encaminhamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Suppress unused-import warnings for fields that may be imported but only used conditionally.
void ([] as TargetField[]);

// Popover multi-seleção com busca — usado nos filtros de PJ e Médico no
// toolbar dos resultados. Mesmo padrão visual do filtro de status.
