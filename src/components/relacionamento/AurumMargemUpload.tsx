// Upload de bases Aurum (margem por médico e por procedimento).
// Faz full-replace por hospital_id ativo a partir de XLSX no frontend.
import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, UserRound, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";

type TableName = "aurum_margem_medico" | "aurum_margem_procedimento";

// Mapeamento comum das 20 colunas quantitativas/dimensionais das planilhas Aurum.
const COMMON_MAP: Record<string, string> = {
  "Caráter": "carater",
  "Carater": "carater",
  "Período Internação": "periodo_internacao",
  "Periodo Internacao": "periodo_internacao",
  "Faturado": "faturado",
  "Ano": "ano",
  "Dias": "dias",
  "QTD Cirurgias": "qtd_cirurgias",
  "Receita": "receita",
  "Impostos": "impostos",
  "Glosa Externa": "glosa_externa",
  "Receita Líquida": "receita_liquida",
  "Receita Liquida": "receita_liquida",
  "Custo Total": "custo_total",
  "Margem": "margem",
  "% Margem": "pct_margem",
  "Custo OPME": "custo_opme",
  "Custo Mat/Med": "custo_mat_med",
  "Custo HM": "custo_hm",
  "Custo Exames Img": "custo_exames_img",
  "Custo Laboratorio": "custo_laboratorio",
  "Custo Laboratório": "custo_laboratorio",
  "Margem dia": "margem_dia",
  "Margem Dia": "margem_dia",
};

const NUMERIC_FIELDS = new Set([
  "dias", "qtd_cirurgias", "receita", "impostos", "glosa_externa",
  "receita_liquida", "custo_total", "margem", "pct_margem", "custo_opme",
  "custo_mat_med", "custo_hm", "custo_exames_img", "custo_laboratorio", "margem_dia",
]);

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "sim" || s === "s" || s === "true" || s === "1";
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Normaliza padrão brasileiro (1.234,56) e símbolos.
  const s = String(v).replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapRow(
  row: Record<string, unknown>,
  keyLabel: string,
  keyField: "medico_cirurgiao" | "ds_procedimento",
  hospitalId: string,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { hospital_id: hospitalId };
  const keyVal = String(row[keyLabel] ?? "").trim();
  if (!keyVal) return null;
  // Descarta linhas de rodapé do export Aurum ("Applied filters: ...")
  // que aparecem no fim da planilha e poluem os cadastros.
  if (/^applied\s+filters?\b/i.test(keyVal)) return null;
  out[keyField] = keyVal;

  for (const [label, field] of Object.entries(COMMON_MAP)) {
    if (!(label in row)) continue;
    const raw = row[label];
    if (field === "faturado") out[field] = toBool(raw);
    else if (field === "ano") {
      const n = toNumber(raw);
      out[field] = n !== null ? Math.round(n) : null;
    } else if (field === "carater" || field === "periodo_internacao") {
      out[field] = String(raw ?? "").trim() || "Todos";
    } else if (NUMERIC_FIELDS.has(field)) {
      out[field] = toNumber(raw);
    }
  }

  const ano = out.ano as number | null;
  if (!ano) return null;
  if (ano < 2020 || ano > 2030) {
    // não bloqueia — só sinaliza depois via toast agregado
    (out as { __anoAviso?: boolean }).__anoAviso = true;
  }
  return out;
}

interface UploadCardProps {
  title: string;
  icon: React.ReactNode;
  table: TableName;
  keyLabel: string;
  keyField: "medico_cirurgiao" | "ds_procedimento";
  hospitalId: string | null;
  onImported: () => void;
  count: number | null;
}

function UploadCard({
  title, icon, table, keyLabel, keyField, hospitalId, onImported, count,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!hospitalId) {
        toast.error("Selecione um hospital ativo antes de importar.");
        return;
      }
      setBusy(true);
      setProgress(null);
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "margem unificada")
          ?? wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) throw new Error("Planilha vazia ou sem sheet 'Margem Unificada'.");
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

        const mapped: Record<string, unknown>[] = [];
        let anoAvisos = 0;
        for (const r of rows) {
          const m = mapRow(r, keyLabel, keyField, hospitalId);
          if (!m) continue;
          if ((m as { __anoAviso?: boolean }).__anoAviso) {
            anoAvisos += 1;
            delete (m as { __anoAviso?: boolean }).__anoAviso;
          }
          mapped.push(m);
        }

        if (mapped.length === 0) {
          throw new Error(`Nenhuma linha válida encontrada (coluna-chave: ${keyLabel}).`);
        }

        // Full replace do hospital ativo.
        const { error: delErr } = await supabase
          .from(table as unknown as never)
          .delete()
          .eq("hospital_id", hospitalId);
        if (delErr) throw delErr;

        const CHUNK = 500;
        let done = 0;
        setProgress({ done: 0, total: mapped.length });
        for (let i = 0; i < mapped.length; i += CHUNK) {
          const slice = mapped.slice(i, i + CHUNK);
          const { error: insErr } = await supabase
            .from(table as unknown as never)
            .insert(slice as never);
          if (insErr) throw insErr;
          done += slice.length;
          setProgress({ done, total: mapped.length });
        }

        toast.success(`${title}: ${mapped.length} registros importados.`);
        if (anoAvisos > 0) {
          toast.warning(`${anoAvisos} linha(s) com Ano fora de 2020–2030.`);
        }
        onImported();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao importar planilha.";
        toast.error(msg);
      } finally {
        setBusy(false);
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [hospitalId, keyField, keyLabel, onImported, table, title],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <Badge variant="secondary">
          {count === null ? "—" : `${count.toLocaleString("pt-BR")} registros`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ler sheet <code>Margem Unificada</code>. A importação substitui toda a base
          Aurum deste hospital.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || !hospitalId}
          className="w-full sm:w-auto"
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {progress ? `Importando ${progress.done}/${progress.total}` : "Processando..."}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Atualizar base
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AurumMargemUpload() {
  const hospitalId = useEnforcedHospitalId();
  const [medicoCount, setMedicoCount] = useState<number | null>(null);
  const [procCount, setProcCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!hospitalId) {
      setMedicoCount(null);
      setProcCount(null);
      return;
    }
    const [m, p] = await Promise.all([
      supabase
        .from("aurum_margem_medico" as unknown as never)
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId),
      supabase
        .from("aurum_margem_procedimento" as unknown as never)
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId),
    ]);
    setMedicoCount((m as { count: number | null }).count ?? 0);
    setProcCount((p as { count: number | null }).count ?? 0);
  }, [hospitalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UploadCard
        title="Margem por Médico"
        icon={<UserRound className="h-4 w-4 text-primary" />}
        table="aurum_margem_medico"
        keyLabel="MEDICO_CIRURGIAO"
        keyField="medico_cirurgiao"
        hospitalId={hospitalId}
        onImported={refresh}
        count={medicoCount}
      />
      <UploadCard
        title="Margem por Procedimento"
        icon={<Stethoscope className="h-4 w-4 text-primary" />}
        table="aurum_margem_procedimento"
        keyLabel="DS_PROCEDIMENTO"
        keyField="ds_procedimento"
        hospitalId={hospitalId}
        onImported={refresh}
        count={procCount}
      />
    </div>
  );
}
