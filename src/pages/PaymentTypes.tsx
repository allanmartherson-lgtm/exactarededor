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
import { toast } from "sonner";
import { Tag, Plus, Pencil } from "lucide-react";

type PT = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  category: string | null;
  tuss_default: string | null;
  requires_tuss_in_sheet: boolean;
  default_function: string | null;
  default_value_column_hint: string | null;
  expected_headers: string[];
  allow_mixed_subtypes: boolean;
  subtype_split_hint: any | null;
};

const empty: PT = {
  code: "",
  label: "",
  description: "",
  color: "",
  sort_order: 50,
  active: true,
  category: "",
  tuss_default: "",
  requires_tuss_in_sheet: true,
  default_function: "",
  default_value_column_hint: "",
  expected_headers: [],
  allow_mixed_subtypes: false,
  subtype_split_hint: null,
};

export default function PaymentTypes({ embedded = false }: { embedded?: boolean } = {}) {
  const [list, setList] = useState<PT[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PT | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headersText, setHeadersText] = useState("");
  const [splitHintText, setSplitHintText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("payment_types").select("*").order("sort_order").order("label");
    if (error) toast.error("Erro ao carregar tipos: " + error.message);
    else
      setList(
        (data ?? []).map((d: any) => ({
          ...d,
          expected_headers: Array.isArray(d.expected_headers) ? d.expected_headers : [],
        })) as PT[],
      );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({ ...empty });
    setHeadersText("");
    setSplitHintText("");
    setIsNew(true);
  };
  const openEdit = (p: PT) => {
    setEditing({ ...p, expected_headers: p.expected_headers ?? [] });
    setHeadersText((p.expected_headers ?? []).join("\n"));
    setSplitHintText(p.subtype_split_hint ? JSON.stringify(p.subtype_split_hint, null, 2) : "");
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!code || !editing.label.trim()) {
      toast.error("Código e rótulo são obrigatórios");
      return;
    }
    const headers = headersText
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);
    let splitHint: any = null;
    if (splitHintText.trim()) {
      try {
        splitHint = JSON.parse(splitHintText);
      } catch {
        toast.error("Regra de subdivisão precisa ser JSON válido");
        return;
      }
    }
    setSaving(true);
    const payload = {
      code,
      label: editing.label.trim(),
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      sort_order: Number(editing.sort_order) || 50,
      active: editing.active,
      category: editing.category?.trim() || null,
      tuss_default: editing.tuss_default?.trim() || null,
      requires_tuss_in_sheet: editing.requires_tuss_in_sheet,
      default_function: editing.default_function?.trim() || null,
      default_value_column_hint: editing.default_value_column_hint?.trim() || null,
      expected_headers: headers,
      allow_mixed_subtypes: editing.allow_mixed_subtypes,
      subtype_split_hint: splitHint,
    };
    const { error } = isNew
      ? await supabase.from("payment_types").insert(payload)
      : await supabase.from("payment_types").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success(isNew ? "Tipo criado" : "Tipo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: PT) => {
    const { error } = await supabase.from("payment_types").update({ active: !p.active }).eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message);
    else load();
  };

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Tipos de pagamento"
          description="Cada tipo carrega TUSS padrão, função, cabeçalhos esperados e regra de subdivisão usados pelo wizard de nova base e pelo motor de regras."
          actions={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Novo tipo
            </Button>
          }
        />
      )}
      <div className={embedded ? "max-w-5xl space-y-4" : "p-8 max-w-5xl space-y-4"}>
        {embedded && (
          <div className="flex justify-end">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Novo tipo
            </Button>
          </div>
        )}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4" /> Tipos cadastrados
            </CardTitle>
            <CardDescription>
              Tipos com <strong>TUSS padrão</strong> dispensam a coluna TUSS na planilha (sistema injeta).
              <strong> Subtipos misturados</strong> permitem que uma mesma base contenha mais de um tipo (ex.: Parecer + Visita)
              e use a regra correta para cada linha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum tipo cadastrado.</p>
            ) : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {p.code}
                        </Badge>
                        {p.category && (
                          <Badge variant="secondary" className="text-xs">
                            {p.category}
                          </Badge>
                        )}
                        {p.tuss_default && (
                          <Badge variant="outline" className="text-xs">
                            TUSS {p.tuss_default}
                          </Badge>
                        )}
                        {!p.requires_tuss_in_sheet && (
                          <Badge variant="outline" className="text-xs">
                            sem TUSS na base
                          </Badge>
                        )}
                        {p.allow_mixed_subtypes && (
                          <Badge variant="outline" className="text-xs">
                            subtipos misturados
                          </Badge>
                        )}
                        {!p.active && (
                          <Badge variant="secondary" className="text-xs">
                            inativo
                          </Badge>
                        )}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} aria-label="Ativo" />
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo tipo de pagamento" : "Editar tipo"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Código *</Label>
                  <Input
                    value={editing.code}
                    disabled={!isNew}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    placeholder="ex: parecer_adulto"
                  />
                  <p className="text-xs text-muted-foreground">Imutável após criação.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rótulo *</Label>
                  <Input
                    value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    placeholder="ex: Parecer Adulto"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input
                    value={editing.category ?? ""}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    placeholder="ex: Parecer, Cirurgia, Exames"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ordem de exibição</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                  placeholder="Como esse tipo é usado no fluxo"
                />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Governança do wizard</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>TUSS padrão</Label>
                    <Input
                      value={editing.tuss_default ?? ""}
                      onChange={(e) => setEditing({ ...editing, tuss_default: e.target.value })}
                      placeholder="ex: 10102019"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Função padrão</Label>
                    <Input
                      value={editing.default_function ?? ""}
                      onChange={(e) => setEditing({ ...editing, default_function: e.target.value })}
                      placeholder="ex: Parecerista"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.requires_tuss_in_sheet}
                    onCheckedChange={(v) => setEditing({ ...editing, requires_tuss_in_sheet: v })}
                  />
                  <Label className="font-normal cursor-pointer">Exigir coluna TUSS na planilha</Label>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Quando desligado, o sistema injeta o TUSS padrão em todas as linhas e dispensa o mapeamento dessa coluna.
                </p>

                <div className="space-y-1.5">
                  <Label>Dica de coluna de valor</Label>
                  <Input
                    value={editing.default_value_column_hint ?? ""}
                    onChange={(e) => setEditing({ ...editing, default_value_column_hint: e.target.value })}
                    placeholder='ex: "Valor a repassar"'
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Cabeçalhos esperados (um por linha)</Label>
                  <Textarea
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    rows={4}
                    placeholder={"Atend.\nPaciente\nMédico Parecerista\nValor a repassar"}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Usados para auto-mapear colunas no wizard.</p>
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.allow_mixed_subtypes}
                    onCheckedChange={(v) => setEditing({ ...editing, allow_mixed_subtypes: v })}
                  />
                  <Label className="font-normal cursor-pointer">Permitir subtipos misturados na mesma base</Label>
                </div>
                {editing.allow_mixed_subtypes && (
                  <div className="space-y-1.5">
                    <Label>Regra de subdivisão (JSON)</Label>
                    <Textarea
                      value={splitHintText}
                      onChange={(e) => setSplitHintText(e.target.value)}
                      rows={5}
                      className="font-mono text-xs"
                      placeholder={`{\n  "column": "Medico Solic.",\n  "patterns": [{ "match": "visita", "target_code": "visita" }]\n}`}
                    />
                    <p className="text-xs text-muted-foreground">
                      <code>column</code>: cabeçalho da coluna a inspecionar. <code>patterns</code>: lista de
                      <code> {`{ match, target_code }`}</code> — quando o texto contém <code>match</code>, a linha vira o tipo
                      <code> target_code</code>.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Cor (opcional)</Label>
                  <Input
                    value={editing.color ?? ""}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                    placeholder="#3b82f6"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <Label className="font-normal cursor-pointer">Ativo</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
