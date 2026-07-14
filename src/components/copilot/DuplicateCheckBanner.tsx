import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Candidate {
  id: string;
  label: string;
  document?: string | null;
  meta?: string;
}

interface Props {
  newEntity: { name: string; document?: string | null; type: "doctor" | "company" | "convenio" | "sector" };
  candidates: Candidate[];
  /**
   * Match determinístico (fuzzy) já calculado pelo chamador — se vier, é
   * exibido sem custo. IA nunca roda automaticamente. Mantido opcional para
   * não obrigar refactor dos chamadores atuais.
   */
  deterministicHit?: { candidate_id: string; confidence: number; reason?: string } | null;
}

/**
 * Alerta de possível duplicata em cadastro novo.
 *
 * Comportamento:
 *  - Se `deterministicHit` vier, mostra o alerta imediatamente (custo zero).
 *  - IA (task `suggest_duplicate`) só é acionada quando o usuário clica em
 *    "Verificar com IA". Sem debounce, sem chamada automática enquanto digita.
 *  - Nunca bloqueia o salvamento — só alerta.
 */
export function DuplicateCheckBanner({ newEntity, candidates, deterministicHit }: Props) {
  const [loading, setLoading] = useState(false);
  const [aiHit, setAiHit] = useState<null | { candidate_id: string; confidence: number; reasoning: string }>(null);
  const [aiChecked, setAiChecked] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const canCheck =
    !!newEntity.name && newEntity.name.trim().length >= 4 && candidates.length > 0;

  const runAi = async () => {
    if (!canCheck || loading) return;
    setLoading(true);
    setAiError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-copilot", {
        body: {
          task: "suggest_duplicate",
          context: { new_entity: newEntity, candidates: candidates.slice(0, 20) },
        },
      });
      if (error) {
        setAiError(error.message || "Falha na verificação");
        return;
      }
      const r = (data as { result?: { is_duplicate?: boolean; candidate_id?: string; confidence?: number; reasoning?: string } })?.result;
      if (r?.is_duplicate && r.candidate_id && (r.confidence ?? 0) >= 0.7) {
        setAiHit({ candidate_id: r.candidate_id, confidence: r.confidence ?? 0, reasoning: r.reasoning ?? "" });
      }
      setAiChecked(true);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const hit = aiHit
    ? { ...aiHit, source: "ai" as const }
    : deterministicHit
      ? {
          candidate_id: deterministicHit.candidate_id,
          confidence: deterministicHit.confidence,
          reasoning: deterministicHit.reason ?? "",
          source: "fuzzy" as const,
        }
      : null;

  if (!hit) {
    // Sem match determinístico e sem verificação IA feita — apenas oferece o botão.
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={runAi}
          disabled={!canCheck || loading}
        >
          {loading ? (
            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Verificando…</>
          ) : (
            <><ZeevIcon className="h-3 w-3 mr-1 text-primary" /> Verificar com IA</>
          )}
        </Button>
        {aiChecked && !aiHit && !loading && (
          <span className="text-[10px]">Nenhuma duplicata provável.</span>
        )}
        {aiError && <span className="text-[10px] text-destructive">{aiError}</span>}
      </div>
    );
  }

  const target = candidates.find((c) => c.id === hit.candidate_id);
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4" /> Possível duplicata
        <Badge variant="outline" className="gap-1 text-[10px]">
          {hit.source === "ai" ? (
            <><ZeevIcon className="h-3 w-3" /> IA · {Math.round(hit.confidence * 100)}%</>
          ) : (
            <>Fuzzy · {Math.round(hit.confidence * 100)}%</>
          )}
        </Badge>
      </div>
      <p className="text-xs text-amber-900/90 dark:text-amber-200/90">
        Já existe um cadastro semelhante: <span className="font-medium">{target?.label ?? hit.candidate_id}</span>
        {target?.document && <span className="text-muted-foreground"> · {target.document}</span>}
      </p>
      {hit.reasoning && <p className="text-xs italic text-amber-800/80 dark:text-amber-300/80">{hit.reasoning}</p>}
      <div className="flex items-center gap-2 pt-1">
        <p className="text-[10px] text-muted-foreground flex-1">
          {hit.source === "ai" ? "Sugestão da IA" : "Sugestão determinística"} — confirme antes de salvar. Você ainda pode prosseguir.
        </p>
        {hit.source === "fuzzy" && !aiChecked && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={runAi}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar com IA"}
          </Button>
        )}
      </div>
    </div>
  );
}
