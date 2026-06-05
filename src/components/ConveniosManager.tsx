import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, Plus, Pencil, X, Upload, Download } from "lucide-react";


type Convenio = {
  slug: string;
  code?: string | null;
  name: string;
  aliases: string[];
  active: boolean;
  sort_order: number;
  operator_code: string | null;
  notes: string | null;
};

const empty: Convenio = {
  slug: "",
  code: null,
  name: "",
  aliases: [],
  active: true,
  sort_order: 50,
  operator_code: "",
  notes: "",
};

function buildSlug(input: string) {
  return input.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Props = { canManage?: boolean };

export default function ConveniosManager({ canManage = true }: Props) {
  const [list, setList] = useState<Convenio[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Convenio | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const rows = [
      { "Convênio": "Bradesco Saúde", "Alias": "bradesco, bradesco saude, bsaude, bradescosaude" },
      { "Convênio": "Sul América", "Alias": "sul america, sulamerica, sul américa" },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["Convênio", "Alias"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Convênios");
    XLSX.writeFile(wb, "modelo_convenios.xlsx");
  };

  const buildSlugLocal = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      const wb = isCsv
        ? XLSX.read(await file.text(), { type: "string" })
        : XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (rows.length === 0) { toast.error("Planilha vazia"); return; }

      // Detectar colunas (Convênio / Alias) tolerando variações
      const headers = Object.keys(rows[0]);
      const norm = (s: string) => s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const nameCol = headers.find(h => ["convenio", "nome", "nome canonico", "convênio"].includes(norm(h)))
        ?? headers[0];
      const aliasCol = headers.find(h => ["alias", "aliases", "variacoes", "variações"].includes(norm(h)))
        ?? headers[1];

      const payload = rows
        .map(r => {
          const name = String(r[nameCol] ?? "").trim();
          if (!name) return null;
          const aliases = String(r[aliasCol] ?? "")
            .split(",").map(a => a.trim()).filter(Boolean);
          return {
            slug: buildSlugLocal(name),
            name,
            aliases,
            active: true,
            sort_order: 50,
          };
        })
        .filter(Boolean) as any[];

      if (payload.length === 0) { toast.error("Nenhuma linha válida"); return; }

      const { error } = await supabase.from("convenios").upsert(payload, { onConflict: "slug" });
      if (error) { toast.error("Erro ao importar: " + error.message); return; }
      toast.success(`${payload.length} convênios importados/atualizados`);
      load();
    } catch (e: any) {
      toast.error("Falha ao ler planilha: " + (e?.message ?? e));
    } finally {
      setImporting(false);
    }
  };


  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("convenios").select("*").order("sort_order").order("name");
    if (error) toast.error("Erro ao carregar convênios: " + error.message);
    else setList((data ?? []) as Convenio[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing({ ...empty });
    setIsNew(true);
    setAliasInput("");
  };
  const openEdit = (c: Convenio) => {
    setEditing({ ...c, aliases: [...c.aliases] });
    setIsNew(false);
    setAliasInput("");
  };

  const save = async () => {
    if (!editing) return;
    const slug = (editing.slug || buildSlug(editing.name)).trim().toLowerCase();
    if (!slug || !editing.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    const payload = {
      ...editing,
      slug,
      aliases: editing.aliases.map(a => a.trim()).filter(Boolean),
      operator_code: editing.operator_code?.trim() || null,
      notes: editing.notes?.trim() || null,
    };
    const { error } = isNew
      ? await supabase.from("convenios").insert(payload)
      : await supabase.from("convenios").update(payload).eq("slug", editing.slug);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(isNew ? "Convênio criado" : "Convênio atualizado");
    setEditing(null);
    load();
  };

  const addAlias = () => {
    if (!editing || !aliasInput.trim()) return;
    const v = aliasInput.trim();
    if (editing.aliases.some(a => a.toLowerCase() === v.toLowerCase())) {
      setAliasInput("");
      return;
    }
    setEditing({ ...editing, aliases: [...editing.aliases, v] });
    setAliasInput("");
  };

  const removeAlias = (a: string) => {
    if (!editing) return;
    setEditing({ ...editing, aliases: editing.aliases.filter(x => x !== a) });
  };

  const filtered = list.filter(c => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return c.name.toLowerCase().includes(s)
      || c.slug.toLowerCase().includes(s)
      || c.aliases.some(a => a.toLowerCase().includes(s))
      || (c.operator_code ?? "").toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Convênios
          </h2>
          <p className="text-sm text-muted-foreground">
            Cadastro central de convênios/operadoras. Aliases capturam as variações de escrita
            (ex.: "Bradesco", "BRADESCO SAÚDE", "BSAÚDE") usadas nas planilhas.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />Baixar modelo
            </Button>
            <Button variant="outline" onClick={() => importRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4 mr-1" />{importing ? "Importando…" : "Importar planilha"}
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                if (importRef.current) importRef.current.value = "";
              }}
            />
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" />Novo convênio
            </Button>
          </div>
        )}

      </div>

      <Input
        placeholder="Buscar por nome, alias ou código…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-md"
      />

      <div className="grid gap-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum convênio encontrado.</p>
        )}
        {filtered.map(c => (
          <Card key={c.slug} className={c.active ? "" : "opacity-60"}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.code && (
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{c.code}</code>
                  )}
                  {c.operator_code && (
                    <code className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                      {c.operator_code}
                    </code>
                  )}
                  <span className="font-semibold">{c.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.slug}</code>
                  {!c.active && <Badge variant="destructive" className="text-xs">inativo</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.aliases.length === 0 && (
                    <span className="text-xs text-muted-foreground">Sem aliases</span>
                  )}
                  {c.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
              </div>
              {canManage && (
                <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
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
            <DialogTitle>{isNew ? "Novo convênio" : `Editar ${editing?.name}`}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nome canônico</Label>
                <Input
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Bradesco Saúde"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Slug (interno)</Label>
                  <Input
                    value={editing.slug}
                    disabled={!isNew}
                    onChange={e => setEditing({ ...editing, slug: e.target.value })}
                    placeholder="auto a partir do nome"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código operadora (opcional)</Label>
                  <Input
                    value={editing.operator_code ?? ""}
                    onChange={e => setEditing({ ...editing, operator_code: e.target.value })}
                    placeholder="Ex: 005711"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input
                  type="number"
                  value={editing.sort_order}
                  onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Aliases (variações reconhecidas)</Label>
                <div className="flex gap-2">
                  <Input
                    value={aliasInput}
                    onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                    placeholder="Digite e pressione Enter"
                  />
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
                <Textarea
                  value={editing.notes ?? ""}
                  rows={2}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editing.active}
                  onCheckedChange={v => setEditing({ ...editing, active: v })}
                />
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
