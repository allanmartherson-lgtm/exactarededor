import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Upload, AlertTriangle, CheckCircle2, ArrowLeft, X, Loader2, Search } from "lucide-react";
import { normalizeNumericValue } from "@/lib/utils";

export type ImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "boolean" | "array";
  aliases?: string[];
  uniqueKey?: boolean;
  defaultValue?: any;
};

export type ImportProfile = {
  entity:
    | "reference_table_items"
    | "companies"
    | "cost_centers"
    | "rules"
    | "procedure_classifications"
    | "doctors";
  fields: ImportFieldDef[];
  fixedContext?: Record<string, any>;
  /** Modos suportados pela tela. Default: ["append","update"]. */
  supportedModes?: ImportMode[];
  /** Escopo opcional para "replace" (filtra a deleção) */
  replaceScope?: Record<string, any>;
  /** Linhas de exemplo para o botão "Baixar modelo" no passo de upload.
   *  Cabeçalhos são derivados dos labels dos `fields`. */
  templateRows?: Record<string, any>[];
  /** Nome do arquivo de modelo (sem extensão). Default: entity. */
  templateFileName?: string;
};


export type ImportMode = "append" | "update" | "replace";

type Sheet = { name: string; headers: string[]; total: number; preview: any[] };
type Step = "upload" | "preview" | "role_config" | "validate" | "confirm" | "done";
type CommitResult = {
  total: number;
  inserted: number;
  updated?: number;
  created?: number;
  removed_before_replace?: number;
  skipped: number;
  validation_errors: number;
  duplicates: number;
  insert_errors: { chunk: number; reason: string }[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  profile: ImportProfile;
  onComplete?: (result: CommitResult) => void;
}

export function ImportWizard({ open, onOpenChange, title, profile, onComplete }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [rowsBySheet, setRowsBySheet] = useState<Record<string, any[]>>({});
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [detectedRoles, setDetectedRoles] = useState<string[]>([]);
  const [roleMapping, setRoleMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<{
    summary: { total: number; valid: number; errors: number; duplicates: number };
    errors: { row: number; reason: string }[];
    duplicates: { row: number; key: string }[];
    sample: any[];
    itemsCreated: { row: number; code: string; name: string; amount: number; role: string; sourceCol: string }[];
    crmConflicts?: { number: string; ufs: string[]; rows: number[]; source: "file" | "registry" }[];
    resolutionReport?: { row: number; crm: string; uf: string | null; method: "crm+uf" | "crm-only" | "novo"; reason: string }[];
  } | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [replaceConfirm, setReplaceConfirm] = useState("");
  // Atribuição manual de UF por número de CRM (resolve conflitos sem reabrir o arquivo)
  const [ufOverrides, setUfOverrides] = useState<Record<string, string>>({});
  // UX do passo de mapeamento: filtro por texto, colapso de opcionais e prévia só de colunas mapeadas
  const [fieldFilter, setFieldFilter] = useState("");
  const [showOptional, setShowOptional] = useState(true);
  const [onlyMappedPreview, setOnlyMappedPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);


  const supportedModes = profile.supportedModes ?? ["append", "update"];
  const sheet = sheets.find((s) => s.name === activeSheet);
  const autoDetectedValueColumns = sheet
    ? detectValueColumns(sheet.headers, rowsBySheet[activeSheet] ?? [], mapping)
    : [];

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setSheets([]);
      setRowsBySheet({});
      setActiveSheet("");
      setMapping({});
      setDetectedRoles([]);
      setRoleMapping({});
      setValidation(null);
      setResult(null);
      setImportMode(supportedModes[0] ?? "append");
      setReplaceConfirm("");
      setUfOverrides({});
    }
  }, [open]);

  const callFn = async (body: any) => {
    const { data, error } = await supabase.functions.invoke("import-wizard", { body });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const data = await readWorkbookSheets(file);
      setRowsBySheet(data.rowsBySheet);
      setSheets(data.sheets);
      const first = data.sheets?.[0];
      if (first) {
        setActiveSheet(first.name);
        // sugestão inicial via heurística cliente
        setMapping(suggestMapping(first.headers, profile.fields));
      }
      setStep("preview");
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const prepareValidation = async () => {
    if (profile.entity === "reference_table_items" && profile.fields.some(f => f.key === "amount")) {
      const rows = rowsBySheet[activeSheet] ?? [];
      const headers = sheets.find(s => s.name === activeSheet)?.headers || [];
      const rolesList = detectValueColumns(headers, rows, mapping);

      if (rolesList.length > 1 || (rolesList.length === 1 && !mapping["role"])) {
        setDetectedRoles(rolesList);
        const initialRoleMap: Record<string, string> = { ...roleMapping };
        rolesList.forEach(r => { 
          if (!initialRoleMap[r]) initialRoleMap[r] = r; 
        });
        setRoleMapping(initialRoleMap);
        setStep("role_config");
        return;
      }
    }
    runValidation();
  };

  const runValidation = async () => {
    setBusy(true);
    try {
      const { allRows, records, errors, dups } = buildImportPayload(
        rowsBySheet[activeSheet] ?? [], 
        mapping, 
        profile.fields, 
        profile.fixedContext, 
        profile.entity,
        roleMapping
      );
      if (profile.entity === "doctors") applyUfOverrides(records, ufOverrides);

      
      const itemsCreated = records.map(r => ({
        row: r._meta?.row || 0,
        code: String(r.code || r.id || ""),
        name: String(r.name || r.description || r.title || ""),
        amount: Number(r.amount || 0),
        role: String(r.role || ""),
        sourceCol: String(r._meta?.sourceCol || "N/A")
      }));

      // Detecção de conflitos CRM/UF e relatório de auditoria (apenas para médicos)
      let crmConflicts: { number: string; ufs: string[]; rows: number[]; source: "file" | "registry" }[] = [];
      let resolutionReport: { row: number; crm: string; uf: string | null; method: "crm+uf" | "crm-only" | "novo"; reason: string }[] = [];
      if (profile.entity === "doctors") {
        const detected = await detectCrmConflicts(records);
        crmConflicts = detected.conflicts;
        resolutionReport = detected.report;
      }

      setValidation({
        summary: { total: allRows.length, valid: records.length, errors: errors.length, duplicates: dups.length },
        errors: errors.slice(0, 50),
        duplicates: dups.slice(0, 50),
        sample: records.slice(0, 10),
        itemsCreated: itemsCreated.slice(0, 500),
        crmConflicts,
        resolutionReport,
      });
      setStep("validate");
    } catch (e: any) {
      toast({ title: "Erro na validação", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    // Validações de segurança antes de chamar o backend
    const requiredMissing = profile.fields
      .filter((f) => {
        if (!f.required) return false;
        if (f.key === "amount" && profile.entity === "reference_table_items" && autoDetectedValueColumns.length > 0) return false;
        return !mapping[f.key];
      })
      .map((f) => f.label);
    if (requiredMissing.length > 0) {
      toast({
        title: "Campos obrigatórios não mapeados",
        description: requiredMissing.join(", "),
        variant: "destructive",
      });
      return;
    }
    if (!validation || validation.summary.valid <= 0) {
      toast({ title: "Nada para importar", description: "Todas as linhas foram rejeitadas.", variant: "destructive" });
      return;
    }
    if (importMode === "replace" && replaceConfirm.trim().toUpperCase() !== "SUBSTITUIR") {
      toast({ title: "Confirme a substituição", description: "Digite SUBSTITUIR para liberar.", variant: "destructive" });
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      const { allRows, records } = buildImportPayload(rowsBySheet[activeSheet] ?? [], mapping, profile.fields, profile.fixedContext, profile.entity, roleMapping);
      if (profile.entity === "doctors") applyUfOverrides(records, ufOverrides);
      const totals: CommitResult = { 
        total: allRows.length, 
        inserted: 0, 
        updated: 0, 
        created: 0, 
        removed_before_replace: 0, 
        skipped: 0, 
        validation_errors: validation?.summary.errors ?? 0, 
        duplicates: validation?.summary.duplicates ?? 0, 
        insert_errors: [] 
      };
      
      const CHUNK = 100;
      const totalToImport = records.length;
      
      for (let i = 0; i < totalToImport; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK).map(r => {
          const { _meta, ...clean } = r;
          return clean;
        });
        try {
          const data = await callFn({
            mode: "commit",
            records: chunk,
            totalRows: chunk.length,
            replaceBefore: i === 0,
            profile: { ...profile, importMode },
          });
          
          totals.inserted += data.inserted ?? 0;
          totals.updated = (totals.updated ?? 0) + (data.updated ?? 0);
          totals.created = (totals.created ?? 0) + (data.created ?? 0);
          totals.removed_before_replace = (totals.removed_before_replace ?? 0) + (data.removed_before_replace ?? 0);
          totals.insert_errors.push(...(data.insert_errors ?? []));
        } catch (chunkErr: any) {
          console.error(`Error in chunk ${i/CHUNK + 1}:`, chunkErr);
          totals.insert_errors.push({ 
            chunk: Math.floor(i / CHUNK) + 1, 
            reason: chunkErr.message || "Erro de conexão no lote" 
          });
        }
        
        setProgress(Math.round(((i + chunk.length) / totalToImport) * 100));
      }
      totals.skipped = totals.validation_errors + totals.duplicates + Math.max(0, records.length - totals.inserted);
      const data = totals;
      const res: CommitResult = {
        total: data.total ?? 0,
        inserted: data.inserted ?? 0,
        updated: data.updated ?? 0,
        created: data.created ?? 0,
        removed_before_replace: data.removed_before_replace ?? 0,
        skipped: data.skipped ?? 0,
        validation_errors: data.validation_errors ?? 0,
        duplicates: data.duplicates ?? 0,
        insert_errors: data.insert_errors ?? [],
      };
      setResult(res);
      setStep("done");
      if (res.inserted > 0) {
        toast({ title: `${res.inserted} de ${res.total} linha(s) processada(s)` });
      } else {
        toast({
          title: "Nenhuma linha foi salva",
          description: res.insert_errors[0]?.reason ?? "Verifique os erros e o mapeamento.",
          variant: "destructive",
        });
      }
      onComplete?.(res);
    } catch (e: any) {
      toast({ title: "Erro ao importar", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-[98vw] w-[98vw] sm:max-w-[98vw] ${step === "preview" ? "h-[95vh] max-h-[95vh] flex flex-col overflow-hidden" : "max-h-[95vh] overflow-y-auto"}`}>
        <DialogHeader>
          <DialogTitle>
            {title} · {stepLabel(step)}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione um arquivo Excel (.xlsx, .xls) ou CSV. O sistema mostrará uma prévia antes de importar.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTemplate(profile, title)}
              >
                Baixar modelo
              </Button>
              <span className="text-xs text-muted-foreground self-center">
                Use o modelo como referência das colunas esperadas.
              </span>
            </div>
            <Input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <FieldsHelp fields={profile.fields} />
          </div>
        )}


        {step === "preview" && sheet && (() => {
          // Índice reverso: header da planilha -> campo Exacta mapeado (para destacar na prévia)
          const headerToField: Record<string, ImportFieldDef> = {};
          for (const f of profile.fields) {
            const col = mapping[f.key];
            if (col) headerToField[col] = f;
          }
          const requiredFields = profile.fields.filter((f) => f.required);
          const optionalFields = profile.fields.filter((f) => !f.required);
          const requiredMapped = requiredFields.filter((f) => !!mapping[f.key]).length;
          const optionalMapped = optionalFields.filter((f) => !!mapping[f.key]).length;
          const filterText = fieldFilter.trim().toLowerCase();
          const matchesFilter = (f: ImportFieldDef) =>
            !filterText ||
            f.label.toLowerCase().includes(filterText) ||
            f.key.toLowerCase().includes(filterText);
          const visibleRequired = requiredFields.filter(matchesFilter);
          const visibleOptional = optionalFields.filter(matchesFilter);
          const previewHeaders = onlyMappedPreview
            ? sheet.headers.filter((h) => headerToField[h])
            : sheet.headers;

          const renderFieldRow = (f: ImportFieldDef) => {
            const value = mapping[f.key] ?? "";
            const isMapped = !!value;
            return (
              <div
                key={f.key}
                className={`rounded-md border px-2.5 py-2 space-y-1 transition-colors ${
                  isMapped
                    ? "border-primary/40 bg-primary/5"
                    : f.required
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-background"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium truncate" title={f.label}>
                    {f.label}
                    {f.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <div className="flex items-center gap-1 shrink-0">
                    {f.key === "amount" && autoDetectedValueColumns.length > 0 && (
                      <span
                        className="text-[10px] font-normal text-primary bg-primary/10 px-1 rounded border border-primary/20"
                        title={`Detectadas: ${autoDetectedValueColumns.join(", ")}`}
                      >
                        auto {autoDetectedValueColumns.length > 1 ? `×${autoDetectedValueColumns.length}` : ""}
                      </span>
                    )}
                    {isMapped && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                  </div>
                </div>
                <select
                  value={value}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}
                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                >
                  <option value="">— ignorar —</option>
                  {sheet.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            );
          };

          return (
            <div className="flex-1 flex flex-col min-h-0 gap-3 overflow-hidden">
              {/* Barra superior: aba + estatísticas */}
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {sheets.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Aba</Label>
                    <select
                      value={activeSheet}
                      onChange={(e) => {
                        setActiveSheet(e.target.value);
                        const s = sheets.find((x) => x.name === e.target.value);
                        if (s) setMapping(suggestMapping(s.headers, profile.fields));
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {sheets.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name} ({s.total} linhas)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  <strong>{sheet.total}</strong> linhas · <strong>{sheet.headers.length}</strong> colunas
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      requiredMapped === requiredFields.length
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-destructive/10 border-destructive/30 text-destructive"
                    }`}
                  >
                    Obrigatórios {requiredMapped}/{requiredFields.length}
                  </span>
                  <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                    Opcionais {optionalMapped}/{optionalFields.length}
                  </span>
                </div>
              </div>

              {/* Corpo em 2 colunas: mapeamento (esquerda) + prévia (direita) */}
              <div className="flex-1 grid lg:grid-cols-[minmax(320px,380px)_1fr] gap-3 min-h-0">
                {/* Coluna esquerda — Mapeamento */}
                <div className="flex flex-col min-h-0 rounded-md border border-border bg-background">
                  <div className="border-b border-border px-2.5 py-2 space-y-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Mapeamento
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={fieldFilter}
                        onChange={(e) => setFieldFilter(e.target.value)}
                        placeholder="Filtrar campo..."
                        className="h-8 pl-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-3">
                    {visibleRequired.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase text-destructive/80 px-1">
                          Obrigatórios
                        </div>
                        <div className="space-y-1.5">{visibleRequired.map(renderFieldRow)}</div>
                      </div>
                    )}
                    {optionalFields.length > 0 && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setShowOptional((v) => !v)}
                          className="w-full flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground px-1 hover:text-foreground"
                        >
                          <span>Opcionais ({optionalFields.length})</span>
                          <span>{showOptional ? "recolher" : "expandir"}</span>
                        </button>
                        {showOptional && (
                          <div className="space-y-1.5">
                            {visibleOptional.length > 0 ? (
                              visibleOptional.map(renderFieldRow)
                            ) : (
                              <p className="text-[11px] text-muted-foreground italic px-1">
                                Nenhum campo opcional corresponde ao filtro.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Coluna direita — Prévia */}
                <div className="flex flex-col min-h-0 rounded-md border border-border bg-background">
                  <div className="border-b border-border px-2.5 py-2 flex items-center justify-between gap-2 shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Prévia (20 primeiras linhas)
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyMappedPreview}
                        onChange={(e) => setOnlyMappedPreview(e.target.checked)}
                        className="h-3 w-3"
                      />
                      Só colunas mapeadas
                    </label>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="text-xs w-full">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                          {previewHeaders.map((h) => {
                            const mapped = headerToField[h];
                            return (
                              <th
                                key={h}
                                className={`px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap ${
                                  mapped ? "bg-primary/10 text-primary" : ""
                                }`}
                              >
                                <div className="flex flex-col">
                                  <span>{h}</span>
                                  {mapped && (
                                    <span className="text-[9px] font-normal text-primary/80">
                                      → {mapped.label}
                                    </span>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.preview.map((row, i) => (
                          <tr key={i} className="even:bg-muted/20">
                            {previewHeaders.map((h) => (
                              <td
                                key={h}
                                className={`px-2 py-1 border-b border-border whitespace-nowrap max-w-[200px] truncate ${
                                  headerToField[h] ? "bg-primary/5" : ""
                                }`}
                              >
                                {String(row[h] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer fixo */}
              <DialogFooter className="shrink-0 border-t border-border pt-3">
                <Button variant="outline" onClick={() => setStep("upload")} disabled={busy}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Trocar arquivo
                </Button>
                <Button onClick={prepareValidation} disabled={busy}>
                  Continuar
                </Button>
              </DialogFooter>
            </div>
          );
        })()}

        {step === "role_config" && (
          <div className="space-y-4">
            <div className="p-3 bg-muted/30 rounded-md border border-border">
              <h4 className="text-sm font-medium mb-1">Mapeamento de Funções</h4>
              <p className="text-xs text-muted-foreground">
                Detectamos múltiplas colunas de valores. Como cada uma deve ser chamada no sistema?
              </p>
            </div>

            <div className="space-y-2">
              {detectedRoles.map(col => (
                <div key={col} className="flex items-center gap-3">
                  <div className="w-1/2 text-sm font-mono bg-muted/20 p-1.5 rounded border border-border truncate" title={col}>
                    {col}
                  </div>
                  <div className="text-muted-foreground">→</div>
                  <Input 
                    value={roleMapping[col] || ""} 
                    onChange={e => setRoleMapping(prev => ({ ...prev, [col]: e.target.value }))}
                    placeholder="Nome da função"
                    className="flex-1 h-9"
                  />
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep("preview")} disabled={busy}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
              <Button onClick={runValidation} disabled={busy}>
                Validar registros
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "validate" && validation && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Total" value={validation.summary.total} />
              <Stat label="Serão importadas" value={validation.summary.valid} tone="success" />
              <Stat label="Com alerta/erro" value={validation.summary.errors} tone="warn" />
              <Stat label="Duplicadas (ignoradas)" value={validation.summary.duplicates} tone="warn" />
            </div>

            {validation.errors.length > 0 && (
              <Section icon={<AlertTriangle className="h-4 w-4 text-destructive" />} title={`Linhas com erro (${validation.errors.length})`}>
                <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                  {validation.errors.slice(0, 30).map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-muted-foreground">L{e.row}</span> — {e.reason}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {validation.duplicates.length > 0 && (
              <Section icon={<X className="h-4 w-4 text-warning" />} title={`Duplicadas — apenas a 1ª ocorrência será mantida (${validation.duplicates.length})`}>
                <ul className="text-xs space-y-1 max-h-32 overflow-auto">
                  {validation.duplicates.slice(0, 30).map((d, i) => (
                    <li key={i}>
                      <span className="font-mono text-muted-foreground">L{d.row}</span> — chave: {d.key}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {validation.crmConflicts && validation.crmConflicts.length > 0 && (
              <Section
                icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
                title={`Conflitos de CRM/UF — corrija no arquivo antes de importar (${validation.crmConflicts.length})`}
              >
                <p className="text-[11px] text-muted-foreground mb-2">
                  CRMs idênticos aparecem com UFs diferentes (ou faltando). Padronize o campo
                  "CRM" para o formato <code className="font-mono">28923/DF</code> ou preencha a
                  coluna UF separadamente. A importação está bloqueada até a correção.
                </p>
                <div className="overflow-auto max-h-56 rounded-md border border-destructive/30">
                  <table className="text-[11px] w-full border-collapse">
                    <thead className="bg-destructive/5 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Origem</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">CRM</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">UFs encontradas</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Linhas afetadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.crmConflicts.map((c, i) => (
                        <tr key={i} className="even:bg-muted/20">
                          <td className="px-2 py-1 border-b border-border">
                            {c.source === "file" ? (
                              <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-medium">No arquivo</span>
                            ) : (
                              <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[10px] font-medium">Vs. cadastro</span>
                            )}
                          </td>
                          <td className="px-2 py-1 border-b border-border font-mono">{c.number}</td>
                          <td className="px-2 py-1 border-b border-border font-mono">{c.ufs.join(", ")}</td>
                          <td className="px-2 py-1 border-b border-border font-mono text-muted-foreground">
                            {c.rows.slice(0, 8).map((r) => `L${r}`).join(", ")}
                            {c.rows.length > 8 ? ` (+${c.rows.length - 8})` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Atribuição em massa de UF — resolve conflitos sem reabrir o arquivo */}
                <div className="mt-3 rounded-md border border-border bg-muted/20 p-2">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-medium">Atribuir UF em massa</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => runValidation()}
                      disabled={busy}
                    >
                      Revalidar com atribuições
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Defina a UF correta para cada CRM em conflito. A atribuição só preenche
                    linhas sem UF — valores explícitos no arquivo são preservados. Clique em
                    "Revalidar" para reaplicar e liberar a importação.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {validation.crmConflicts.map((c, i) => {
                      const options = Array.from(new Set(c.ufs.filter((u) => u && u !== "(sem UF)")));
                      const current = ufOverrides[c.number] ?? "";
                      return (
                        <div key={`ov-${i}`} className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono w-24 truncate" title={`CRM ${c.number}`}>CRM {c.number}</span>
                          <select
                            value={current}
                            onChange={(e) =>
                              setUfOverrides((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[c.number] = e.target.value;
                                else delete next[c.number];
                                return next;
                              })
                            }
                            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-[11px]"
                          >
                            <option value="">— não atribuir —</option>
                            {options.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Section>
            )}


            {validation.resolutionReport && validation.resolutionReport.length > 0 && (
              <Section
                icon={<CheckCircle2 className="h-4 w-4 text-success" />}
                title={`Auditoria de resolução de CRM (${validation.resolutionReport.length})`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="grid grid-cols-3 gap-2 text-[11px] flex-1">
                    <Stat
                      label="Match CRM+UF"
                      value={validation.resolutionReport.filter((r) => r.method === "crm+uf").length}
                      tone="success"
                    />
                    <Stat
                      label="Match só por número"
                      value={validation.resolutionReport.filter((r) => r.method === "crm-only").length}
                      tone="warn"
                    />
                    <Stat
                      label="Novo cadastro"
                      value={validation.resolutionReport.filter((r) => r.method === "novo").length}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] ml-2 shrink-0"
                    onClick={() => downloadResolutionCsv(validation.resolutionReport!)}
                  >
                    Exportar CSV
                  </Button>
                </div>

                <div className="overflow-auto max-h-72 rounded-md border border-border">
                  <table className="text-[11px] w-full border-collapse">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Linha</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">CRM</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">UF</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Método</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Justificativa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.resolutionReport.slice(0, 200).map((r, i) => (
                        <tr key={i} className="even:bg-muted/20">
                          <td className="px-2 py-1 border-b border-border font-mono text-muted-foreground">L{r.row}</td>
                          <td className="px-2 py-1 border-b border-border font-mono">{r.crm}</td>
                          <td className="px-2 py-1 border-b border-border font-mono">{r.uf ?? "—"}</td>
                          <td className="px-2 py-1 border-b border-border">
                            {r.method === "crm+uf" && (
                              <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[10px] font-medium">CRM+UF</span>
                            )}
                            {r.method === "crm-only" && (
                              <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-medium">Só número</span>
                            )}
                            {r.method === "novo" && (
                              <span className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[10px] font-medium">Novo</span>
                            )}
                          </td>
                          <td className="px-2 py-1 border-b border-border text-muted-foreground">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validation.resolutionReport.length > 200 && (
                  <p className="text-[10px] text-muted-foreground mt-2 italic text-center">
                    Mostrando 200 de {validation.resolutionReport.length} linhas.
                  </p>
                )}
              </Section>
            )}

            {validation.itemsCreated.length > 0 && (
              <Section icon={<CheckCircle2 className="h-4 w-4 text-success" />} title="Itens que serão criados (prévia detalhada)">
                <div className="overflow-auto max-h-80 rounded-md border border-border">
                  <table className="text-[10px] w-full border-collapse">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Linha Origem</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Coluna Valor</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Código/ID</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Nome/Desc</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Valor</th>
                        <th className="px-2 py-1.5 text-left font-medium border-b border-border">Função</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.itemsCreated.map((item, idx) => (
                        <tr key={idx} className="even:bg-muted/20 hover:bg-muted/40">
                          <td className="px-2 py-1 border-b border-border font-mono text-muted-foreground">L{item.row}</td>
                          <td className="px-2 py-1 border-b border-border font-medium text-blue-600">{item.sourceCol}</td>
                          <td className="px-2 py-1 border-b border-border truncate max-w-[100px]" title={item.code}>{item.code}</td>
                          <td className="px-2 py-1 border-b border-border truncate max-w-[150px]" title={item.name}>{item.name}</td>
                          <td className="px-2 py-1 border-b border-border font-mono">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}
                          </td>
                          <td className="px-2 py-1 border-b border-border truncate max-w-[100px]" title={item.role}>
                            <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[9px] font-medium">
                              {item.role}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validation.summary.valid > validation.itemsCreated.length && (
                  <p className="text-[10px] text-muted-foreground mt-2 italic text-center">
                    Mostrando os primeiros {validation.itemsCreated.length} de {validation.summary.valid} itens que serão criados.
                  </p>
                )}
              </Section>
            )}

            {supportedModes.length > 1 && (
              <Section icon={<Upload className="h-4 w-4" />} title="Modo de importação">
                <div className="space-y-2 text-sm">
                  {supportedModes.includes("append") && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="mode" checked={importMode === "append"} onChange={() => setImportMode("append")} className="mt-1" />
                      <span><strong>Adicionar novos</strong> — insere apenas registros que ainda não existem.</span>
                    </label>
                  )}
                  {supportedModes.includes("update") && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="mode" checked={importMode === "update"} onChange={() => setImportMode("update")} className="mt-1" />
                      <span><strong>Atualizar existentes</strong> — atualiza registros já cadastrados pela chave natural e insere os novos.</span>
                    </label>
                  )}
                  {supportedModes.includes("replace") && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="mode" checked={importMode === "replace"} onChange={() => setImportMode("replace")} className="mt-1" />
                      <span><strong className="text-destructive">Substituir lista atual</strong> — apaga os registros existentes antes de importar. Ação destrutiva.</span>
                    </label>
                  )}
                  {importMode === "replace" && (
                    <div className="mt-2 p-2 rounded-md border border-destructive/40 bg-destructive/5 space-y-2">
                      <p className="text-xs text-destructive">
                        Esta ação remove permanentemente os registros antes de gravar os novos. Para confirmar, digite <strong>SUBSTITUIR</strong> abaixo.
                      </p>
                      <Input value={replaceConfirm} onChange={(e) => setReplaceConfirm(e.target.value)} placeholder="SUBSTITUIR" />
                    </div>
                  )}
                </div>
              </Section>
            )}

            {busy && (
              <div className="space-y-2 py-4 border-t border-border mt-4">
                <div className="flex justify-between text-xs font-medium">
                  <span>Processando importação...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-[10px] text-muted-foreground text-center">
                  Por favor, não feche esta janela até a conclusão.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={() => setStep("preview")} disabled={busy}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Corrigir mapeamento
              </Button>
              <Button
                onClick={runCommit}
                disabled={
                  busy ||
                  validation.summary.valid === 0 ||
                  (importMode === "replace" && replaceConfirm.trim().toUpperCase() !== "SUBSTITUIR") ||
                  (validation.crmConflicts && validation.crmConflicts.length > 0)
                }
                title={validation.crmConflicts && validation.crmConflicts.length > 0 ? "Resolva os conflitos de CRM/UF antes de importar" : undefined}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  `Confirmar importação (${validation.summary.valid})`
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className={`flex items-center gap-3 p-4 rounded-md border ${result.inserted > 0 ? "border-success/30 bg-success-soft text-success" : result.insert_errors.length === 0 ? "border-warning/30 bg-warning/10 text-warning-foreground" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {result.inserted > 0 ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
              <div>
                <div className="font-medium">
                  {result.inserted > 0
                    ? "Importação concluída"
                    : result.insert_errors.length === 0
                    ? "Nenhum registro novo"
                    : "Nenhuma linha foi salva"}
                </div>
                <div className="text-sm">
                  {result.inserted} de {result.total} linha(s) processada(s).
                  {result.inserted === 0 && result.insert_errors.length === 0 && result.total > 0
                    ? " Todos os registros já estavam cadastrados."
                    : ""}
                  {result.removed_before_replace ? ` ${result.removed_before_replace} apagada(s) antes da substituição.` : ""}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Total no arquivo" value={result.total} />
              <Stat label="Criadas" value={result.created ?? 0} tone="success" />
              <Stat label="Atualizadas" value={result.updated ?? 0} tone="success" />
              <Stat label="Ignoradas / com erro" value={result.skipped} tone="warn" />
            </div>
            {result.insert_errors.length > 0 && (
              <Section icon={<AlertTriangle className="h-4 w-4 text-destructive" />} title={`Erros ao gravar no banco (${result.insert_errors.length} lote(s))`}>
                <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                  {result.insert_errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-muted-foreground">Lote {e.chunk}</span> — {e.reason}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warn" }) {
  const cls =
    tone === "success"
      ? "border-success/30 bg-success-soft text-success"
      : tone === "warn"
        ? "border-warning/30 bg-warning-soft text-warning"
        : "border-border bg-muted/30 text-foreground";
  return (
    <div className={`rounded-md border ${cls} px-3 py-2`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function FieldsHelp({ fields }: { fields: ImportFieldDef[] }) {
  return (
    <div className="text-xs text-muted-foreground border border-border rounded-md p-3">
      <div className="font-medium mb-1 text-foreground">Campos esperados:</div>
      <ul className="space-y-0.5">
        {fields.map((f) => (
          <li key={f.key}>
            • <strong>{f.label}</strong>
            {f.required ? <span className="text-destructive"> *</span> : " (opcional)"}
            {f.aliases?.length ? <span className="opacity-70"> — aceita: {f.aliases.join(", ")}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function downloadTemplate(profile: ImportProfile, title: string) {
  const headers = profile.fields.map(f => f.label);
  const exampleRows = profile.templateRows && profile.templateRows.length > 0
    ? profile.templateRows
    : [Object.fromEntries(profile.fields.map(f => [f.label, ""]))];
  const ws = XLSX.utils.json_to_sheet(exampleRows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Modelo");
  const base = (profile.templateFileName ?? profile.entity ?? title ?? "modelo")
    .toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  XLSX.writeFile(wb, `modelo_${base}.xlsx`);
}


/**
 * Exporta o relatório de auditoria de resolução de CRM como CSV.
 * Inclui todas as linhas (não apenas as 200 exibidas em tela).
 */
function downloadResolutionCsv(
  report: { row: number; crm: string; uf: string | null; method: "crm+uf" | "crm-only" | "novo"; reason: string }[],
) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["linha", "crm", "uf", "metodo", "justificativa"].join(";");
  const lines = report.map((r) => [r.row, r.crm, r.uf ?? "", r.method, r.reason].map(esc).join(";"));
  const csv = "\uFEFF" + [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `auditoria-crm-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**

 * Aplica overrides manuais de UF (atribuição em massa) sobre os registros
 * antes da validação/commit. Só preenche UF quando ela está vazia, para não
 * sobrescrever um valor explícito vindo do arquivo.
 */
function applyUfOverrides(records: any[], overrides: Record<string, string>) {
  if (!overrides || Object.keys(overrides).length === 0) return;
  for (const r of records) {
    const number = String(r.crm ?? "").replace(/\D/g, "");
    if (!number) continue;
    const ov = overrides[number];
    if (!ov) continue;
    const current = String(r.crm_uf ?? "").toUpperCase().trim();
    if (!current) r.crm_uf = ov.toUpperCase();
  }
}

/**
 * Detecta conflitos de CRM/UF na importação de médicos e produz um relatório
 * de auditoria do método de resolução por linha.
 *

 * Conflitos:
 *  - "file": dentro do próprio arquivo há linhas com o mesmo número de CRM
 *    e UFs diferentes (ou ausentes em parte das linhas).
 *  - "registry": linha do arquivo trouxe CRM sem UF, e existem múltiplos
 *    cadastros com aquele número em UFs diferentes — não dá para decidir
 *    automaticamente qual atualizar.
 */
async function detectCrmConflicts(records: any[]): Promise<{
  conflicts: { number: string; ufs: string[]; rows: number[]; source: "file" | "registry" }[];
  report: { row: number; crm: string; uf: string | null; method: "crm+uf" | "crm-only" | "novo"; reason: string }[];
}> {
  const report: { row: number; crm: string; uf: string | null; method: "crm+uf" | "crm-only" | "novo"; reason: string }[] = [];
  const fileByNumber = new Map<string, Map<string, number[]>>(); // number -> uf("" se ausente) -> rows
  const numbersOnly = new Set<string>(); // números do arquivo sem UF

  for (const r of records) {
    const number = String(r.crm ?? "").replace(/\D/g, "");
    const uf = String(r.crm_uf ?? "").toUpperCase().trim();
    const row = r._meta?.row ?? 0;
    if (!number) continue;
    const slot = fileByNumber.get(number) ?? new Map<string, number[]>();
    const list = slot.get(uf) ?? [];
    list.push(row);
    slot.set(uf, list);
    fileByNumber.set(number, slot);
    if (!uf) numbersOnly.add(number);
  }

  // Carrega cadastros existentes que possam colidir
  const existingByNumber = new Map<string, string[]>();
  try {
    const numbersArr = Array.from(fileByNumber.keys()).filter(Boolean);
    if (numbersArr.length) {
      // Quebrar em chunks para evitar query gigante
      const CHUNK = 200;
      for (let i = 0; i < numbersArr.length; i += CHUNK) {
        const slice = numbersArr.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("doctors")
          .select("crm, crm_uf")
          .in("crm", slice);
        for (const d of data ?? []) {
          const n = String((d as any).crm ?? "");
          const u = String((d as any).crm_uf ?? "").toUpperCase().trim();
          if (!n || !u) continue;
          const list = existingByNumber.get(n) ?? [];
          if (!list.includes(u)) list.push(u);
          existingByNumber.set(n, list);
        }
      }
    }
  } catch (e) {
    // Best-effort: se falhar consulta, segue sem conflitos de cadastro
    console.warn("[detectCrmConflicts] falha ao consultar cadastros:", (e as any)?.message);
  }

  const conflicts: { number: string; ufs: string[]; rows: number[]; source: "file" | "registry" }[] = [];

  // 1) conflitos dentro do arquivo: mesmo número, UFs diferentes (incluindo "" como ausente)
  for (const [number, slot] of fileByNumber.entries()) {
    const ufs = Array.from(slot.keys());
    const distinctUfs = ufs.filter((u) => u);
    const hasMissing = ufs.includes("");
    if (distinctUfs.length > 1 || (distinctUfs.length >= 1 && hasMissing)) {
      const rows = ufs.flatMap((u) => slot.get(u) ?? []).sort((a, b) => a - b);
      conflicts.push({ number, ufs: [...distinctUfs, ...(hasMissing ? ["(sem UF)"] : [])], rows, source: "file" });
    }
  }

  // 2) conflitos contra o cadastro: linha sem UF e número cadastrado em múltiplas UFs
  for (const number of numbersOnly) {
    const cadUfs = existingByNumber.get(number) ?? [];
    if (cadUfs.length > 1) {
      const rows = (fileByNumber.get(number)?.get("") ?? []).sort((a, b) => a - b);
      conflicts.push({ number, ufs: cadUfs, rows, source: "registry" });
    }
  }

  // 3) relatório de auditoria por linha
  for (const r of records) {
    const number = String(r.crm ?? "").replace(/\D/g, "");
    const uf = String(r.crm_uf ?? "").toUpperCase().trim() || null;
    const row = r._meta?.row ?? 0;
    if (!number) continue;
    const cadUfs = existingByNumber.get(number) ?? [];
    if (uf && cadUfs.includes(uf)) {
      report.push({ row, crm: number, uf, method: "crm+uf", reason: `Match exato com cadastro existente CRM ${number}/${uf}` });
    } else if (uf) {
      report.push({ row, crm: number, uf, method: "crm+uf", reason: `Novo registro será criado com CRM ${number}/${uf}` });
    } else if (cadUfs.length === 1) {
      report.push({ row, crm: number, uf: cadUfs[0], method: "crm-only", reason: `Linha sem UF; cadastro único encontrado em ${cadUfs[0]}` });
    } else if (cadUfs.length > 1) {
      report.push({ row, crm: number, uf: null, method: "crm-only", reason: `Ambíguo: CRM ${number} cadastrado em ${cadUfs.join(", ")} — exige correção manual` });
    } else {
      report.push({ row, crm: number, uf: null, method: "novo", reason: `Novo CRM ${number} sem UF informada` });
    }
  }

  return { conflicts, report };
}



function stepLabel(s: Step) {
  return { upload: "1. Upload", preview: "2. Mapeamento", role_config: "2.5 Funções", validate: "3. Validação", done: "4. Concluído" }[s];
}

async function readWorkbookSheets(file: File): Promise<{ sheets: Sheet[]; rowsBySheet: Record<string, any[]> }> {
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: "string", raw: false })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellNF: false, cellText: false, cellFormula: false, cellHTML: false });
  const rowsBySheet: Record<string, any[]> = {};
  const sheets = (wb.SheetNames ?? []).map((name) => {
    const ws = wb.Sheets[name];
    const rows = ws ? XLSX.utils.sheet_to_json<any>(ws, { defval: "", raw: false }) : [];
    rowsBySheet[name] = rows;
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { name, headers, total: rows.length, preview: rows.slice(0, 20) };
  });
  return { sheets, rowsBySheet };
}

function buildImportPayload(
  rows: any[],
  mapping: Record<string, string | null>,
  fields: ImportFieldDef[],
  fixedContext: Record<string, any> | undefined,
  entity: ImportProfile["entity"],
  roleMapping?: Record<string, string>
) {
  const mapped = applyMapping(rows, mapping, fields, entity, roleMapping);
  const { valid, errors, dups } = validateRows(mapped, fields, entity);
  const fixed = fixedContext ?? {};
  const records = valid.map((r) => {
    const rec: Record<string, any> = { ...r, ...fixed };
    if (entity === "reference_table_items" && (rec.code == null || rec.code === "") && rec.package_id) rec.code = String(rec.package_id);
    if (entity === "doctors") {
      // Aceita CRM unificado ("28923/DF") ou separado. Se UF vier embutida no
      // campo CRM, extrai automaticamente quando crm_uf não foi mapeado.
      if (typeof rec.crm === "string") {
        const raw = rec.crm.toUpperCase().trim();
        const ufMatch = raw.match(/\b([A-Z]{2})\b/);
        const digits = raw.replace(/\D/g, "");
        rec.crm = digits;
        if (ufMatch && (!rec.crm_uf || String(rec.crm_uf).trim() === "")) {
          rec.crm_uf = ufMatch[1];
        }
      }
      if (typeof rec.crm_uf === "string") rec.crm_uf = rec.crm_uf.toUpperCase().trim();
    }
    return rec;
  });
  return { allRows: rows, records, errors, dups };
}

const norm = (s: any) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const VALUE_COLUMN_KEYWORDS = [
  "valor", "preco", "amount", "honorario", "uco", "filme", "custo", "vlr",
  "auxiliar", "cirurgiao", "porte", "anestesista", "instrumentador", "coparticipacao",
].map(norm);

function detectValueColumns(headers: string[], rows: any[], mapping: Record<string, string | null>) {
  const detected = new Set<string>();
  const checkRows = rows.slice(0, 500);
  const hasPositiveNumber = (colName: string) => checkRows.some((row) => {
    const val = normalizeNumericValue(row[colName]);
    return !val.invalid && val.value > 0;
  });

  const mainAmountCol = mapping["amount"];
  if (mainAmountCol && hasPositiveNumber(mainAmountCol)) detected.add(mainAmountCol);

  headers.forEach((colName) => {
    const otherMapped = Object.entries(mapping).some(([k, v]) => v === colName && k !== "amount");
    if (otherMapped) return;
    const normalizedColumn = norm(colName);
    const looksLikeValueColumn = VALUE_COLUMN_KEYWORDS.some((keyword) => normalizedColumn.includes(keyword));
    if (looksLikeValueColumn && hasPositiveNumber(colName)) detected.add(colName);
  });

  return Array.from(detected);
}

function suggestMapping(headers: string[], fields: ImportFieldDef[]) {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(norm).filter(Boolean);
    let best: string | null = null;
    // 1ª passada: match exato (evita que "Nome" capture o que deveria ir para "Nome Pessoa")
    for (const h of headers) {
      if (used.has(h)) continue;
      if (candidates.includes(norm(h))) { best = h; break; }
    }
    // 2ª passada: substring (header contém algum alias) — só se nenhum exato bateu
    if (!best) {
      for (const h of headers) {
        if (used.has(h)) continue;
        const nh = norm(h);
        if (candidates.some((c) => nh.includes(c))) { best = h; break; }
      }
    }
    out[f.key] = best;
    if (best) used.add(best);
  }
  return out;
}

const parseNumber = (v: any): number | null => {
  const result = normalizeNumericValue(v);
  return result.invalid ? null : result.value;
};

function applyMapping(rows: any[], mapping: Record<string, string | null>, fields: ImportFieldDef[], entity?: ImportProfile["entity"], roleMapping?: Record<string, string>) {
  const result: any[] = [];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const detectedValueColumns = detectValueColumns(headers, rows, mapping);

  rows.forEach((row, rowIndex) => {
    const base: Record<string, any> = {};
    const otherFields = fields.filter(f => f.key !== "amount" && f.key !== "role");
    const originalRowNum = rowIndex + 2; // Usually Excel starts at row 2 for data
    
    for (const f of otherFields) {
      const src = mapping[f.key];
      const raw = src ? row[src] : undefined;
      if (f.type === "number") base[f.key] = parseNumber(raw);
      else if (f.type === "boolean") {
        const s = normalizeBooleanToken(raw);
        const def = f.defaultValue !== undefined ? f.defaultValue : false;
        // Aceita variantes comuns de "ativo": "A" (Tasy), "ATIVO", "ATIV", "ACTIVE", etc.
        // Importante: "A" sozinho (situação médico no Tasy) precisa virar true.
        const truthy = ["1", "true", "sim", "s", "yes", "y", "a", "at", "ativ", "ativo", "active"];
        const falsy = ["0", "false", "nao", "não", "n", "no", "i", "in", "inat", "inativo", "inactive"];
        if (raw == null || s === "") base[f.key] = def;
        else if (truthy.includes(s)) base[f.key] = true;
        else if (falsy.includes(s)) base[f.key] = false;
        else base[f.key] = def;
      } else if (f.type === "array") {
        // Divide APENAS por separadores explícitos (,  ;  |). Nunca por espaço
        // ou barra — nomes de especialidade contêm espaços ("Clínica Médica",
        // "Ortopedia e Traumatologia") e barras ("Radiologia / Diagnóstico").
        const s = String(raw ?? "").trim();
        base[f.key] = s ? s.split(/[,;|]+/).map((x) => x.trim()).filter(Boolean) : [];
      } else base[f.key] = raw == null ? (f.defaultValue ?? null) : String(raw).trim();
    }

    if (entity === "reference_table_items" && fields.some(f => f.key === "amount")) {
      const amountCols: { role: string, amount: number, sourceCol: string }[] = [];
      const roleCol = mapping["role"];

      detectedValueColumns.forEach(colName => {
        const val = normalizeNumericValue(row[colName]);
        if (!val.invalid && val.value > 0) {
          const roleRaw = roleCol && colName === mapping["amount"] ? String(row[roleCol] || "").trim() : colName;
          const role = (roleMapping && roleMapping[roleRaw]) || roleRaw;
          amountCols.push({ role, amount: val.value, sourceCol: colName });
        }
      });

      if (amountCols.length > 0) {
        amountCols.forEach(ac => {
          result.push({ 
            ...base, 
            role: ac.role, 
            amount: ac.amount,
            _meta: { row: originalRowNum, sourceCol: ac.sourceCol }
          });
        });
      } else {
        result.push({ 
          ...base, 
          role: null, 
          amount: 0,
          _meta: { row: originalRowNum, sourceCol: mapping["amount"] || "N/A" }
        });
      }
    } else {
      const out: Record<string, any> = { ...base };
      const amountField = fields.find(f => f.key === "amount");
      const roleField = fields.find(f => f.key === "role");
      let sourceCol = "N/A";
      
      if (amountField) {
        const src = mapping["amount"];
        out["amount"] = src ? parseNumber(row[src]) : (amountField.defaultValue ?? 0);
        if (src) sourceCol = src;
      }
      if (roleField) {
        const src = mapping["role"];
        out["role"] = src ? String(row[src] || "").trim() : (roleField.defaultValue ?? null);
      }
      
      result.push({
        ...out,
        _meta: { row: originalRowNum, sourceCol }
      });
    }
  });
  return result;
}

function normalizeBooleanToken(value: any): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

function validateRows(mapped: any[], fields: ImportFieldDef[], entity?: ImportProfile["entity"]) {
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  const uniqueKeys = fields.filter((f) => f.uniqueKey).map((f) => f.key);
  
  // Se for reference_table_items, a unicidade deve considerar code + role para não barrar múltiplas colunas de valor da mesma linha
  const isRefTable = entity === "reference_table_items";
  
  const seen = new Set<string>();
  const errors: { row: number; reason: string }[] = [];
  const dups: { row: number; key: string }[] = [];
  const valid: any[] = [];
  
  mapped.forEach((r) => {
    const rowNum = r._meta?.row || 0;
    const missing = requiredKeys.filter((k) => r[k] == null || r[k] === "" || (Array.isArray(r[k]) && r[k].length === 0));
    if (missing.length) {
      const labels = missing.map(k => fields.find(f => f.key === k)?.label || k);
      errors.push({ row: rowNum, reason: `Campos obrigatórios ausentes: ${labels.join(", ")}` });
      return;
    }

    if (r.email && typeof r.email === 'string' && r.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(r.email)) {
        errors.push({ row: rowNum, reason: `E-mail inválido: ${r.email}` });
        return;
      }
    }

    if (entity === "doctors") {
      // CRM pode vir unificado ("28923/DF") ou só números. Aceita ambos.
      if (r.crm) {
        const raw = String(r.crm).toUpperCase().trim();
        const digits = raw.replace(/\D/g, "");
        const rest = raw.replace(/\d/g, "").replace(/[\s./\-]/g, "");
        if (!digits) {
          errors.push({ row: rowNum, reason: `CRM sem número: ${r.crm}` });
          return;
        }
        if (rest && !/^[A-Z]{2}$/.test(rest)) {
          errors.push({ row: rowNum, reason: `CRM inválido (esperado número ou número/UF): ${r.crm}` });
          return;
        }
      }
      if (r.crm_uf && !/^[A-Z]{2}$/i.test(String(r.crm_uf).trim())) {
        errors.push({ row: rowNum, reason: `UF inválida: ${r.crm_uf}` });
        return;
      }
    }

    if (uniqueKeys.length) {
      let k = uniqueKeys.map((u) => String(r[u] ?? "").toLowerCase().trim()).join("||");
      
      // Ajuste para evitar falsos positivos em múltiplas colunas de valor
      if (isRefTable && r.role) {
        k += `||role:${String(r.role).toLowerCase().trim()}`;
      }

      if (seen.has(k)) {
        dups.push({ row: rowNum, key: k });
        return;
      }
      seen.add(k);
    }
    valid.push(r);
  });
  return { valid, errors, dups };
}
