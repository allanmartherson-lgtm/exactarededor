import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Network, Upload, Loader2, Search, AlertCircle, ChevronDown, History, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDate } from "@/lib/status";
import { ImportWizard, type ImportProfile } from "@/components/ImportWizard";

const COST_CENTERS_IMPORT_PROFILE: ImportProfile = {
  entity: "cost_centers",
  supportedModes: ["update", "append"],
  fields: [
    { key: "code_p12", label: "COD_P12", required: true, uniqueKey: true, aliases: ["COD_P12", "cod p12", "p12"] },
    { key: "code_p10", label: "COD_P10", aliases: ["COD_P10", "cod p10", "p10"] },
    { key: "code_pai", label: "COD_PAI", aliases: ["COD_PAI", "cod pai", "pai"] },
    { key: "level1", label: "CENTRO_N1", aliases: ["CENTRO_N1", "centro n1", "n1"] },
    { key: "level2", label: "CENTRO_N2", aliases: ["CENTRO_N2", "centro n2", "n2"] },
    { key: "level3", label: "CENTRO_N3", aliases: ["CENTRO_N3", "centro n3", "n3"] },
    { key: "level4", label: "CENTRO_N4", aliases: ["CENTRO_N4", "centro n4", "n4"] },
    { key: "level5", label: "CENTRO_N5", aliases: ["CENTRO_N5", "centro n5", "n5"] },
    { key: "status", label: "STATUS_MSIGA", aliases: ["STATUS_MSIGA", "status msiga", "status"] },
  ],
  fixedContext: { active: true },
};

interface CostCenter {
  id: string;
  code_p12: string;
  code_p10: string | null;
  code_pai: string | null;
  level1: string | null;
  level2: string | null;
  level3: string | null;
  level4: string | null;
  level5: string | null;
  status: string | null;
  active: boolean;
  imported_at: string;
}

interface ImportLog {
  id: string;
  file_name: string | null;
  rows_in_file: number;
  created_count: number;
  updated_count: number;
  deactivated_count: number;
  imported_by: string;
  imported_at: string;
  status: string;
  reverted_by: string | null;
  reverted_at: string | null;
  importer?: { full_name: string | null; email: string } | null;
  reverter?: { full_name: string | null; email: string } | null;
}

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");
  for (const k of keys) for (const rk of Object.keys(row)) if (norm(rk) === norm(k)) return row[rk];
  for (const k of keys) for (const rk of Object.keys(row)) if (norm(rk).includes(norm(k))) return row[rk];
  return undefined;
};
const toStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
const isUnblocked = (status: string | null): boolean => {
  if (!status) return false;
  const n = status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return n === "nao bloqueado";
};

const CostCenters = () => {
  const { user, roles } = useAuth();
  const canManage = roles.includes("admin") || roles.includes("diretor");
  const [items, setItems] = useState<CostCenter[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [reverting, setReverting] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const PAGE_SIZE = 100;
  const reqIdRef = useRef(0);

  useEffect(() => { document.title = "Centros de custo | MedPay"; }, []);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Contagens globais (independem do filtro/busca)
  const refreshCounts = useCallback(async () => {
    const [{ count: total }, { count: active }] = await Promise.all([
      supabase.from("cost_centers").select("id", { count: "exact", head: true }),
      supabase.from("cost_centers").select("id", { count: "exact", head: true }).eq("active", true),
    ]);
    setTotalCount(total ?? 0);
    setActiveCount(active ?? 0);
  }, []);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase
      .from("cost_center_imports")
      .select("id,file_name,rows_in_file,created_count,updated_count,deactivated_count,imported_by,imported_at,status,reverted_by,reverted_at")
      .order("imported_at", { ascending: false })
      .limit(20);
    const list = (data ?? []) as ImportLog[];
    // Busca nomes dos autores em uma chamada
    const ids = Array.from(new Set(list.flatMap((l) => [l.imported_by, l.reverted_by]).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, { full_name: p.full_name, email: p.email }]));
      list.forEach((l) => {
        l.importer = map.get(l.imported_by) ?? null;
        l.reverter = l.reverted_by ? map.get(l.reverted_by) ?? null : null;
      });
    }
    setLogs(list);
  }, []);

  // Query base com filtros aplicados
  const buildQuery = useCallback(() => {
    let q = supabase
      .from("cost_centers")
      .select("*", { count: "exact" })
      .order("code_p12");
    if (!showInactive) q = q.eq("active", true);
    if (debouncedSearch.trim()) {
      const s = debouncedSearch.trim().replace(/[%,]/g, " ");
      const like = `%${s}%`;
      q = q.or(
        [
          `code_p12.ilike.${like}`,
          `code_p10.ilike.${like}`,
          `level2.ilike.${like}`,
          `level3.ilike.${like}`,
          `level4.ilike.${like}`,
          `level5.ilike.${like}`,
        ].join(","),
      );
    }
    return q;
  }, [debouncedSearch, showInactive]);

  // Carrega primeira página sempre que filtros mudam
  const loadFirstPage = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const { data } = await buildQuery().range(0, PAGE_SIZE - 1);
    if (reqId !== reqIdRef.current) return; // resposta obsoleta
    setItems((data ?? []) as CostCenter[]);
    setLoading(false);
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    const from = items.length;
    const { data } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    setItems((prev) => [...prev, ...((data ?? []) as CostCenter[])]);
    setLoadingMore(false);
  }, [items.length, buildQuery, loading, loadingMore]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);
  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleImportComplete = async () => {
    await Promise.all([refreshCounts(), loadFirstPage(), loadLogs()]);
  };

  const revertImport = async (logId: string) => {
    setReverting(logId);
    const { data, error } = await supabase.rpc("revert_cost_center_import", { _import_id: logId });
    setReverting(null);
    if (error) {
      toast({ title: "Não foi possível desfazer", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { restored: number; removed: number } | null;
    toast({
      title: "Importação revertida",
      description: result ? `${result.restored} restaurados · ${result.removed} removidos` : undefined,
    });
    await Promise.all([refreshCounts(), loadFirstPage(), loadLogs()]);
  };

  // Só a última aplicada pode ser desfeita
  const lastAppliedId = logs.find((l) => l.status === "aplicada")?.id ?? null;

  const filteredCount = items.length; // página atual carregada

  return (
    <>
      <PageHeader
        title="Centros de custo"
        description="Catálogo importado da controladoria (P12). Apenas centros com status 'Não Bloqueado' são considerados."
      />
      <div className="p-8 max-w-full space-y-6">
        {canManage && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Importar planilha da controladoria</CardTitle>
              <CardDescription>
                Fluxo padrão: upload → prévia → mapeamento de colunas → validação → confirmação → importação. Esperado: <code>COD_P12</code>, <code>COD_P10</code>, <code>COD_PAI</code>, <code>CENTRO_N1..N5</code> e <code>STATUS_MSIGA</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-2" /> Iniciar importação
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Network className="h-4 w-4" /> Catálogo</CardTitle>
              <CardDescription>
                {activeCount.toLocaleString("pt-BR")} ativos · {totalCount.toLocaleString("pt-BR")} no total
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={showInactive ? "secondary" : "outline"} size="sm" onClick={() => setShowInactive((s) => !s)}>
                {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                placeholder="Buscar por código P12, gerência, setor, área…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                {debouncedSearch
                  ? "Nenhum resultado para a busca."
                  : <>Nenhum centro de custos cadastrado. {canManage && "Importe a planilha P12 acima."}</>}
              </div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <div className="w-full">
                  <div className="hidden sm:grid sm:grid-cols-12 bg-muted/40 text-muted-foreground text-xs font-medium border-b border-border">
                    <div className="px-3 py-2 sm:col-span-1">P12</div>
                    <div className="px-3 py-2 sm:col-span-2">Diretoria</div>
                    <div className="px-3 py-2 sm:col-span-3">Gerência</div>
                    <div className="px-3 py-2 sm:col-span-2">Setor</div>
                    <div className="px-3 py-2 sm:col-span-3">Sub-área</div>
                    <div className="px-3 py-2 sm:col-span-1 text-right">Status</div>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((it) => (
                      <div key={it.id} className="grid grid-cols-1 sm:grid-cols-12 items-start sm:items-center py-2 px-3 hover:bg-muted/30 transition-colors gap-1 sm:gap-0">
                        <div className="sm:col-span-1 font-mono text-xs text-muted-foreground break-all">{it.code_p12}</div>
                        <div className="sm:col-span-2 text-xs break-words">{it.level2}</div>
                        <div className="sm:col-span-3 text-xs break-words">{it.level3}</div>
                        <div className="sm:col-span-2 text-xs break-words">{it.level4}</div>
                        <div className="sm:col-span-3 text-sm font-medium break-words">{it.level5}</div>
                        <div className="sm:col-span-1 flex sm:justify-end">
                          {it.active ? (
                            <Badge variant="outline" className="text-[10px] text-success border-success/30 bg-success-soft h-5 px-1.5">Ativo</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground h-5 px-1.5">Inativo</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 p-3 border-t border-border bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Mostrando {filteredCount.toLocaleString("pt-BR")} {debouncedSearch || !showInactive ? "registros filtrados" : "de " + totalCount.toLocaleString("pt-BR")}
                  </p>
                  {/* Heurística: se voltou uma página cheia, provavelmente há mais */}
                  {filteredCount > 0 && filteredCount % PAGE_SIZE === 0 && (
                    <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                      Carregar mais
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <Collapsible open={showHistory} onOpenChange={setShowHistory}>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Histórico de importações
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showHistory ? "rotate-180" : ""}`} />
                </CardTitle>
                <CardDescription>Últimas 20 importações. Apenas a mais recente pode ser desfeita.</CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma importação registrada ainda.</p>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium cell-date">Quando</th>
                          <th className="text-left px-3 py-2 font-medium">Por</th>
                          <th className="text-left px-3 py-2 font-medium">Arquivo</th>
                          <th className="text-right px-3 py-2 font-medium cell-num">Linhas</th>
                          <th className="text-right px-3 py-2 font-medium cell-num">Criados</th>
                          <th className="text-right px-3 py-2 font-medium cell-num">Atualizados</th>
                          <th className="text-right px-3 py-2 font-medium cell-num">Desativados</th>
                          <th className="text-left px-3 py-2 font-medium cell-status">Status</th>
                          {canManage && <th className="text-right px-3 py-2 font-medium">Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((l) => {
                          const isLast = l.id === lastAppliedId;
                          const isApplied = l.status === "aplicada";
                          return (
                            <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                              <td className="px-3 py-2 cell-date">{formatDate(l.imported_at)}</td>
                              <td className="px-3 py-2">{l.importer?.full_name ?? l.importer?.email ?? "—"}</td>
                              <td className="px-3 py-2 truncate max-w-[200px]" title={l.file_name ?? ""}>{l.file_name ?? "—"}</td>
                              <td className="px-3 py-2 text-right cell-num">{l.rows_in_file}</td>
                              <td className="px-3 py-2 text-right cell-num text-success">{l.created_count}</td>
                              <td className="px-3 py-2 text-right cell-num">{l.updated_count}</td>
                              <td className="px-3 py-2 text-right cell-num text-muted-foreground">{l.deactivated_count}</td>
                              <td className="px-3 py-2 cell-status">
                                {isApplied ? (
                                  <Badge variant="outline" className="text-success border-success/30 bg-success-soft">Aplicada</Badge>
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <Badge variant="outline" className="text-muted-foreground w-fit">Revertida</Badge>
                                    {l.reverter && (
                                      <span className="text-[10px] text-muted-foreground">
                                        por {l.reverter.full_name ?? l.reverter.email} · {formatDate(l.reverted_at)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              {canManage && (
                                <td className="px-3 py-2 text-right">
                                  {isApplied && isLast ? (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" disabled={!!reverting}>
                                          {reverting === l.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Undo2 className="h-3.5 w-3.5 mr-1" />}
                                          Desfazer
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Desfazer esta importação?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            O catálogo voltará ao estado anterior a esta importação. Centros criados serão removidos e os alterados/desativados voltarão aos valores antigos.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => revertImport(l.id)}>Desfazer</AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  ) : isApplied ? (
                                    <span className="text-xs text-muted-foreground">só a última</span>
                                  ) : null}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Importar centros de custo"
        profile={COST_CENTERS_IMPORT_PROFILE}
        onComplete={handleImportComplete}
      />
    </>

  );
};

export default CostCenters;