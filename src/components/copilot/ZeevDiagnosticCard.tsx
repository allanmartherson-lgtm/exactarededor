import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, MapPin, Building2, ShieldQuestion, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Counts = {
  total: number;
  sem_setor: number;
  sem_cc: number;
  sem_empresa: number;
  sem_regra: number;
  divergentes: number;
  zerados: number;
};

type Bucket = {
  id: string;
  label: string;
  count: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "danger" | "warn" | "info";
  /** Filtro do grid; quando definido, dispara zeev:apply-filter. */
  filter?: "divergentes" | "sem_regra" | "reprovados" | "zerados";
  /** Prompt a executar no chat (quando não há filtro adequado). */
  chatPrompt?: string;
};

interface Props {
  paymentId: string;
  /** Se definido, o pre-flight conta só itens dessa empresa (escopo da tela atual). */
  companyId?: string | null;
  /** Nome amigável para exibir no header ("Pre-flight da empresa X"). */
  companyName?: string | null;
  /** Disparado quando usuário clica em um filtro — fecha o popover do Zeev. */
  onActed?: () => void;
  /** Chama o tab "chat" e injeta um prompt inicial. */
  onSendChatPrompt?: (prompt: string) => void;
}

/**
 * Diagnóstico do lote — Fase 1 do Zeev v2.
 * Card pré-flight que lista o que falta resolver agrupado por categoria,
 * com 1 clique por etapa (filtro ou prompt no chat).
 */
export function ZeevDiagnosticCard({ paymentId, companyId, companyName, onActed, onSendChatPrompt }: Props) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Refetch sempre que o Zeev aplicar algo
  useEffect(() => {
    const handler = () => setRefreshNonce((n) => n + 1);
    window.addEventListener("zeev:applied", handler);
    return () => window.removeEventListener("zeev:applied", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // CC do lote propaga pra itens sem CC. Se o lote já tem CC, não conta "itens sem CC".
      const { data: pay } = await supabase
        .from("payments")
        .select("cost_center_code")
        .eq("id", paymentId)
        .maybeSingle();
      const loteCc = (pay as { cost_center_code?: string | null } | null)?.cost_center_code ?? null;
      const loteHasCc = !!loteCc && String(loteCc).trim() !== "";

      let query = supabase
        .from("payment_items")
        .select(
          "id, ai_status, gross_amount, manual_intervention_reason_id, ai_findings, company_id, sector, cost_center_code, is_pool_item",
        )
        .eq("payment_id", paymentId)
        .limit(20000);
      // Escopo da empresa quando o Zeev roda dentro de /empresa/:companyId — evita
      // contar pendências de outras empresas do mesmo lote.
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query;
      if (cancelled) return;
      if (error || !data) {
        setCounts(null);
        setLoading(false);
        return;
      }
      const c: Counts = {
        total: 0,
        sem_setor: 0,
        sem_cc: 0,
        sem_empresa: 0,
        sem_regra: 0,
        divergentes: 0,
        zerados: 0,
      };
      for (const it of data as Array<Record<string, unknown>>) {
        c.total++;
        const gross = Number(it.gross_amount ?? 0);
        if (!gross) c.zerados++;
        const status = it.ai_status as string | null;
        if ((status === "reprovado" || status === "alerta") && !it.manual_intervention_reason_id) {
          c.divergentes++;
        }
        const findings = it.ai_findings as { needs_human_review?: boolean } | null;
        if (findings?.needs_human_review) c.sem_regra++;
        if (!it.sector || it.sector === "") c.sem_setor++;
        if (!loteHasCc && (!it.cost_center_code || it.cost_center_code === "")) c.sem_cc++;
        if (!it.company_id && !it.is_pool_item) c.sem_empresa++;
      }
      setCounts(c);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, refreshNonce]);

  const buckets: Bucket[] = useMemo(() => {
    if (!counts) return [];
    const out: Bucket[] = [];
    if (counts.sem_setor > 0) {
      out.push({
        id: "sem_setor",
        label: "Itens sem setor",
        count: counts.sem_setor,
        hint: 'Aplicar setor em lote ("define setor X nos itens sem setor")',
        icon: MapPin,
        tone: "warn",
        chatPrompt: `Define o setor nos ${counts.sem_setor} itens sem setor deste lote`,
      });
    }
    if (counts.sem_cc > 0) {
      out.push({
        id: "sem_cc",
        label: "Itens sem centro de custos",
        count: counts.sem_cc,
        hint: "Aplicar CC em lote",
        icon: Building2,
        tone: "warn",
        chatPrompt: `Define o centro de custos nos ${counts.sem_cc} itens sem CC deste lote`,
      });
    }
    if (counts.sem_empresa > 0) {
      out.push({
        id: "sem_empresa",
        label: "Médicos sem PJ vinculada",
        count: counts.sem_empresa,
        hint: "Vincular médico → empresa",
        icon: Building2,
        tone: "danger",
        chatPrompt: `Vincula os médicos sem PJ deste lote`,
      });
    }
    if (counts.sem_regra > 0) {
      out.push({
        id: "sem_regra",
        label: "Itens sem regra calculada",
        count: counts.sem_regra,
        hint: "Filtrar no grid pra revisar",
        icon: ShieldQuestion,
        tone: "danger",
        filter: "sem_regra",
      });
    }
    if (counts.divergentes > 0) {
      out.push({
        id: "divergentes",
        label: "Divergências sem tratativa",
        count: counts.divergentes,
        hint: "Filtrar no grid",
        icon: AlertTriangle,
        tone: "warn",
        filter: "divergentes",
      });
    }
    if (counts.zerados > 0) {
      out.push({
        id: "zerados",
        label: "Itens com valor zerado",
        count: counts.zerados,
        hint: "Filtrar no grid",
        icon: AlertTriangle,
        tone: "info",
        filter: "zerados",
      });
    }
    return out;
  }, [counts]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3 w-3 animate-spin" /> Diagnosticando o lote…
      </div>
    );
  }
  if (!counts) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        Não consegui ler os itens deste lote agora.
      </div>
    );
  }
  if (buckets.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 p-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-[12px] leading-snug text-foreground">
          Lote limpo — {counts.total} itens sem pendência operacional aparente. Pode seguir pra validação.
        </div>
      </div>
    );
  }

  const handleFilter = (filter: NonNullable<Bucket["filter"]>) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zeev:apply-filter", { detail: { filter } }));
    }
    onActed?.();
  };

  const handleChat = (prompt: string) => {
    onSendChatPrompt?.(prompt);
  };

  const toneClass: Record<Bucket["tone"], string> = {
    danger: "border-rose-300 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20",
    warn: "border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20",
    info: "border-sky-300 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Pre-flight do lote · {counts.total} itens</span>
        <span className="text-foreground/60">{buckets.reduce((s, b) => s + b.count, 0)} pendentes</span>
      </div>
      <ul className="space-y-1.5">
        {buckets.map((b) => {
          const Icon = b.icon;
          return (
            <li key={b.id} className={cn("rounded-lg border p-2.5 flex items-center gap-2.5", toneClass[b.tone])}>
              <Icon className="h-4 w-4 text-foreground/70 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold leading-tight">
                  <span className="tabular-nums">{b.count}</span>{" "}
                  <span className="text-muted-foreground font-normal">· {b.label}</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{b.hint}</div>
              </div>
              {b.filter ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 shrink-0"
                  onClick={() => handleFilter(b.filter!)}
                >
                  Filtrar <ArrowRight className="h-2.5 w-2.5 ml-1" />
                </Button>
              ) : b.chatPrompt ? (
                <Button
                  size="sm"
                  className="h-6 text-[10px] px-2 shrink-0"
                  onClick={() => handleChat(b.chatPrompt!)}
                >
                  Resolver <ArrowRight className="h-2.5 w-2.5 ml-1" />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
