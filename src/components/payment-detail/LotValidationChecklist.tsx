// LotValidationChecklist — Checklist único por lote (substitui o por empresa).
// Combina sinais determinísticos com 1 chamada à IA via edge function
// payment-lot-checklist. Cada item pode ter drill-down para uma empresa
// específica (clique navega para a âncora #group-<id>).
//
// Audiências:
//  - validator (default): full checklist com checkboxes
//  - director: resumo executivo read-only (sem checkboxes)

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type Audience = "validator" | "director";

interface ChecklistItem {
  text: string;
  priority: "alta" | "media" | "baixa";
  category: string;
  company_name?: string | null;
  source: "deterministic" | "ai";
}

interface Summary {
  empresas: number;
  total_lote: number;
  valor_em_risco: number;
  reprovado: number;
  alerta: number;
  sem_regra: number;
  bloqueantes: number;
  tuss_pendentes: number;
}

interface Props {
  paymentId: string;
  /** Mapa company_name -> group_id, para drill-down via âncora #group-<id>. */
  companyToGroupId?: Record<string, string>;
  audience?: Audience;
}

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PRIORITY_VARIANT: Record<ChecklistItem["priority"], "destructive" | "warning" | "muted"> = {
  alta: "destructive",
  media: "warning",
  baixa: "muted",
};
const PRIORITY_LABEL: Record<ChecklistItem["priority"], string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export function LotValidationChecklist({ paymentId, companyToGroupId, audience = "validator" }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [errored, setErrored] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [cached, setCached] = useState<boolean>(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setErrored(false);
    setSkipped(null);
    try {
      const { data, error } = await supabase.functions.invoke("payment-lot-checklist", {
        body: { payment_id: paymentId, audience, force_refresh: force },
      });
      if (error || !data?.ok) {
        setErrored(true);
        setItems([]);
        setSummary(null);
      } else {
        setItems(Array.isArray(data.items) ? data.items : []);
        setSummary(data.summary ?? null);
        setSkipped(typeof data.skipped === "string" ? data.skipped : null);
        setCached(Boolean(data.cached));
      }
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [paymentId, audience]);

  useEffect(() => { load(false); }, [load]);

  const isDirector = audience === "director";

  const goToCompany = (company: string | null | undefined) => {
    if (!company || !companyToGroupId) return;
    const gid = companyToGroupId[company];
    if (!gid) return;
    window.location.hash = `#group-${gid}`;
    // Hash assign não scrolla quando já está na hash; força.
    requestAnimationFrame(() => {
      document.getElementById(`group-${gid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const ariaTitle = isDirector ? "Resumo executivo do lote" : "Checklist de validação do lote";

  if (loading) {
    return (
      <Card className="border-violet-200 bg-violet-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-violet-600" />
            {ariaTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (errored || skipped || items.length === 0) return null;

  const toggle = (idx: number) => {
    const next = new Set(checked);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    setChecked(next);
  };

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-violet-600" />
          {ariaTitle}
          {!isDirector && (
            <span className="text-xs font-normal text-muted-foreground ml-auto">
              {checked.size}/{items.length} conferidos
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {summary && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pb-2 border-b border-violet-200/60 mb-1">
            <span><strong className="text-foreground">{summary.empresas}</strong> empresa(s)</span>
            <span>Total: <strong className="text-foreground">{BRL(summary.total_lote)}</strong></span>
            {summary.valor_em_risco > 0 && (
              <span>Em risco: <strong className="text-destructive">{BRL(summary.valor_em_risco)}</strong></span>
            )}
            {summary.bloqueantes > 0 && (
              <span className="text-destructive"><strong>{summary.bloqueantes}</strong> bloqueante(s)</span>
            )}
            {summary.tuss_pendentes > 0 && (
              <span className="text-destructive"><strong>{summary.tuss_pendentes}</strong> TUSS pendente(s)</span>
            )}
            {summary.sem_regra > 0 && (
              <span><strong className="text-foreground">{summary.sem_regra}</strong> sem regra</span>
            )}
          </div>
        )}
        {items.map((item, idx) => {
          const isChecked = checked.has(idx);
          const hasDrill = !!item.company_name && !!companyToGroupId?.[item.company_name];
          return (
            <div key={idx} className="flex items-start gap-2 p-2 rounded border bg-background">
              {!isDirector && (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggle(idx)}
                  className="mt-0.5"
                  aria-label={item.text}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <span className={`text-xs flex-1 ${isChecked && !isDirector ? "line-through text-muted-foreground" : ""}`}>
                    {item.text}
                  </span>
                  <Badge variant={PRIORITY_VARIANT[item.priority]} className="text-[10px] shrink-0">
                    {PRIORITY_LABEL[item.priority]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.category && (
                    <span className="text-[10px] text-muted-foreground">{item.category}</span>
                  )}
                  {item.source === "ai" && (
                    <span className="text-[10px] text-violet-600 inline-flex items-center gap-0.5">
                      <Sparkles className="h-2.5 w-2.5" /> IA
                    </span>
                  )}
                  {hasDrill && (
                    <button
                      type="button"
                      onClick={() => goToCompany(item.company_name)}
                      className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 ml-auto"
                    >
                      Ir para {item.company_name} <ChevronRight className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
