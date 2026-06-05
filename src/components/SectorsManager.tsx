import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Layers, Plus, Pencil, X, Upload, Loader2 } from "lucide-react";

type Sector = {
  slug: string;
  code: string | null;
  name: string;
  aliases: string[];
  active: boolean;
  sort_order: number;
  notes: string | null;
  tasy_code: string | null;
  classification: string | null;
};

const empty: Sector = {
  slug: "",
  code: null,
  name: "",
  aliases: [],
  active: true,
  sort_order: 50,
  notes: "",
  tasy_code: "",
  classification: "",
};

const norm = (s: string) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./]+/g, "");

function buildSlug(input: string) {
  return input.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Props = { canManage?: boolean };

/**
 * Painel reutilizável de Setores — usado na sub-aba "Setores" dentro de Centro de Custos.
 * Renderiza sem `PageHeader` próprio para se encaixar em layouts tabbed.
 */
export default function SectorsManager({ canManage = true }: Props) {
  const [list, setList] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("sectors").select("*").order("sort_order");
    if (error) toast.error("Erro ao carregar setores: " + error.message);
    else setList((data ?? []) as Sector[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...empty }); setIsNew(true); setAliasInput(""); };
  const openEdit = (s: Sector) => { setEditing({ ...s, aliases: [...s.aliases] }); setIsNew(false); setAliasInput(""); };

  const save = async () => {
    if (!editing) return;
    const slug = editing.slug.trim().toLowerCase().replace(/\s+/g, "_");
    if (!slug || !editing.name.trim()) { toast.error("Slug e nome são obrigatórios"); return; }
    const payload = {
      ...editing,
      slug,
      aliases: editing.aliases.map(a => a.trim()).filter(Boolean),
      tasy_code: editing.tasy_code?.trim() || null,
      classification: editing.classification?.trim() || null,
    };
    const { error } = isNew
      ? await supabase.from("sectors").insert(payload)
      : await supabase.from("sectors").update(payload).eq("slug", editing.slug);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(isNew ? "Setor criado" : "Setor atualizado");
    setEditing(null);
    load();
  };

  const addAlias = () => {
    if (!editing || !aliasInput.trim()) return;
    const v = aliasInput.trim();
    if (editing.aliases.some(a => a.toLowerCase() === v.toLowerCase())) { setAliasInput(""); return; }
    setEditing({ ...editing, aliases: [...editing.aliases, v] });
    setAliasInput("");
  };

  const removeAlias = (a: string) => {
    if (!editing) return;
    setEditing({ ...editing, aliases: editing.aliases.filter(x => x !== a) });
  };

  const runTest = async () => {
    if (!testInput.trim()) return;
    const { data, error } = await supabase.rpc("normalize_sector", { input: testInput });
    if (error) { toast.error(error.message); return; }
    setTestResult(data ?? "(nenhum match)");
  };

  /**
   * Importação em lote a partir de XLSX/CSV — fluxo em 2 etapas:
   * 1. `parseFile` lê a planilha, detecta o mapeamento de colunas e monta o payload em memória.
   * 2. `confirmImport` faz upsert no Supabase após o usuário revisar o preview.
   */
  type PreviewState = {
    fileName: string;
    totalRows: number;
    skipped: number;
    mapping: Record<string, string | null>;
    detectedColumns: string[];
    payload: Sector[];
  };
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const COLUMN_ALIASES: Record<string, string[]> = {
    nome: ["nome", "name", "setor", "nomesetor", "nome do setor", "setor (nome oficial)", "nome oficial"],
    codigo: ["codigo", "code", "cod", "cod.", "codigotasy", "codigo tasy", "cd_setor", "cd_setor_atendimento"],
    classificacao: ["classificacao", "classification", "classificacaosetor", "classe", "tipo", "classif setor", "classif. setor", "classif"],
    slug: ["slug"],
    aliases: ["aliases", "alias", "variacoes", "variações", "aliases (separados por |)", "aliases separados por"],
    ordem: ["ordem", "sort_order", "order"],
    ativo: ["ativo", "active", "status"],
    notas: ["notas", "notes", "observacao", "observações"],
  };

  const parseFile = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Planilha sem aba legível");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (rows.length === 0) throw new Error("Planilha vazia");

      const detectedColumns = Object.keys(rows[0]);

      // Detecta a coluna original para cada campo lógico
      const detectColumn = (keys: string[]): string | null => {
        const wanted = keys.map(norm);
        for (const col of detectedColumns) {
          if (wanted.includes(norm(col))) return col;
        }
        return null;
      };
      const mapping: Record<string, string | null> = {};
      for (const [field, keys] of Object.entries(COLUMN_ALIASES)) {
        mapping[field] = detectColumn(keys);
      }

      const pickByCol = (row: Record<string, unknown>, col: string | null) => {
        if (!col) return null;
        const v = row[col];
        return v == null || v === "" ? null : String(v).trim();
      };
      const splitAliases = (raw: string | null): string[] => {
        if (!raw) return [];
        return raw.split(/[|;,]/).map((s) => s.trim()).filter(Boolean);
      };

      const existingBySlug = new Map(list.map((s) => [s.slug, s] as const));
      const payload: Sector[] = [];
      let skipped = 0;

      for (const row of rows) {
        const nome = pickByCol(row, mapping.nome);
        const codigo = pickByCol(row, mapping.codigo);
        const classification = pickByCol(row, mapping.classificacao);
        let slug = pickByCol(row, mapping.slug);
        if (!slug && codigo) slug = buildSlug(codigo);
        if (!slug && nome) slug = buildSlug(nome);
        if (!slug || !nome) { skipped++; continue; }
        slug = buildSlug(slug);
        const aliasesRaw = pickByCol(row, mapping.aliases);
        const ordem = Number(pickByCol(row, mapping.ordem) ?? 50) || 50;
        const ativoRaw = pickByCol(row, mapping.ativo);
        const ativo = ativoRaw == null ? true : !/^(0|false|nao|não|inativo|n|i)$/i.test(ativoRaw);
        const notas = pickByCol(row, mapping.notas);

        const existing = existingBySlug.get(slug);
        const mergedAliases = Array.from(
          new Set([...(existing?.aliases ?? []), ...splitAliases(aliasesRaw), nome]),
        );

        payload.push({
          slug, name: nome, aliases: mergedAliases,
          active: ativo, sort_order: ordem, notes: notas,
          tasy_code: codigo, classification,
        });
      }

      if (payload.length === 0) {
        toast.error(`Nenhuma linha válida encontrada${skipped ? ` (${skipped} ignoradas)` : ""}. Verifique se as colunas "nome" e "codigo/slug" estão presentes.`);
        return;
      }

      setPreview({ fileName: file.name, totalRows: rows.length, skipped, mapping, detectedColumns, payload });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao processar planilha");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    const { error } = await supabase.from("sectors").upsert(preview.payload, { onConflict: "slug" });
    setImporting(false);
    if (error) { toast.error("Erro ao importar: " + error.message); return; }
    toast.success(`${preview.payload.length} setor(es) importado(s)${preview.skipped ? ` · ${preview.skipped} ignorado(s)` : ""}`);
    setPreview(null);
    await load();
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Layers className="h-5 w-5" /> Setores</h2>
          <p className="text-sm text-muted-foreground">
            Padronização dos nomes de setor que vêm da base. Aliases capturam variações (acentos, abreviações, sufixos).
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              Importar planilha
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Novo setor</Button>
          </div>
        )}
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importação em lote</CardTitle>
            <CardDescription>
              Aceita <code>.xlsx</code>, <code>.xls</code> ou <code>.csv</code>. Colunas reconhecidas:
              {" "}<code>codigo</code> (Tasy), <code>nome</code>, <code>classificacao</code>,
              {" "}<code>aliases</code> (separados por <code>|</code>, <code>;</code> ou <code>,</code>),
              {" "}<code>ativo</code>, <code>ordem</code>, <code>notas</code>, <code>slug</code> (opcional).
              Upsert pelo <code>slug</code> — aliases existentes são preservados.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Testar normalização</CardTitle>
          <CardDescription>Cole um valor de setor da base e veja para qual slug ele resolve.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 items-center">
          <Input
            placeholder="Ex: Centro Cirúrgico (DFStar)"
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runTest()}
          />
          <Button variant="secondary" onClick={runTest}>Testar</Button>
          {testResult !== null && (
            <Badge variant={testResult === "(nenhum match)" ? "destructive" : "default"}>
              → {testResult}
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {!loading && list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum setor cadastrado.</p>}
        {list.map(s => (
          <Card key={s.slug} className={s.active ? "" : "opacity-60"}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {s.code && (
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{s.code}</code>
                  )}
                  {s.tasy_code && (
                    <code className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                      {s.tasy_code}
                    </code>
                  )}
                  <span className="font-semibold">{s.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.slug}</code>
                  {s.classification && <Badge variant="outline" className="text-xs">{s.classification}</Badge>}
                  {!s.active && <Badge variant="destructive" className="text-xs">inativo</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.aliases.length === 0 && <span className="text-xs text-muted-foreground">Sem aliases</span>}
                  {s.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
                {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
              </div>
              {canManage && (
                <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo setor" : `Editar ${editing?.name}`}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Código (Tasy)</Label>
                  <Input value={editing.tasy_code ?? ""}
                    onChange={e => setEditing({ ...editing, tasy_code: e.target.value })}
                    placeholder="Ex: 1234" />
                </div>
                <div>
                  <Label className="text-xs">Classificação</Label>
                  <Input value={editing.classification ?? ""}
                    onChange={e => setEditing({ ...editing, classification: e.target.value })}
                    placeholder="Ex: Assistencial" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Nome do setor</Label>
                <Input value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Centro Cirúrgico" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Slug (interno)</Label>
                  <Input value={editing.slug} disabled={!isNew}
                    onChange={e => setEditing({ ...editing, slug: e.target.value })}
                    placeholder="centro_cirurgico" />
                </div>
                <div>
                  <Label className="text-xs">Ordem</Label>
                  <Input type="number" value={editing.sort_order}
                    onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Aliases (variações reconhecidas)</Label>
                <div className="flex gap-2">
                  <Input value={aliasInput}
                    onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                    placeholder="Digite e pressione Enter" />
                  <Button type="button" variant="secondary" onClick={addAlias}>Adicionar</Button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {editing.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="gap-1">
                      {a}
                      <button onClick={() => removeAlias(a)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Observações</Label>
                <Textarea value={editing.notes ?? ""} rows={2}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.active}
                  onCheckedChange={v => setEditing({ ...editing, active: v })} />
                <Label className="text-xs">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Pré-visualização da importação</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Arquivo: <code className="bg-muted px-1 rounded">{preview.fileName}</code></span>
                <span>Linhas lidas: <b>{preview.totalRows}</b></span>
                <span className="text-emerald-600 dark:text-emerald-500">Válidas: <b>{preview.payload.length}</b></span>
                {preview.skipped > 0 && <span className="text-destructive">Ignoradas: <b>{preview.skipped}</b></span>}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Mapeamento de colunas</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {Object.entries(preview.mapping).map(([field, col]) => (
                    <div key={field} className="border rounded p-2">
                      <div className="font-medium capitalize">{field}</div>
                      {col ? (
                        <code className="text-[11px] bg-muted px-1 rounded break-all">{col}</code>
                      ) : (
                        <span className="text-muted-foreground italic">não encontrada</span>
                      )}
                    </div>
                  ))}
                </div>
                {preview.detectedColumns.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Colunas detectadas no arquivo: {preview.detectedColumns.map(c => <code key={c} className="bg-muted px-1 rounded mr-1">{c}</code>)}
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Pré-visualização ({Math.min(preview.payload.length, 20)} de {preview.payload.length})
                </h4>
                <div className="border rounded max-h-[360px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr className="text-left">
                        <th className="p-2">Código</th>
                        <th className="p-2">Nome</th>
                        <th className="p-2">Slug</th>
                        <th className="p-2">Classificação</th>
                        <th className="p-2">Aliases</th>
                        <th className="p-2">Ativo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.payload.slice(0, 20).map((p, i) => (
                        <tr key={p.slug + i} className="border-t align-top">
                          <td className="p-2 font-mono">{p.tasy_code ?? "—"}</td>
                          <td className="p-2">{p.name}</td>
                          <td className="p-2"><code className="bg-muted px-1 rounded">{p.slug}</code></td>
                          <td className="p-2">{p.classification ?? "—"}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1 max-w-[320px]">
                              {p.aliases.slice(0, 6).map(a => (
                                <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>
                              ))}
                              {p.aliases.length > 6 && <span className="text-muted-foreground">+{p.aliases.length - 6}</span>}
                            </div>
                          </td>
                          <td className="p-2">{p.active ? "sim" : "não"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={importing}>
              {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirmar importação ({preview?.payload.length ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
