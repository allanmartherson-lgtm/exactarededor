/**
 * Diálogo de mapeamento de colunas para o relatório de Parecer do Tasy.
 *
 * Por que existir: o relatório vem de exports diferentes do Tasy e pode
 * mudar os headers a qualquer momento. Em vez de depender de aliases
 * hardcoded, o analista vê o que o sistema detectou, corrige se necessário,
 * e salva como template (por assinatura de cabeçalho em localStorage) para
 * reuso automático nas próximas importações.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

export type ParecerFieldKey =
  | "atendimento"
  | "paciente"
  | "medico_solicitante"
  | "medico_resposta"
  | "crm_resposta"
  | "espec_origem"
  | "espec_destino"
  | "dt_solic_parecer"
  | "dt_resposta_parecer"
  | "situacao"
  | "nr_parecer"
  | "tempo_resposta";

export type ParecerMapping = Partial<Record<ParecerFieldKey, string>>;

interface FieldDef {
  key: ParecerFieldKey;
  label: string;
  hint?: string;
  required: boolean;
  aliases: string[];
}

const FIELDS: FieldDef[] = [
  {
    key: "atendimento",
    label: "Nº Atendimento",
    hint: "Chave de cruzamento com a base de pagamento",
    required: true,
    aliases: ["atend_paciente", "atendimento", "nr_atendimento", "atend", "nr_atend"],
  },
  {
    key: "medico_resposta",
    label: "Médico que respondeu",
    hint: "Nome (pode vir com CRM entre parênteses)",
    required: true,
    aliases: [
      "medico_resposta_parecer",
      "medico_resposta",
      "medico_que_respondeu",
      "medico_responde",
      "medico_executor",
      "responsavel",
    ],
  },
  {
    key: "dt_resposta_parecer",
    label: "Data da resposta",
    hint: "Usada para cruzar com a data de procedimento",
    required: true,
    aliases: ["dt_resposta_parecer", "data_resposta", "dt_resposta"],
  },
  {
    key: "crm_resposta",
    label: "CRM do médico (resposta)",
    hint: "Se vazio, o sistema extrai do nome quando vier (CRM 123456)",
    required: false,
    aliases: [
      "crm_resposta",
      "crm_medico_resposta",
      "crm_medico_resposta_parecer",
      "crm",
      "conselho",
      "conselho_resposta",
    ],
  },
  {
    key: "medico_solicitante",
    label: "Médico solicitante",
    required: false,
    aliases: [
      "medico_solic_parecer",
      "medico_solicitante",
      "solicitante",
      "medico_solic",
    ],
  },
  {
    key: "paciente",
    label: "Paciente",
    required: false,
    aliases: ["paciente", "nome_paciente"],
  },
  {
    key: "espec_origem",
    label: "Especialidade solicitante",
    required: false,
    aliases: [
      "espec_med_solic_parecer",
      "espec_origem",
      "especialidade_origem",
    ],
  },
  {
    key: "espec_destino",
    label: "Especialidade destino",
    required: false,
    aliases: ["espec_dest_parecer", "espec_destino", "especialidade_destino"],
  },
  {
    key: "dt_solic_parecer",
    label: "Data de solicitação",
    required: false,
    aliases: ["dt_solic_parecer", "data_solicitacao", "dt_solicitacao"],
  },
  {
    key: "situacao",
    label: "Situação",
    required: false,
    aliases: ["situacao_parecer", "situacao", "status"],
  },
  {
    key: "nr_parecer",
    label: "Nº do parecer",
    hint: "Identificador único do parecer no Tasy — usado para detectar parecer duplicado",
    required: false,
    aliases: [
      "nr_parecer",
      "numero_parecer",
      "n_parecer",
      "nr_parecer_paciente",
      "nr_sequencial_parecer",
      "parecer",
    ],
  },
  {
    key: "tempo_resposta",
    label: "Tempo de resposta",
    hint: "Única informação temporal confiável do relatório (a hora vem corrompida na origem)",
    required: false,
    aliases: [
      "tempo_resposta",
      "tempo_de_resposta",
      "tempo_resp",
      "tempo_resposta_parecer",
    ],
  },
];

const normHeader = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export function headerSignature(headers: string[]): string {
  return [...headers].map(normHeader).sort().join("|");
}

export function autoSuggestMapping(headers: string[]): ParecerMapping {
  const normMap = new Map<string, string>();
  for (const h of headers) normMap.set(normHeader(h), h);
  const out: ParecerMapping = {};
  for (const f of FIELDS) {
    for (const a of f.aliases) {
      const hit = normMap.get(normHeader(a));
      if (hit) {
        out[f.key] = hit;
        break;
      }
    }
  }
  return out;
}

const STORAGE_PREFIX = "parecer-col-template:";

export function loadSavedMapping(headers: string[]): ParecerMapping | null {
  try {
    const sig = headerSignature(headers);
    const raw = localStorage.getItem(STORAGE_PREFIX + sig);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // valida que os headers gravados ainda existem
    const out: ParecerMapping = {};
    const set = new Set(headers);
    for (const k of Object.keys(parsed)) {
      if (set.has(parsed[k])) out[k as ParecerFieldKey] = parsed[k];
    }
    return out;
  } catch {
    return null;
  }
}

export function saveMappingTemplate(headers: string[], mapping: ParecerMapping) {
  try {
    const sig = headerSignature(headers);
    localStorage.setItem(STORAGE_PREFIX + sig, JSON.stringify(mapping));
  } catch {}
}

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  headers: string[];
  sampleRow?: Record<string, any> | null;
  onApply: (mapping: ParecerMapping, saveAsTemplate: boolean) => void;
}

export default function ParecerColumnMappingDialog({
  open,
  onOpenChange,
  fileName,
  headers,
  sampleRow,
  onApply,
}: Props) {
  const initial = useMemo(
    () => loadSavedMapping(headers) ?? autoSuggestMapping(headers),
    [headers],
  );
  const [mapping, setMapping] = useState<ParecerMapping>(initial);

  useEffect(() => {
    if (open) setMapping(initial);
  }, [open, initial]);

  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key]);

  const setField = (k: ParecerFieldKey, v: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (v === NONE) delete next[k];
      else next[k] = v;
      return next;
    });
  };

  const sampleFor = (h?: string) => {
    if (!h || !sampleRow) return "—";
    const v = sampleRow[h];
    if (v == null || v === "") return "—";
    return String(v).slice(0, 60);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[90vw] lg:max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Mapeamento de colunas — Relatório de Parecer
          </DialogTitle>
          <DialogDescription>
            Confira como o sistema interpretou as colunas de{" "}
            <span className="font-medium text-foreground">{fileName}</span>.
            Ajuste se necessário — o mapeamento será salvo para esse formato
            de planilha e reaplicado nas próximas importações.
          </DialogDescription>
        </DialogHeader>

        {missingRequired.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Campos obrigatórios sem coluna</AlertTitle>
            <AlertDescription>
              {missingRequired.map((m) => m.label).join(" · ")}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Mapeamento OK</AlertTitle>
            <AlertDescription>
              Todos os campos obrigatórios foram identificados.
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 w-[32%]">Campo</th>
                <th className="py-2 px-3 w-[36%]">Coluna da planilha</th>
                <th className="py-2 pl-3">Exemplo</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => {
                const cur = mapping[f.key];
                return (
                  <tr key={f.key} className="border-b last:border-0">
                    <td className="py-2 pr-3 align-top">
                      <div className="font-medium flex items-center gap-1.5">
                        {f.label}
                        {f.required && (
                          <span className="text-destructive text-xs">*</span>
                        )}
                        {!cur && !f.required && (
                          <Badge variant="outline" className="text-[10px]">
                            opcional
                          </Badge>
                        )}
                      </div>
                      {f.hint && (
                        <div className="text-xs text-muted-foreground">
                          {f.hint}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <Select
                        value={cur ?? NONE}
                        onValueChange={(v) => setField(f.key, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground truncate max-w-[220px]">
                      {sampleFor(cur)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => onApply(mapping, true)}
            disabled={missingRequired.length > 0}
          >
            Aplicar e importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
