// Tela de Parâmetros do Sistema.
// Cada parâmetro vive em `system_parameter_defs` (valor padrão global).
// Exceções por hospital + convênio + especialidade vão em `system_parameter_overrides`.
// Resolver: `resolve_system_parameter(key, hospital_id, convenio_slug, specialty)` no DB.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Settings, Plus, Edit, Trash2, Globe } from "lucide-react";

type ParamDef = {
  key: string;
  category: string;
  label: string;
  description: string | null;
  json_schema: any;
  value: any;
  updated_at: string;
};

type ParamOverride = {
  id: string;
  def_key: string;
  hospital_id: string | null;
  convenio_slug: string | null;
  specialty: string | null;
  value: any;
  active: boolean;
  note: string | null;
  priority: number;
  updated_at: string;
};

type Hospital = { id: string; name: string };
type Convenio = { slug: string; name: string };

export default function SystemParameters({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const [defs, setDefs] = useState<ParamDef[]>([]);
  const [overrides, setOverrides] = useState<ParamOverride[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [loading, setLoading] = useState(true);

  const [defOpen, setDefOpen] = useState<ParamDef | null>(null);
  const [defJson, setDefJson] = useState("");

  const [ovOpen, setOvOpen] = useState<{ def: ParamDef; edit?: ParamOverride } | null>(null);
  const [ovForm, setOvForm] = useState({
    hospital_id: "",
    convenio_slug: "",
    specialty: "",
    note: "",
    active: true,
    valueJson: "",
  });

  async function load() {
    setLoading(true);
    const [d, o, h, c] = await Promise.all([
      supabase.from("system_parameter_defs" as never).select("*").order("category").order("key"),
      supabase.from("system_parameter_overrides" as never).select("*").order("priority", { ascending: false }),
      supabase.from("hospitals" as never).select("id, name").order("name"),
      supabase.from("convenios" as never).select("slug, name").order("name"),
    ]);
    setDefs((d.data as ParamDef[] | null) ?? []);
    setOverrides((o.data as ParamOverride[] | null) ?? []);
    setHospitals((h.data as Hospital[] | null) ?? []);
    setConvenios((c.data as Convenio[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const byCategory = useMemo(() => {
    const m = new Map<string, ParamDef[]>();
    for (const d of defs) {
      const list = m.get(d.category) ?? [];
      list.push(d);
      m.set(d.category, list);
    }
    return Array.from(m.entries());
  }, [defs]);

  const overridesByDef = useMemo(() => {
    const m = new Map<string, ParamOverride[]>();
    for (const o of overrides) {
      const list = m.get(o.def_key) ?? [];
      list.push(o);
      m.set(o.def_key, list);
    }
    return m;
  }, [overrides]);

  const hospitalName = (id: string | null) =>
    id ? (hospitals.find((h) => h.id === id)?.name ?? id.slice(0, 8)) : null;
  const convenioName = (slug: string | null) =>
    slug ? (convenios.find((c) => c.slug === slug)?.name ?? slug) : null;

  // -------- editar padrão global --------
  function openDef(d: ParamDef) {
    setDefOpen(d);
    setDefJson(JSON.stringify(d.value, null, 2));
  }
  async function saveDef() {
    if (!defOpen) return;
    let parsed: any;
    try { parsed = JSON.parse(defJson); }
    catch (e: any) { toast({ title: "JSON inválido", description: e.message, variant: "destructive" }); return; }
    const { error } = await supabase
      .from("system_parameter_defs" as never)
      .update({ value: parsed, updated_by: user?.id } as never)
      .eq("key", defOpen.key);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Padrão atualizado", description: `${defOpen.label} agora vigente.` });
    setDefOpen(null);
    load();
  }

  // -------- override --------
  function openOv(def: ParamDef, edit?: ParamOverride) {
    setOvOpen({ def, edit });
    setOvForm({
      hospital_id: edit?.hospital_id ?? "",
      convenio_slug: edit?.convenio_slug ?? "",
      specialty: edit?.specialty ?? "",
      note: edit?.note ?? "",
      active: edit?.active ?? true,
      valueJson: JSON.stringify(edit?.value ?? def.value, null, 2),
    });
  }
  async function saveOv() {
    if (!ovOpen) return;
    if (!ovForm.hospital_id && !ovForm.convenio_slug && !ovForm.specialty.trim()) {
      toast({ title: "Defina ao menos um escopo", description: "Hospital, convênio ou especialidade.", variant: "destructive" });
      return;
    }
    let parsed: any;
    try { parsed = JSON.parse(ovForm.valueJson); }
    catch (e: any) { toast({ title: "JSON inválido", description: e.message, variant: "destructive" }); return; }
    const payload = {
      def_key: ovOpen.def.key,
      hospital_id: ovForm.hospital_id || null,
      convenio_slug: ovForm.convenio_slug || null,
      specialty: ovForm.specialty.trim() ? ovForm.specialty.trim().toLowerCase() : null,
      value: parsed,
      note: ovForm.note.trim() || null,
      active: ovForm.active,
      updated_by: user?.id,
    };
    const q = ovOpen.edit
      ? supabase.from("system_parameter_overrides" as never).update(payload as never).eq("id", ovOpen.edit.id)
      : supabase.from("system_parameter_overrides" as never).insert(payload as never);
    const { error } = await q;
    if (error) { toast({ title: "Erro ao salvar exceção", description: error.message, variant: "destructive" }); return; }
    toast({ title: ovOpen.edit ? "Exceção atualizada" : "Exceção criada" });
    setOvOpen(null);
    load();
  }
  async function deleteOv(id: string) {
    if (!confirm("Remover esta exceção? Os escopos voltam a usar o padrão global.")) return;
    const { error } = await supabase.from("system_parameter_overrides" as never).delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Exceção removida" });
    load();
  }

  const body = (
    <div className="p-4 md:p-6 space-y-6">
      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!loading && defs.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum parâmetro cadastrado ainda.
        </Card>
      )}
      {byCategory.map(([cat, list]) => (
        <section key={cat} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h2>
          <div className="space-y-4">
            {list.map((d) => {
              const ovs = overridesByDef.get(d.key) ?? [];
              return (
                <Card key={d.key} className="p-4 md:p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{d.label}</h3>
                        <Badge variant="outline" className="font-mono text-[10px]">{d.key}</Badge>
                      </div>
                      {d.description && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{d.description}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openDef(d)}>
                      <Edit className="h-3.5 w-3.5 mr-1.5" /> Editar padrão
                    </Button>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
                      <Globe className="h-3.5 w-3.5" /> Padrão global (sem exceção)
                    </div>
                    <pre className="text-xs font-mono overflow-x-auto">{JSON.stringify(d.value, null, 2)}</pre>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">
                        Exceções <span className="text-muted-foreground">({ovs.length})</span>
                      </h4>
                      <Button size="sm" variant="secondary" onClick={() => openOv(d)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Nova exceção
                      </Button>
                    </div>
                    {ovs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem exceções — todos os escopos usam o padrão acima.</p>
                    ) : (
                      <div className="space-y-2">
                        {ovs.map((o) => (
                          <div key={o.id} className="rounded-md border p-3 flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {hospitalName(o.hospital_id) && <Badge variant="outline">{hospitalName(o.hospital_id)}</Badge>}
                                {convenioName(o.convenio_slug) && <Badge variant="outline">{convenioName(o.convenio_slug)}</Badge>}
                                {o.specialty && <Badge variant="outline" className="capitalize">{o.specialty}</Badge>}
                                {!o.active && <Badge variant="destructive">desativada</Badge>}
                                <span className="text-[10px] text-muted-foreground ml-1">prioridade {o.priority}</span>
                              </div>
                              {o.note && <p className="text-xs text-muted-foreground">{o.note}</p>}
                              <pre className="text-xs font-mono overflow-x-auto bg-muted/40 rounded p-2">{JSON.stringify(o.value, null, 2)}</pre>
                            </div>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openOv(d, o)} aria-label="Editar">
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteOv(o.id)} aria-label="Remover">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      {/* Editar padrão global */}
      <Dialog open={!!defOpen} onOpenChange={(o) => !o && setDefOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar padrão global</DialogTitle>
            <DialogDescription>{defOpen?.label} — afeta todos os escopos sem exceção específica.</DialogDescription>
          </DialogHeader>
          {defOpen && (
            <div className="space-y-3">
              <Label>Valor (JSON)</Label>
              <Textarea value={defJson} onChange={(e) => setDefJson(e.target.value)} rows={10} className="font-mono text-xs" />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Schema esperado</summary>
                <pre className="mt-2 font-mono">{JSON.stringify(defOpen.json_schema, null, 2)}</pre>
              </details>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefOpen(null)}>Cancelar</Button>
            <Button onClick={saveDef}>Salvar padrão</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar override */}
      <Dialog open={!!ovOpen} onOpenChange={(o) => !o && setOvOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{ovOpen?.edit ? "Editar exceção" : "Nova exceção"}</DialogTitle>
            <DialogDescription>
              {ovOpen?.def.label}. Defina ao menos um escopo; mais escopos = maior prioridade.
            </DialogDescription>
          </DialogHeader>
          {ovOpen && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Hospital</Label>
                  <Select value={ovForm.hospital_id || "__any"} onValueChange={(v) => setOvForm((f) => ({ ...f, hospital_id: v === "__any" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">Qualquer hospital</SelectItem>
                      {hospitals.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Convênio</Label>
                  <Select value={ovForm.convenio_slug || "__any"} onValueChange={(v) => setOvForm((f) => ({ ...f, convenio_slug: v === "__any" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">Qualquer convênio</SelectItem>
                      {convenios.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Especialidade</Label>
                  <Input
                    placeholder="ex: psiquiatria"
                    value={ovForm.specialty}
                    onChange={(e) => setOvForm((f) => ({ ...f, specialty: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label>Valor (JSON) — sobrescreve os campos informados</Label>
                <Textarea
                  value={ovForm.valueJson}
                  onChange={(e) => setOvForm((f) => ({ ...f, valueJson: e.target.value }))}
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label>Observação (opcional)</Label>
                <Input value={ovForm.note} onChange={(e) => setOvForm((f) => ({ ...f, note: e.target.value }))} placeholder="Por que esta exceção existe?" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={ovForm.active} onCheckedChange={(v) => setOvForm((f) => ({ ...f, active: v }))} />
                <Label>Exceção ativa</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvOpen(null)}>Cancelar</Button>
            <Button onClick={saveOv}>Salvar exceção</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) return body;
  return (
    <div>
      <PageHeader
        title="Parâmetros do Sistema"
        description="Configurações globais e exceções por hospital, convênio ou especialidade."
        icon={Settings}
      />
      {body}
    </div>
  );
}
