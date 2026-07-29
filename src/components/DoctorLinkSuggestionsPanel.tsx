import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Link2, X, Check, Building2, Sparkles, Hand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCNPJ } from "@/lib/cnpj";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";

interface Suggestion {
  id: string;
  doctor_id: string;
  detected_kind: string;
  detected_value: string;
  detected_value_normalized: string;
  matched_company_id: string | null;
  auto_resolution: string | null;
  status: string;
  raw_snippet: string | null;
  created_at: string;
  source?: string | null;
  score?: number | null;
  confidence?: string | null;
  ai_reasoning?: string | null;
}


interface DoctorRef { id: string; full_name: string; }
interface CompanyRef { id: string; name: string; document: string | null; }

/**
 * Painel admin: revisa CNPJs detectados em "Notas operacionais" dos médicos
 * e cria vínculo formal em doctor_companies (regra: vínculo nunca em texto livre).
 */
export function DoctorLinkSuggestionsPanel() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [doctors, setDoctors] = useState<Record<string, DoctorRef>>({});
  const [companies, setCompanies] = useState<Record<string, CompanyRef>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "engine_fuzzy" | "ai_suggested" | "analyst_manual">("all");


  const load = async () => {
    setLoading(true);
    const { data, error } = await (async () => {
      let q = supabase
        .from("doctor_link_suggestions")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("source", filter);
      return await q;
    })();
    if (error) { toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" }); setLoading(false); return; }

    const list = (data ?? []) as Suggestion[];
    setItems(list);

    const docIds = Array.from(new Set(list.map((s) => s.doctor_id)));
    const compIds = Array.from(new Set(list.map((s) => s.matched_company_id).filter(Boolean) as string[]));
    if (docIds.length) {
      const { data: ds } = await supabase.from("doctors").select("id,full_name").in("id", docIds);
      const map: Record<string, DoctorRef> = {};
      for (const d of (ds ?? []) as DoctorRef[]) map[d.id] = d;
      setDoctors(map);
    }
    if (compIds.length) {
      const { data: cs } = await supabase.from("companies").select("id,name,document").in("id", compIds);
      const map: Record<string, CompanyRef> = {};
      for (const c of (cs ?? []) as CompanyRef[]) map[c.id] = c;
      setCompanies(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const runScan = async () => {
    setScanning(true);
    const { data, error } = await supabase.rpc("scan_all_doctor_notes");
    setScanning(false);
    if (error) { toast({ title: "Falha na varredura", description: error.message, variant: "destructive" }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast({
      title: "Varredura concluída",
      description: `${row?.scanned ?? 0} médicos analisados · ${row?.suggestions_created ?? 0} sugestões novas · ${row?.matched ?? 0} prontas para vincular`,
    });
    load();
  };

  const approve = async (s: Suggestion) => {
    if (!s.matched_company_id) {
      toast({ title: "Sem PJ correspondente", description: "Cadastre a empresa antes de aprovar.", variant: "destructive" });
      return;
    }
    setBusyId(s.id);
    // cria vínculo se não existir
    const { data: existing } = await supabase
      .from("doctor_companies")
      .select("id")
      .eq("doctor_id", s.doctor_id)
      .eq("company_id", s.matched_company_id)
      .is("end_date", null)
      .maybeSingle();
    if (!existing) {
      const hid = await resolveActiveHospitalId();
      if (!hid) { setBusyId(null); toast({ title: "Erro ao vincular", description: "Hospital ativo não resolvido", variant: "destructive" }); return; }
      const { error } = await supabase.from("doctor_companies").insert({
        doctor_id: s.doctor_id,
        company_id: s.matched_company_id,
        start_date: new Date().toISOString().slice(0, 10),
        hospital_id: hid,
      });
      if (error) { setBusyId(null); toast({ title: "Erro ao vincular", description: error.message, variant: "destructive" }); return; }
    }
    await supabase
      .from("doctor_link_suggestions")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", s.id);
    setBusyId(null);
    toast({ title: "Vínculo criado" });
    load();
  };

  const reject = async (s: Suggestion) => {
    setBusyId(s.id);
    await supabase
      .from("doctor_link_suggestions")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", s.id);
    setBusyId(null);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Vínculos sugeridos a partir de observações
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            CNPJs encontrados em notas livres dos médicos. Aprove para criar o vínculo formal em <code>doctor_companies</code>.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {(["all","engine_fuzzy","ai_suggested","analyst_manual"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="h-7 text-xs"
                onClick={() => setFilter(f)}>
                {f === "all" ? "todas" : f === "engine_fuzzy" ? "motor" : f === "ai_suggested" ? "IA" : "analista"}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Varrer notas
          </Button>
        </div>

      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma sugestão pendente. Clique em "Varrer" para reanalisar a base.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((s) => {
              const doc = doctors[s.doctor_id];
              const comp = s.matched_company_id ? companies[s.matched_company_id] : null;
              return (
                <div key={s.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{doc?.full_name ?? "(médico)"}</span>
                      <span className="text-muted-foreground text-xs">menciona</span>
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {formatCNPJ(s.detected_value_normalized)}
                      </code>
                      {comp ? (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Building2 className="h-3 w-3" /> {comp.name}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">PJ não cadastrada</Badge>
                      )}
                      {s.source && s.source !== "analyst_manual" && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Sparkles className="h-3 w-3" /> {s.source === "engine_fuzzy" ? "motor" : "IA"}
                        </Badge>
                      )}
                      {s.source === "analyst_manual" && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Hand className="h-3 w-3" /> analista
                        </Badge>
                      )}
                      {s.score != null && (
                        <Badge variant={s.confidence === "high" ? "default" : "outline"} className="text-[10px]">
                          score {Number(s.score).toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    {s.ai_reasoning && (
                      <p className="text-xs text-muted-foreground mt-1 italic">IA: {s.ai_reasoning}</p>
                    )}
                    {s.raw_snippet && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">"{s.raw_snippet}"</p>
                    )}

                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => reject(s)} disabled={busyId === s.id}>
                      <X className="h-3 w-3 mr-1" /> Ignorar
                    </Button>
                    <Button size="sm" onClick={() => approve(s)} disabled={busyId === s.id || !comp}>
                      <Check className="h-3 w-3 mr-1" /> Vincular
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
