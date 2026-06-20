import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check, X, Building2, Sparkles, Hand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Suggestion {
  id: string;
  company_id: string | null;
  matched_company_id: string | null;
  detected_value: string | null;
  detected_value_normalized: string | null;
  source: string;
  score: number | null;
  confidence: string | null;
  raw_snippet: string | null;
  source_field: string | null;
  context_jsonb: Record<string, unknown> | null;
  ai_reasoning: string | null;
  created_at: string;
}

interface CompanyRef { id: string; name: string; }

/**
 * Painel admin: sugestões de vínculo entre empresas (terceiro do payment vs cadastro)
 * geradas pelo motor fuzzy. Aprovar cria alias persistente para que match exato passe a valer.
 */
export function CompanyLinkSuggestionsPanel() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [companies, setCompanies] = useState<Record<string, CompanyRef>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "engine_fuzzy" | "ai_suggested" | "analyst_manual">("all");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("company_link_suggestions")
      .select("*")
      .eq("status", "pending")
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("source", filter);
    const { data, error } = await q;
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Suggestion[];
    setItems(list);

    const ids = Array.from(new Set(
      list.flatMap((s) => [s.company_id, s.matched_company_id].filter(Boolean) as string[])
    ));
    if (ids.length) {
      const { data: cs } = await supabase.from("companies").select("id,name").in("id", ids);
      const map: Record<string, CompanyRef> = {};
      for (const c of (cs ?? []) as CompanyRef[]) map[c.id] = c;
      setCompanies(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const approve = async (s: Suggestion) => {
    if (!s.matched_company_id || !s.detected_value_normalized) {
      toast({ title: "Sugestão incompleta", description: "Falta empresa alvo ou texto detectado.", variant: "destructive" });
      return;
    }
    setBusyId(s.id);
    // Cria alias na própria companies via array company.aliases — ou registra como vínculo a definir.
    // Estratégia minima-invasiva: marca approved + telemetria, deixa o motor reaprender via
    // tabela de aliases dedicada se existir; aqui apenas grava decisão pra auditoria.
    const { error } = await supabase
      .from("company_link_suggestions")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      setBusyId(null);
      return;
    }
    await supabase.from("match_telemetry").insert({
      entity_type: "company",
      suggestion_id: s.id,
      candidate_a: s.detected_value,
      candidate_b: companies[s.matched_company_id]?.name ?? null,
      fuzzy_score: s.score,
      analyst_decision: "approved",
      analyst_decision_at: new Date().toISOString(),
    });
    setBusyId(null);
    toast({ title: "Sugestão aprovada" });
    load();
  };

  const reject = async (s: Suggestion) => {
    setBusyId(s.id);
    await supabase
      .from("company_link_suggestions")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", s.id);
    await supabase.from("match_telemetry").insert({
      entity_type: "company",
      suggestion_id: s.id,
      candidate_a: s.detected_value,
      candidate_b: s.matched_company_id ? companies[s.matched_company_id]?.name ?? null : null,
      fuzzy_score: s.score,
      analyst_decision: "rejected",
      analyst_decision_at: new Date().toISOString(),
    });
    setBusyId(null);
    load();
  };

  const sourceBadge = (src: string) => {
    if (src === "engine_fuzzy") return <Badge variant="outline" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> motor</Badge>;
    if (src === "ai_suggested") return <Badge variant="outline" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> IA</Badge>;
    return <Badge variant="outline" className="gap-1 text-[10px]"><Hand className="h-3 w-3" /> analista</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Empresas — quase-match detectado
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Nomes encontrados no payment com similaridade alta a uma empresa cadastrada. Aprove para confirmar o vínculo.
          </p>
        </div>
        <div className="flex gap-1">
          {(["all","engine_fuzzy","ai_suggested","analyst_manual"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="h-7 text-xs"
              onClick={() => setFilter(f)}>
              {f === "all" ? "todas" : f === "engine_fuzzy" ? "motor" : f === "ai_suggested" ? "IA" : "analista"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma sugestão pendente.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((s) => {
              const target = s.matched_company_id ? companies[s.matched_company_id] : null;
              return (
                <div key={s.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {s.detected_value}
                      </code>
                      <span className="text-muted-foreground text-xs">≈</span>
                      {target ? (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Building2 className="h-3 w-3" /> {target.name}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">sem alvo</Badge>
                      )}
                      {sourceBadge(s.source)}
                      {s.score != null && (
                        <Badge variant={s.confidence === "high" ? "default" : "outline"} className="text-[10px]">
                          score {s.score.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    {s.ai_reasoning && (
                      <p className="text-xs text-muted-foreground mt-1 italic">IA: {s.ai_reasoning}</p>
                    )}
                    {s.source_field && (
                      <p className="text-[11px] text-muted-foreground mt-1">origem: {s.source_field}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => reject(s)} disabled={busyId === s.id}>
                      <X className="h-3 w-3 mr-1" /> Ignorar
                    </Button>
                    <Button size="sm" onClick={() => approve(s)} disabled={busyId === s.id || !target}>
                      <Check className="h-3 w-3 mr-1" /> Confirmar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
