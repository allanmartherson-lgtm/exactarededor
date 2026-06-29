/**
 * ImportCalculationsDialog — extrai uma lista de cálculos de um texto/arquivo
 * via IA (edge function `convert-rules`), mostra preview com checkboxes e
 * adiciona os escolhidos à regra atual (append).
 *
 * Diferença para o fluxo de "Importar regras com IA" do Rules.tsx:
 *  - Aqui ignoramos os metadados das regras retornadas e achatamos só os
 *    `calculations[]` em uma lista plana.
 *  - O resultado é integrado a uma regra JÁ existente em edição — útil quando
 *    o validador bloqueia uma nova master (master_already_exists) e o analista
 *    precisa enriquecer a master vigente com cálculos adicionais (consultas
 *    por especialidade, parecer, visita etc.) sem criar regra concorrente.
 */
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSpecialties } from "@/hooks/useSpecialties";
import { RULE_CALCULATION_TYPE_LABELS, type RuleCalculationType } from "@/lib/status";
import { makeEmptyCalc, type CalcItem } from "./RuleCalculationsEditor";

type AiCalc = Record<string, any>;

export type ImportCalculationsDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentTypes: { id: string; label: string; code?: string | null }[];
  onImport: (calcs: CalcItem[]) => void;
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.split(",")[1] ?? s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const numStr = (v: any): string => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? String(n) : "";
};

const arr = (v: any): any[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== "") : []);

/**
 * Converte um cálculo retornado pela IA em CalcItem do editor.
 * Inicia em makeEmptyCalc() e sobrescreve só os campos conhecidos para evitar
 * regressão de defaults.
 */
function aiCalcToCalcItem(
  c: AiCalc,
  paymentTypes: { id: string; label: string; code?: string | null }[],
): CalcItem {
  const base = makeEmptyCalc();
  const ct = (c?.calculation_type as RuleCalculationType) ?? "informativo";
  const codes = arr(c?.procedure_codes).map(String);
  const specs = arr(c?.specialties).map(String);
  const sects = arr(c?.sectors).map(String);
  const roles = arr(c?.doctor_roles).map(String);

  const ptCode: string | null = c?.payment_type_code ?? null;
  const ptId = ptCode ? (paymentTypes.find((p) => (p as any).code === ptCode)?.id ?? null) : null;

  return {
    ...base,
    label: c?.label ?? null,
    calculation_type: ct,
    fixed_amount: ct === "valor_fixo" ? numStr(c?.fixed_amount) : base.fixed_amount,
    package_amount: ct === "pacote" ? numStr(c?.package_amount) : base.package_amount,
    bonus_amount: ct === "bonus" ? numStr(c?.bonus_amount) : base.bonus_amount,
    bonus_pct: ct === "bonus" ? numStr(c?.bonus_pct) : base.bonus_pct,
    target_amount: ct === "complemento" ? numStr(c?.target_amount) : base.target_amount,
    multiplier: ct === "tabela_diferenciada" ? numStr(c?.multiplier) : base.multiplier,
    deflator_pct: ct === "tabela_diferenciada" ? numStr(c?.deflator_pct) : base.deflator_pct,
    convenio_percentage: ct === "percentual_sobre_convenio" ? numStr(c?.convenio_percentage) : base.convenio_percentage,
    procedure_codes: codes,
    code_match_mode: codes.length ? "whitelist" : "any",
    specialties: specs,
    match_by_specialty: specs.length > 0,
    sectors: sects,
    doctor_roles: roles,
    payment_type_id: ptId,
    has_conditions: specs.length > 0 || sects.length > 0,
  };
}

function summarize(c: AiCalc): string {
  const ct = String(c?.calculation_type ?? "informativo");
  const bits: string[] = [];
  if (ct === "valor_fixo" && c?.fixed_amount) bits.push(`R$ ${c.fixed_amount}`);
  if (ct === "percentual_sobre_convenio" && c?.convenio_percentage) bits.push(`${c.convenio_percentage}% conv.`);
  if (ct === "tabela_diferenciada" && c?.multiplier) bits.push(`x${c.multiplier}`);
  if (ct === "pacote" && c?.package_amount) bits.push(`pacote R$ ${c.package_amount}`);
  if (Array.isArray(c?.specialties) && c.specialties.length) bits.push(`esp: ${c.specialties.slice(0, 2).join(", ")}${c.specialties.length > 2 ? "…" : ""}`);
  if (Array.isArray(c?.procedure_codes) && c.procedure_codes.length) bits.push(`${c.procedure_codes.length} TUSS`);
  return bits.join(" · ");
}

export function ImportCalculationsDialog({ open, onOpenChange, paymentTypes, onImport }: ImportCalculationsDialogProps) {
  const { specialties: specialtiesList } = useSpecialties();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState<AiCalc[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const reset = () => {
    setText(""); setFile(null); setExtracted(null); setChecked(new Set());
  };

  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const allChecked = useMemo(
    () => extracted ? extracted.length > 0 && checked.size === extracted.length : false,
    [extracted, checked],
  );

  const toggle = (i: number) => {
    const next = new Set(checked);
    next.has(i) ? next.delete(i) : next.add(i);
    setChecked(next);
  };
  const toggleAll = () => {
    if (!extracted) return;
    setChecked(allChecked ? new Set() : new Set(extracted.map((_, i) => i)));
  };

  const runExtraction = async () => {
    if (!text.trim() && !file) {
      toast.error("Adicione texto ou um arquivo");
      return;
    }
    setLoading(true);
    try {
      const body: any = {
        inputKind: "auto",
        context: {
          paymentTypes: paymentTypes.map((p) => ({ id: p.id, code: (p as any).code, label: p.label })),
          specialties: specialtiesList,
        },
      };
      if (text.trim()) body.text = text;
      if (file) {
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        const isSpreadsheet = ["xlsx", "xls", "csv"].includes(ext);
        const isText = ["txt", "md", "eml"].includes(ext);
        if (isSpreadsheet) {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const sheets = wb.SheetNames.map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
          body.text = (body.text ? body.text + "\n\n" : "") + sheets;
          body.inputKind = "table";
        } else if (isText) {
          body.text = (body.text ? body.text + "\n\n" : "") + (await file.text());
        } else {
          body.file = { name: file.name, mimeType: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) };
        }
      }
      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) {
        toast.error("Erro ao extrair", { description: String(error?.message ?? data?.error ?? "Falha") });
        return;
      }
      // Achata todos os calculations[] de todas as regras retornadas.
      const flat: AiCalc[] = [];
      for (const r of data.rules) {
        const cs = Array.isArray(r?.calculations) ? r.calculations : [];
        for (const c of cs) flat.push(c);
      }
      if (flat.length === 0) {
        toast.warning("Nenhum cálculo extraído", { description: "A IA não identificou cálculos nesse conteúdo." });
        return;
      }
      setExtracted(flat);
      setChecked(new Set(flat.map((_, i) => i)));
    } catch (e: any) {
      toast.error("Erro", { description: String(e?.message ?? e) });
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    if (!extracted || checked.size === 0) {
      toast.error("Selecione ao menos um cálculo");
      return;
    }
    const picked = extracted.filter((_, i) => checked.has(i));
    onImport(picked.map((c) => aiCalcToCalcItem(c, paymentTypes)));
    toast.success(`${picked.length} cálculo(s) adicionado(s)`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Importar cálculos com IA
          </DialogTitle>
        </DialogHeader>

        {!extracted ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cole o texto da tabela/acordo ou anexe um arquivo (PDF, planilha, txt). A IA vai extrair somente os
              cálculos — eles serão adicionados a esta regra após sua revisão.
            </p>
            <Textarea
              placeholder="Cole aqui o conteúdo (tabela tarifária, acordo, e-mail...)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer border rounded-md px-3 py-2 hover:bg-muted">
                <Upload className="h-3.5 w-3.5" />
                {file ? file.name : "Anexar arquivo"}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.eml,.png,.jpg,.jpeg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {file && (
                <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
              <Button onClick={runExtraction} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Extrair cálculos
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {extracted.length} cálculo(s) extraído(s) · {checked.size} selecionado(s)
              </span>
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {allChecked ? "Desmarcar todos" : "Marcar todos"}
              </Button>
            </div>
            <ScrollArea className="h-[360px] border rounded-md">
              <ul className="divide-y">
                {extracted.map((c, i) => {
                  const isOn = checked.has(i);
                  const ctLabel = RULE_CALCULATION_TYPE_LABELS[c?.calculation_type as RuleCalculationType] ?? c?.calculation_type ?? "?";
                  return (
                    <li key={i} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                      <Checkbox checked={isOn} onCheckedChange={() => toggle(i)} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{c?.label || "(sem rótulo)"}</span>
                          <Badge variant="outline" className="text-[10px]">{ctLabel}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{summarize(c) || "—"}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setExtracted(null); setChecked(new Set()); }}>Voltar</Button>
              <Button onClick={confirm} disabled={checked.size === 0}>
                Adicionar {checked.size} à regra
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
