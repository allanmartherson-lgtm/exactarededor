// TussTable — administração da tabela de referência `tuss_procedure_names`.
// Códigos oficiais ANS + aprendizados automáticos do motor.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type TussRow = {
  code: string;
  canonical_name: string;
  source: string | null;
  created_at: string | null;
};

const PAGE_SIZE = 50;
const ANS_SOURCE = "ANS-TUSS-202501";

type SourceFilter = "all" | typeof ANS_SOURCE | "auto-learn";

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: ANS_SOURCE, label: "ANS (oficial)" },
  { value: "auto-learn", label: "Aprendidos automaticamente" },
];

const EDIT_SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: ANS_SOURCE, label: "ANS Oficial" },
  { value: "auto-learn", label: "Aprendido" },
];

function SourceBadge({ source }: { source: string | null }) {
  if (source === ANS_SOURCE) {
    return (
      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200">
        ANS Oficial
      </Badge>
    );
  }
  if (source === "auto-learn") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
        Aprendido
      </Badge>
    );
  }
  if (source === "manual") {
    return (
      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-200">
        Manual
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      {source ?? "—"}
    </Badge>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

type Stats = { total: number; ans: number; learned: number };

export default function TussTable() {
  const [rows, setRows] = useState<TussRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [stats, setStats] = useState<Stats>({ total: 0, ans: 0, learned: 0 });

  const [editing, setEditing] = useState<TussRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formSource, setFormSource] = useState("manual");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TussRow | null>(null);

  const loadStats = useCallback(async () => {
    const [{ count: total }, { count: ans }, { count: learned }] = await Promise.all([
      supabase.from("tuss_procedure_names").select("*", { count: "exact", head: true }),
      supabase
        .from("tuss_procedure_names")
        .select("*", { count: "exact", head: true })
        .eq("source", ANS_SOURCE),
      supabase
        .from("tuss_procedure_names")
        .select("*", { count: "exact", head: true })
        .eq("source", "auto-learn"),
    ]);
    setStats({ total: total ?? 0, ans: ans ?? 0, learned: learned ?? 0 });
  }, []);

  const loadPage = useCallback(
    async (pageIndex: number, replace: boolean) => {
      const from = pageIndex * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("tuss_procedure_names")
        .select("*")
        .order("code", { ascending: true })
        .range(from, to);
      if (sourceFilter !== "all") {
        query = query.eq("source", sourceFilter);
      }
      const { data, error } = await query;
      if (error) {
        toast({
          variant: "destructive",
          title: "Falha ao carregar",
          description: error.message,
        });
        return;
      }
      const list = (data ?? []) as TussRow[];
      setHasMore(list.length === PAGE_SIZE);
      setRows((prev) => (replace ? list : [...prev, ...list]));
    },
    [sourceFilter],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPage(0);
      await Promise.all([loadPage(0, true), loadStats()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage, loadStats]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const next = page + 1;
    await loadPage(next, false);
    setPage(next);
    setLoadingMore(false);
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.canonical_name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const openCreate = () => {
    setEditing(null);
    setFormCode("");
    setFormName("");
    setFormSource("manual");
    setDialogOpen(true);
  };

  const openEdit = (row: TussRow) => {
    setEditing(row);
    setFormCode(row.code);
    setFormName(row.canonical_name);
    setFormSource(row.source ?? "manual");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const code = formCode.replace(/\D/g, "").trim();
    const name = formName.trim();
    if (!code) {
      toast({
        variant: "destructive",
        title: "Código inválido",
        description: "Informe um código numérico.",
      });
      return;
    }
    if (!name) {
      toast({
        variant: "destructive",
        title: "Nome obrigatório",
        description: "Informe o nome do procedimento.",
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("tuss_procedure_names")
      .upsert(
        { code, canonical_name: name, source: formSource },
        { onConflict: "code" },
      );
    setSaving(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Falha ao salvar",
        description: error.message,
      });
      return;
    }
    toast({
      title: editing ? "Código atualizado" : "Código cadastrado",
      description: `${code} — ${name}`,
    });
    setDialogOpen(false);
    setPage(0);
    await Promise.all([loadPage(0, true), loadStats()]);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.source === ANS_SOURCE) {
      toast({
        variant: "destructive",
        title: "Não permitido",
        description: "Códigos oficiais da ANS não podem ser removidos.",
      });
      setDeleteTarget(null);
      return;
    }
    const { error } = await supabase
      .from("tuss_procedure_names")
      .delete()
      .eq("code", deleteTarget.code);
    if (error) {
      toast({
        variant: "destructive",
        title: "Falha ao remover",
        description: error.message,
      });
      return;
    }
    toast({
      title: "Código removido",
      description: deleteTarget.code,
    });
    setDeleteTarget(null);
    setPage(0);
    await Promise.all([loadPage(0, true), loadStats()]);
  };

  return (
    <div>
      <PageHeader
        title="Tabela TUSS — Procedimentos"
        description="Base de referência para padronização de nomes de procedimentos. Códigos oficiais da ANS e aprendidos automaticamente pelo sistema."
        icon={BookOpen}
      />

      <div className="p-4 md:p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de códigos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {stats.total.toLocaleString("pt-BR")}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                ANS (oficial)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-blue-700">
                {stats.ans.toLocaleString("pt-BR")}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Aprendidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-green-700">
                {stats.learned.toLocaleString("pt-BR")}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código ou nome..."
              className="pl-9"
            />
          </div>
          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as SourceFilter)}
          >
            <SelectTrigger className="w-full md:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Novo código
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2 w-[130px]">Código</th>
                  <th className="text-left font-medium px-3 py-2">Nome do procedimento</th>
                  <th className="text-left font-medium px-3 py-2 w-[140px]">Origem</th>
                  <th className="text-left font-medium px-3 py-2 w-[120px]">Cadastrado em</th>
                  <th className="text-right font-medium px-3 py-2 w-[100px]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      Nenhum código encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isAns = row.source === ANS_SOURCE;
                    return (
                      <tr
                        key={row.code}
                        className="border-t border-border hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-mono">{row.code}</td>
                        <td className="px-3 py-2">{row.canonical_name}</td>
                        <td className="px-3 py-2">
                          <SourceBadge source={row.source} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(row)}
                              aria-label={`Editar ${row.code}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8 text-destructive hover:text-destructive",
                                isAns && "opacity-30 pointer-events-none",
                              )}
                              onClick={() => !isAns && setDeleteTarget(row)}
                              aria-label={`Remover ${row.code}`}
                              disabled={isAns}
                              title={
                                isAns
                                  ? "Códigos oficiais da ANS não podem ser removidos"
                                  : "Remover"
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {hasMore && !loading && (
            <div className="p-3 border-t border-border flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Carregando..." : "Carregar mais"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar código TUSS" : "Novo código TUSS"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Código</label>
              <Input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.replace(/\D/g, ""))}
                placeholder="Ex.: 10101012"
                inputMode="numeric"
                disabled={!!editing}
                maxLength={20}
              />
              {editing && (
                <p className="text-xs text-muted-foreground mt-1">
                  O código não pode ser alterado após criado.
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Nome do procedimento</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex.: Consulta em consultório"
                maxLength={500}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Origem</label>
              <Select value={formSource} onValueChange={setFormSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_SOURCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover código TUSS?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  Você está removendo <span className="font-mono">{deleteTarget.code}</span>{" "}
                  — {deleteTarget.canonical_name}. Essa ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
