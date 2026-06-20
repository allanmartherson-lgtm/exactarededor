/**
 * Diálogo de revisão/correção do mapeamento de colunas da planilha.
 *
 * - Mostra todos os campos do modelo, o header detectado e a confiança
 * - Permite trocar o header manualmente (dropdown com todos os headers da planilha)
 * - Bloqueia "Aplicar" se faltar campo obrigatório
 * - Permite salvar o mapeamento como template (por hospital ou global)
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Info, Save, Sparkles } from "lucide-react";
import {
  FIELD_DEFINITIONS,
  FIELD_BY_KEY,
  hitsToMapping,
  inspectColumnMapping,
  scoreToConfidence,
  summarizeMissing,
  type FieldDefinition,
  type FieldKey,
  type FieldMappingHit,
  type ManualMapping,
} from "@/lib/columnMapping";

import { useSheetColumnTemplates } from "@/hooks/useSheetColumnTemplates";
import { toast } from "sonner";

const NONE = "__none__";

const confidenceBadge = (score: number) => {
  const c = scoreToConfidence(score);
  if (c === "high") return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">Alta confiança</Badge>;
  if (c === "medium") return <Badge variant="secondary">Média</Badge>;
  if (c === "low") return <Badge variant="outline" className="border-amber-500 text-amber-700">Baixa</Badge>;
  return <Badge variant="outline" className="border-destructive text-destructive">Sem match</Badge>;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  /** Headers crus detectados na planilha. */
  headers: string[];
  /** Mapping inicial (heurística + template se houver). */
  initialMapping: ManualMapping;
  /** Linha de exemplo para mostrar valor sob cada header. */
  sampleRow?: Record<string, unknown> | null;
  /** Hospital atual para salvar template. null = global. */
  hospitalId: string | null;
  /** Callback quando o usuário confirma o mapeamento. */
  onApply: (mapping: ManualMapping) => void;
  /**
   * Modo de uso da base:
   * - "analise" (default): planilha de pagamento real → exige `gross_amount` (valor repasse)
   * - "confeccao": planilha bruta para o motor calcular → exige `procedure_amount` (valor convênio)
   *   e oculta `gross_amount` para evitar que o analista importe valor de repasse pré-existente
   */
  mode?: "analise" | "confeccao";
}

export default function ColumnMappingDialog({
  open,
  onOpenChange,
  fileName,
  headers,
  initialMapping,
  sampleRow,
  hospitalId,
  onApply,
  mode = "analise",
}: Props) {

  const [mapping, setMapping] = useState<ManualMapping>(initialMapping);
  const [showSave, setShowSave] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [scopeGlobal, setScopeGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const { save } = useSheetColumnTemplates(hospitalId);

  useEffect(() => {
    if (open) {
      setMapping(initialMapping);
      setShowSave(false);
      setTemplateName(`Template — ${fileName.replace(/\.[^.]+$/, "").slice(0, 60)}`);
      setScopeGlobal(false);
    }
  }, [open, initialMapping, fileName]);

  /**
   * Definições efetivas conforme o modo:
   * - confeccao: oculta `gross_amount` (motor é quem calcula o repasse) e
   *   promove `procedure_amount` (valor convênio) a obrigatório, já que é
   *   a base de cálculo das regras.
   * - analise: mantém o comportamento padrão.
   */
  const effectiveFields = useMemo(() => {
    if (mode !== "confeccao") return FIELD_DEFINITIONS;
    return FIELD_DEFINITIONS.filter((f) => f.key !== "gross_amount").map((f) =>
      f.key === "procedure_amount" ? { ...f, requirement: "required" as const } : f,
    );
  }, [mode]);

  const requirementByField = useMemo(() => {
    const m: Partial<Record<FieldKey, FieldDefinition["requirement"]>> = {};
    effectiveFields.forEach((f) => { m[f.key] = f.requirement; });
    return m;
  }, [effectiveFields]);

  /** Reconstrói FieldMappingHit a partir do mapping atual + heurística para alternativas. */
  const hits = useMemo<FieldMappingHit[]>(() => {
    const base = inspectColumnMapping(headers).filter((h) => requirementByField[h.field] !== undefined);
    return base.map((h) => {
      const override = mapping[h.field];
      if (override && headers.includes(override)) {
        return { ...h, header: override, score: 100, confidence: "high" as const };
      }
      return h;
    });
  }, [headers, mapping, requirementByField]);

  const { missingRequired, lowConfidence } = useMemo(() => {
    const missingRequired = hits.filter(
      (h) => requirementByField[h.field] === "required" && (!h.header || h.score < 30),
    );
    const lowConfidence = hits.filter(
      (h) => requirementByField[h.field] !== "optional" && h.header && h.score < 60,
    );
    return { missingRequired, lowConfidence };
  }, [hits, requirementByField]);

  const setField = (field: FieldKey, header: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (header === NONE) delete next[field];
      else next[field] = header;
      return next;
    });
  };

  const handleApply = () => {
    if (missingRequired.length > 0) {
      toast.error(`Faltam campos obrigatórios: ${missingRequired.map((m) => FIELD_BY_KEY[m.field].label).join(", ")}`);
      return;
    }
    const out = hitsToMapping(hits);
    if (mode === "confeccao") delete out.gross_amount;
    onApply(out);
    onOpenChange(false);
  };


  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error("Dê um nome ao template");
      return;
    }
    setSaving(true);
    const res = await save({
      name: templateName.trim(),
      headers,
      mapping: hitsToMapping(hits),
      scope: scopeGlobal || !hospitalId ? "global" : "hospital",
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`Falha ao salvar template: ${res.error}`);
      return;
    }
    toast.success("Template salvo. Próximas planilhas com este cabeçalho aplicam automaticamente.");
    setShowSave(false);
  };

  const sampleValueFor = (header: string | null): string => {
    if (!header || !sampleRow) return "—";
    const v = sampleRow[header];
    if (v == null || v === "") return "—";
    return String(v).slice(0, 60);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Mapeamento de colunas
          </DialogTitle>
          <DialogDescription>
            Confira como o sistema interpretou as colunas de <span className="font-medium text-foreground">{fileName}</span>.
            Corrija o que estiver errado e salve como template para reusar em planilhas com o mesmo formato.
          </DialogDescription>
        </DialogHeader>

        {missingRequired.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Campos obrigatórios sem coluna</AlertTitle>
            <AlertDescription>
              {missingRequired.map((m) => FIELD_BY_KEY[m.field].label).join(" · ")}
            </AlertDescription>
          </Alert>
        )}
        {missingRequired.length === 0 && lowConfidence.length > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Revisar campos com baixa confiança</AlertTitle>
            <AlertDescription>
              {lowConfidence.map((m) => FIELD_BY_KEY[m.field].label).join(" · ")}
            </AlertDescription>
          </Alert>
        )}
        {missingRequired.length === 0 && lowConfidence.length === 0 && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Mapeamento OK</AlertTitle>
            <AlertDescription>Todos os campos críticos foram identificados.</AlertDescription>
          </Alert>
        )}

        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 w-[28%]">Campo do sistema</th>
                <th className="py-2 px-3 w-[34%]">Coluna da planilha</th>
                <th className="py-2 px-3 w-[14%]">Confiança</th>
                <th className="py-2 pl-3">Exemplo</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_DEFINITIONS.map((def) => {
                const hit = hits.find((h) => h.field === def.key)!;
                const required = def.requirement === "required";
                return (
                  <tr key={def.key} className="border-b last:border-0">
                    <td className="py-2 pr-3 align-top">
                      <div className="font-medium flex items-center gap-1">
                        {def.label}
                        {required && <span className="text-destructive text-xs">*</span>}
                      </div>
                      {def.hint && <div className="text-xs text-muted-foreground">{def.hint}</div>}
                    </td>
                    <td className="py-2 px-3">
                      <Select value={hit.header ?? NONE} onValueChange={(v) => setField(def.key, v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 px-3 align-middle">{confidenceBadge(hit.score)}</td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground truncate max-w-[260px]">
                      {sampleValueFor(hit.header)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {showSave && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <Label className="text-xs">Nome do template</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="h-8" />
            <div className="flex items-center justify-between text-xs">
              <span>Salvar como template global (todos os hospitais)</span>
              <Switch checked={scopeGlobal} onCheckedChange={setScopeGlobal} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowSave(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSaveTemplate} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Salvando…" : "Salvar template"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {!showSave ? (
            <Button variant="outline" size="sm" onClick={() => setShowSave(true)} disabled={missingRequired.length > 0}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Salvar como template
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleApply} disabled={missingRequired.length > 0}>
              Aplicar mapeamento
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
