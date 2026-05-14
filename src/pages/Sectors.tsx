import { useEffect, useState } from "react";
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
import { Layers, Plus, Pencil, X } from "lucide-react";

type Sector = {
  slug: string;
  name: string;
  aliases: string[];
  active: boolean;
  sort_order: number;
  notes: string | null;
};

const empty: Sector = { slug: "", name: "", aliases: [], active: true, sort_order: 50, notes: "" };

export default function Sectors() {
  const [list, setList] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

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
    const payload = { ...editing, slug, aliases: editing.aliases.map(a => a.trim()).filter(Boolean) };
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6" /> Setores</h1>
          <p className="text-sm text-muted-foreground">
            Padronização dos nomes de setor que vêm da base. Aliases capturam variações (acentos, abreviações, sufixos).
          </p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Novo setor</Button>
      </div>

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
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.slug}</code>
                  {!s.active && <Badge variant="outline">inativo</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.aliases.length === 0 && <span className="text-xs text-muted-foreground">Sem aliases</span>}
                  {s.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
                {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                <Pencil className="h-4 w-4" />
              </Button>
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
                <Label className="text-xs">Nome de exibição</Label>
                <Input value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Centro Cirúrgico" />
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
