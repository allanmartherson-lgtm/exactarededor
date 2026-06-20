import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Hand, Bot, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTimeBR } from "@/lib/dateUtils";

interface Row {
  id: string;
  entity_type: string;
  candidate_a: string | null;
  candidate_b: string | null;
  fuzzy_score: number | null;
  ai_invoked: boolean | null;
  ai_decision: boolean | null;
  ai_confidence: number | null;
  ai_response: { reasoning?: string } | null;
  analyst_decision: string | null;
  analyst_decision_at: string | null;
  created_at: string;
}

interface Bucket {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  aiInvoked: number;
  aiAgreed: number;
}

function emptyBucket(): Bucket {
  return { total: 0, approved: 0, rejected: 0, pending: 0, aiInvoked: 0, aiAgreed: 0 };
}

export default function CopilotTelemetry() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("match_telemetry")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const byEntity: Record<string, Bucket> = {};
  for (const r of rows) {
    const b = (byEntity[r.entity_type] ??= emptyBucket());
    b.total++;
    if (r.analyst_decision === "approved") b.approved++;
    else if (r.analyst_decision === "rejected") b.rejected++;
    else b.pending++;
    if (r.ai_invoked) {
      b.aiInvoked++;
      // IA "concordou" se decisão da IA == decisão final do analista (true=>approved)
      if (
        (r.ai_decision === true && r.analyst_decision === "approved") ||
        (r.ai_decision === false && r.analyst_decision === "rejected")
      ) b.aiAgreed++;
    }
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-purple-600" />
        <h1 className="text-2xl font-semibold">Telemetria do Copiloto</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Monitoramento das sugestões geradas pelo motor fuzzy e pela IA, e as decisões dos analistas.
        Use para calibrar thresholds e confiança da IA.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {(["doctor","company","convenio","sector"] as const).map((k) => {
              const b = byEntity[k] ?? emptyBucket();
              const rate = b.total ? Math.round((b.approved / b.total) * 100) : 0;
              const aiAgreeRate = b.aiInvoked ? Math.round((b.aiAgreed / b.aiInvoked) * 100) : null;
              return (
                <Card key={k}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm capitalize">{k === "doctor" ? "Médicos" : k === "company" ? "Empresas" : k === "convenio" ? "Convênios" : "Setores"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    <div>Total: <span className="font-medium">{b.total}</span></div>
                    <div className="flex gap-3">
                      <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{b.approved}</span>
                      <span className="text-red-600 flex items-center gap-1"><XCircle className="h-3 w-3" />{b.rejected}</span>
                      <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{b.pending}</span>
                    </div>
                    <div>Taxa aprovação: <span className="font-medium">{rate}%</span></div>
                    {aiAgreeRate != null && (
                      <div className="text-purple-700">IA acertou: <span className="font-medium">{aiAgreeRate}%</span> ({b.aiInvoked} chamadas)</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Últimas decisões</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border">
              {rows.slice(0, 50).map((r) => (
                <div key={r.id} className="py-2 flex items-start gap-3 text-xs">
                  <Badge variant="outline" className="capitalize shrink-0">{r.entity_type}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono truncate">
                      <span className="text-muted-foreground">{r.candidate_a}</span>
                      <span className="mx-1">≈</span>
                      <span>{r.candidate_b}</span>
                    </div>
                    {r.ai_response?.reasoning && (
                      <div className="text-purple-700 italic line-clamp-2 mt-0.5 flex items-start gap-1">
                        <Bot className="h-3 w-3 mt-0.5 shrink-0" /> {r.ai_response.reasoning}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    {r.fuzzy_score != null && <div className="text-muted-foreground">score {r.fuzzy_score.toFixed(2)}</div>}
                    {r.analyst_decision ? (
                      <Badge variant={r.analyst_decision === "approved" ? "default" : "destructive"} className="text-[10px]">
                        <Hand className="h-3 w-3 mr-1" /> {r.analyst_decision}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">pendente</Badge>
                    )}
                    <div className="text-muted-foreground">{formatDateTimeBR(r.created_at)}</div>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Sem registros ainda.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
