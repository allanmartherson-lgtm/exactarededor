import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { BrainCircuit, EyeOff, Archive, RefreshCw } from "lucide-react";

interface Pattern {
  id: string;
  kind: string;
  scope: Record<string, any>;
  signal: Record<string, any>;
  occurrences: number;
  confidence: number;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  silenced_reason: string | null;
}

const KIND_LABEL: Record<string, string> = {
  exclusao: "Exclusão recorrente",
  ausencia: "Ausência recorrente",
  override_valor: "Override de valor",
  aceitar_divergencia: "Aceitação de divergência",
};

export default function LearnedPatterns() {
  const selectedHospitalId = useActiveHospitalId();
  const [items, setItems] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ativo" | "silenciado" | "arquivado" | "todos">("ativo");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!selectedHospitalId) return;
    setLoading(true);
    let q = supabase
      .from("learned_patterns")
      .select("*")
      .eq("hospital_id", selectedHospitalId)
      .order("confidence", { ascending: false })
      .order("occurrences", { ascending: false })
      .limit(500);
    if (statusFilter !== "todos") q = q.eq("status", statusFilter);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar padrões", variant: "destructive" }); return; }
    setItems((data ?? []) as Pattern[]);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selectedHospitalId, statusFilter]);

  const change = async (id: string, status: "silenciado" | "arquivado" | "ativo") => {
    setBusy(id);
    const reason = status === "ativo" ? "" : (window.prompt("Motivo (opcional):") ?? "");
    const { error } = await supabase.rpc("silence_learned_pattern", {
      _pattern_id: id, _reason: reason, _new_status: status,
    });
    setBusy(null);
    if (error) { toast({ title: "Falha", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Padrão atualizado" });
    load();
  };

  const filtered = items.filter(p => {
    if (!filter.trim()) return true;
    const t = filter.toLowerCase();
    return JSON.stringify(p.scope).toLowerCase().includes(t) || (KIND_LABEL[p.kind] ?? p.kind).toLowerCase().includes(t);
  });

  return (
    <div className="container max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <BrainCircuit className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Aprendizado de padrões</h1>
          <p className="text-sm text-muted-foreground">
            Consolida feedbacks aceitos das validações de empresa. Padrões com confiança ≥ 0.6
            geram alerta visual no próximo lote analisado.
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <Input placeholder="Filtrar por escopo ou tipo..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
        <div className="flex gap-1">
          {(["ativo","silenciado","arquivado","todos"] as const).map(s => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          {loading ? "Carregando..." : "Nenhum padrão registrado ainda. Aceite feedbacks de validações para começar a treinar."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{KIND_LABEL[p.kind] ?? p.kind}</Badge>
                    <Badge variant="outline" className={
                      p.confidence >= 0.6 ? "bg-success-soft text-success border-success/30"
                      : "bg-warning-soft text-warning-text border-warning/30"
                    }>
                      Confiança {Math.round(p.confidence * 100)}%
                    </Badge>
                    <Badge variant="outline">{p.occurrences}×</Badge>
                    {p.status !== "ativo" && (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">{p.status}</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {p.status === "ativo" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => change(p.id, "silenciado")}>
                          <EyeOff className="h-3 w-3 mr-1" /> Silenciar
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => change(p.id, "arquivado")}>
                          <Archive className="h-3 w-3 mr-1" /> Arquivar
                        </Button>
                      </>
                    )}
                    {p.status !== "ativo" && (
                      <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => change(p.id, "ativo")}>
                        Reativar
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(p.scope, null, 2)}</pre>
                {p.signal && Object.keys(p.signal).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Sinal: {JSON.stringify(p.signal)}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  Visto entre {new Date(p.first_seen_at).toLocaleDateString("pt-BR")} e {new Date(p.last_seen_at).toLocaleDateString("pt-BR")}
                  {p.silenced_reason && ` — motivo: ${p.silenced_reason}`}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
