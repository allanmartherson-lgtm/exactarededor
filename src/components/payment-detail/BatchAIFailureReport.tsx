import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ExternalLink, RefreshCw, FileWarning, Download, Search, Loader2, Link2 } from "lucide-react";
import { learnCompanyAlias } from "@/lib/learnCompanyAlias";
import { useToast } from "@/hooks/use-toast";

type FailedCompany = { company_name: string; company_id?: string | null; error: string; at?: string };

type Job = {
  id: string;
  payment_id: string;
  status: string;
  failed_companies: FailedCompany[] | null;
  created_at: string;
  finished_at: string | null;
};

type TelemetryRow = {
  id: string;
  job_id: string | null;
  company_name: string | null;
  company_id?: string | null;
  error: string | null;
  ai_items_count: number | null;
  items_count: number | null;
  created_at: string;
};

type GroupRow = {
  id: string;
  company_name: string | null;
  company_id: string | null;
};

type ReportEntry = {
  companyName: string;
  type: "total" | "parcial";
  reason: string;
  groupId: string | null;
  companyId: string | null;
  matchSource: "name" | "id" | "fuzzy" | "none";
  at?: string;
};

function parsePartial(err: string | null): { failed: number; total: number; retries?: number } | null {
  if (!err) return null;
  const m = err.match(/ai_partial_failure:\s*(\d+)\s*\/\s*(\d+)\s*chunks falharam(?:\s*\(retries:\s*(\d+)\))?/i);
  if (!m) return null;
  return { failed: Number(m[1]), total: Number(m[2]), retries: m[3] ? Number(m[3]) : undefined };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

// Fuzzy normalization: strip accents, legal suffixes, punctuation, collapse spaces
function fuzzy(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\.?a\.?|s\/a|cnpj|cpf)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMatch(
  name: string | null | undefined,
  cid: string | null | undefined,
  byName: Map<string, GroupRow>,
  byId: Map<string, GroupRow>,
  byFuzzy: Map<string, GroupRow>,
): { group: GroupRow | null; source: "name" | "id" | "fuzzy" | "none" } {
  const n = norm(name);
  if (n && byName.has(n)) return { group: byName.get(n)!, source: "name" };
  if (cid && byId.has(cid)) return { group: byId.get(cid)!, source: "id" };
  const f = fuzzy(name);
  if (f && byFuzzy.has(f)) return { group: byFuzzy.get(f)!, source: "fuzzy" };
  return { group: null, source: "none" };
}

export function BatchAIFailureReport({ paymentId }: { paymentId: string }) {
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [rawNameToLink, setRawNameToLink] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; document: string | null; code: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: jobData }, { data: pay }] = await Promise.all([
      supabase
        .from("payment_processing_jobs")
        .select("id, payment_id, status, failed_companies, created_at, finished_at")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("payments").select("hospital_id").eq("id", paymentId).maybeSingle(),
    ]);

    const j = (jobData as Job | null) ?? null;
    setJob(j);
    setHospitalId(((pay as any)?.hospital_id as string | null) ?? null);

    const [{ data: tel }, { data: grp }] = await Promise.all([
      j
        ? supabase
            .from("analysis_telemetry")
            .select("id, job_id, company_name, error, ai_items_count, items_count, created_at")
            .eq("job_id", j.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as TelemetryRow[] } as { data: TelemetryRow[] }),
      supabase
        .from("payment_company_groups")
        .select("id, company_name, company_id")
        .eq("payment_id", paymentId),
    ]);

    setTelemetry((tel as TelemetryRow[]) ?? []);
    setGroups((grp as GroupRow[]) ?? []);
    setLoading(false);
  }, [paymentId]);

  useEffect(() => {
    load();
  }, [load]);

  const runSearch = useCallback(async (term: string) => {
    // Remove caracteres que o PostgREST interpreta como sintaxe de filtro,
    // evitando que o texto digitado injete condições extras no .or().
    const q = term.trim().replace(/[,()%.]/g, " ").trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from("companies")
      .select("id, name, document, code")
      .or(`name.ilike.%${q}%,document.ilike.%${q}%,code.ilike.%${q}%`)

      .eq("active", true)
      .order("name")
      .limit(20);
    setSearchResults((data as Array<{ id: string; name: string; document: string | null; code: string | null }>) ?? []);
    setSearching(false);
  }, []);

  const handleLink = useCallback(
    async (company: { id: string; name: string }) => {
      const raw = rawNameToLink.trim();
      if (!raw) {
        toast({ title: "Nome bruto vazio", variant: "destructive" });
        return;
      }
      setLinkingId(company.id);
      const res = await learnCompanyAlias(supabase, { companyId: company.id, rawName: raw });
      if (!res.ok) {
        setLinkingId(null);
        toast({ title: "Falha ao vincular", description: res.error ?? "Erro desconhecido", variant: "destructive" });
        return;
      }
      // Atualiza os itens deste pagamento que vieram com o nome bruto para apontar para a empresa cadastrada
      const { error: updErr } = await supabase
        .from("payment_items")
        .update({ company_id: company.id, company_name: company.name })
        .eq("payment_id", paymentId)
        .eq("company_name", raw);
      if (updErr) {
        console.warn("[BatchAIFailureReport] falha ao reapontar payment_items", updErr);
      }

      const { error: dispatchErr } = await supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: paymentId, only_companies: [company.name], run_ai: true },
      });
      setLinkingId(null);
      setSearchOpen(false);
      if (dispatchErr) {
        toast({
          title: "Vínculo criado, mas falha ao reanalisar",
          description: `Alias salvo em "${company.name}". Clique em "Reanalisar lote" manualmente. (${dispatchErr.message})`,
        });
      } else {
        toast({
          title: "Empresa vinculada",
          description: `"${raw}" agora aponta para "${company.name}". Reanálise disparada.`,
        });
      }
      await load();
    },
    [rawNameToLink, paymentId, load, toast],
  );



  if (loading) return null;
  if (!job) return null;

  const groupByName = new Map<string, GroupRow>();
  const groupById = new Map<string, GroupRow>();
  const groupByFuzzy = new Map<string, GroupRow>();
  for (const g of groups) {
    groupByName.set(norm(g.company_name), g);
    if (g.company_id) groupById.set(g.company_id, g);
    const f = fuzzy(g.company_name);
    if (f) groupByFuzzy.set(f, g);
  }

  const entries: ReportEntry[] = [];

  const latestTelemetryByCompany = new Map<string, TelemetryRow>();
  for (const t of telemetry) {
    const key = norm(t.company_name ?? "Sem empresa");
    if (!key || latestTelemetryByCompany.has(key)) continue;
    latestTelemetryByCompany.set(key, t);
  }

  // Total failures: companies the job marked as failed (didn't finish). If a
  // later telemetry row for the same company has no error, the retry succeeded
  // and the stale failure should no longer remain visible.
  for (const f of job.failed_companies ?? []) {
    const latest = latestTelemetryByCompany.get(norm(f.company_name ?? "Sem empresa"));
    if (latest && !latest.error && (!f.at || new Date(latest.created_at).getTime() >= new Date(f.at).getTime())) {
      continue;
    }
    const { group, source } = resolveMatch(f.company_name, f.company_id, groupByName, groupById, groupByFuzzy);
    entries.push({
      companyName: f.company_name,
      type: "total",
      reason: f.error || "Falha não especificada",
      groupId: group?.id ?? null,
      companyId: f.company_id ?? group?.company_id ?? null,
      matchSource: source,
      at: f.at,
    });
  }

  // Partial failures: use only the latest telemetry per company. Old partial
  // markers from the previous run must not keep the company stuck in the list
  // after a successful retry writes a newer row without error.
  for (const t of latestTelemetryByCompany.values()) {
    const partial = parsePartial(t.error);
    if (!partial) continue;
    const { group, source } = resolveMatch(t.company_name, t.company_id, groupByName, groupById, groupByFuzzy);
    const retries = partial.retries != null ? `, ${partial.retries} retries` : "";
    entries.push({
      companyName: t.company_name ?? "(sem empresa)",
      type: "parcial",
      reason: `IA: ${partial.failed} de ${partial.total} chunks falharam após retry${retries}. Justificativas podem estar incompletas.`,
      groupId: group?.id ?? null,
      companyId: t.company_id ?? group?.company_id ?? null,
      matchSource: source,
      at: t.created_at,
    });
  }


  if (entries.length === 0) return null;

  const totalCount = entries.filter((e) => e.type === "total").length;
  const partialCount = entries.filter((e) => e.type === "parcial").length;

  const exportCsv = () => {
    const header = ["Tipo", "Empresa", "Justificativa", "Quando", "Link"];
    const baseUrl = window.location.origin + window.location.pathname;
    const rows = entries.map((e) => [
      e.type === "total" ? "Falha total" : "Falha parcial",
      e.companyName,
      e.reason.replace(/"/g, '""'),
      e.at ?? "",
      e.groupId ? `${baseUrl}#group-${e.groupId}` : "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-ia-lote-${job.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openEvidence = (groupId: string | null) => {
    if (!groupId) return;
    window.location.hash = `group-${groupId}`;
    const el = document.getElementById(`group-${groupId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reprocessFailed = async () => {
    if (!hospitalId) {
      toast({ title: "Hospital não identificado no lote", variant: "destructive" });
      return;
    }
    const names = Array.from(
      new Set(entries.map((e) => (e.companyName || "").trim()).filter(Boolean)),
    );
    if (names.length === 0) return;
    setReprocessing(true);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("dispatch-payment-analysis", {
        body: {
          payment_id: paymentId,
          only_companies: names,
          force_fresh_rules: true,
          run_ai: true,
        },
      });
      if (invErr) {
        toast({
          title: "Falha ao reprocessar",
          description: invErr.message,
          variant: "destructive",
        });
      } else {
        const alreadyRunning = (data as any)?.already_running === true;
        toast({
          title: alreadyRunning ? "Reprocessamento já em andamento" : "Reprocessamento disparado",
          description: alreadyRunning
            ? (data as any)?.message ?? "A análise em andamento será reaproveitada."
            : `${names.length} empresa(s) enviada(s) para nova análise.`,
        });
      }
      await load();
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-600" />
            Relatório de falhas da análise — lote{" "}
            <span className="font-mono text-xs text-muted-foreground">{job.id.slice(0, 8)}</span>
            <Badge variant="outline" className="ml-1">
              {totalCount} totais
            </Badge>
            <Badge variant="outline">{partialCount} parciais</Badge>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="default"
              onClick={() => void reprocessFailed()}
              disabled={reprocessing || entries.length === 0}
            >
              {reprocessing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Reprocessar falhas
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="h-3 w-3 mr-1" />
              Exportar CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Atualizar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border/60">
          {entries.map((e, i) => (
            <li key={i} className="py-2.5 flex items-start gap-3">
              <div className="mt-0.5">
                {e.type === "total" ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{e.companyName}</span>
                  <Badge
                    variant={e.type === "total" ? "destructive" : "secondary"}
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {e.type === "total" ? "Falha total" : "Falha parcial"}
                  </Badge>
                  {e.matchSource === "fuzzy" && (
                    <Badge variant="outline" className="text-[10px]">match aproximado</Badge>
                  )}
                  {e.matchSource === "id" && (
                    <Badge variant="outline" className="text-[10px]">match por ID</Badge>
                  )}
                  {e.at && (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(e.at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 break-words">{e.reason}</div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                {e.groupId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEvidence(e.groupId)}
                    className="h-7 px-2 text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Abrir evidência
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRawNameToLink(e.companyName);
                        setSearchTerm(e.companyName);
                        setSearchResults([]);
                        setSearchOpen(true);
                        void runSearch(e.companyName);
                      }}
                      className="h-7 px-2 text-xs"
                    >
                      <Search className="h-3 w-3 mr-1" />
                      Vincular ao cadastro
                    </Button>
                    <span className="text-[10px] text-muted-foreground italic max-w-[160px] text-right">
                      Não vinculada a nenhum grupo deste pagamento
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular empresa ao cadastro</DialogTitle>
            <DialogDescription>
              Nome bruto que veio na base:{" "}
              <span className="font-mono text-foreground">{rawNameToLink || "—"}</span>
              <br />
              Selecione a empresa correta para criar o vínculo. Próximas importações vão reconhecer esse nome automaticamente, e a reanálise será disparada agora.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={searchTerm}
              onChange={(ev) => setSearchTerm(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") void runSearch(searchTerm);
              }}
              placeholder="Nome, CNPJ ou código"
            />
            <Button size="sm" onClick={() => void runSearch(searchTerm)} disabled={searching}>
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            </Button>
          </div>
          <div className="max-h-80 overflow-auto divide-y divide-border/60 rounded border">
            {searchResults.length === 0 && !searching && (
              <div className="p-4 text-xs text-muted-foreground text-center">
                Nenhum resultado. Tente outra parte do nome ou o CNPJ.
              </div>
            )}
            {searchResults.map((r) => (
              <div key={r.id} className="p-2.5 text-sm flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {r.code ?? "—"} · {r.document ?? "sem CNPJ"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  disabled={linkingId !== null}
                  onClick={() => void handleLink({ id: r.id, name: r.name })}
                  className="h-7 px-2 text-xs shrink-0"
                >
                  {linkingId === r.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Link2 className="h-3 w-3 mr-1" />
                      Vincular
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default BatchAIFailureReport;
