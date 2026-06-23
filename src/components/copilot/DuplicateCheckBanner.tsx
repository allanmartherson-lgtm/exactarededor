import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";
import { Badge } from "@/components/ui/badge";
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
  /** Debounce em ms antes de chamar a IA. Default 800. */
  debounceMs?: number;
}

/**
 * Painel que verifica em background se o cadastro novo é provavelmente duplicata
 * de algum candidato existente. Usa a task `suggest_duplicate` do copiloto IA.
 * Nunca bloqueia o salvamento — só alerta.
 */
export function DuplicateCheckBanner({ newEntity, candidates, debounceMs = 800 }: Props) {
  const [loading, setLoading] = useState(false);
  const [hit, setHit] = useState<null | { candidate_id: string; confidence: number; reasoning: string }>(null);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    setHit(null);
    setSkipped(false);
    if (!newEntity.name || newEntity.name.trim().length < 4 || candidates.length === 0) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("ai-copilot", {
          body: {
            task: "suggest_duplicate",
            context: {
              new_entity: newEntity,
              candidates: candidates.slice(0, 20),
            },
          },
        });
        if (error) { setSkipped(true); return; }
        const r = (data as { result?: { is_duplicate?: boolean; candidate_id?: string; confidence?: number; reasoning?: string } })?.result;
        if (r?.is_duplicate && r.candidate_id && (r.confidence ?? 0) >= 0.7) {
          setHit({ candidate_id: r.candidate_id, confidence: r.confidence ?? 0, reasoning: r.reasoning ?? "" });
        }
      } catch {
        setSkipped(true);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [newEntity.name, newEntity.document, candidates.length, debounceMs, newEntity, candidates]);

  if (skipped) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
        <Loader2 className="h-3 w-3 animate-spin" /> IA verificando se já existe…
      </div>
    );
  }
  if (!hit) return null;

  const target = candidates.find((c) => c.id === hit.candidate_id);
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4" /> Possível duplicata
        <Badge variant="outline" className="gap-1 text-[10px]">
          <ZeevIcon className="h-3 w-3" /> IA · {Math.round(hit.confidence * 100)}%
        </Badge>
      </div>
      <p className="text-xs text-amber-900/90 dark:text-amber-200/90">
        Já existe um cadastro semelhante: <span className="font-medium">{target?.label ?? hit.candidate_id}</span>
        {target?.document && <span className="text-muted-foreground"> · {target.document}</span>}
      </p>
      {hit.reasoning && <p className="text-xs italic text-amber-800/80 dark:text-amber-300/80">{hit.reasoning}</p>}
      <p className="text-[10px] text-muted-foreground">Sugestão da IA — confirme antes de salvar. Você ainda pode prosseguir.</p>
    </div>
  );
}
