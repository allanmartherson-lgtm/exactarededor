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
   * Importação em lote a partir de XLSX/CSV.
   * Colunas reconhecidas (case/acento-insensitive): codigo, nome, classificacao, aliases, ordem, ativo, notas, slug.
   * - `codigo` (Tasy) é gravado em `tasy_code`. Se `slug` não vier, é derivado de `codigo` ou `nome`.
   * - `aliases` aceita lista separada por `;` ou `,`.
   * - Upsert por `slug`: aliases existentes são complementados (sem duplicar).
   */
  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Planilha sem aba legível");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

      const pick = (row: Record<string, unknown>, keys: string[]) => {
        const wanted = keys.map(norm);
        for (const k of Object.keys(row)) {
          if (wanted.includes(norm(k))) {
            const v = row[k];
            return v == null || v === "" ? null : String(v).trim();
          }
        }
        return null;
      };

      const splitAliases = (raw: string | null): string[] => {
        if (!raw) return [];
        return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      };

      const existingBySlug = new Map(list.map((s) => [s.slug, s] as const));
      const payload: Sector[] = [];
      let skipped = 0;

      for (const row of rows) {
        const nome = pick(row, ["nome", "name", "setor", "nomesetor", "nome do setor"]);
        const codigo = pick(row, ["codigo", "code", "codigotasy", "codigo tasy", "cd_setor", "cd_setor_atendimento"]);
        const classification = pick(row, ["classificacao", "classification", "classificacaosetor", "classe", "tipo"]);
        let slug = pick(row, ["slug"]);
        if (!slug && codigo) slug = buildSlug(codigo);
        if (!slug && nome) slug = buildSlug(nome);
        if (!slug || !nome) { skipped++; continue; }
        slug = buildSlug(slug);
        const aliasesRaw = pick(row, ["aliases", "alias", "variacoes", "variações"]);
        const ordem = Number(pick(row, ["ordem", "sort_order", "order"]) ?? 50) || 50;
        const ativoRaw = pick(row, ["ativo", "active", "status"]);
        const ativo = ativoRaw == null ? true : !/^(0|false|nao|não|inativo|n|i)$/i.test(ativoRaw);
        const notas = pick(row, ["notas", "notes", "observacao", "observações"]);

        const existing = existingBySlug.get(slug);
        const mergedAliases = Array.from(
          new Set([...(existing?.aliases ?? []), ...splitAliases(aliasesRaw), nome]),
        );

        payload.push({
          slug,
          name: nome,
          aliases: mergedAliases,
          active: ativo,
          sort_order: ordem,
          notes: notas,
          tasy_code: codigo,
          classification,
        });
      }

      if (payload.length === 0) {
        toast.error(`Nenhuma linha válida encontrada${skipped ? ` (${skipped} ignoradas).` : "."}`);
        return;
      }

      const { error } = await supabase.from("sectors").upsert(payload, { onConflict: "slug" });
      if (error) { toast.error("Erro ao importar: " + error.message); return; }
      toast.success(`${payload.length} setor(es) importado(s)${skipped ? ` · ${skipped} ignorado(s)` : ""}`);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao processar planilha");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
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
              {" "}<code>aliases</code> (separados por <code>;</code> ou <code>,</code>),
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
    </div>
  );
}
