import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Upload, AlertTriangle, CheckCircle2, ArrowLeft, X } from "lucide-react";
import { normalizeNumericValue } from "@/lib/utils";

export type ImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "boolean" | "array";
  aliases?: string[];
  uniqueKey?: boolean;
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
};

export type ImportMode = "append" | "update" | "replace";

type Sheet = { name: string; headers: string[]; total: number; preview: any[] };
type Step = "upload" | "preview" | "validate" | "confirm" | "done";
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
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [rowsBySheet, setRowsBySheet] = useState<Record<string, any[]>>({});
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [validation, setValidation] = useState<{
    summary: { total: number; valid: number; errors: number; duplicates: number };
    errors: { row: number; reason: string }[];
    duplicates: { row: number; key: string }[];
    sample: any[];
  } | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [replaceConfirm, setReplaceConfirm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const supportedModes = profile.supportedModes ?? ["append", "update"];

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setSheets([]);
      setRowsBySheet({});
      setActiveSheet("");
      setMapping({});
      setValidation(null);
      setResult(null);
      setImportMode(supportedModes[0] ?? "append");
      setReplaceConfirm("");
    }
  }, [open]);

  const sheet = sheets.find((s) => s.name === activeSheet);

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

  const runValidation = async () => {
    setBusy(true);
    try {
      const { allRows, records, errors, dups } = buildImportPayload(rowsBySheet[activeSheet] ?? [], mapping, profile.fields, profile.fixedContext, profile.entity);
      setValidation({
        summary: { total: allRows.length, valid: records.length, errors: errors.length, duplicates: dups.length },
        errors: errors.slice(0, 50),
        duplicates: dups.slice(0, 50),
        sample: records.slice(0, 10),
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
      .filter((f) => f.required && !mapping[f.key])
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
    try {
      const { allRows, records } = buildImportPayload(rowsBySheet[activeSheet] ?? [], mapping, profile.fields, profile.fixedContext, profile.entity);
      const totals: CommitResult = { total: allRows.length, inserted: 0, updated: 0, created: 0, removed_before_replace: 0, skipped: 0, validation_errors: validation?.summary.errors ?? 0, duplicates: validation?.summary.duplicates ?? 0, insert_errors: [] };
      const CHUNK = 100;
      for (let i = 0; i < records.length; i += CHUNK) {
        const data = await callFn({
          mode: "commit",
          records: records.slice(i, i + CHUNK),
          totalRows: records.slice(i, i + CHUNK).length,
          replaceBefore: i === 0,
          profile: { ...profile, importMode },
        });
        totals.inserted += data.inserted ?? 0;
        totals.updated = (totals.updated ?? 0) + (data.updated ?? 0);
        totals.created = (totals.created ?? 0) + (data.created ?? 0);
        totals.removed_before_replace = (totals.removed_before_replace ?? 0) + (data.removed_before_replace ?? 0);
        totals.insert_errors.push(...(data.insert_errors ?? []));
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
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
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

        {step === "preview" && sheet && (
          <div className="space-y-4">
            {sheets.length > 1 && (
              <div className="space-y-1.5">
                <Label>Aba</Label>
                <select
                  value={activeSheet}
                  onChange={(e) => {
                    setActiveSheet(e.target.value);
                    const s = sheets.find((x) => x.name === e.target.value);
                    if (s) setMapping(suggestMapping(s.headers, profile.fields));
                  }}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.total} linhas)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <strong>{sheet.total}</strong> linhas · <strong>{sheet.headers.length}</strong> colunas detectadas
            </div>

            <div>
              <Label className="mb-2 block">Mapeamento de colunas</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {profile.fields.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-sm w-40 shrink-0">
                      {f.label}
                      {f.required && <span className="text-destructive ml-1">*</span>}
                    </span>
                    <select
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))
                      }
                      className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">— ignorar —</option>
                      {sheet.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Prévia (20 primeiras linhas)</Label>
              <div className="overflow-auto max-h-72 rounded-md border border-border">
                <table className="text-xs w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {sheet.headers.map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.preview.map((row, i) => (
                      <tr key={i} className="even:bg-muted/20">
                        {sheet.headers.map((h) => (
                          <td key={h} className="px-2 py-1 border-b border-border whitespace-nowrap max-w-[200px] truncate">
                            {String(row[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")} disabled={busy}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Trocar arquivo
              </Button>
              <Button onClick={runValidation} disabled={busy}>
                Validar e revisar
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

            {validation.sample.length > 0 && (
              <Section icon={<CheckCircle2 className="h-4 w-4 text-success" />} title="Amostra do que será importado">
                <pre className="text-xs bg-muted/40 p-2 rounded-md max-h-40 overflow-auto">
                  {JSON.stringify(validation.sample, null, 2)}
                </pre>
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

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={() => setStep("preview")} disabled={busy}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Corrigir mapeamento
              </Button>
              <Button
                onClick={runCommit}
                disabled={busy || validation.summary.valid === 0 || (importMode === "replace" && replaceConfirm.trim().toUpperCase() !== "SUBSTITUIR")}
              >
                Confirmar importação ({validation.summary.valid})
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className={`flex items-center gap-3 p-4 rounded-md border ${result.inserted > 0 ? "border-success/30 bg-success-soft text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {result.inserted > 0 ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
              <div>
                <div className="font-medium">
                  {result.inserted > 0 ? "Importação concluída" : "Nenhuma linha foi salva"}
                </div>
                <div className="text-sm">
                  {result.inserted} de {result.total} linha(s) processada(s).
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

function stepLabel(s: Step) {
  return { upload: "1. Upload", preview: "2. Mapeamento", validate: "3. Validação", done: "4. Concluído" }[s];
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
) {
  const mapped = applyMapping(rows, mapping, fields);
  const { valid, errors, dups } = validateRows(mapped, fields);
  const fixed = fixedContext ?? {};
  const records = valid.map((r) => {
    const rec: Record<string, any> = { ...r, ...fixed };
    if (entity === "reference_table_items" && (rec.code == null || rec.code === "") && rec.package_id) rec.code = String(rec.package_id);
    if (entity === "doctors") {
      if (typeof rec.crm === "string") rec.crm = rec.crm.replace(/\D/g, "");
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

function suggestMapping(headers: string[], fields: ImportFieldDef[]) {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(norm);
    let best: string | null = null;
    for (const h of headers) {
      if (used.has(h)) continue;
      const nh = norm(h);
      if (candidates.includes(nh) || candidates.some((c) => c && nh.includes(c))) {
        best = h;
        break;
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

function applyMapping(rows: any[], mapping: Record<string, string | null>, fields: ImportFieldDef[]) {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      const src = mapping[f.key];
      const raw = src ? row[src] : undefined;
      if (f.type === "number") out[f.key] = parseNumber(raw);
      else if (f.type === "boolean") {
        const s = String(raw ?? "").toLowerCase().trim();
        out[f.key] = ["1", "true", "sim", "s", "yes", "y", "ativo"].includes(s);
      } else if (f.type === "array") {
        const s = String(raw ?? "").trim();
        out[f.key] = s ? s.split(/[,;|/\s]+/).map((x) => x.trim()).filter(Boolean) : [];
      } else out[f.key] = raw == null ? null : String(raw).trim();
    }
    return out;
  });
}

function validateRows(mapped: any[], fields: ImportFieldDef[]) {
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  const uniqueKeys = fields.filter((f) => f.uniqueKey).map((f) => f.key);
  const seen = new Set<string>();
  const errors: { row: number; reason: string }[] = [];
  const dups: { row: number; key: string }[] = [];
  const valid: any[] = [];
  mapped.forEach((r, i) => {
    const missing = requiredKeys.filter((k) => r[k] == null || r[k] === "" || (Array.isArray(r[k]) && r[k].length === 0));
    if (missing.length) {
      errors.push({ row: i + 2, reason: `Campos obrigatórios ausentes: ${missing.join(", ")}` });
      return;
    }
    if (uniqueKeys.length) {
      const k = uniqueKeys.map((u) => String(r[u]).toLowerCase()).join("||");
      if (seen.has(k)) {
        dups.push({ row: i + 2, key: k });
        return;
      }
      seen.add(k);
    }
    valid.push(r);
  });
  return { valid, errors, dups };
}
