import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Upload, AlertTriangle, CheckCircle2, ArrowLeft, X } from "lucide-react";

export type ImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "boolean";
  aliases?: string[];
  uniqueKey?: boolean;
};

export type ImportProfile = {
  entity:
    | "reference_table_items"
    | "companies"
    | "cost_centers"
    | "rules"
    | "procedure_classifications";
  fields: ImportFieldDef[];
  fixedContext?: Record<string, any>;
};

type Sheet = { name: string; headers: string[]; total: number; preview: any[] };
type Step = "upload" | "preview" | "validate" | "done";
type CommitResult = {
  total: number;
  inserted: number;
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
  const [storagePath, setStoragePath] = useState<string>("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [validation, setValidation] = useState<{
    summary: { total: number; valid: number; errors: number; duplicates: number };
    errors: { row: number; reason: string }[];
    duplicates: { row: number; key: string }[];
    sample: any[];
  } | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setStoragePath("");
      setSheets([]);
      setActiveSheet("");
      setMapping({});
      setValidation(null);
      setResult(null);
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
      const path = `${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("import-uploads")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      setStoragePath(path);
      const data = await callFn({ mode: "parse", storagePath: path });
      setSheets(data.sheets ?? []);
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
      const data = await callFn({
        mode: "preview",
        storagePath,
        sheetName: activeSheet,
        mapping,
        profile,
      });
      setValidation(data);
      setStep("validate");
    } catch (e: any) {
      toast({ title: "Erro na validação", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    try {
      const data = await callFn({
        mode: "commit",
        storagePath,
        sheetName: activeSheet,
        mapping,
        profile,
      });
      const res: CommitResult = {
        total: data.total ?? 0,
        inserted: data.inserted ?? 0,
        skipped: data.skipped ?? 0,
        validation_errors: data.validation_errors ?? 0,
        duplicates: data.duplicates ?? 0,
        insert_errors: data.insert_errors ?? [],
      };
      setResult(res);
      setStep("done");
      toast({ title: `${res.inserted} de ${res.total} linha(s) importada(s)` });
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

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={() => setStep("preview")} disabled={busy}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Corrigir mapeamento
              </Button>
              <Button onClick={runCommit} disabled={busy || validation.summary.valid === 0}>
                Confirmar importação ({validation.summary.valid})
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-md border border-success/30 bg-success-soft text-success">
              <CheckCircle2 className="h-6 w-6" />
              <div>
                <div className="font-medium">Importação concluída</div>
                <div className="text-sm">{result.inserted} linha(s) inserida(s).</div>
              </div>
            </div>
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
