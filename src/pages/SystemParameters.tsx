// Tela de Parâmetros do Sistema.
// Cada parâmetro vive em `system_parameter_defs` (valor padrão global).
// Exceções por hospital + convênio + especialidade vão em `system_parameter_overrides`.
// Resolver: `resolve_system_parameter(key, hospital_id, convenio_slug, specialty)` no DB.
//
// O editor é orientado pelo `json_schema` do parâmetro — campos viram inputs
// nativos (Switch/Number/Select/Input) para que regras não fiquem hardcoded
// no código nem dependam de JSON. Modo avançado (JSON cru) permanece como
// fallback para parâmetros com schema livre.
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { Settings, Plus, Edit, Trash2, Globe, Check, ChevronsUpDown } from "lucide-react";
import { COMMON_SPECIALTIES } from "@/lib/specialties";
import { cn } from "@/lib/utils";

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

// ---- Combobox de especialidade -------------------------------------------------
function SpecialtyCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const display = value
    ? value
    : "Qualquer especialidade";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{display}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(360px,90vw)] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Buscar ou digitar nova…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onChange(query.trim().toLowerCase());
                    setOpen(false);
                  }}
                >
                  Usar &quot;{query.trim().toLowerCase()}&quot;
                </button>
              ) : (
                <span className="px-3 py-2 text-sm text-muted-foreground">Sem resultados.</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__any"
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                Qualquer especialidade
              </CommandItem>
              {COMMON_SPECIALTIES.map((s) => {
                const norm = s.toLowerCase();
                return (
                  <CommandItem
                    key={s}
                    value={s}
                    onSelect={() => {
                      onChange(norm);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === norm ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {s}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---- Editor schema-driven ------------------------------------------------------
// Aceita JSON Schema (subset) com type=object/properties; cada property é
// renderizada como input nativo. Schema livre cai pro modo JSON.
type SchemaProp = {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: any;
  description?: string;
  title?: string;
};

function readableTitle(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: any;
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  const props: Record<string, SchemaProp> = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Este parâmetro não tem schema estruturado — use o modo avançado (JSON).
      </p>
    );
  }
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      {keys.map((k) => {
        const p = props[k];
        const v = value?.[k];
        const isReq = required.includes(k);
        const title = p.title ?? readableTitle(k);
        const help = p.description;
        const labelEl = (
          <div className="space-y-0.5">
            <Label className="text-sm">
              {title} {isReq && <span className="text-destructive">*</span>}
            </Label>
            {help && <p className="text-xs text-muted-foreground">{help}</p>}
          </div>
        );
        if (p.type === "boolean") {
          return (
            <div key={k} className="flex items-start justify-between gap-3 rounded-md border p-3">
              {labelEl}
              <Switch checked={!!v} onCheckedChange={(b) => set(k, b)} />
            </div>
          );
        }
        if (p.type === "integer" || p.type === "number") {
          return (
            <div key={k} className="space-y-1.5">
              {labelEl}
              <Input
                type="number"
                value={v ?? ""}
                min={p.minimum}
                max={p.maximum}
                step={p.type === "integer" ? 1 : "any"}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") return set(k, null);
                  const num = p.type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
                  set(k, Number.isFinite(num) ? num : null);
                }}
              />
              {(p.minimum !== undefined || p.maximum !== undefined) && (
                <p className="text-[10px] text-muted-foreground">
                  {p.minimum !== undefined && `mín ${p.minimum}`}
                  {p.minimum !== undefined && p.maximum !== undefined && " · "}
                  {p.maximum !== undefined && `máx ${p.maximum}`}
                </p>
              )}
            </div>
          );
        }
        if (p.type === "string" && Array.isArray(p.enum) && p.enum.length > 0) {
          return (
            <div key={k} className="space-y-1.5">
              {labelEl}
              <Select value={v ?? ""} onValueChange={(nv) => set(k, nv)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {p.enum.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }
        if (p.type === "string") {
          return (
            <div key={k} className="space-y-1.5">
              {labelEl}
              <Input value={v ?? ""} onChange={(e) => set(k, e.target.value)} />
            </div>
          );
        }
        // Fallback: edita como JSON inline pra subobjetos/arrays
        return (
          <div key={k} className="space-y-1.5">
            {labelEl}
            <Textarea
              rows={4}
              className="font-mono text-xs"
              value={JSON.stringify(v ?? p.default ?? null, null, 2)}
              onChange={(e) => {
                try { set(k, JSON.parse(e.target.value)); } catch { /* ignora até parsear */ }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---- Página -------------------------------------------------------------------
export default function SystemParameters({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const [defs, setDefs] = useState<ParamDef[]>([]);
  const [overrides, setOverrides] = useState<ParamOverride[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [loading, setLoading] = useState(true);

  // edição do padrão global
  const [defOpen, setDefOpen] = useState<ParamDef | null>(null);
  const [defValue, setDefValue] = useState<Record<string, any>>({});
  const [defAdvanced, setDefAdvanced] = useState(false);
  const [defJson, setDefJson] = useState("");

  // edição de override
  const [ovOpen, setOvOpen] = useState<{ def: ParamDef; edit?: ParamOverride } | null>(null);
  const [ovScope, setOvScope] = useState({ hospital_id: "", convenio_slug: "", specialty: "" });
  const [ovMeta, setOvMeta] = useState({ note: "", active: true });
  const [ovValue, setOvValue] = useState<Record<string, any>>({});
  const [ovAdvanced, setOvAdvanced] = useState(false);
  const [ovJson, setOvJson] = useState("");

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

  function describeValue(schema: any, value: any): string {
    const props = schema?.properties ?? {};
    const keys = Object.keys(props);
    if (keys.length === 0) return JSON.stringify(value);
    return keys
      .map((k) => `${(props[k]?.title ?? readableTitle(k))}: ${formatScalar(value?.[k])}`)
      .join(" · ");
  }
  function formatScalar(v: any) {
    if (v === true) return "sim";
    if (v === false) return "não";
    if (v === null || v === undefined) return "—";
    return String(v);
  }

  // -------- editar padrão global --------
  function openDef(d: ParamDef) {
    setDefOpen(d);
    setDefValue({ ...(d.value ?? {}) });
    setDefAdvanced(false);
    setDefJson(JSON.stringify(d.value, null, 2));
  }
  async function saveDef() {
    if (!defOpen) return;
    let parsed: any;
    if (defAdvanced) {
      try { parsed = JSON.parse(defJson); }
      catch (e: any) { toast({ title: "JSON inválido", description: e.message, variant: "destructive" }); return; }
    } else {
      parsed = defValue;
    }
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
    setOvScope({
      hospital_id: edit?.hospital_id ?? "",
      convenio_slug: edit?.convenio_slug ?? "",
      specialty: edit?.specialty ?? "",
    });
    setOvMeta({ note: edit?.note ?? "", active: edit?.active ?? true });
    const baseValue = { ...(def.value ?? {}), ...(edit?.value ?? {}) };
    setOvValue(baseValue);
    setOvAdvanced(false);
    setOvJson(JSON.stringify(edit?.value ?? {}, null, 2));
  }
  async function saveOv() {
    if (!ovOpen) return;
    if (!ovScope.hospital_id && !ovScope.convenio_slug && !ovScope.specialty.trim()) {
      toast({ title: "Defina ao menos um escopo", description: "Hospital, convênio ou especialidade.", variant: "destructive" });
      return;
    }
    let parsed: any;
    if (ovAdvanced) {
      try { parsed = JSON.parse(ovJson); }
      catch (e: any) { toast({ title: "JSON inválido", description: e.message, variant: "destructive" }); return; }
    } else {
      // Só persiste as chaves que diferem do default — assim o override é
      // "patch", e mudanças futuras no padrão global propagam.
      const baseDef = ovOpen.def.value ?? {};
      const diff: Record<string, any> = {};
      for (const k of Object.keys(ovValue)) {
        if (JSON.stringify(ovValue[k]) !== JSON.stringify(baseDef[k])) {
          diff[k] = ovValue[k];
        }
      }
      parsed = diff;
      if (Object.keys(parsed).length === 0) {
        toast({
          title: "Nada a sobrescrever",
          description: "Os valores são iguais ao padrão global. Altere ao menos um campo.",
          variant: "destructive",
        });
        return;
      }
    }
    const payload = {
      def_key: ovOpen.def.key,
      hospital_id: ovScope.hospital_id || null,
      convenio_slug: ovScope.convenio_slug || null,
      specialty: ovScope.specialty.trim() ? ovScope.specialty.trim().toLowerCase() : null,
      value: parsed,
      note: ovMeta.note.trim() || null,
      active: ovMeta.active,
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

                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Globe className="h-3.5 w-3.5" /> Padrão global (sem exceção)
                    </div>
                    <p className="text-sm">{describeValue(d.json_schema, d.value)}</p>
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
                              <p className="text-sm">
                                Sobrescreve: <span className="text-muted-foreground">{describeValue(d.json_schema, o.value)}</span>
                              </p>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar padrão global</DialogTitle>
            <DialogDescription>{defOpen?.label} — afeta todos os escopos sem exceção específica.</DialogDescription>
          </DialogHeader>
          {defOpen && (
            <div className="space-y-4">
              {!defAdvanced ? (
                <SchemaForm schema={defOpen.json_schema} value={defValue} onChange={setDefValue} />
              ) : (
                <div className="space-y-2">
                  <Label>Valor (JSON)</Label>
                  <Textarea value={defJson} onChange={(e) => setDefJson(e.target.value)} rows={10} className="font-mono text-xs" />
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={defAdvanced}
                    onCheckedChange={(v) => {
                      if (v) setDefJson(JSON.stringify(defValue, null, 2));
                      else {
                        try { setDefValue(JSON.parse(defJson)); } catch { /* mantém */ }
                      }
                      setDefAdvanced(v);
                    }}
                  />
                  <Label className="text-xs text-muted-foreground">Modo avançado (JSON)</Label>
                </div>
              </div>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{ovOpen?.edit ? "Editar exceção" : "Nova exceção"}</DialogTitle>
            <DialogDescription>
              {ovOpen?.def.label}. Defina ao menos um escopo; quanto mais específico, maior a prioridade.
            </DialogDescription>
          </DialogHeader>
          {ovOpen && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Hospital</Label>
                  <Select
                    value={ovScope.hospital_id || "__any"}
                    onValueChange={(v) => setOvScope((s) => ({ ...s, hospital_id: v === "__any" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">Qualquer hospital</SelectItem>
                      {hospitals.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Convênio</Label>
                  <Select
                    value={ovScope.convenio_slug || "__any"}
                    onValueChange={(v) => setOvScope((s) => ({ ...s, convenio_slug: v === "__any" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">Qualquer convênio</SelectItem>
                      {convenios.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Especialidade</Label>
                  <SpecialtyCombobox
                    value={ovScope.specialty}
                    onChange={(v) => setOvScope((s) => ({ ...s, specialty: v }))}
                  />
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm font-medium">Valores nesta exceção</Label>
                <p className="text-xs text-muted-foreground">
                  Só os campos que você alterar serão sobrescritos. Os demais seguem o padrão global.
                </p>
                {!ovAdvanced ? (
                  <SchemaForm schema={ovOpen.def.json_schema} value={ovValue} onChange={setOvValue} />
                ) : (
                  <Textarea
                    value={ovJson}
                    onChange={(e) => setOvJson(e.target.value)}
                    rows={8}
                    className="font-mono text-xs"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Observação (opcional)</Label>
                <Input
                  value={ovMeta.note}
                  onChange={(e) => setOvMeta((m) => ({ ...m, note: e.target.value }))}
                  placeholder="Por que esta exceção existe?"
                />
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-2">
                  <Switch checked={ovMeta.active} onCheckedChange={(v) => setOvMeta((m) => ({ ...m, active: v }))} />
                  <Label>Exceção ativa</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={ovAdvanced}
                    onCheckedChange={(v) => {
                      if (v) setOvJson(JSON.stringify(ovValue, null, 2));
                      else {
                        try { setOvValue(JSON.parse(ovJson)); } catch { /* mantém */ }
                      }
                      setOvAdvanced(v);
                    }}
                  />
                  <Label className="text-xs text-muted-foreground">Modo avançado (JSON)</Label>
                </div>
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
        description="Configure regras padrão e exceções por hospital, convênio ou especialidade — sem deixar nada hardcoded."
        icon={Settings}
      />
      {body}
    </div>
  );
}
