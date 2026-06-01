import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital, type Hospital } from "@/contexts/HospitalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

const UF_LIST = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Form = { id?: string; slug: string; name: string; state_uf: string; cnpj: string; active: boolean };
const emptyForm: Form = { slug: "", name: "", state_uf: "DF", cnpj: "", active: true };

export default function Hospitals() {
  const { refresh } = useHospital();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("hospitals").select("*").order("name");
    if (error) toast.error(error.message);
    setHospitals((data ?? []) as Hospital[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (h: Hospital) => {
    setForm({ id: h.id, slug: h.slug, name: h.name, state_uf: h.state_uf, cnpj: h.cnpj ?? "", active: h.active });
    setOpen(true);
  };

  const save = async () => {
    if (!form.slug.trim() || !form.name.trim() || !form.state_uf) {
      toast.error("slug, nome e UF são obrigatórios");
      return;
    }
    setSaving(true);
    const payload = {
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      state_uf: form.state_uf.toUpperCase(),
      cnpj: form.cnpj.trim() || null,
      active: form.active,
    };
    const q = form.id
      ? supabase.from("hospitals").update(payload).eq("id", form.id)
      : supabase.from("hospitals").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? "Hospital atualizado" : "Hospital criado");
    setOpen(false);
    await load();
    await refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hospitais"
        description="Cadastro dos hospitais da operação. Cada hospital tem isolamento operacional, e cadastros (médicos/empresas/convênios) são compartilhados por estado."
        icon={Building2}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Hospitais cadastrados</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Novo hospital
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{form.id ? "Editar hospital" : "Novo hospital"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="slug">Slug (identificador técnico)</Label>
                  <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="ex.: rd_brasilia" disabled={!!form.id} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex.: Hospital DF Star" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="uf">UF</Label>
                    <select
                      id="uf"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.state_uf}
                      onChange={(e) => setForm({ ...form, state_uf: e.target.value })}
                    >
                      {UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cnpj">CNPJ (opcional)</Label>
                    <Input id="cnpj" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor="active">Ativo</Label>
                  <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : hospitals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum hospital cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {hospitals.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell className="font-mono text-xs">{h.slug}</TableCell>
                    <TableCell>{h.state_uf}</TableCell>
                    <TableCell className="font-mono text-xs">{h.cnpj ?? "—"}</TableCell>
                    <TableCell>
                      <span className={h.active ? "text-emerald-600" : "text-muted-foreground"}>
                        {h.active ? "Ativo" : "Inativo"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(h)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como funciona o isolamento</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Operacional isolado:</strong> pagamentos, notas, glosas, regras e
            todos os dados de fluxo ficam restritos ao hospital ativo (selecionado no canto superior).
          </p>
          <p>
            <strong className="text-foreground">Cadastros compartilhados por estado:</strong> médicos, empresas,
            convênios e setores são compartilhados entre hospitais do mesmo estado (UF). Cada hospital pode aplicar
            overrides locais sem afetar os demais.
          </p>
          <p>
            <strong className="text-foreground">Portais:</strong> usuários de portal (empresa e médico) enxergam apenas
            os dados das suas próprias entidades, independente de hospital — o gate de hospital não se aplica a eles
            porque seu escopo já é definido pelo vínculo company/doctor.
          </p>
          <p>
            <strong className="text-foreground">Roles globais:</strong> admin e diretor enxergam todos os hospitais e
            podem alternar pelo seletor no topo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
