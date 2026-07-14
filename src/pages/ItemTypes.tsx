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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tag, Plus, Pencil, Star, AlertTriangle } from "lucide-react";


/**
 * Cadastro de TIPOS DE ITEM (procedimento da linha).
 * Parecer/Visita/Cirurgia/Consulta/Bônus/Exames — tudo que descreve
 * a natureza do item individual. Modelos do lote
 * (Produção/Plantão/Remessa/Valor fixo) ficam em /payment-models.
 */

type IT = {
  id?: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
  default_function: string | null;
  requires_tuss: boolean;
  is_default_when_no_tuss: boolean;
  tuss_default: string | null;
  tuss_codes_extra: string[];
};

const empty: IT = {
  code: "",
  label: "",
  description: "",
  color: "",
  sort_order: 50,
  active: true,
  default_function: "",
  requires_tuss: false,
  is_default_when_no_tuss: false,
  tuss_default: "",
  tuss_codes_extra: [],
};

const TUSS_RE = /^\d{4,10}$/;

const schema = z
  .object({
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
    default_function: z.string().trim().max(80).optional().nullable(),
    requires_tuss: z.boolean(),
    is_default_when_no_tuss: z.boolean(),
    tuss_default: z
      .string()
      .trim()
      .regex(/^(\d{4,10})?$/, "TUSS deve ter de 4 a 10 dígitos")
      .optional()
      .nullable(),
    tuss_codes_extra: z
      .array(
        z
          .string()
          .trim()
          .regex(TUSS_RE, "Cada TUSS extra deve ter de 4 a 10 dígitos"),
      )
      .max(200),
  })
  .refine(
    (v) =>
      // Se requires_tuss=true, faz sentido ter ao menos um TUSS configurado
      !v.requires_tuss ||
      !!v.tuss_default ||
      (v.tuss_codes_extra && v.tuss_codes_extra.length > 0),
    {
      message:
        "Tipo que exige TUSS precisa ter ao menos um TUSS padrão ou extra cadastrado.",
      path: ["tuss_default"],
    },
  );

const CODE_RE = /[^a-z0-9_]/g;

export default function ItemTypes({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [list, setList] = useState<IT[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<IT | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraText, setExtraText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("item_types")
      .select("*")
      .order("sort_order")
      .order("label");
    if (error) toast.error("Erro ao carregar tipos: " + error.message);
    else
      setList(
        (data ?? []).map((d: any) => ({
          ...d,
          tuss_codes_extra: Array.isArray(d.tuss_codes_extra)
            ? d.tuss_codes_extra
            : [],
        })) as IT[],
      );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({ ...empty });
    setExtraText("");
    setIsNew(true);
  };
  const openEdit = (p: IT) => {
    setEditing({ ...p, tuss_codes_extra: p.tuss_codes_extra ?? [] });
    setExtraText((p.tuss_codes_extra ?? []).join("\n"));
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const code = editing.code.trim().toLowerCase().replace(CODE_RE, "_");
    const extras = extraText
      .split(/[\n,;]/)
      .map((h) => h.trim())
      .filter(Boolean);

    const candidate = {
      ...editing,
      code,
      description: editing.description?.trim() || null,
      color: editing.color?.trim() || null,
      default_function: editing.default_function?.trim() || null,
      tuss_default: editing.tuss_default?.trim() || null,
      tuss_codes_extra: extras,
      sort_order: Number(editing.sort_order) || 0,
    };
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    // Se este vai virar default-sem-TUSS, garante exclusividade tirando dos outros
    setSaving(true);
    if (parsed.data.is_default_when_no_tuss) {
      const q = supabase
        .from("item_types")
        .update({ is_default_when_no_tuss: false })
        .eq("is_default_when_no_tuss", true);
      if (editing.id) q.neq("id", editing.id);
      const { error: clearErr } = await q;
      if (clearErr) {
        setSaving(false);
        toast.error("Erro ao limpar default anterior: " + clearErr.message);
        return;
      }
    }

    const payload = parsed.data;
    const { error } = isNew
      ? await supabase.from("item_types").insert(payload as any)
      : await supabase
          .from("item_types")
          .update(payload as any)
          .eq("id", editing.id!);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success(isNew ? "Tipo criado" : "Tipo atualizado");
    setEditing(null);
    load();
  };

  const toggleActive = async (p: IT) => {
    if (p.active && p.is_default_when_no_tuss) {
      toast.error(
        "Não dá para inativar o tipo padrão sem TUSS. Marque outro como padrão antes.",
      );
      return;
    }
    const { error } = await supabase
      .from("item_types")
      .update({ active: !p.active })
      .eq("id", p.id!);
    if (error) toast.error("Erro: " + error.message);
    else load();
  };

  // Ambiguidade de TUSS: acumula, entre os TIPOS ATIVOS, os tipos que
  // reivindicam cada código (tuss_default ∪ tuss_codes_extra). Códigos com
  // ≥2 tipos ativos ficam ambíguos — o motor NÃO classifica automaticamente
  // (fica para o cross-reference-parecer ou override manual).
  const tussOwners = new Map<string, Array<{ id: string; label: string }>>();
  for (const p of list) {
    if (!p.active || !p.id) continue;
    const codes = new Set<string>();
    if (p.tuss_default) codes.add(p.tuss_default.trim());
    for (const c of p.tuss_codes_extra ?? []) {
      if (c) codes.add(String(c).trim());
    }
    for (const c of codes) {
      if (!c) continue;
      const arr = tussOwners.get(c) ?? [];
      arr.push({ id: p.id, label: p.label });
      tussOwners.set(c, arr);
    }
  }
  const ambiguousCodes = new Map<string, Array<{ id: string; label: string }>>();
  for (const [code, owners] of tussOwners) {
    if (owners.length > 1) ambiguousCodes.set(code, owners);
  }
  const ambiguityByTypeId = new Map<string, Map<string, string[]>>();
  for (const [code, owners] of ambiguousCodes) {
    for (const o of owners) {
      const others = owners.filter((x) => x.id !== o.id).map((x) => x.label);
      const bucket = ambiguityByTypeId.get(o.id) ?? new Map<string, string[]>();
      bucket.set(code, others);
      ambiguityByTypeId.set(o.id, bucket);
    }
  }

  return (
    <>
      {!embedded && (

        <PageHeader
          title="Tipos de item"
          description="Tipos descrevem o procedimento da linha (Parecer, Visita, Cirurgia, Consulta, Bônus, Exames). O motor usa o TUSS do item para identificar o tipo automaticamente; itens sem TUSS caem no tipo padrão marcado abaixo."
          icon={Tag}
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
              <Star className="h-3 w-3 inline mr-1 text-amber-500" />
              marca o tipo padrão quando o item não tem TUSS — só um pode ser
              padrão por vez.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ambiguousCodes.size > 0 && !loading && (
              <Alert className="mb-4 border-amber-500/50 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>
                  {ambiguousCodes.size} código(s) TUSS compartilhado(s) entre tipos ativos
                </AlertTitle>
                <AlertDescription>
                  Códigos reivindicados por mais de um tipo (ex.: Parecer × Visita)
                  não são classificados automaticamente. O motor de Parecer/Visita
                  ou o override manual decide caso a caso.
                </AlertDescription>
              </Alert>
            )}
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum tipo cadastrado.
              </p>
            ) : (

              <div className="space-y-2">
                {list.map((p) => {
                  const ambigMap = p.id ? ambiguityByTypeId.get(p.id) : undefined;
                  const isAmbiguous = !!ambigMap && ambigMap.size > 0;
                  const tooltipLines = ambigMap
                    ? Array.from(ambigMap.entries()).map(
                        ([code, others]) => `TUSS ${code}: também em ${others.join(", ")}`,
                      )
                    : [];
                  return (
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
                        {p.is_default_when_no_tuss && (
                          <Badge className="text-xs bg-amber-500 hover:bg-amber-500">
                            <Star className="h-3 w-3 mr-1" />
                            padrão sem TUSS
                          </Badge>
                        )}
                        {p.requires_tuss && (
                          <Badge variant="outline" className="text-xs">
                            exige TUSS
                          </Badge>
                        )}
                        {p.tuss_default && (
                          <Badge variant="outline" className="text-xs">
                            TUSS {p.tuss_default}
                          </Badge>
                        )}
                        {p.tuss_codes_extra && p.tuss_codes_extra.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            +{p.tuss_codes_extra.length} TUSS
                          </Badge>
                        )}
                        {isAmbiguous && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-xs border-amber-500 text-amber-700 bg-amber-500/10 cursor-help"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  TUSS ambíguo
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-xs space-y-1">
                                  {tooltipLines.map((l) => (
                                    <div key={l}>{l}</div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
              {isNew ? "Novo tipo de item" : "Editar tipo"}
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
                    placeholder="ex: parecer_adulto"
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
                    placeholder="ex: Parecer Adulto"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Função padrão</Label>
                  <Input
                    value={editing.default_function ?? ""}
                    maxLength={80}
                    onChange={(e) =>
                      setEditing({ ...editing, default_function: e.target.value })
                    }
                    placeholder="ex: Parecerista"
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
                  placeholder="Quando esse tipo se aplica"
                />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Classificação automática por TUSS
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>TUSS padrão</Label>
                    <Input
                      value={editing.tuss_default ?? ""}
                      maxLength={10}
                      inputMode="numeric"
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          tuss_default: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      placeholder="ex: 10101012"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch
                      checked={editing.requires_tuss}
                      onCheckedChange={(v) =>
                        setEditing({ ...editing, requires_tuss: v })
                      }
                    />
                    <Label className="font-normal cursor-pointer">
                      Exige TUSS no item
                    </Label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>TUSS adicionais (um por linha ou separados por , ;)</Label>
                  <Textarea
                    value={extraText}
                    rows={4}
                    onChange={(e) => setExtraText(e.target.value)}
                    placeholder={"40101013\n40101021"}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Qualquer item cujo TUSS bate com o padrão ou um extra é
                    classificado como esse tipo automaticamente.
                  </p>
                </div>

                <div className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/15 p-2">
                  <Switch
                    checked={editing.is_default_when_no_tuss}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, is_default_when_no_tuss: v })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <Label className="font-normal cursor-pointer flex items-center gap-1">
                      <Star className="h-3 w-3 text-amber-500" />
                      Tipo padrão quando o item não tem TUSS
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Itens importados sem TUSS recebem esse tipo. Só um por vez
                      — marcar aqui desmarca o anterior.
                    </p>
                  </div>
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
