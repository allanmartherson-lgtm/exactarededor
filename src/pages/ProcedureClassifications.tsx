import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { recordAudit } from "@/lib/audit";
import { Plus, Trash2, Upload, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

type Row = {
  id: string;
  code_tuss: string;
  description: string | null;
  sector_classified: string;
  confidence: string;
  active: boolean;
  observation: string | null;
};

const SECTOR_OPTIONS = ["hemodinamica", "cirurgia", "consulta", "visita", "parecer", "procedimento", "outro"];
const CONFIDENCE_OPTIONS = ["alta", "media", "baixa"];

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CODE_CANDIDATES = ["codigo tuss", "codigo_tuss", "tuss", "codigo", "code", "cod tuss", "cod"];
const DESC_CANDIDATES = [
  "descricao",
  "descrição",
  "descricao do procedimento",
  "descrição do procedimento",
  "procedimento",
  "nome do procedimento",
  "descricao tuss",
  "descrição tuss",
  "nome",
  "procedimento/material",
  "procedimento material",
  "proced/mat",
  "proced mat",
  "proced/material",
];

const findKeyExact = (keys: string[], candidates: string[]) => {
  const normKeys = keys.map((k) => ({ raw: k, n: norm(k) }));
  // exact first
  for (const c of candidates) {
    const cn = norm(c);
    const hit = normKeys.find((k) => k.n === cn);
    if (hit) return hit.raw;
  }
  // contains
  for (const c of candidates) {
    const cn = norm(c);
    const hit = normKeys.find((k) => k.n.includes(cn));
    if (hit) return hit.raw;
  }
  return null;
};

const chunk = <T,>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

type PreviewState = {
  fileName: string;
  rawRows: any[];
  headers: string[];
  codeKey: string | null;
  descKey: string | null;
};

const ProcedureClassifications = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [confirmDelete, setConfirmDelete] = useState<null | { ids: string[]; all: boolean }>(null);
  const [confirmAllText, setConfirmAllText] = useState("");

  const load = () =>
    supabase
      .from("procedure_classifications" as any)
      .select("*")
      .order("code_tuss")
      .then(({ data }) => {
        setRows(((data ?? []) as unknown) as Row[]);
        setSelected(new Set());
      });

  useEffect(() => {
    document.title = "Classificação de procedimentos | MedPay";
    load();
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("procedure_classifications" as any).insert({
      code_tuss: String(f.get("code_tuss")).trim(),
      description: (String(f.get("description") || "") || null) as any,
      sector_classified: String(f.get("sector_classified") || "hemodinamica"),
      confidence: String(f.get("confidence") || "alta"),
      active: f.get("active") === "on",
      observation: (String(f.get("observation") || "") || null) as any,
      created_by: user!.id,
    } as any);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false);
    load();
    toast({ title: "Procedimento classificado" });
  };

  const toggleActive = async (r: Row) => {
    await supabase.from("procedure_classifications" as any).update({ active: !r.active } as any).eq("id", r.id);
    load();
  };

  const remove = async (id: string) => {
    setConfirmDelete({ ids: [id], all: false });
  };

  // Etapa 1: ler arquivo e gerar prévia
  const onFilePicked = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      if (data.length === 0) {
        toast({ title: "Planilha vazia", variant: "destructive" });
        return;
      }
      const headers = Object.keys(data[0] ?? {});
      const codeKey = findKeyExact(headers, CODE_CANDIDATES);
      const descKey = findKeyExact(headers, DESC_CANDIDATES);
      if (!codeKey) {
        toast({
          title: "Coluna de código não identificada",
          description: "Esperado: código TUSS / TUSS / código",
          variant: "destructive",
        });
        return;
      }
      if (!descKey) {
        toast({
          title: "Descrição não identificada na planilha",
          description: "Você poderá mapear manualmente na prévia.",
        });
      }
      setPreview({ fileName: file.name, rawRows: data, headers, codeKey, descKey });
      setImportMode("append");
    } catch (e: any) {
      toast({ title: "Erro ao ler arquivo", description: e?.message ?? "Falha", variant: "destructive" });
    }
  };

  // Etapa 2: confirmar importação (com modo append/replace)
  const confirmImport = async () => {
    if (!preview || !preview.codeKey) return;
    setImporting(true);
    let removed = 0;
    try {
      const toUpsert = preview.rawRows
        .map((row) => {
          const code = String(row[preview.codeKey!] ?? "").trim();
          if (!code) return null;
          const desc = preview.descKey ? String(row[preview.descKey] ?? "").trim() || null : null;
          return {
            code_tuss: code,
            description: desc,
            sector_classified: "hemodinamica",
            confidence: "alta",
            active: true,
            observation: null,
          };
        })
        .filter(Boolean) as any[];

      if (toUpsert.length === 0) {
        toast({ title: "Nenhuma linha válida", variant: "destructive" });
        return;
      }

      if (importMode === "replace") {
        const { count, error: delErr } = await supabase
          .from("procedure_classifications" as any)
          .delete({ count: "exact" } as any)
          .eq("sector_classified", "hemodinamica");
        if (delErr) throw delErr;
        removed = count ?? 0;
      }

      for (const c of chunk(toUpsert, 500)) {
        const { error } = await supabase
          .from("procedure_classifications" as any)
          .upsert(c, { onConflict: "code_tuss,sector_classified" } as any);
        if (error) throw error;
      }

      if (user) {
        await recordAudit({
          entityType: "rule",
          entityId: user.id,
          action: "update",
          actorId: user.id,
          diff: {
            procedure_classifications_import: {
              before: { mode: importMode, removed },
              after: {
                file: preview.fileName,
                rows_in_file: preview.rawRows.length,
                imported: toUpsert.length,
                code_column: preview.codeKey,
                desc_column: preview.descKey,
              },
            },
          },
        });
      }

      toast({
        title: `${toUpsert.length} classificações importadas`,
        description: importMode === "replace" ? `${removed} substituídas` : "Adicionadas à lista atual",
      });
      setPreview(null);
      load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  // Filtro/seleção
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? rows.filter(
            (r) => r.code_tuss.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
          )
        : rows,
    [rows, q],
  );
  const visible = filtered.slice(0, 300);
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
    else visible.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const requestDeleteSelected = () => {
    if (selected.size === 0) return;
    setConfirmDelete({ ids: Array.from(selected), all: false });
  };
  const requestDeleteAll = () => {
    setConfirmDelete({ ids: [], all: true });
    setConfirmAllText("");
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      let count = 0;
      if (confirmDelete.all) {
        const { count: c, error } = await supabase
          .from("procedure_classifications" as any)
          .delete({ count: "exact" } as any)
          .not("id", "is", null);
        if (error) throw error;
        count = c ?? 0;
      } else {
        const { error } = await supabase
          .from("procedure_classifications" as any)
          .delete()
          .in("id", confirmDelete.ids);
        if (error) throw error;
        count = confirmDelete.ids.length;
      }
      if (user) {
        await recordAudit({
          entityType: "rule",
          entityId: user.id,
          action: "update",
          actorId: user.id,
          diff: {
            procedure_classifications_delete: {
              before: { count },
              after: { all: confirmDelete.all },
            },
          },
        });
      }
      toast({ title: `${count} classificações excluídas` });
      setConfirmDelete(null);
      setConfirmAllText("");
      load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    }
  };

  return (
    <>
      <PageHeader
        title="Classificação de procedimentos"
        description="Classifica automaticamente itens da base por código TUSS. Não calcula pagamento."
        actions={
          <>
            <label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFilePicked(f);
                  e.currentTarget.value = "";
                }}
              />
              <Button asChild variant="outline" disabled={importing}>
                <span>
                  <Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : "Importar"}
                </span>
              </Button>
            </label>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> Nova classificação
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova classificação</DialogTitle>
                </DialogHeader>
                <form onSubmit={create} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Código TUSS</Label>
                    <Input name="code_tuss" required maxLength={32} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrição</Label>
                    <Input name="description" maxLength={300} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Setor</Label>
                      <select
                        name="sector_classified"
                        defaultValue="hemodinamica"
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {SECTOR_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Confiança</Label>
                      <select
                        name="confidence"
                        defaultValue="alta"
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {CONFIDENCE_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Observação</Label>
                    <Input name="observation" maxLength={300} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked /> Ativo
                  </label>
                  <Button type="submit" className="w-full">
                    Criar
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código TUSS ou descrição…"
            className="max-w-md"
          />
          <span className="text-xs text-muted-foreground">
            {filtered.length} de {rows.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0}
              onClick={requestDeleteSelected}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Excluir selecionadas ({selected.size})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={rows.length === 0}
              onClick={requestDeleteAll}
            >
              Excluir todas
            </Button>
          </div>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "Nenhuma classificação. Crie ou importe uma planilha."
                  : "Nenhum resultado."}
              </p>
            ) : (
              <>
                <div className="px-6 py-2 flex items-center gap-3 border-b bg-muted/30 text-xs">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} />
                  <span className="text-muted-foreground">Selecionar todas exibidas</span>
                </div>
                <div className="divide-y divide-border">
                  {visible.map((r) => (
                    <div key={r.id} className="px-6 py-3 flex items-center gap-4">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                      />
                      <span className="font-mono text-sm text-muted-foreground w-28">{r.code_tuss}</span>
                      <span className="flex-1 text-sm truncate">{r.description ?? "—"}</span>
                      <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 w-32 text-center">
                        {r.sector_classified}
                      </span>
                      <span className="text-xs text-muted-foreground w-16 text-center">{r.confidence}</span>
                      <button
                        onClick={() => toggleActive(r)}
                        className={`text-xs rounded-full px-2 py-0.5 border ${
                          r.active
                            ? "bg-success-soft text-success border-success/30"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {r.active ? "ativo" : "inativo"}
                      </button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Prévia de importação */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Prévia da importação</DialogTitle>
            <DialogDescription>
              Confirme o mapeamento das colunas antes de importar a planilha.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Coluna de código TUSS</Label>
                  <select
                    value={preview.codeKey ?? ""}
                    onChange={(e) =>
                      setPreview({ ...preview, codeKey: e.target.value || null })
                    }
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— selecione —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Coluna de descrição{" "}
                    {!preview.descKey && (
                      <span className="text-warning text-xs ml-1 inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> não identificada
                      </span>
                    )}
                  </Label>
                  <select
                    value={preview.descKey ?? ""}
                    onChange={(e) =>
                      setPreview({ ...preview, descKey: e.target.value || null })
                    }
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— sem descrição —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Arquivo: <span className="font-mono">{preview.fileName}</span> ·{" "}
                {preview.rawRows.length} linhas
              </div>

              <div className="border rounded-md max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Código</th>
                      <th className="px-3 py-2 text-left">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rawRows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 font-mono">
                          {preview.codeKey ? String(r[preview.codeKey] ?? "") : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {preview.descKey ? String(r[preview.descKey] ?? "") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <Label>Modo de importação</Label>
                <div className="space-y-1.5 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={importMode === "append"}
                      onChange={() => setImportMode("append")}
                      className="mt-1"
                    />
                    <span>
                      <strong>Adicionar à lista atual</strong> — novos códigos são inseridos e existentes
                      são atualizados.
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={importMode === "replace"}
                      onChange={() => setImportMode("replace")}
                      className="mt-1"
                    />
                    <span>
                      <strong>Substituir lista atual</strong> — apaga todas as classificações do setor antes
                      de importar.
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
            <Button
              onClick={confirmImport}
              disabled={!preview?.codeKey || importing}
            >
              {importing ? "Importando..." : "Confirmar importação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar exclusão</DialogTitle>
            <DialogDescription>
              {confirmDelete?.all
                ? `Tem certeza que deseja excluir TODAS as ${rows.length} classificações? Esta ação é irreversível.`
                : `Tem certeza que deseja excluir ${confirmDelete?.ids.length ?? 0} classificações?`}
            </DialogDescription>
          </DialogHeader>
          {confirmDelete?.all && (
            <div className="space-y-2">
              <Label>
                Digite <span className="font-mono">EXCLUIR TODAS</span> para confirmar:
              </Label>
              <Input
                value={confirmAllText}
                onChange={(e) => setConfirmAllText(e.target.value)}
                placeholder="EXCLUIR TODAS"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={doDelete}
              disabled={confirmDelete?.all && confirmAllText !== "EXCLUIR TODAS"}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProcedureClassifications;
