import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Building2, Plus, Trash2, Pencil } from "lucide-react";

interface Company { id: string; name: string; document: string | null; aliases: string[]; notes: string | null }

const empty: Company = { id: "", name: "", document: "", aliases: [], notes: "" };

const Companies = () => {
  const [items, setItems] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company>(empty);
  const [aliasInput, setAliasInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => { document.title = "Empresas | MedPay"; load(); }, []);

  const load = async () => {
    const { data } = await supabase.from("companies").select("*").order("name");
    setItems((data ?? []) as Company[]);
  };

  const save = async () => {
    if (!editing.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    const payload = {
      name: editing.name.trim(),
      document: editing.document?.trim() || null,
      aliases: editing.aliases,
      notes: editing.notes?.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from("companies").update(payload).eq("id", editing.id)
      : await supabase.from("companies").insert(payload);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: editing.id ? "Empresa atualizada" : "Empresa criada" });
    setOpen(false); setEditing(empty); setAliasInput(""); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir empresa?")) return;
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const filtered = search.trim()
    ? items.filter((c) =>
        [c.name, c.document ?? "", ...(c.aliases ?? [])].join(" ").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <>
      <PageHeader title="Empresas" description="Cadastro de clínicas/PJs para reconhecimento automático nas planilhas." />
      <div className="p-8 max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Input placeholder="Buscar por nome, CNPJ ou apelido..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(empty); setAliasInput(""); } }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(empty)}><Plus className="h-4 w-4 mr-2" /> Nova empresa</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing.id ? "Editar empresa" : "Nova empresa"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nome oficial *</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Clínica Cirúrgica de Taguatinga Ltda" />
                </div>
                <div className="space-y-1.5">
                  <Label>CNPJ</Label>
                  <Input value={editing.document ?? ""} onChange={(e) => setEditing({ ...editing, document: e.target.value })} placeholder="00.000.000/0001-00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Apelidos / variações de nome</Label>
                  <p className="text-xs text-muted-foreground">Use para casos em que o nome do arquivo difere do oficial. Pressione Enter para adicionar.</p>
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && aliasInput.trim()) {
                        e.preventDefault();
                        setEditing({ ...editing, aliases: [...editing.aliases, aliasInput.trim()] });
                        setAliasInput("");
                      }
                    }}
                    placeholder="Ex: Cirurgica Taguatinga"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {editing.aliases.map((a, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {a}
                        <button onClick={() => setEditing({ ...editing, aliases: editing.aliases.filter((_, j) => j !== i) })}>×</button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <Textarea rows={2} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">{filtered.length} empresa(s)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">Nenhuma empresa cadastrada ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">CNPJ</th>
                    <th className="px-4 py-2 font-medium">Apelidos</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{c.name}</td>
                      <td className="px-4 py-2 text-muted-foreground tabular-nums">{c.document ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(c.aliases ?? []).map((a, i) => <Badge key={i} variant="outline" className="text-xs">{a}</Badge>)}
                          {(c.aliases ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Companies;
