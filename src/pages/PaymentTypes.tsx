import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Tag, Plus, Pencil, Layers, Boxes } from "lucide-react";

/**
 * Fase D / Onda 4 — Caso C: a página foi dividida em duas abas que editam
 * tabelas distintas (item_types × payment_models). A tabela legada
 * `payment_types` permanece no banco apenas para FKs históricas e NÃO é
 * mais editada por aqui.
 */

// ============== TIPO DE ITEM (item_types) ==============
type ItemTypeRow = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  tuss_default: string | null;
  tuss_codes_extra: string[] | null;
  requires_tuss: boolean;
  is_default_when_no_tuss: boolean;
  default_function: string | null;
};

const emptyItemType: ItemTypeRow = {
  code: "", label: "", description: "", color: "", sort_order: 50, active: true,
  tuss_default: "", tuss_codes_extra: [], requires_tuss: true,
  is_default_when_no_tuss: false, default_function: "",
};

function ItemTypesTab() {
  const [list, setList] = useState<ItemTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ItemTypeRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tussExtraText, setTussExtraText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from as any)("item_types")
      .select("*").order("sort_order").order("label");
    if (error) toast.error("Erro ao carregar tipos de item: " + error.message);
    else setList((data ?? []) as ItemTypeRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...emptyItemType }); setTussExtraText(""); setIsNew(true); };
  const openEdit = (p: ItemTypeRow) => {
    setEditing({ ...p });
    setTussExtraText((p.tuss_codes_extra ?? []).join("\n"));
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!code || !editing.label.trim()) { toast.error("Código e rótulo obrigatórios"); return; }
    const extra = tussExtraText.split("\n").map(s => s.trim()).filter(Boolean);
    setSaving(true);
    const payload = {
      code,
      label: editing.label.trim(),
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      sort_order: Number(editing.sort_order) || 50,
      active: editing.active,
      tuss_default: editing.tuss_default?.trim() || null,
      tuss_codes_extra: extra.length ? extra : null,
      requires_tuss: editing.requires_tuss,
      is_default_when_no_tuss: editing.is_default_when_no_tuss,
      default_function: editing.default_function?.trim() || null,
    };
    const { error } = isNew
      ? await (supabase.from as any)("item_types").insert(payload)
      : await (supabase.from as any)("item_types").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(isNew ? "Tipo criado" : "Tipo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: ItemTypeRow) => {
    const { error } = await (supabase.from as any)("item_types").update({ active: !p.active }).eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message); else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo tipo de item</Button>
      </div>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Tipos de item</CardTitle>
          <CardDescription>
            Dimensão de cada linha da base hospitalar (Parecer, Visita, Consulta, etc.). Define TUSS padrão, função
            padrão e se a base precisa ter a coluna TUSS. O motor casa regras por tipo de item.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
            : list.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum tipo cadastrado.</p>
            : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
                        {p.tuss_default && <Badge variant="outline" className="text-xs">TUSS {p.tuss_default}</Badge>}
                        {!p.requires_tuss && <Badge variant="outline" className="text-xs">sem TUSS na base</Badge>}
                        {p.is_default_when_no_tuss && <Badge variant="outline" className="text-xs">default sem TUSS</Badge>}
                        {!p.active && <Badge variant="secondary" className="text-xs">inativo</Badge>}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} aria-label="Ativo" />
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isNew ? "Novo tipo de item" : "Editar tipo de item"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Código *</Label>
                  <Input value={editing.code} disabled={!isNew}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    placeholder="ex: parecer_adulto" />
                  <p className="text-xs text-muted-foreground">Imutável após criação.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rótulo *</Label>
                  <Input value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    placeholder="ex: Parecer Adulto" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea value={editing.description ?? ""} rows={2}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reconhecimento na base</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>TUSS padrão</Label>
                    <Input value={editing.tuss_default ?? ""}
                      onChange={(e) => setEditing({ ...editing, tuss_default: e.target.value })}
                      placeholder="ex: 10102019" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Função padrão</Label>
                    <Input value={editing.default_function ?? ""}
                      onChange={(e) => setEditing({ ...editing, default_function: e.target.value })}
                      placeholder="ex: Parecerista" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>TUSS adicionais (um por linha)</Label>
                  <Textarea value={tussExtraText} rows={3} className="font-mono text-xs"
                    onChange={(e) => setTussExtraText(e.target.value)}
                    placeholder={"10102027\n10102035"} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.requires_tuss}
                    onCheckedChange={(v) => setEditing({ ...editing, requires_tuss: v })} />
                  <Label className="font-normal cursor-pointer">Exigir TUSS na base</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.is_default_when_no_tuss}
                    onCheckedChange={(v) => setEditing({ ...editing, is_default_when_no_tuss: v })} />
                  <Label className="font-normal cursor-pointer">Tipo padrão quando linha não tem TUSS</Label>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Ordem</Label>
                  <Input type="number" value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Cor</Label>
                  <Input value={editing.color ?? ""}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                    placeholder="#3b82f6" />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={editing.active}
                    onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <Label className="font-normal cursor-pointer">Ativo</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== MODELO DE LOTE (payment_models) ==============
type PaymentModelRow = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  calc_strategy: string | null;
  allow_mixed_item_types: boolean;
  expected_headers: string[] | null;
};

const emptyPaymentModel: PaymentModelRow = {
  code: "", label: "", description: "", color: "", sort_order: 50, active: true,
  calc_strategy: "producao", allow_mixed_item_types: false, expected_headers: [],
};

function PaymentModelsTab() {
  const [list, setList] = useState<PaymentModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PaymentModelRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headersText, setHeadersText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from as any)("payment_models")
      .select("*").order("sort_order").order("label");
    if (error) toast.error("Erro ao carregar modelos: " + error.message);
    else setList((data ?? []).map((d: any) => ({
      ...d,
      expected_headers: Array.isArray(d.expected_headers) ? d.expected_headers : [],
    })) as PaymentModelRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...emptyPaymentModel }); setHeadersText(""); setIsNew(true); };
  const openEdit = (p: PaymentModelRow) => {
    setEditing({ ...p, expected_headers: p.expected_headers ?? [] });
    setHeadersText((p.expected_headers ?? []).join("\n"));
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!code || !editing.label.trim()) { toast.error("Código e rótulo obrigatórios"); return; }
    const headers = headersText.split("\n").map((h) => h.trim()).filter(Boolean);
    setSaving(true);
    const payload = {
      code,
      label: editing.label.trim(),
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      sort_order: Number(editing.sort_order) || 50,
      active: editing.active,
      calc_strategy: editing.calc_strategy?.trim() || null,
      allow_mixed_item_types: editing.allow_mixed_item_types,
      expected_headers: headers,
    };
    const { error } = isNew
      ? await (supabase.from as any)("payment_models").insert(payload)
      : await (supabase.from as any)("payment_models").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(isNew ? "Modelo criado" : "Modelo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: PaymentModelRow) => {
    const { error } = await (supabase.from as any)("payment_models").update({ active: !p.active }).eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message); else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo modelo de lote</Button>
      </div>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Boxes className="h-4 w-4" /> Modelos de lote</CardTitle>
          <CardDescription>
            Como o lote é estruturado e calculado (Produção, Remessa, Manual, etc.). Define estratégia de cálculo,
            se mistura tipos de item diferentes e dicas de cabeçalho para o wizard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
            : list.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum modelo cadastrado.</p>
            : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
                        {p.calc_strategy && <Badge variant="secondary" className="text-xs">{p.calc_strategy}</Badge>}
                        {p.allow_mixed_item_types && <Badge variant="outline" className="text-xs">mistura tipos</Badge>}
                        {!p.active && <Badge variant="secondary" className="text-xs">inativo</Badge>}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} aria-label="Ativo" />
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isNew ? "Novo modelo de lote" : "Editar modelo"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Código *</Label>
                  <Input value={editing.code} disabled={!isNew}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    placeholder="ex: producao" />
                  <p className="text-xs text-muted-foreground">Imutável após criação.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rótulo *</Label>
                  <Input value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    placeholder="ex: Produção" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea value={editing.description ?? ""} rows={2}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label>Estratégia de cálculo</Label>
                  <Input value={editing.calc_strategy ?? ""}
                    onChange={(e) => setEditing({ ...editing, calc_strategy: e.target.value })}
                    placeholder="ex: producao | remessa | manual" />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.allow_mixed_item_types}
                    onCheckedChange={(v) => setEditing({ ...editing, allow_mixed_item_types: v })} />
                  <Label className="font-normal cursor-pointer">Permitir tipos de item misturados no mesmo lote</Label>
                </div>
                <div className="space-y-1.5">
                  <Label>Cabeçalhos esperados (um por linha)</Label>
                  <Textarea value={headersText} rows={4} className="font-mono text-xs"
                    onChange={(e) => setHeadersText(e.target.value)}
                    placeholder={"Atend.\nPaciente\nMédico\nValor a repassar"} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Ordem</Label>
                  <Input type="number" value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Cor</Label>
                  <Input value={editing.color ?? ""}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                    placeholder="#3b82f6" />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={editing.active}
                    onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <Label className="font-normal cursor-pointer">Ativo</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== SHELL ==============
export default function PaymentTypes({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <>
      {!embedded && (
        <PageHeader
          title="Tipos & Modelos"
          description="Tipos de item (dimensão das linhas da base) e modelos de lote (como o lote é calculado). Editados em tabelas separadas após Fase D."
        />
      )}
      <div className={embedded ? "max-w-5xl" : "p-8 max-w-5xl"}>
        <Tabs defaultValue="item_types">
          <TabsList>
            <TabsTrigger value="item_types"><Tag className="h-3.5 w-3.5 mr-1.5" /> Tipos de item</TabsTrigger>
            <TabsTrigger value="payment_models"><Layers className="h-3.5 w-3.5 mr-1.5" /> Modelos de lote</TabsTrigger>
          </TabsList>
          <TabsContent value="item_types" className="mt-4"><ItemTypesTab /></TabsContent>
          <TabsContent value="payment_models" className="mt-4"><PaymentModelsTab /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}
