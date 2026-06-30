import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Layers, Plus, Pencil } from "lucide-react";

/**
 * Cadastro de MODELOS DE PAGAMENTO do lote.
 * Modelos descrevem o desenho contratual do lote inteiro
 * (Produção, Plantão, Remessa, Valor fixo).
 *
 * Não confundir com `item_types`, que descreve o tipo do procedimento
 * em cada linha (Parecer/Visita/Cirurgia/Consulta/Bônus/Exames).
 */

type PM = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  calc_strategy: string | null;
  allow_mixed_item_types: boolean;
  expected_headers: string[];
};

const empty: PM = {
  code: "",
  label: "",
  description: "",
  color: "",
  sort_order: 50,
  active: true,
  calc_strategy: "rules",
  allow_mixed_item_types: true,
  expected_headers: [],
};

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Código precisa ter ao menos 2 caracteres")
    .max(40, "Código muito longo (máx 40)")
    .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _"),
  label: z.string().trim().min(2, "Rótulo obrigatório").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  color: z
    .string()
    .trim()
    .max(20)
    .regex(/^(#[0-9a-fA-F]{3,8})?$/, "Use formato hex (#RRGGBB) ou deixe vazio")
    .optional()
    .nullable(),
  sort_order: z.number().int().min(0).max(9999),
  active: z.boolean(),
  calc_strategy: z.string().trim().max(40).optional().nullable(),
  allow_mixed_item_types: z.boolean(),
  expected_headers: z.array(z.string().trim().max(200)).max(100),
});

const CODE_RE = /[^a-z0-9_]/g;

export default function PaymentModels({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [list, setList] = useState<PM[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PM | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headersText, setHeadersText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_models")
      .select("*")
      .order("sort_order")
      .order("label");
    if (error) toast.error("Erro ao carregar modelos: " + error.message);
    else
      setList(
        (data ?? []).map((d: any) => ({
          ...d,
          expected_headers: Array.isArray(d.expected_headers)
            ? d.expected_headers
            : [],
        })) as PM[],
      );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({ ...empty });
    setHeadersText("");
    setIsNew(true);
  };
  const openEdit = (p: PM) => {
    setEditing({ ...p, expected_headers: p.expected_headers ?? [] });
    setHeadersText((p.expected_headers ?? []).join("\n"));
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(CODE_RE, "_");
    const headers = headersText
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);
    const candidate = {
      ...editing,
      code,
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      calc_strategy: editing.calc_strategy?.trim() || null,
      sort_order: Number(editing.sort_order) || 0,
      expected_headers: headers,
    };
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setSaving(true);
    const payload = parsed.data;
    const { error } = isNew
      ? await supabase.from("payment_models").insert(payload as any)
      : await supabase
          .from("payment_models")
          .update(payload as any)
          .eq("id", editing.id!);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success(isNew ? "Modelo criado" : "Modelo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: PM) => {
    const { error } = await supabase
      .from("payment_models")
      .update({ active: !p.active })
      .eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message);
    else load();
  };

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Modelos de pagamento"
          description="Modelos descrevem o desenho contratual do lote (Produção, Plantão, Remessa, Valor fixo). O tipo do procedimento em cada linha é configurado em Tipos de Item."
          icon={Layers}
          actions={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Novo modelo
            </Button>
          }
        />
      )}
      <div className={embedded ? "max-w-5xl space-y-4" : "p-8 max-w-5xl space-y-4"}>
        {embedded && (
          <div className="flex justify-end">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Novo modelo
            </Button>
          </div>
        )}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" /> Modelos cadastrados
            </CardTitle>
            <CardDescription>
              Cada lote referencia um modelo. Modelos com{" "}
              <strong>itens misturados</strong> permitem que linhas do mesmo
              lote sejam de tipos diferentes (ex.: Parecer + Visita no mesmo
              lote de Produção).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum modelo cadastrado.
              </p>
            ) : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {p.code}
                        </Badge>
                        {p.calc_strategy && (
                          <Badge variant="secondary" className="text-xs">
                            {p.calc_strategy}
                          </Badge>
                        )}
                        {p.allow_mixed_item_types && (
                          <Badge variant="outline" className="text-xs">
                            itens misturados
                          </Badge>
                        )}
                        {!p.active && (
                          <Badge variant="secondary" className="text-xs">
                            inativo
                          </Badge>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {p.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={p.active}
                        onCheckedChange={() => toggleActive(p)}
                        aria-label="Ativo"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(p)}
                      >
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
            <DialogTitle>
              {isNew ? "Novo modelo de pagamento" : "Editar modelo"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Código *</Label>
                  <Input
                    value={editing.code}
                    disabled={!isNew}
                    maxLength={40}
                    onChange={(e) =>
                      setEditing({ ...editing, code: e.target.value })
                    }
                    placeholder="ex: producao"
                  />
                  <p className="text-xs text-muted-foreground">
                    Imutável após criação. Apenas a-z, 0-9 e _.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rótulo *</Label>
                  <Input
                    value={editing.label}
                    maxLength={80}
                    onChange={(e) =>
                      setEditing({ ...editing, label: e.target.value })
                    }
                    placeholder="ex: Produção"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Estratégia de cálculo</Label>
                  <Input
                    value={editing.calc_strategy ?? ""}
                    maxLength={40}
                    onChange={(e) =>
                      setEditing({ ...editing, calc_strategy: e.target.value })
                    }
                    placeholder="rules"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ordem de exibição</Label>
                  <Input
                    type="number"
                    min={0}
                    max={9999}
                    value={editing.sort_order}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        sort_order: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Textarea
                  value={editing.description ?? ""}
                  maxLength={500}
                  rows={2}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  placeholder="Para que serve esse modelo de lote"
                />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.allow_mixed_item_types}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, allow_mixed_item_types: v })
                    }
                  />
                  <Label className="font-normal cursor-pointer">
                    Permitir tipos de item misturados no mesmo lote
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Quando ligado, um lote desse modelo pode ter linhas de
                  diferentes <code>item_types</code> (ex.: Parecer + Visita).
                </p>

                <div className="space-y-1.5">
                  <Label>Cabeçalhos esperados na planilha (um por linha)</Label>
                  <Textarea
                    value={headersText}
                    rows={4}
                    onChange={(e) => setHeadersText(e.target.value)}
                    placeholder={"Atend.\nPaciente\nMédico\nValor a repassar"}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Usados para auto-mapear colunas no wizard de nova base.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Cor (opcional)</Label>
                  <Input
                    value={editing.color ?? ""}
                    maxLength={20}
                    onChange={(e) =>
                      setEditing({ ...editing, color: e.target.value })
                    }
                    placeholder="#3b82f6"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={editing.active}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, active: v })
                    }
                  />
                  <Label className="font-normal cursor-pointer">Ativo</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
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
