import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { addDaysYmd, competenceOfYmd, assertYmd } from "@/lib/dateUtils";
import { dbDateOrNull } from "@/lib/dateNormalize";
import {
  TVR_SOURCE,
  TVR_STATUS_LABEL,
  TVR_STATUS_TONE,
  TVR_STATUS_ORDER,
  brl,
  formatTvrDate,
  normTuss,
  isExcludedTvrTuss,
  normAtt,
  normDoctorName,
  effectiveTvrStatus,
  computeTvrCounts,
  mapTvrStatusToStoredClassification,
  isTvrResult,
  getAusenteTasyMissingFields,
  getTvrValorRecuperar,
  computeTvrFinancialTotals,
  computeTvrHeadlineTotals,
  describeTvrAcao,
  buildTvrReplaceSummary,
  type TasyRow,
  type PagRow,
  type TvrStatus,
  type TvrResult
} from "@/lib/tvr";
import {
  ArrowLeftIcon,
  PlayIcon,
  UploadCloudIcon,
  ChevronsUpDownIcon,
  SendIcon,
  LockIcon,
  ExternalLinkIcon,
  PercentIcon,
  PackageIcon,
  BanIcon,
  RotateCcwIcon,
  Search as SearchIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  ArrowDown as ArrowDownIcon,
  X as XIcon,
  Minus as MinusIcon,
  Building2 as Building2Icon
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { computeTvrRulePreview } from "@/lib/tvrRulePreview";
import { deriveTipoAnaliseFromCalcType, formatPrevistoSourceLabel } from "@/lib/tvrSimulationMapping";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RetroactiveMappingWizard, { readRawSheet, TASY_TARGETS } from "./RetroactiveMappingWizard";
import { learnCompanyAlias, shouldLearnAlias } from "@/lib/learnCompanyAlias";
import { type ReconMode, type ReconRow } from "./reconTypes";
import { getStoredMode } from "./reconModeStorage";
import { computeTvrResults, normCompanyName, normConvenio, type TvrCompanyIndex } from "@/lib/tvr/engine";
import { ListView } from "./ListView";
import { NewView } from "./NewView";
import { AlegacaoDetailView } from "./AlegacaoDetailView";
import { KeyAuditDialog } from "./KeyAuditDialog";
import { LoteScopeFilter } from "./LoteScopeFilter";
import { EncaminharApuracaoModal } from "./EncaminharApuracaoModal";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { ReavaliarVinculosDialog } from "./ReavaliarVinculosDialog";

/** Campo de data com input mascarado dd/mm/aaaa + botão de calendário. */











// Parsing de planilha agora vive em RetroactiveMappingWizard (readRawSheet + UI de mapeamento)

export default function RetroactiveReconciliationsTab() {
  const hospitalId = useActiveHospitalId();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const reconciliationParam = searchParams.get("reconciliation");
  const [view, setView] = useState<{ kind: "list" } | { kind: "detail"; id: string } | { kind: "new" }>(
    reconciliationParam ? { kind: "detail", id: reconciliationParam } : { kind: "list" },
  );

  useEffect(() => {
    if (reconciliationParam && (view.kind !== "detail" || view.id !== reconciliationParam)) {
      setView({ kind: "detail", id: reconciliationParam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconciliationParam]);

  const clearReconParam = () => {
    if (searchParams.has("reconciliation")) {
      const next = new URLSearchParams(searchParams);
      next.delete("reconciliation");
      setSearchParams(next, { replace: true });
    }
  };

  if (view.kind === "list")
    return <ListView onOpen={(id) => setView({ kind: "detail", id })} onNew={() => setView({ kind: "new" })} />;
  if (view.kind === "new")
    return (
      <NewView
        hospitalId={hospitalId}
        userId={user?.id ?? null}
        onCreated={(id) => setView({ kind: "detail", id })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  return <DetailView id={view.id} onBack={() => { clearReconParam(); setView({ kind: "list" }); }} />;
}

/* -------------------------- LIST -------------------------- */
function DetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [mode, setMode] = useState<ReconMode | null>(null);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("retroactive_reconciliations" as never)
        .select("summary")
        .eq("id", id)
        .single();
      const summary = (data as unknown as { summary?: { mode?: ReconMode } } | null)?.summary;
      const stored = getStoredMode(id);
      setMode(summary?.mode === "tasy_vs_repasse" ? "tasy_vs_repasse" : stored);
    })();
  }, [id]);
  if (!mode) return <Skeleton className="h-24 w-full" />;
  if (mode === "tasy_vs_repasse") {
    return <TasyVsRepasseView id={id} onBack={onBack} />;
  }
  return <AlegacaoDetailView id={id} onBack={onBack} />;
}

function TasyVsRepasseView({ id, onBack }: { id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; aliases: string[] }>>([]);
  const [tasyRows, setTasyRows] = useState<TasyRow[]>([]);
  const [tasyFile, setTasyFile] = useState<string>("");
  const [tasyFileTotals, setTasyFileTotals] = useState<{ file: number; valid: number; excluded: number; dropped: number } | null>(null);
  const [tasyDroppedExamples, setTasyDroppedExamples] = useState<Array<{ row_index: number; missing: string[] }>>([]);
  const [pagRows, setPagRows] = useState<PagRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [excludeTuss, setExcludeTuss] = useState<string>("");
  const [pendingTussExclude, setPendingTussExclude] = useState<string>("");
  const [excludedConvenios, setExcludedConvenios] = useState<string[]>([]);
  const [convenioFilterStats, setConvenioFilterStats] = useState<{ tasyRemoved: number; pagRemoved: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  type ProcStep = "cruzando" | "enriquecendo" | "salvando";
  const [procProgress, setProcProgress] = useState<{ step: ProcStep; current: number; total: number } | null>(null);
  const [results, setResults] = useState<TvrResult[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<TvrStatus>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Painel informativo — linhas TASY sem PJ resolvida ficam fora do escopo do lote,
  // mas o analista ainda pode vincular manualmente quando quiser incluí-las.
  const [unresolvedPjPanel, setUnresolvedPjPanel] = useState<
    Array<{ raw: string; count: number; missing: boolean }>
  >([]);
  const [pjMapDraft, setPjMapDraft] = useState<Record<string, string>>({});
  const [pjMapApplying, setPjMapApplying] = useState(false);
  const resultTopScrollRef = useRef<HTMLDivElement | null>(null);
  const resultTableScrollRef = useRef<HTMLDivElement | null>(null);
  const resultScrollSyncingRef = useRef(false);
  const [resultScrollWidth, setResultScrollWidth] = useState(1);
  // Redesign: quais grupos de PJ estão colapsados na lista agrupada.
  const [collapsedPjs, setCollapsedPjs] = useState<Set<string>>(new Set());
  const togglePjCollapsed = (pj: string) => {
    setCollapsedPjs((prev) => {
      const n = new Set(prev);
      if (n.has(pj)) n.delete(pj); else n.add(pj);
      return n;
    });
  };
  const [doctorInfo, setDoctorInfo] = useState<{ id: string | null; name: string | null; crm: string | null }>({ id: null, name: null, crm: null });
  const [hospitalIdRecon, setHospitalIdRecon] = useState<string | null>(null);
  const [encaminharOpen, setEncaminharOpen] = useState(false);
  const [keyAuditOpen, setKeyAuditOpen] = useState(false);
  const [encaminharBusy, setEncaminharBusy] = useState(false);
  const [reavaliarOpen, setReavaliarOpen] = useState(false);
  const [reavaliarBusy, setReavaliarBusy] = useState(false);
  const [groupDoctorsMap, setGroupDoctorsMap] = useState<Record<string, { full_name: string; crm: string | null }>>({});

  const [wizard, setWizard] = useState<
    | { kind: "none" }
    | { kind: "tasy"; fileName: string; headers: string[]; rows: Record<string, unknown>[] }
  >({ kind: "none" });

  const loadTvrReconciliation = async () => {
    const { data } = await supabase
      .from("retroactive_reconciliations" as never)
      .select("id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, hospital_id, source_payment_id, cost_center_code, analysis_mode")
      .eq("id", id)
      .single();
    const row = data as unknown as ReconRow;
    setRecon(row);
    if (row && row.summary?.mode !== "tasy_vs_repasse") {
      await supabase
        .from("retroactive_reconciliations" as never)
        .update({ summary: { ...(row.summary ?? {}), mode: "tasy_vs_repasse" } } as never)
        .eq("id", id);
    }
    setExcludeTuss(row?.summary?.exclude_tuss ?? "");
    setPendingTussExclude(row?.summary?.exclude_tuss ?? "");
    setExcludedConvenios(row?.summary?.excluded_convenios ?? []);
    setTasyFile(row?.summary?.tasy_file ?? "");
    setTasyFileTotals(row?.summary?.tasy_file_totals ?? null);
    setTasyDroppedExamples(row?.summary?.tasy_dropped_examples ?? []);

    // Pagina para escapar do teto default de 1000 linhas do PostgREST — sem
    // isso, apurações grandes ficam truncadas em "1000 de 1000".
    const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
    const savedItems = await fetchAllPaginated<{
      id: string;
      raw?: { tvr_result?: unknown };
      excluir_do_encaminhamento?: boolean | null;
      exclusion_reason?: TvrResult["exclusion_reason"] | null;
      exclusion_note?: string | null;
      generated_adjustment_id?: string | null;
      retroactive_target_company_id?: string | null;
      target_reassign_reason?: string | null;
    }>((from, to) =>
      supabase
        .from("retroactive_reconciliation_items" as never)
        .select("id, raw, excluir_do_encaminhamento, exclusion_reason, exclusion_note, generated_adjustment_id, retroactive_target_company_id, target_reassign_reason")
        .eq("reconciliation_id", id)
        .eq("source", TVR_SOURCE)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    const savedResults = savedItems
      .map((item) => {
        const tvr = item.raw?.tvr_result;
        if (!isTvrResult(tvr)) return null;
        return {
          ...tvr,
          excluir_do_encaminhamento: Boolean(item.excluir_do_encaminhamento),
          exclusion_reason: item.exclusion_reason ?? null,
          exclusion_note: item.exclusion_note ?? null,
          _retroReconRowId: item.id,
          _generatedAdjustmentId: item.generated_adjustment_id ?? null,
          retroactive_target_company_id: item.retroactive_target_company_id ?? null,
          target_reassign_reason: item.target_reassign_reason ?? null,
        } as TvrResult;
      })
      .filter((x): x is TvrResult => x !== null);
    if (savedResults.length > 0) {
      setResults(savedResults);
      setTasyRows(savedResults.filter((r) => r.status !== "ausente_tasy").map<TasyRow>((r) => ({
        tasy_atendimento: r.atendimento,
        tasy_tuss: r.tuss,
        tasy_qtd: String(r.qtd_tasy || 1),
        // Motor consome `tasy_valor_unit` como TOTAL da linha (tasyValueIsLineTotal=true).
        // Re-hidratando com valor_total_tasy garante recomputo estável e evita
        // deflação (unit ≠ total quando qtd > 1). `.toFixed(2)` também blinda
        // contra ambiguidade dot-thousand em números como 900.025.
        tasy_valor_unit: (Number(r.valor_total_tasy) || 0).toFixed(2),
        tasy_procedimento: r.procedimento,
        tasy_paciente: r.paciente,
        tasy_data: r.data,
        tasy_convenio: r.convenio,
        tasy_medico: r.medico,
        tasy_funcao: r.funcao,
        tasy_empresa: r.tasy_empresa,
        tasy_resolved_company_id: r.tasy_resolved_company_id ?? null,
      })));
      setPagRows(savedResults.filter((r) => r.status !== "nao_pago").map<PagRow>((r) => ({
        pag_atendimento: r.atendimento,
        pag_tuss: r.tuss,
        pag_qtd: String(r.qtd_por_func || 1),
        pag_valor_base: (Number(r.valor_pago_base) || 0).toFixed(2),
        pag_valor_com_acordo: (Number(r.valor_com_acordo) || 0).toFixed(2),
        pag_funcao: r.funcao || r.funcoes_pagas,
        pag_medico: r.medico,
        pag_data: r.data,
        pag_paciente: r.paciente,
        pag_convenio: r.convenio,
        pag_procedimento: r.procedimento,
        pag_lote: r.lotes,
        pag_payment_item_id: r.matched_payment_item_id,
        pag_payment_id: r.matched_payment_id,
      })));
      setPaymentsLoaded(true);
    }

    // Carrega info do médico (CRM/nome) para uso no encaminhamento → glosa.
    const rowAny = row as unknown as { hospital_id?: string | null };
    setHospitalIdRecon(rowAny?.hospital_id ?? null);
    if (row?.doctor_id) {
      const { data: doc } = await supabase
        .from("doctors" as never)
        .select("id, full_name, crm")
        .eq("id", row.doctor_id)
        .maybeSingle();
      const d = doc as unknown as { id: string; full_name: string | null; crm: string | null } | null;
      setDoctorInfo({ id: d?.id ?? row.doctor_id, name: d?.full_name ?? null, crm: d?.crm ?? null });
    } else {
      setDoctorInfo({ id: null, name: null, crm: null });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const rows = await fetchAllPaginated<{ id: string; name: string; aliases: string[] | null }>((from, to) =>
        supabase
          .from("companies")
          .select("id, name, aliases")
          .eq("active", true)
          .order("name")
          .range(from, to),
      );
      if (cancelled) return;
      setCompanies(rows.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] })));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadTvrReconciliation();
  }, [id]);

  const onPickTasy = async (file: File) => {
    try {
      const { headers, rows } = await readRawSheet(file);
      if (rows.length === 0) {
        toast({ title: "Planilha vazia", variant: "destructive" });
        return;
      }
      setPendingTussExclude(excludeTuss);
      setWizard({ kind: "tasy", fileName: file.name, headers, rows });
    } catch (e) {
      toast({ title: "Erro ao ler planilha", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const loadPaymentItems = async (currentRecon: ReconRow | null, sourceTasyRows = tasyRows) => {
    const r = currentRecon ?? recon;
    if (!r) return;
    setLoadingPayments(true);
    setPaymentsLoaded(false);
    try {
      // Janela operada 100% em Y-M-D — nunca passa por `new Date` para
      // evitar shift de fuso (ver `assertYmd` + `addDaysYmd` em dateUtils).
      assertYmd(r.period_start, "loadPaymentItems.period_start");
      assertYmd(r.period_end, "loadPaymentItems.period_end");

      // Escopo: individual (doctor/company do próprio row) ou multi_pj
      // (arrays em summary.multi_company_ids / summary.multi_doctor_ids).
      const multiCompanyIds = (r.summary?.multi_company_ids ?? []).filter(Boolean);
      const multiDoctorIds = (r.summary?.multi_doctor_ids ?? []).filter(Boolean);
      const isMulti = (r.summary?.scope === "multi_pj") && (multiCompanyIds.length > 0 || multiDoctorIds.length > 0);
      const hasScope = Boolean(r.doctor_id || r.company_id) || isMulti;
      const tasyAttendances = Array.from(new Set(sourceTasyRows.map((t) => t.tasy_atendimento).filter(Boolean)));

      // Se o analista fixou os lotes na apuração, apertamos a janela ao
      // período do lote (sem ±90d) — os payment_ids selecionados já delimitam
      // o universo, então ampliar a data só faz o Postgres varrer linhas
      // que serão descartadas depois. Sem lotes selecionados (compat antigo),
      // mantemos ±90d para pegar "pago em outro mês".
      const selectedPidsPre = (((r.summary as Record<string, unknown> | null)?.selected_payment_ids ?? []) as string[]).filter(Boolean);
      const hasSelectedLotes = selectedPidsPre.length > 0;
      const startYmd = hasSelectedLotes
        ? String(r.period_start).slice(0, 10)
        : (addDaysYmd(r.period_start, -90) ?? String(r.period_start).slice(0, 10));
      const endYmd = hasSelectedLotes
        ? String(r.period_end).slice(0, 10)
        : (addDaysYmd(r.period_end, 90) ?? String(r.period_end).slice(0, 10));
      const endExclusiveYmd = addDaysYmd(endYmd, 1) ?? endYmd;

      if (!hasScope && tasyAttendances.length === 0) {
        toast({
          title: "Sem escopo definido",
          description: "Esta apuração não tem médico nem PJ. Carregue primeiro a base TASY — vamos usar os atendimentos dela como filtro.",
          variant: "destructive",
        });
        return;
      }

      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      let data: Array<Record<string, unknown>> = [];
      try {
        // Se não há médico/PJ, filtra por chunks de attendance_number (limite ~500 por IN)
        if (!hasScope) {
          const CHUNK = 500;
          for (let i = 0; i < tasyAttendances.length; i += CHUNK) {
            const chunk = tasyAttendances.slice(i, i + CHUNK);
            const part = await fetchAllPaginated<Record<string, unknown>>((from, to) =>
              supabase
                .from("payment_items" as never)
                .select("id, attendance_number, procedure_code, quantity, procedure_amount, expected_amount, doctor_role, doctor_name, doctor_id, procedure_date, patient_name, procedure_name, convenio_slug, payment_id, company_id, applied_rule_id, applied_rule_label, applied_calc_id, applied_calc_method")
                .gte("procedure_date", startYmd)
                .lt("procedure_date", endExclusiveYmd)
                .in("attendance_number", chunk)
                .range(from, to),
            );
            data.push(...part);
          }
        } else {
          data = await fetchAllPaginated<Record<string, unknown>>((from, to) => {
            let q = supabase
              .from("payment_items" as never)
              .select("id, attendance_number, procedure_code, quantity, procedure_amount, expected_amount, doctor_role, doctor_name, doctor_id, procedure_date, patient_name, procedure_name, convenio_slug, payment_id, company_id, applied_rule_id, applied_rule_label, applied_calc_id, applied_calc_method");
            if (hasSelectedLotes) {
              // Lote define o universo de PAGAMENTOS, mas o eixo de
              // COMPETÊNCIA continua sendo o período da apuração. Itens
              // realizados em competências anteriores (ex.: março pago em
              // abril) NÃO devem entrar — pertencem à apuração da própria
              // competência de origem. Mantém filtro por procedure_date.
              q = q.in("payment_id", selectedPidsPre)
                .gte("procedure_date", startYmd)
                .lt("procedure_date", endExclusiveYmd);
            } else {
              q = q.gte("procedure_date", startYmd).lt("procedure_date", endExclusiveYmd);
            }


            if (isMulti) {
              if (multiCompanyIds.length > 0) q = q.in("company_id", multiCompanyIds);
              if (multiDoctorIds.length > 0) q = q.in("doctor_id", multiDoctorIds);
            } else {
              if (r.doctor_id) q = q.eq("doctor_id", r.doctor_id);
              if (r.company_id) q = q.eq("company_id", r.company_id);
            }
            return q.range(from, to);
          });
        }
      } catch (error: any) {
        toast({ title: "Erro ao buscar pagamentos", description: error?.message ?? String(error), variant: "destructive" });
        return;
      }


      const rawItemsAll = data;
      const paymentIds = Array.from(new Set(rawItemsAll.map((it) => String(it.payment_id ?? "")).filter(Boolean)));
      const loteByPaymentId = new Map<string, string>();
      const compByPaymentId = new Map<string, string>();
      if (paymentIds.length > 0) {
        const { data: paymentsData } = await supabase
          .from("payments" as never)
          .select("id, reference, competence_month")
          .in("id", paymentIds);
        for (const p of (paymentsData ?? []) as Array<Record<string, unknown>>) {
          const ref = String(p.reference ?? "").trim();
          const comp = p.competence_month ? String(p.competence_month).slice(0, 7) : "";
          const label = ref || (comp ? `Comp. ${comp}` : String(p.id).slice(0, 8));
          loteByPaymentId.set(String(p.id), label);
          if (comp) compByPaymentId.set(String(p.id), comp);
        }
      }

      // Filtra por lote: se a apuração persistiu selected_payment_ids, foca
      // estritamente nesses lotes (fluxo novo). Caso contrário, cai no filtro
      // por competência (compat com apurações antigas).
      const selectedPidsSummary = ((r.summary as Record<string, unknown> | null)?.selected_payment_ids ?? []) as string[];
      const selectedPidsSet = new Set(selectedPidsSummary.filter(Boolean));
      let rawItems: typeof rawItemsAll;
      let dropReason = "";
      if (selectedPidsSet.size > 0) {
        rawItems = rawItemsAll.filter((it) => selectedPidsSet.has(String(it.payment_id ?? "")));
        const dropped = rawItemsAll.length - rawItems.length;
        if (dropped > 0) dropReason = ` · ${dropped} fora dos lotes selecionados`;
      } else {
        const targetCompetence = competenceOfYmd(r.period_start) ?? "";
        rawItems = targetCompetence
          ? rawItemsAll.filter((it) => {
              const pid = String(it.payment_id ?? "");
              if (!pid) return false;
              return compByPaymentId.get(pid) === targetCompetence;
            })
          : rawItemsAll;
        const dropped = rawItemsAll.length - rawItems.length;
        if (dropped > 0) dropReason = ` · ${dropped} descartado(s) fora da competência ${targetCompetence}`;
      }

      const rows: PagRow[] = rawItems.map((row) => ({
        pag_atendimento: normAtt(String(row.attendance_number ?? "")),
        pag_tuss: normTuss(String(row.procedure_code ?? "")),
        pag_qtd: String(row.quantity ?? "1"),
        pag_valor_base: String(row.procedure_amount ?? "0"),
        pag_valor_com_acordo: String(row.expected_amount ?? "0"),
        pag_funcao: (row.doctor_role as string) ?? "",
        pag_medico: (row.doctor_name as string) ?? "",
        pag_data: (row.procedure_date as string) ?? "",
        pag_paciente: (row.patient_name as string) ?? "",
        pag_convenio: (row.convenio_slug as string) ?? "",
        pag_procedimento: (row.procedure_name as string) ?? "",
        pag_lote: loteByPaymentId.get(String(row.payment_id ?? "")) ?? "",
        pag_payment_item_id: row.id ? String(row.id) : "",
        pag_payment_id: row.payment_id ? String(row.payment_id) : "",
        pag_doctor_id: row.doctor_id ? String(row.doctor_id) : "",
        pag_company_id: row.company_id ? String(row.company_id) : "",
        pag_applied_rule_id: row.applied_rule_id ? String(row.applied_rule_id) : "",
        pag_applied_rule_label: row.applied_rule_label ? String(row.applied_rule_label) : "",
        pag_applied_calc_id: row.applied_calc_id ? String(row.applied_calc_id) : "",
        pag_applied_calc_method: row.applied_calc_method ? String(row.applied_calc_method) : "",
      })).filter((x) => x.pag_atendimento && x.pag_tuss);

      setPagRows(rows);
      setPaymentsLoaded(true);
      toast({ title: `${rows.length} item(ns) carregados do sistema${dropReason}` });
      return rows;
    } finally {
      setLoadingPayments(false);
    }
  };

  const confirmTasy = (
    drafts: Record<string, string>[],
    meta?: {
      mapping: Record<string, string>;
      totals: { file: number; valid: number; excluded: number; dropped: number };
      droppedExamples: Array<{ row_index: number; missing: string[] }>;
      companyMapping?: Record<string, string | null>;
    },
  ) => {
    const companyMapping = meta?.companyMapping ?? {};
    const excluded = new Set(
      pendingTussExclude
        .split(",")
          .map((s) => normTuss(s.trim()))
        .filter(Boolean),
    );
    setExcludeTuss(pendingTussExclude);
    const filtered = drafts
      .filter((d) => !isExcludedTvrTuss(d.tuss_code, excluded))
      .map<TasyRow>((d) => ({
        tasy_atendimento: normAtt(d.tasy_atendimento || d.attendance),
        tasy_tuss: normTuss(d.tasy_tuss || d.tuss_code),
        tasy_qtd: d.tasy_qtd || "1",
        tasy_valor_unit: d.tasy_valor_unit || "0",
        tasy_procedimento: d.tasy_procedimento,
        tasy_paciente: d.tasy_paciente,
        tasy_data: d.tasy_data,
        tasy_convenio: d.tasy_convenio,
        tasy_medico: d.tasy_medico,
        tasy_funcao: d.tasy_funcao,
        tasy_empresa: d.tasy_empresa,
        tasy_resolved_company_id: d.tasy_empresa ? companyMapping[d.tasy_empresa] ?? null : null,
      }))
      .filter((r) => r.tasy_atendimento && r.tasy_tuss);
    setTasyRows(filtered);
    const fileName = (wizard.kind === "tasy" && wizard.fileName) || "";
    setTasyFile(fileName);
    if (meta?.totals) setTasyFileTotals(meta.totals);
    if (meta?.droppedExamples) setTasyDroppedExamples(meta.droppedExamples);
    setResults(null);
    setWizard({ kind: "none" });
    toast({ title: `TASY: ${filtered.length} de ${meta?.totals.file ?? filtered.length} linha(s) carregadas` });
    void (async () => {
      if (!meta?.companyMapping) return;
      const entries = Object.entries(meta.companyMapping);
      let learned = 0;
      const { data: companyRows } = await supabase
        .from("companies" as never)
        .select("id, name, aliases")
        .in("id", entries.map(([, companyId]) => companyId).filter(Boolean) as string[]);
      const companyById = new Map(
        ((companyRows ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>).map((c) => [c.id, c]),
      );
      for (const [rawName, companyId] of entries) {
        if (!companyId) continue;
        const company = companyById.get(companyId);
        if (!company || !shouldLearnAlias(rawName, company)) continue;
        const res = await learnCompanyAlias(supabase, { companyId, rawName });
        if (res.ok) learned++;
      }
      if (recon && entries.length > 0) {
        const nextSummary = {
          ...(recon.summary ?? {}),
          tasy_company_mapping: meta.companyMapping,
        };
        await supabase
          .from("retroactive_reconciliations" as never)
          .update({ summary: nextSummary } as never)
          .eq("id", id);
      }
      if (learned > 0) toast({ title: `${learned} apelido(s) de PJ aprendido(s) para próximas importações` });
    })();
    // Dispara busca automática dos payment_items
    void loadPaymentItems(recon, filtered);
  };



  /**
   * Aplica o mapeamento manual feito no painel "PJs TASY não vinculadas":
   * atualiza tasy_resolved_company_id em memória, aprende aliases no cadastro
   * e persiste em summary.tasy_company_mapping — sem reabrir o wizard.
   */
  const applyPjMapDraft = async () => {
    const entries = Object.entries(pjMapDraft).filter(([raw, cid]) => raw && cid && raw !== "(vazio)");
    if (entries.length === 0) {
      toast({ title: "Selecione ao menos uma PJ para vincular", variant: "destructive" });
      return;
    }
    setPjMapApplying(true);
    try {
      const rawToCid = new Map(entries);
      // 1) Atualiza tasyRows em memória
      setTasyRows((prev) =>
        prev.map((r) => {
          const rawEmp = String(r.tasy_empresa ?? "").trim();
          const cid = rawEmp ? rawToCid.get(rawEmp) : undefined;
          return cid ? { ...r, tasy_resolved_company_id: cid } : r;
        }),
      );
      // 2) Aprende alias no cadastro estadual (para próximas importações)
      const companyIds = Array.from(new Set(entries.map(([, cid]) => cid).filter(Boolean)));
      const { data: companyRows } = await supabase
        .from("companies" as never)
        .select("id, name, aliases")
        .in("id", companyIds);
      const companyById = new Map(
        ((companyRows ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>).map((c) => [c.id, c]),
      );
      let learned = 0;
      for (const [rawName, companyId] of entries) {
        const company = companyById.get(companyId);
        if (!company || !shouldLearnAlias(rawName, company)) continue;
        const res = await learnCompanyAlias(supabase, { companyId, rawName });
        if (res.ok) learned++;
      }
      // 3) Persiste no summary da apuração para sobreviver a recarregamentos
      if (recon) {
        const prevMap = ((recon.summary as Record<string, unknown> | null)?.tasy_company_mapping ?? {}) as Record<string, string>;
        const nextMap = { ...prevMap, ...Object.fromEntries(entries) };
        const nextSummary = { ...(recon.summary ?? {}), tasy_company_mapping: nextMap };
        await supabase
          .from("retroactive_reconciliations" as never)
          .update({ summary: nextSummary } as never)
          .eq("id", id);
      }
      setUnresolvedPjPanel([]);
      setPjMapDraft({});
      toast({
        title: `${entries.length} PJ(s) vinculada(s)${learned > 0 ? ` · ${learned} apelido(s) aprendido(s)` : ""}`,
        description: "Clique em Processar para rodar novamente com o escopo corrigido.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao aplicar mapeamentos", description: msg, variant: "destructive" });
    } finally {
      setPjMapApplying(false);
    }
  };

  const clearAll = async () => {
    const preservedSummary = (recon?.summary ?? {}) as Record<string, unknown>;
    setTasyRows([]);
    setTasyFile("");
    setTasyFileTotals(null);
    setTasyDroppedExamples([]);
    setPagRows([]);
    setPaymentsLoaded(false);
    setResults(null);
    setExcludeTuss("");
    setPendingTussExclude("");
    await supabase
      .from("retroactive_reconciliation_items" as never)
      .delete()
      .eq("reconciliation_id", id)
      .eq("source", TVR_SOURCE);
    const { error } = await supabase
      .from("retroactive_reconciliations" as never)
      .update({
        summary: {
          ...preservedSummary,
          mode: "tasy_vs_repasse",
          total: 0,
          total_gap: 0,
          total_excess: 0,
          tasy_file: "",
          exclude_tuss: "",
          tvr_counts: computeTvrCounts([]),
        },
      } as never)
      .eq("id", id);
    if (error) toast({ title: "Erro ao limpar resultado salvo", description: error.message, variant: "destructive" });
  };

  // A normalização de convênio vem do motor (`normConvenio`): a chave desta
  // lista PRECISA ser a mesma que o motor usa para excluir, senão o que o
  // analista marca aqui não bate com o que é filtrado lá.
  const availableConvenios = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    const add = (raw: unknown) => {
      const label = String(raw ?? "").trim();
      if (!label) return;
      const key = normConvenio(label);
      if (!key) return;
      const cur = map.get(key);
      if (cur) { cur.count += 1; }
      else { map.set(key, { key, label, count: 1 }); }
    };
    for (const r of tasyRows) add(r.tasy_convenio);
    for (const r of pagRows) add(r.pag_convenio);
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [tasyRows, pagRows]);


  const process = (pagRowsOverride?: PagRow[]) => {
    // Defesa em profundidade: o botão já vem disabled quando isLocked,
    // mas atalho/mobile/chamada programática pode driblar o disabled.
    if (recon?.summary && (recon.summary as { handoff?: unknown }).handoff) {
      toast({
        title: "Apuração encaminhada",
        description: "Desfaça o encaminhamento antes de processar novamente.",
        variant: "destructive",
      });
      return;
    }
    const effectivePagRows = pagRowsOverride ?? pagRows;
    if (tasyRows.length === 0 || effectivePagRows.length === 0) {
      toast({ title: "Carregue o TASY e aguarde a busca dos pagamentos do sistema", variant: "destructive" });
      return;
    }
    setProcessing(true);
    setProcProgress({ step: "cruzando", current: 0, total: tasyRows.length + effectivePagRows.length });
    setTimeout(async () => {
      // Índice de PJs cadastradas — único IO que o motor precisa receber pronto.
      const companyIndex: TvrCompanyIndex = { byDoc: new Map(), byName: new Map() };
      try {
        const { data: companiesData } = await supabase
          .from("companies" as never)
          .select("id, name, document, aliases");
        for (const c of (companiesData ?? []) as Array<Record<string, unknown>>) {
          const docDigits = String(c.document ?? "").replace(/\D+/g, "");
          const cid = String(c.id ?? "");
          if (!cid) continue;
          if (docDigits) companyIndex.byDoc.set(docDigits, cid);
          const nn = normCompanyName(c.name);
          if (nn && !companyIndex.byName.has(nn)) companyIndex.byName.set(nn, cid);
          const aliases = Array.isArray(c.aliases) ? c.aliases : [];
          for (const alias of aliases) {
            const aliasKey = normCompanyName(alias);
            if (aliasKey && !companyIndex.byName.has(aliasKey)) companyIndex.byName.set(aliasKey, cid);
          }
        }
      } catch (e) {
        console.warn("TVR: falha carregando companies para resolver empresa do TASY", e);
      }

      const summaryScope = (recon?.summary as Record<string, unknown> | null) ?? {};
      const { results: out, diagnostics, appliedCalcIdByKey } = computeTvrResults({
        tasyRows,
        pagRows: effectivePagRows,
        excludeTuss,
        excludedConvenios,
        companyIndex,
        recon: recon
          ? {
              period_start: recon.period_start,
              period_end: recon.period_end,
              company_id: recon.company_id,
              scope: summaryScope.scope,
              multi_company_ids: (summaryScope.multi_company_ids as string[] | undefined) ?? [],
            }
          : null,
      });

      // Painel informativo (não bloqueia): permite ao analista mapear PJs
      // cruas a cadastros quando quiser resgatar essas linhas para o lote.
      if (diagnostics.tasyMissingCompany > 0 || diagnostics.tasyUnresolvedCompany > 0) {
        setUnresolvedPjPanel(diagnostics.unresolvedPjSamples);
        setPjMapDraft((prev) => prev ?? {});
        toast({
          title: "Algumas linhas TASY ficaram fora do escopo",
          description: `${diagnostics.tasyMissingCompany + diagnostics.tasyUnresolvedCompany} linha(s) com PJ não vinculada foram ignoradas. Use o painel para mapear se precisar incluí-las.`,
        });
      } else {
        setUnresolvedPjPanel([]);
      }

      if (diagnostics.effectiveTasyCount === 0 && diagnostics.companyTasyRemoved === 0) {
        toast({
          title: "Nenhuma linha TASY dentro do escopo",
          description: "Revise o período selecionado e a coluna de data da planilha antes de processar.",
          variant: "destructive",
        });
        setProcessing(false); setProcProgress(null);
        return;
      }

      // Etapa 2: enriquecimento de PJ e labels de regra (queries auxiliares).
      setProcProgress({ step: "enriquecendo", current: 0, total: out.length });

      // Enriquecer com nome da PJ e label da linha de cálculo aplicada
      try {
        const companyIds = Array.from(new Set(out.map((r) => r.matched_company_id).filter(Boolean))) as string[];
        const calcIds = Array.from(new Set(out.map((r) => appliedCalcIdByKey.get(r.key) || "").filter(Boolean))) as string[];
        const companyNameById = new Map<string, string>();
        const calcLabelById = new Map<string, string>();
        if (companyIds.length > 0) {
          const { data: comps } = await supabase.from("companies").select("id, name").in("id", companyIds);
          for (const c of comps ?? []) if (c?.id) companyNameById.set(String(c.id), String((c as { name?: string }).name ?? ""));
        }
        if (calcIds.length > 0) {
          const { data: calcs } = await supabase.from("rule_calculations").select("id, label, sort_order, calculation_type").in("id", calcIds);
          for (const c of calcs ?? []) {
            if (!c?.id) continue;
            const cc = c as { id: string; label?: string | null; sort_order?: number | null; calculation_type?: string | null };
            const label = (cc.label ?? "").trim();
            const idx = typeof cc.sort_order === "number" ? cc.sort_order + 1 : null;
            const method = cc.calculation_type ?? "";
            calcLabelById.set(String(cc.id), [idx ? `#${idx}` : "", label, method ? `(${method})` : ""].filter(Boolean).join(" "));
          }
        }
        for (const r of out) {
          if (r.matched_company_id) r.pj_conciliada = companyNameById.get(r.matched_company_id) || undefined;
          const cid = appliedCalcIdByKey.get(r.key);
          if (cid) r.calculo_aplicado = calcLabelById.get(cid) || undefined;
        }
      } catch (e) {
        // não bloqueia processamento se enriquecimento falhar
        console.warn("Falha ao enriquecer PJ/regra:", e);
      }

      try {
        // Etapa 3: persistência em lotes — progresso vem do callback do persistResults.
        setProcProgress({ step: "salvando", current: 0, total: out.length });
        await persistResults(out, (saved, total) => {
          setProcProgress({ step: "salvando", current: saved, total });
        });
        setResults(out);
        const hasConvFilter = excludedConvenios.map((k) => normConvenio(k)).filter(Boolean).length > 0;
        setConvenioFilterStats(hasConvFilter ? { tasyRemoved: diagnostics.convTasyRemoved, pagRemoved: diagnostics.convPagRemoved } : null);
        setSelectedKeys(new Set());
        await loadTvrReconciliation();
        const companyMsg = diagnostics.companyTasyRemoved > 0 ? ` · ${diagnostics.companyTasyRemoved} linha(s) TASY fora do escopo de PJ` : "";
        const periodMsg = diagnostics.tasyOutOfPeriodRemoved + diagnostics.tasyMissingDateRemoved > 0
          ? ` · ${diagnostics.tasyOutOfPeriodRemoved + diagnostics.tasyMissingDateRemoved} linha(s) TASY fora do período/sem data`
          : "";
        toast({ title: `Processamento concluído · ${out.length} linha(s) salvas${companyMsg}${periodMsg}` });
      } catch (e) {
        const msg = e instanceof Error
          ? e.message
          : (e && typeof e === "object" && "message" in e && typeof (e as { message?: unknown }).message === "string")
            ? (e as { message: string }).message
            : JSON.stringify(e);
        toast({ title: "Erro ao salvar resultado", description: msg, variant: "destructive" });
      } finally {
        setProcessing(false); setProcProgress(null);
        setProcProgress(null);
      }
    }, 50);
  };

  const [onlyWithPayment, setOnlyWithPayment] = useState(false);
  // Filtros multi-seleção por PJ e Médico. Chave = nome (case-insensitive) já
  // que o mesmo médico/PJ pode aparecer com pequenas variações de grafia.
  const [pjFilter, setPjFilter] = useState<Set<string>>(new Set());
  const [medicoFilter, setMedicoFilter] = useState<Set<string>>(new Set());
  const pjKeyOf = (r: TvrResult) => (r.pj_conciliada || r.pj_provavel || "").trim();
  const medicoKeyOf = (r: TvrResult) => (r.medico || "").trim();


  // Sub-aba da tabela de resultados: separa itens onde faz sentido comparar R$ (valor)
  // dos que só faz sentido comparar presença/quantidade (pacote/valor fixo/tabela diferenciada).
  // Persiste em URL como ?analise=valor|presenca.
  const analysisParam = searchParams.get("analise");
  const analysisTab: "valor" | "quantidade" =
    analysisParam === "presenca" || analysisParam === "quantidade" ? "quantidade" : "valor";
  const setAnalysisTab = (v: "valor" | "quantidade") => {
    const next = new URLSearchParams(searchParams);
    next.set("analise", v === "quantidade" ? "presenca" : "valor");
    setSearchParams(next, { replace: true });
  };

  // Linhas expandidas para mostrar os campos técnicos ocultos no modo compacto.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const countsByTipo = useMemo(() => {
    const c = { valor: 0, quantidade: 0 };
    for (const r of results ?? []) c[r.tipo_analise]++;
    return c;
  }, [results]);

  // Aplica os mesmos filtros de status/busca/apenas com pagamento, opcionalmente
  // ignorando o filtro por tipo de análise (usado no export "duas abas").
  const applyVisibleFilters = (rows: TvrResult[], opts?: { ignoreAnalysisTab?: boolean }) => {
    const hasFilter = statusFilter.size > 0;
    const showOk = statusFilter.has("ok");
    const q = search.trim().toLowerCase();
    const hasPj = pjFilter.size > 0;
    const hasMed = medicoFilter.size > 0;
    return rows.filter((r) => {
      const eff = effectiveTvrStatus(r);
      if (eff === "ok" && !showOk) return false;
      if (!opts?.ignoreAnalysisTab && r.tipo_analise !== analysisTab) return false;
      if (hasFilter && !statusFilter.has(eff)) return false;
      if (onlyWithPayment && eff === "nao_pago") return false;
      if (hasPj && !pjFilter.has(pjKeyOf(r).toLowerCase())) return false;
      if (hasMed && !medicoFilter.has(medicoKeyOf(r).toLowerCase())) return false;
      if (q) {
        const hay = `${r.atendimento} ${r.tuss} ${r.procedimento} ${r.paciente} ${r.medico} ${r.convenio} ${r.funcao} ${r.funcoes_pagas} ${r.lotes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  const visible = useMemo(
    () => applyVisibleFilters(results ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, statusFilter, search, onlyWithPayment, analysisTab, pjFilter, medicoFilter],
  );

  // Contadores por tipo IGNORANDO a sub-aba (mas respeitando busca / status /
  // PJ / médico / apenas com pagamento). Usados no menu Exportar para o
  // analista saber quantos itens sairiam em cada arquivo por tipo.
  const filteredIgnoringTab = useMemo(
    () => (results ? applyVisibleFilters(results, { ignoreAnalysisTab: true }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, statusFilter, search, onlyWithPayment, pjFilter, medicoFilter],
  );
  const visibleByTipo = useMemo(() => {
    const c = { valor: 0, quantidade: 0 };
    for (const r of filteredIgnoringTab) c[r.tipo_analise]++;
    return c;
  }, [filteredIgnoringTab]);

  // Opções dos filtros PJ e Médico — extraídas da sub-aba atual para não
  // poluir a lista com valores de outra análise.
  const pjOptions = useMemo(() => {
    const map = new Map<string, string>(); // key (lower) → label (original)
    for (const r of results ?? []) {
      if (r.tipo_analise !== analysisTab) continue;
      const label = pjKeyOf(r);
      if (!label) continue;
      const k = label.toLowerCase();
      if (!map.has(k)) map.set(k, label);
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [results, analysisTab]);

  const medicoOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results ?? []) {
      if (r.tipo_analise !== analysisTab) continue;
      const label = medicoKeyOf(r);
      if (!label) continue;
      const k = label.toLowerCase();
      if (!map.has(k)) map.set(k, label);
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [results, analysisTab]);






  const getResultHorizontalScrollElement = () => {
    const outerEl = resultTableScrollRef.current;
    if (!outerEl) return null;

    const tableWrapper = outerEl.firstElementChild;
    if (tableWrapper instanceof HTMLElement && tableWrapper.scrollWidth > tableWrapper.clientWidth + 1) {
      return tableWrapper;
    }

    return outerEl;
  };

  useEffect(() => {
    if (!results) return;
    const outerEl = resultTableScrollRef.current;
    const scrollEl = getResultHorizontalScrollElement();
    if (!outerEl || !scrollEl) return;

    const updateScrollWidth = () => {
      const currentScrollEl = getResultHorizontalScrollElement();
      if (!currentScrollEl) return;
      setResultScrollWidth(Math.max(currentScrollEl.scrollWidth, currentScrollEl.clientWidth, 1));
      if (resultTopScrollRef.current) resultTopScrollRef.current.scrollLeft = currentScrollEl.scrollLeft;
    };

    const syncFromTable = () => {
      if (resultScrollSyncingRef.current) return;
      const top = resultTopScrollRef.current;
      const currentScrollEl = getResultHorizontalScrollElement();
      if (!top || !currentScrollEl) return;
      resultScrollSyncingRef.current = true;
      top.scrollLeft = currentScrollEl.scrollLeft;
      resultScrollSyncingRef.current = false;
    };

    updateScrollWidth();

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollWidth) : null;
    resizeObserver?.observe(outerEl);
    resizeObserver?.observe(scrollEl);
    if (scrollEl.firstElementChild) resizeObserver?.observe(scrollEl.firstElementChild);
    scrollEl.addEventListener("scroll", syncFromTable, { passive: true });
    window.addEventListener("resize", updateScrollWidth);

    return () => {
      resizeObserver?.disconnect();
      scrollEl.removeEventListener("scroll", syncFromTable);
      window.removeEventListener("resize", updateScrollWidth);
    };
  }, [results, visible.length, statusFilter, search, onlyWithPayment]);

  const syncResultScroll = (source: "top" | "table") => {
    const top = resultTopScrollRef.current;
    const table = getResultHorizontalScrollElement();
    if (!top || !table) return;
    if (resultScrollSyncingRef.current) return;
    // Reidrata a largura a cada scroll: cobre casos onde o conteúdo cresce
    // depois do primeiro layout (linhas carregadas sob demanda, colunas que
    // dependem de dados assíncronos) sem depender apenas do ResizeObserver.
    const currentWidth = Math.max(table.scrollWidth, table.clientWidth, 1);
    setResultScrollWidth((prev) => (Math.abs(prev - currentWidth) > 1 ? currentWidth : prev));
    resultScrollSyncingRef.current = true;
    if (source === "top") {
      table.scrollLeft = top.scrollLeft;
      top.scrollLeft = table.scrollLeft;
    } else {
      top.scrollLeft = table.scrollLeft;
    }
    resultScrollSyncingRef.current = false;
  };

  const nudgeResultScroll = (direction: -1 | 1) => {
    const table = getResultHorizontalScrollElement();
    if (!table) return;
    // Passo dinâmico: ~80% da área visível, com piso de 320px.
    const step = Math.max(320, Math.floor(table.clientWidth * 0.8));
    table.scrollBy({ left: direction * step, behavior: "smooth" });
    requestAnimationFrame(() => syncResultScroll("table"));
  };

  const counts = useMemo(() => {
    const c: Record<TvrStatus, number> = {
      nao_pago: 0, div_qtd_valor: 0, div_valor: 0, pago_a_mais: 0, ausente_tasy: 0, ok: 0,
    };
    for (const r of results ?? []) c[effectiveTvrStatus(r)]++;
    return c;
  }, [results]);


  // ============================================================
  // Export: definimos colunas em um array único (grupo + cabeçalho + valor).
  // No XLSX viramos isso em 2 linhas de cabeçalho com merge das colunas do
  // mesmo grupo — no Excel isso é o formato nativo pra "agrupar sem sujar
  // o nome da coluna". No CSV/JSON o grupo entra como coluna separada
  // (não dá pra fazer merge), o que é mais limpo do que o antigo prefixo
  // "GRUPO · Nome" que empoluía o cabeçalho em qualquer visualização.
  // ============================================================
  type ExportCol = { group: string; header: string; get: (r: TvrResult) => string | number };
  const EXPORT_COLS: ExportCol[] = [
    // Item — flags de status/análise, sem duplicar PJ/médico (que agora abrem Contexto).
    { group: "Item", header: "Status", get: (r) => TVR_STATUS_LABEL[r.status] },
    { group: "Item", header: "Tipo de análise", get: (r) => r.tipo_analise === "quantidade" ? "Quantidade (tabela própria)" : "Valor (% convênio)" },
    { group: "Item", header: "Sem lastro TASY", get: (r) => r.sem_lastro_tasy ? "Sim" : "" },
    // Contexto — PJ e Médico primeiro (quem), depois atendimento/procedimento (o quê/quando).
    // "PJ" espelha a UI: mostra a PJ conciliada quando existe; para Faltou pagar
    // sem lastro, mostra a PJ provável com prefixo "[prev.]" (equivalente ao
    // badge amarelo). Assim analista abre o XLSX e enxerga o mesmo texto da tela.
    { group: "Contexto", header: "PJ", get: (r) => r.pj_conciliada ? r.pj_conciliada : (r.status === "nao_pago" && r.pj_provavel ? `[prev.] ${r.pj_provavel}` : "") },
    { group: "Contexto", header: "Médico", get: (r) => r.medico },
    { group: "Contexto", header: "Atendimento", get: (r) => r.atendimento },
    { group: "Contexto", header: "Cód. TUSS", get: (r) => r.tuss },
    { group: "Contexto", header: "Procedimento", get: (r) => r.procedimento },
    { group: "Contexto", header: "Paciente", get: (r) => r.paciente },
    { group: "Contexto", header: "Data", get: (r) => formatTvrDate(r.data) },
    { group: "Contexto", header: "Convênio", get: (r) => r.convenio },
    { group: "Contexto", header: "Função", get: (r) => r.funcao },

    // TASY hoje (100% convênio)
    { group: "TASY hoje (100% convênio)", header: "Qtd", get: (r) => r.qtd_tasy },
    { group: "TASY hoje (100% convênio)", header: "Vlr unitário", get: (r) => r.valor_unit_tasy },
    { group: "TASY hoje (100% convênio)", header: "Vlr total", get: (r) => r.valor_total_tasy },
    // Lote histórico
    { group: "Lote histórico", header: "Qtd paga por função", get: (r) => Number(r.qtd_por_func.toFixed(4)) },
    { group: "Lote histórico", header: "Nº de funções pagas", get: (r) => r.n_funcs },
    { group: "Lote histórico", header: "Quais funções pagas", get: (r) => r.funcoes_pagas },
    { group: "Lote histórico", header: "Lote(s) de origem", get: (r) => r.lotes },
    { group: "Lote histórico", header: "Base convênio (100%, época)", get: (r) => r.valor_pago_base },
    { group: "Lote histórico", header: "Pago ao médico (c/ acordo)", get: (r) => r.valor_com_acordo },
    // Diferenças brutas
    { group: "Diferenças brutas (TASY hoje − lote)", header: "Dif. quantidade", get: (r) => Number(r.dif_qtd.toFixed(4)) },
    { group: "Diferenças brutas (TASY hoje − lote)", header: "Dif. valor 100%", get: (r) => Number(r.dif_valor.toFixed(2)) },
    // Devido hoje
    { group: "Devido hoje (acordo × TASY hoje)", header: "Valor devido hoje", get: (r) => {
      // Para itens com lastro no lote usamos o recalc oficial. Para "Faltou
      // pagar" (sem lastro), caímos para valor_previsto_regra — que vem da
      // simulação (motor real) ou do preview local do histórico. Se nada
      // resolveu, devolve 0 (analista vê "sem previsão" pela coluna Origem).
      const v = r.status === "nao_pago"
        ? (typeof r.valor_previsto_regra === "number" ? r.valor_previsto_regra : (r.valor_com_acordo_recalc ?? 0))
        : (r.valor_com_acordo_recalc ?? 0);
      return Number((v ?? 0).toFixed(2));
    } },
    { group: "Devido hoje (acordo × TASY hoje)", header: "Valor previsto (simulação)", get: (r) => r.status === "nao_pago" && typeof r.valor_previsto_regra === "number" ? Number(r.valor_previsto_regra.toFixed(2)) : "" },
    // Ajuste
    { group: "Ajuste (pago no lote − devido hoje)", header: "Ajuste a fazer", get: (r) => Number((r.ajuste_acordo ?? 0).toFixed(2)) },
    { group: "Ajuste (pago no lote − devido hoje)", header: "A recuperar (paguei a mais)", get: (r) => Number(getTvrValorRecuperar(r).toFixed(2)) },
    { group: "Ajuste (pago no lote − devido hoje)", header: "A complementar (paguei a menos)", get: (r) => Number(Math.max(0, -(r.ajuste_acordo ?? 0)).toFixed(2)) },
    // Ação sugerida — mesmo texto que a UI mostra na coluna final.
    { group: "Ação sugerida", header: "Ação", get: (r) => describeAcao(r).label.replace(/^[↓↑—]\s*/, "") },
    { group: "Ação sugerida", header: "Motivo", get: (r) => describeAcao(r).hint },
    // Rastreabilidade — nomes amigáveis + IDs técnicos, para bater linha do
    // relatório com registro exato no banco sem precisar abrir a UI.
    // Regra/Cálculo e IDs correspondentes espelham a UI: quando não há regra
    // aplicada no lote (Faltou pagar), caem para regra/cálculo previstos com
    // marcador "[prev.]" (texto) ou o próprio UUID inferido (colunas de ID).
    { group: "Rastreio", header: "Regra aplicada", get: (r) => r.regra_aplicada ? r.regra_aplicada : (r.status === "nao_pago" && r.regra_prevista ? `[prev.] ${r.regra_prevista}` : "") },
    { group: "Rastreio", header: "Linha do cálculo", get: (r) => r.calculo_aplicado ? r.calculo_aplicado : (r.status === "nao_pago" && r.calculo_previsto ? `[prev.] ${r.calculo_previsto}` : "") },
    { group: "Rastreio", header: "ID do lote (payment_id)", get: (r) => r.matched_payment_id ?? "" },
    { group: "Rastreio", header: "ID do item (payment_item_id)", get: (r) => r.matched_payment_item_id ?? "" },
    { group: "Rastreio", header: "ID da regra (rule_id)", get: (r) => r.applied_rule_id ? r.applied_rule_id : (r.status === "nao_pago" ? (r.regra_prevista_id ?? "") : "") },
    { group: "Rastreio", header: "ID do cálculo (rule_calculation_id)", get: (r) => r.applied_calc_id ? r.applied_calc_id : (r.status === "nao_pago" ? (r.calculo_previsto_id ?? "") : "") },
    { group: "Rastreio", header: "ID da PJ (company_id)", get: (r) => r.matched_company_id ? r.matched_company_id : (r.status === "nao_pago" ? (r.pj_provavel_id ?? "") : "") },
    { group: "Rastreio", header: "ID do médico (doctor_id)", get: (r) => r.matched_doctor_id ?? "" },
    { group: "Rastreio", header: "Chave canônica", get: (r) => r.key ?? "" },
    // Inferência para itens sem lastro no lote — colunas separadas para deixar
    // claro que é sugestão (não valor real do repasse).
    { group: "Rastreio", header: "PJ provável (Faltou pagar)", get: (r) => r.pj_provavel ?? "" },
    { group: "Rastreio", header: "ID PJ provável", get: (r) => r.pj_provavel_id ?? "" },
    { group: "Rastreio", header: "Regra prevista (Faltou pagar)", get: (r) => r.regra_prevista ?? "" },
    { group: "Rastreio", header: "ID regra prevista", get: (r) => r.regra_prevista_id ?? "" },
    { group: "Rastreio", header: "Cálculo previsto", get: (r) => r.calculo_previsto ?? "" },
    { group: "Rastreio", header: "ID cálculo previsto", get: (r) => r.calculo_previsto_id ?? "" },
    // Origem da previsão (Faltou pagar): deixa claro se veio do motor real
    // (simulação — mais confiável) ou de heurística sobre histórico.
    { group: "Rastreio", header: "Origem previsão (Faltou pagar)", get: (r) => r.status === "nao_pago" ? formatPrevistoSourceLabel(r.previsto_source) : "" },
  ];



  // Para CSV/JSON: nomes de coluna limpos com o grupo separado como coluna própria,
  // em vez do prefixo "Grupo · Nome". É mais legível em qualquer editor de texto.
  const buildExportRows = (list: TvrResult[]) => list.map((r) => {
    const obj: Record<string, string | number> = {};
    for (const col of EXPORT_COLS) {
      // Usa nome curto sem prefixo. Se dois grupos tiverem colunas homônimas
      // (não é o caso hoje), o mais específico ganha — aceitável para relatório.
      obj[col.header] = col.get(r);
    }
    return obj;
  });

  // ============================================================
  // Inferência para itens "Faltou pagar" (sem lastro no lote histórico).
  //  · PJ provável: doctor_companies com end_date null. Regra do sistema é 1 PJ
  //    ativa por médico por hospital. Se aparecerem múltiplas → ambíguo → não
  //    sugerimos, para não induzir erro.
  //  · Regra prevista: última regra já aplicada para (médico + procedure_code)
  //    neste hospital, olhando payment_items históricos. Heurística — não
  //    invoca o motor de cálculo, respeita a diretriz "nunca inferir valor".
  // Ambas ficam em campos separados (pj_provavel / regra_prevista) para nunca
  // se confundirem com PJ conciliada / Regra aplicada reais do lote.
  // ============================================================
  const enrichNaoPagoInferred = async (
    rows: TvrResult[],
    hospitalId: string | null,
  ): Promise<void> => {
    const targets = rows.filter(
      (r) => r.status === "nao_pago" && (!r.pj_provavel || !r.regra_prevista),
    );
    if (targets.length === 0) return;

    const collectDoctorIds = (r: TvrResult): string[] => {
      const ids = new Set<string>();
      if (r.matched_doctor_id) ids.add(r.matched_doctor_id);
      for (const d of r.matched_doctor_ids ?? []) if (d) ids.add(d);
      return Array.from(ids);
    };

    // ---------- Fallback: resolver doctor_id via nome ----------
    // Itens "Faltou pagar" não têm lado repasse, então matched_doctor_id costuma
    // vir vazio. Sem doctor_id, a inferência de PJ/regra não roda. Resolvemos
    // pelo nome contra a tabela doctors (paginação simples) e via doctor_aliases,
    // hidratando r.matched_doctor_id antes do resto do fluxo.
    const missingIdTargets = targets.filter(
      (r) => !r.matched_doctor_id && !(r.matched_doctor_ids?.length) && r.medico,
    );
    if (missingIdTargets.length > 0) {
      const wantedNames = new Set<string>();
      for (const r of missingIdTargets) {
        const nn = normDoctorName(r.medico);
        if (nn) wantedNames.add(nn);
      }
      const nameToId = new Map<string, string>();
      try {
        // Paginação — evita truncar em bases grandes.
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data } = await supabase
            .from("doctors")
            .select("id, full_name")
            .eq("active", true)
            .range(from, from + PAGE - 1);
          const rows = (data ?? []) as Array<{ id: string; full_name: string }>;
          for (const d of rows) {
            const nn = normDoctorName(d.full_name);
            if (nn && wantedNames.has(nn) && !nameToId.has(nn)) {
              nameToId.set(nn, d.id);
            }
          }
          if (rows.length < PAGE) break;
          from += PAGE;
          if (from > 50000) break; // guarda-chuva
        }
        // Aliases dedicados — cobrem grafias divergentes que o normDoctorName não pega.
        const { data: aliases } = await supabase
          .from("doctor_aliases")
          .select("alias_normalized, alias_text, doctor_id");
        for (const a of (aliases ?? []) as Array<{ alias_normalized?: string; alias_text?: string; doctor_id: string }>) {
          const nn = (a.alias_normalized || normDoctorName(a.alias_text)) ?? "";
          if (nn && wantedNames.has(nn) && !nameToId.has(nn)) {
            nameToId.set(nn, a.doctor_id);
          }
        }
      } catch (e) {
        console.warn("[nao_pago] fallback doctor por nome falhou:", e);
      }
      for (const r of missingIdTargets) {
        const nn = normDoctorName(r.medico);
        const did = nn ? nameToId.get(nn) : undefined;
        if (did) {
          r.matched_doctor_id = did;
          if (!r.matched_doctor_ids?.length) r.matched_doctor_ids = [did];
        }
      }
    }

    const allDoctorIds = Array.from(
      new Set(targets.flatMap(collectDoctorIds)),
    );

    // ---------- PJ provável ----------
    // Fonte primária: histórico de payment_items DESTE hospital para o médico.
    // Isso respeita a regra "1 PJ ativa por médico por hospital" mesmo quando
    // doctor_companies (que é estadual, sem hospital_id) traz múltiplas PJs
    // do mesmo médico em outros hospitais — o que antes deixava tudo ambíguo
    // e escondia a sugestão em hospitais grandes como o DF Star.
    // Fallback: doctor_companies (end_date null) quando não há histórico local.
    const pjByDoctor = new Map<
      string,
      { company_id: string; name?: string; ambiguous: boolean; source: "history" | "registry" }
    >();

    // ---------- Regra prevista ----------
    // Só faz sentido dentro do escopo do hospital atual (regra é por hospital).
    const ruleByKey = new Map<
      string,
      {
        rule_id: string;
        rule_label?: string;
        calc_id?: string;
        calc_label?: string;
        calc_raw?: {
          calculation_type?: string | null;
          fixed_amount?: number | null;
          convenio_percentage?: number | null;
          auxiliary_pct?: number | null;
          aux_first_pct?: number | null;
          aux_second_pct?: number | null;
          instrumentador_pct?: number | null;
        };
      }
    >();
    if (hospitalId && allDoctorIds.length > 0) {
      // PJ histórica (por médico, hospital-scoped): pega a company_id do
      // payment_item mais recente de cada médico neste hospital.
      try {
        const CHUNK_D = 200;
        type PjRow = { doctor_id: string; company_id: string | null; procedure_date: string | null };
        const pjRows: PjRow[] = [];
        for (let i = 0; i < allDoctorIds.length; i += CHUNK_D) {
          const { data } = await supabase
            .from("payment_items")
            .select("doctor_id, company_id, procedure_date")
            .eq("hospital_id", hospitalId)
            .in("doctor_id", allDoctorIds.slice(i, i + CHUNK_D))
            .not("company_id", "is", null)
            .order("procedure_date", { ascending: false })
            .limit(5000);
          for (const row of (data ?? []) as PjRow[]) pjRows.push(row);
        }
        // Primeira ocorrência (mais recente pelo order) por médico.
        const seen = new Set<string>();
        const compIds = new Set<string>();
        for (const row of pjRows) {
          if (!row.doctor_id || !row.company_id) continue;
          if (seen.has(row.doctor_id)) continue;
          seen.add(row.doctor_id);
          pjByDoctor.set(row.doctor_id, {
            company_id: row.company_id,
            ambiguous: false,
            source: "history",
          });
          compIds.add(row.company_id);
        }
        if (compIds.size > 0) {
          const { data: comps } = await supabase
            .from("companies")
            .select("id, name")
            .in("id", Array.from(compIds));
          const names = new Map<string, string>();
          for (const c of (comps ?? []) as Array<{ id: string; name?: string }>) {
            if (c?.id) names.set(String(c.id), String(c.name ?? ""));
          }
          for (const v of pjByDoctor.values()) v.name = names.get(v.company_id) || undefined;
        }
      } catch (e) {
        console.warn("[nao_pago] falha inferindo PJ via histórico:", e);
      }

      // Fallback: doctor_companies para médicos SEM histórico local.
      const missingPjDocs = allDoctorIds.filter((d) => !pjByDoctor.has(d));
      if (missingPjDocs.length > 0) {
        try {
          const { data } = await supabase
            .from("doctor_companies")
            .select("doctor_id, company_id, end_date")
            .in("doctor_id", missingPjDocs)
            .is("end_date", null);
          const byDoc = new Map<string, Set<string>>();
          for (const row of (data ?? []) as Array<{ doctor_id: string; company_id: string }>) {
            const set = byDoc.get(row.doctor_id) ?? new Set<string>();
            set.add(row.company_id);
            byDoc.set(row.doctor_id, set);
          }
          const compIds = Array.from(new Set(Array.from(byDoc.values()).flatMap((s) => Array.from(s))));
          const compNames = new Map<string, string>();
          if (compIds.length > 0) {
            const { data: comps } = await supabase
              .from("companies")
              .select("id, name")
              .in("id", compIds);
            for (const c of (comps ?? []) as Array<{ id: string; name?: string }>) {
              if (c?.id) compNames.set(String(c.id), String(c.name ?? ""));
            }
          }
          for (const [did, set] of byDoc.entries()) {
            const cids = Array.from(set);
            const first = cids[0];
            // Sem histórico local: se tem só 1 PJ ativa no cadastro, sugere;
            // múltiplas → ambíguo (sem como decidir a do hospital atual).
            pjByDoctor.set(did, {
              company_id: first,
              name: compNames.get(first) || undefined,
              ambiguous: cids.length > 1,
              source: "registry",
            });
          }
        } catch (e) {
          console.warn("[nao_pago] fallback PJ via doctor_companies falhou:", e);
        }
      }

      const codes = Array.from(
        new Set(
          targets.map((r) => (r.tuss || "").trim()).filter((c) => c.length > 0),
        ),
      );
      if (codes.length > 0) {
        try {
          const CHUNK = 200;
          type Row = {
            doctor_id: string;
            procedure_code: string;
            applied_rule_id: string;
            applied_rule_label?: string | null;
            applied_calc_id?: string | null;
            procedure_date?: string | null;
          };
          const all: Row[] = [];
          for (let i = 0; i < codes.length; i += CHUNK) {
            const { data } = await supabase
              .from("payment_items")
              .select(
                "doctor_id, procedure_code, applied_rule_id, applied_rule_label, applied_calc_id, procedure_date",
              )
              .eq("hospital_id", hospitalId)
              .in("doctor_id", allDoctorIds)
              .in("procedure_code", codes.slice(i, i + CHUNK))
              .not("applied_rule_id", "is", null)
              .order("procedure_date", { ascending: false })
              .limit(5000);
            for (const row of (data ?? []) as Row[]) all.push(row);
          }
          // Primeira ocorrência por (doctor + code) já é a mais recente pelo order.
          for (const row of all) {
            const k = `${row.doctor_id}|${row.procedure_code}`;
            if (ruleByKey.has(k)) continue;
            ruleByKey.set(k, {
              rule_id: row.applied_rule_id,
              rule_label: row.applied_rule_label ?? undefined,
              calc_id: row.applied_calc_id ?? undefined,
            });
          }

          const calcIds = Array.from(
            new Set(
              Array.from(ruleByKey.values())
                .map((v) => v.calc_id)
                .filter(Boolean) as string[],
            ),
          );
          if (calcIds.length > 0) {
            const { data: calcs } = await supabase
              .from("rule_calculations")
              .select(
                "id, label, sort_order, calculation_type, fixed_amount, convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct",
              )
              .in("id", calcIds);
            const labels = new Map<string, string>();
            const raws = new Map<string, {
              calculation_type?: string | null;
              fixed_amount?: number | null;
              convenio_percentage?: number | null;
              auxiliary_pct?: number | null;
              aux_first_pct?: number | null;
              aux_second_pct?: number | null;
              instrumentador_pct?: number | null;
            }>();
            for (const c of (calcs ?? []) as Array<{
              id: string;
              label?: string;
              sort_order?: number;
              calculation_type?: string;
              fixed_amount?: number | null;
              convenio_percentage?: number | null;
              auxiliary_pct?: number | null;
              aux_first_pct?: number | null;
              aux_second_pct?: number | null;
              instrumentador_pct?: number | null;
            }>) {
              const idx =
                typeof c.sort_order === "number" ? c.sort_order + 1 : null;
              labels.set(
                String(c.id),
                [
                  idx ? `#${idx}` : "",
                  (c.label ?? "").trim(),
                  c.calculation_type ? `(${c.calculation_type})` : "",
                ]
                  .filter(Boolean)
                  .join(" "),
              );
              raws.set(String(c.id), {
                calculation_type: c.calculation_type ?? null,
                fixed_amount: c.fixed_amount ?? null,
                convenio_percentage: c.convenio_percentage ?? null,
                auxiliary_pct: c.auxiliary_pct ?? null,
                aux_first_pct: c.aux_first_pct ?? null,
                aux_second_pct: c.aux_second_pct ?? null,
                instrumentador_pct: c.instrumentador_pct ?? null,
              });
            }
            for (const v of ruleByKey.values()) {
              if (v.calc_id) {
                v.calc_label = labels.get(v.calc_id);
                v.calc_raw = raws.get(v.calc_id);
              }
            }
          }

          // Fix A — Fallback quando encontramos rule_id no histórico mas nenhum
          // payment_item trouxe applied_calc_id (regra ainda não aplicada nesse
          // TUSS específico). Carregamos TODOS os rule_calculations dessa regra
          // e escolhemos o melhor por (rule_id, tuss):
          //   1) calc cujo procedure_codes contém o TUSS do item, ou
          //   2) calc marcado is_catch_all, ou
          //   3) primeiro por sort_order (fallback determinístico).
          const missingRuleIds = Array.from(
            new Set(
              Array.from(ruleByKey.values())
                .filter((v) => v.rule_id && !v.calc_raw)
                .map((v) => v.rule_id),
            ),
          );
          if (missingRuleIds.length > 0) {
            type FallCalc = {
              id: string;
              rule_id: string;
              sort_order?: number | null;
              label?: string | null;
              calculation_type?: string | null;
              fixed_amount?: number | null;
              convenio_percentage?: number | null;
              auxiliary_pct?: number | null;
              aux_first_pct?: number | null;
              aux_second_pct?: number | null;
              instrumentador_pct?: number | null;
              procedure_codes?: string[] | null;
              is_catch_all?: boolean | null;
            };
            const { data: fallCalcs } = await supabase
              .from("rule_calculations")
              .select(
                "id, rule_id, sort_order, label, calculation_type, fixed_amount, convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, procedure_codes, is_catch_all",
              )
              .in("rule_id", missingRuleIds)
              .order("sort_order", { ascending: true });
            const byRule = new Map<string, FallCalc[]>();
            for (const c of ((fallCalcs ?? []) as FallCalc[])) {
              if (!c.rule_id) continue;
              const arr = byRule.get(c.rule_id) ?? [];
              arr.push(c);
              byRule.set(c.rule_id, arr);
            }
            const pickCalc = (rule_id: string, tuss: string): FallCalc | undefined => {
              const arr = byRule.get(rule_id);
              if (!arr || arr.length === 0) return undefined;
              const codeMatch = arr.find(
                (c) => Array.isArray(c.procedure_codes) && c.procedure_codes.includes(tuss),
              );
              if (codeMatch) return codeMatch;
              const catchAll = arr.find((c) => c.is_catch_all === true);
              if (catchAll) return catchAll;
              return arr[0]; // já vem ordenado por sort_order
            };
            // ruleByKey keys são `${doctor_id}|${procedure_code}` — extrai o code.
            for (const [key, v] of ruleByKey.entries()) {
              if (v.calc_raw) continue;
              const code = key.split("|")[1] ?? "";
              const pick = pickCalc(v.rule_id, code);
              if (!pick) continue;
              v.calc_id = pick.id;
              const idx =
                typeof pick.sort_order === "number" ? pick.sort_order + 1 : null;
              v.calc_label = [
                idx ? `#${idx}` : "",
                (pick.label ?? "").trim(),
                pick.calculation_type ? `(${pick.calculation_type})` : "",
              ]
                .filter(Boolean)
                .join(" ");
              v.calc_raw = {
                calculation_type: pick.calculation_type ?? null,
                fixed_amount: pick.fixed_amount ?? null,
                convenio_percentage: pick.convenio_percentage ?? null,
                auxiliary_pct: pick.auxiliary_pct ?? null,
                aux_first_pct: pick.aux_first_pct ?? null,
                aux_second_pct: pick.aux_second_pct ?? null,
                instrumentador_pct: pick.instrumentador_pct ?? null,
              };
            }
          }
        } catch (e) {
          console.warn("[nao_pago] falha inferindo regra prevista:", e);
        }
      }
    }

    // Aplica nos rows-alvo.
    for (const r of targets) {
      const dids = collectDoctorIds(r);
      // PJ: usa o primeiro doctor_id com PJ ativa não-ambígua.
      if (!r.pj_provavel) {
        for (const did of dids) {
          const hit = pjByDoctor.get(did);
          if (hit && !hit.ambiguous) {
            r.pj_provavel_id = hit.company_id;
            r.pj_provavel = hit.name || `PJ ${hit.company_id.slice(0, 8)}`;
            break;
          }
        }
      }
      // Regra: primeira combinação (médico, code) com histórico de regra.
      if (!r.regra_prevista) {
        const code = (r.tuss || "").trim();
        for (const did of dids) {
          const hit = ruleByKey.get(`${did}|${code}`);
          if (hit?.rule_id) {
            r.regra_prevista_id = hit.rule_id;
            r.regra_prevista = hit.rule_label;
            r.calculo_previsto_id = hit.calc_id;
            r.calculo_previsto = hit.calc_label;
            // Estima o valor devido hoje aplicando o mesmo cálculo do histórico.
            // Se o tipo não for coberto (pacote/tabela_diferenciada) ou faltar
            // dado, previsto_source='bruto' e consumidor cai para valor_total_tasy.
            if (hit.calc_raw) {
              const preview = computeTvrRulePreview({
                ...hit.calc_raw,
                valor_total_tasy: r.valor_total_tasy,
                qtd_tasy: r.qtd_tasy,
                funcao: r.funcao,
              });
              if (preview.valor != null) {
                r.valor_previsto_regra = preview.valor;
              }
              if (preview.tipo_analise) {
                r.tipo_analise_previsto = preview.tipo_analise;
              }
              r.previsto_source = preview.source;
            } else {
              r.previsto_source = "bruto";
            }
            break;
          }
        }
      }
      // Fix B — Faltou pagar não tem lastro no lote, então tipo_analise entrou
      // como "valor" por default. Se a regra prevista revelou que a regra
      // original é de quantidade (pacote/valor_fixo), alinhar aqui para o item
      // aparecer na aba "Por presença" no export split.
      if (r.status === "nao_pago" && r.tipo_analise_previsto && r.tipo_analise !== r.tipo_analise_previsto) {
        r.tipo_analise = r.tipo_analise_previsto;
      }
    }

    // ============================================================
    // Fase 3 — Simulação via motor REAL para itens que a heurística de
    // histórico não conseguiu resolver. Chama `simulate-rule-batch` que roda
    // o mesmo `analyzePaymentItems` usado no cálculo oficial (cobre os 5
    // tipos: percentual_sobre_convenio, valor_fixo, pacote, tabela_diferenciada
    // e exclusao, além de bonus/tabela_referencia).
    //
    // IMPORTANTE: o valor devolvido aqui é uma PREVISÃO para tomada de
    // decisão do analista. O cálculo real só é gravado quando o item entra
    // em confecção (analysis_mode='confeccao') e o motor de pagamento roda
    // de verdade sobre o lote. Marcamos previsto_source='simulacao' para
    // deixar essa distinção visível na UI e no export.
    // ============================================================
    if (hospitalId) {
      // Simulamos quando:
      //  (a) não achamos regra no histórico, OU
      //  (b) achamos regra no histórico mas o preview local não conseguiu
      //      calcular o valor (pacote / tabela_diferenciada / bonus, ou
      //      percentual sem % cadastrado para o papel). Nesse caso o motor
      //      real resolve porque carrega reference_table + porte do convênio.
      const needSim = rows.filter(
        (r) =>
          r.status === "nao_pago" &&
          !!(r.tuss || "").trim() &&
          (!!r.medico || !!r.matched_doctor_id) &&
          (
            !r.regra_prevista ||
            (typeof r.valor_previsto_regra !== "number")
          ),
      );
      if (needSim.length > 0) {
        // Data de referência para carregar reference/exception tables — usa a
        // data mais recente do conjunto (fallback: hoje).
        const dates = needSim.map((r) => r.data).filter(Boolean).sort();
        const reference_date =
          dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);

        const CHUNK = 500;
        try {
          for (let i = 0; i < needSim.length; i += CHUNK) {
            const slice = needSim.slice(i, i + CHUNK);
            const items = slice.map((r, idx) => ({
              id: `tvr-${i + idx}-${r.key ?? ""}`,
              procedure_code: (r.tuss || "").trim() || null,
              procedure_name: r.procedimento || null,
              agreement_name: r.convenio || null,
              doctor_name: r.medico || null,
              doctor_role: r.funcao || null,
              company_id: r.pj_provavel_id || null,
              company_name: r.pj_provavel || null,
              attendance_number: r.atendimento || null,
              patient_name: r.paciente || null,
              procedure_date: r.data || null,
              // Passamos o bruto TASY como referência — o motor devolve
              // expected_amount independente disso, mas mantemos consistência.
              gross_amount: Number(r.valor_total_tasy ?? 0),
              procedure_amount: Number(r.valor_total_tasy ?? 0),
              quantity: Number(r.qtd_tasy ?? 1),
            }));

            const { data, error } = await supabase.functions.invoke(
              "simulate-rule-batch",
              {
                body: {
                  items,
                  hospital_id: hospitalId,
                  reference_date,
                  // tolerances irrelevantes aqui — só usamos matched_rule + expected.
                  tolerance_pct: 0.5,
                  tolerance_abs: 1.0,
                },
              },
            );
            if (error) {
              console.warn("[nao_pago] simulate-rule-batch falhou:", error);
              continue;
            }
            const payload = data as {
              ok?: boolean;
              rows?: Array<{
                idx: number;
                status: "ok" | "sem_regra" | "divergente" | "hospital_errado";
                matched_rule_id: string | null;
                matched_rule_name: string | null;
                calculation_type_used: string | null;
                expected_amount: number | null;
              }>;
            };
            if (!payload?.ok || !Array.isArray(payload.rows)) continue;

            for (const out of payload.rows) {
              const target = slice[out.idx];
              if (!target) continue;
              if (out.matched_rule_id) {
                target.regra_prevista_id = out.matched_rule_id;
                target.regra_prevista = out.matched_rule_name ?? out.matched_rule_id;
                if (out.calculation_type_used) {
                  target.calculo_previsto = `(${out.calculation_type_used})`;
                }
                if (out.expected_amount != null && Number.isFinite(out.expected_amount)) {
                  target.valor_previsto_regra = out.expected_amount;
                }
                target.tipo_analise_previsto = deriveTipoAnaliseFromCalcType(
                  out.calculation_type_used,
                );
                // Alinha tipo_analise para que o item vá para a aba correta
                // no export split (mesmo Fix B, mas aplicado a esta fase).
                if (target.tipo_analise !== target.tipo_analise_previsto) {
                  target.tipo_analise = target.tipo_analise_previsto;
                }
                target.previsto_source = "simulacao";
              } else {
                // Motor rodou e não achou regra aplicável. Marcamos explícito
                // para o analista não confundir com "não simulei ainda".
                target.previsto_source = "sem_regra";
              }
            }
          }
        } catch (e) {
          console.warn("[nao_pago] fase 3 (simulação) falhou:", e);
        }
      }
    }
  };

  // Dispara a inferência quando `results` muda e há itens Faltou pagar sem
  // inferência aplicada. Roda uma única vez por conjunto de resultados.
  React.useEffect(() => {
    if (!results) return;
    const pending = results.filter(
      (r) =>
        r.status === "nao_pago" &&
        !r.previsto_source && // fase 3 marca simulacao/sem_regra → evita loop infinito
        (!r.pj_provavel || !r.regra_prevista),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const clone = results.map((r) => ({ ...r }));
      await enrichNaoPagoInferred(clone, hospitalIdRecon);
      if (cancelled) return;
      setResults(clone);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, hospitalIdRecon]);



  const exportData = async (
    fmt: "xlsx" | "csv" | "json",
    scope: "all" | "visible" | "split" | "valor" | "presenca",
  ) => {
    if (!results) return;
    // valor/presenca: aplicam todos os filtros (busca, status, PJ, médico,
    // apenas com pagamento) IGNORANDO a sub-aba atual, e restringem por
    // tipo_analise. Permite exportar só uma categoria sem trocar de aba.
    const list =
      scope === "visible"
        ? visible
        : scope === "split"
        ? applyVisibleFilters(results, { ignoreAnalysisTab: true })
        : scope === "valor"
        ? applyVisibleFilters(results, { ignoreAnalysisTab: true }).filter(
            (r) => r.tipo_analise === "valor",
          )
        : scope === "presenca"
        ? applyVisibleFilters(results, { ignoreAnalysisTab: true }).filter(
            (r) => r.tipo_analise === "quantidade",
          )
        : results;
    if (list.length === 0) {
      toast({ title: "Nada para exportar neste filtro", variant: "destructive" });
      return;
    }
    const stamp = format(new Date(), "yyyyMMdd_HHmm");
    const suffix =
      scope === "visible"
        ? "filtrado_"
        : scope === "split"
        ? "abas_"
        : scope === "valor"
        ? "por-valor_"
        : scope === "presenca"
        ? "por-presenca_"
        : "";
    const baseName = `tasy-vs-repasse_${suffix}${stamp}`;


    // Fallback: enriquece PJ Conciliada / Regra / Cálculo para resultados
    // carregados do banco antes desta funcionalidade existir. Busca por
    // matched_payment_item_id → payment_items → companies / rule_calculations.
    const missing = list.filter((r) => r.matched_payment_item_id && (!r.pj_conciliada || !r.regra_aplicada || !r.calculo_aplicado));
    if (missing.length > 0) {
      try {
        const pii = Array.from(new Set(missing.map((r) => r.matched_payment_item_id!).filter(Boolean)));
        const CHUNK = 300;
        const piMap = new Map<string, { company_id?: string; applied_rule_label?: string; applied_rule_id?: string; applied_calc_id?: string }>();
        for (let i = 0; i < pii.length; i += CHUNK) {
          const { data } = await supabase
            .from("payment_items" as never)
            .select("id, company_id, applied_rule_label, applied_rule_id, applied_calc_id")
            .in("id", pii.slice(i, i + CHUNK) as never);
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            piMap.set(String(row.id), {
              company_id: row.company_id ? String(row.company_id) : undefined,
              applied_rule_label: row.applied_rule_label ? String(row.applied_rule_label) : undefined,
              applied_rule_id: row.applied_rule_id ? String(row.applied_rule_id) : undefined,
              applied_calc_id: row.applied_calc_id ? String(row.applied_calc_id) : undefined,
            });
          }
        }
        const compIds = Array.from(new Set(Array.from(piMap.values()).map((v) => v.company_id).filter(Boolean))) as string[];
        const calcIds = Array.from(new Set(Array.from(piMap.values()).map((v) => v.applied_calc_id).filter(Boolean))) as string[];
        const companyNameById = new Map<string, string>();
        const calcLabelById = new Map<string, string>();
        if (compIds.length > 0) {
          const { data: comps } = await supabase.from("companies").select("id, name").in("id", compIds);
          for (const c of comps ?? []) if (c?.id) companyNameById.set(String(c.id), String((c as { name?: string }).name ?? ""));
        }
        if (calcIds.length > 0) {
          const { data: calcs } = await supabase.from("rule_calculations").select("id, label, sort_order, calculation_type").in("id", calcIds);
          for (const c of calcs ?? []) {
            if (!c?.id) continue;
            const cc = c as { id: string; label?: string | null; sort_order?: number | null; calculation_type?: string | null };
            const label = (cc.label ?? "").trim();
            const idx = typeof cc.sort_order === "number" ? cc.sort_order + 1 : null;
            const method = cc.calculation_type ?? "";
            calcLabelById.set(String(cc.id), [idx ? `#${idx}` : "", label, method ? `(${method})` : ""].filter(Boolean).join(" "));
          }
        }
        for (const r of missing) {
          const info = piMap.get(r.matched_payment_item_id!);
          if (!info) continue;
          if (!r.pj_conciliada && info.company_id) r.pj_conciliada = companyNameById.get(info.company_id) || undefined;
          if (!r.regra_aplicada && info.applied_rule_label) r.regra_aplicada = info.applied_rule_label;
          if (!r.calculo_aplicado && info.applied_calc_id) r.calculo_aplicado = calcLabelById.get(info.applied_calc_id) || undefined;
          if (!r.matched_company_id && info.company_id) r.matched_company_id = info.company_id;
          if (!r.applied_rule_id && info.applied_rule_id) r.applied_rule_id = info.applied_rule_id;
          if (!r.applied_calc_id && info.applied_calc_id) r.applied_calc_id = info.applied_calc_id;
        }
      } catch (e) {
        console.warn("Falha ao enriquecer PJ/regra no export:", e);
      }
    }


    if (fmt === "json") {
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.json`; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const XLSX = await import("xlsx");

    if (fmt === "csv") {
      // CSV não suporta merge, então usa cabeçalho único com o grupo colado.
      const rows = buildExportRows(list);
      const ws = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.csv`; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // ============================================================
    // XLSX com estilos reais (xlsx-js-style). Ganhos de leitura:
    //  · linha 1 = título do grupo com fundo colorido por natureza
    //  · linha 2 = cabeçalho da coluna, negrito, mesmo tom mais claro
    //  · corpo   = número formatado (R$ / qtd), bordas suaves entre grupos
    //  · freeze de 2 linhas + 2 colunas para bater o olho sem perder o contexto
    // A biblioteca community `xlsx` ignora a chave `s` no writeFile, por isso
    // trocamos para `xlsx-js-style` (fork com mesma API que preserva estilo).
    // ============================================================
    const XLSXStyle = await import("xlsx-js-style");

    // Paleta por grupo — tons pastel legíveis e alinhados à leitura visual da UI.
    // Header (linha 1) = tom mais forte; sub-header (linha 2) = tom claro.
    // Paleta suave: headers em tons pastel legíveis, texto escuro. Evita saturação forte.
    const GROUP_STYLE: Record<string, { header: string; sub: string; band: string }> = {
      "Item":                                       { header: "E2E8F0", sub: "F1F5F9", band: "FAFBFC" },
      "Contexto":                                   { header: "DBEAFE", sub: "EFF6FF", band: "F8FBFF" },
      "TASY hoje (100% convênio)":                  { header: "FEF3C7", sub: "FEFCE8", band: "FFFDF5" },
      "Lote histórico":                             { header: "EDE9FE", sub: "F5F3FF", band: "FBFAFF" },
      "Diferenças brutas (TASY hoje − lote)":       { header: "FFE4E6", sub: "FFF1F2", band: "FFF8F9" },
      "Devido hoje (acordo × TASY hoje)":           { header: "D1FAE5", sub: "ECFDF5", band: "F6FDFA" },
      "Ajuste (pago no lote − devido hoje)":        { header: "FED7AA", sub: "FFEDD5", band: "FFF7EC" },
      "Ação sugerida":                              { header: "E0E7FF", sub: "EEF2FF", band: "F5F7FF" },
      "Rastreio":                                   { header: "E2E8F0", sub: "F1F5F9", band: "F8FAFC" },
    };
    const fallbackStyle = { header: "E2E8F0", sub: "F1F5F9", band: "FFFFFF" };
    // Texto escuro para todos os headers (sem branco sobre cor saturada).
    const HEADER_TEXT = "334155";
    const BORDER_SOFT = "CBD5E1";

    // Formato numérico por header. R$ em contabilidade, quantidade com 4 casas
    // quando é fracionada. Zero vira "—" para não poluir a leitura.
    const MONEY_FMT = '_-"R$" * #,##0.00_-;[Red]-"R$" * #,##0.00_-;_-"R$" * "—"_-;_-@_-';
    const QTY_FMT = '0.####;-0.####;"—"';
    const numFmtFor = (header: string): string | null => {
      const h = header.toLowerCase();
      if (h.includes("qtd") || h.startsWith("dif. quant") || h.includes("nº")) return QTY_FMT;
      if (
        h.startsWith("vlr") || h.startsWith("valor") || h.startsWith("base") ||
        h.startsWith("pago") || h.startsWith("dif. valor") || h.startsWith("ajuste") ||
        h.startsWith("a recuperar") || h.startsWith("a complementar")
      ) return MONEY_FMT;
      return null;
    };

    // Constrói uma aba de dados a partir de uma sub-lista. Extraído em helper
    // para permitir gerar duas abas ("Por valor" e "Por presença") no mesmo
    // arquivo respeitando os filtros correntes.
    const buildDataSheet = (subList: TvrResult[]) => {
      // AoA: linha 0 = grupo, linha 1 = header, restante = dados.
      const groupRow = EXPORT_COLS.map((c) => c.group);
      const headerRow = EXPORT_COLS.map((c) => c.header);
      const dataRows = subList.map((r) => EXPORT_COLS.map((c) => c.get(r)));
      const aoa: (string | number)[][] = [groupRow, headerRow, ...dataRows];
      const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

      const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
      let groupStart = 0;
      for (let i = 1; i <= EXPORT_COLS.length; i++) {
        const isEnd = i === EXPORT_COLS.length || EXPORT_COLS[i].group !== EXPORT_COLS[groupStart].group;
        if (isEnd) {
          if (i - 1 > groupStart) merges.push({ s: { r: 0, c: groupStart }, e: { r: 0, c: i - 1 } });
          groupStart = i;
        }
      }
      (ws as unknown as { "!merges"?: unknown[] })["!merges"] = merges;
      (ws as unknown as { "!freeze"?: unknown })["!freeze"] = { xSplit: 2, ySplit: 2 };
      (ws as unknown as { "!views"?: unknown[] })["!views"] = [{ state: "frozen", xSplit: 2, ySplit: 2, topLeftCell: "C3", activePane: "bottomRight" }];

      const widths: Array<{ wch: number }> = EXPORT_COLS.map((c) => {
        const h = c.header.toLowerCase();
        if (h.startsWith("id ") || h.includes("chave canônica")) return { wch: 38 };
        if (h.includes("procedimento") || h.includes("paciente") || h.includes("quais")) return { wch: 34 };
        if (h.includes("médico") || h.includes("pj") || h.includes("regra") || h.includes("motivo") || h.includes("linha do")) return { wch: 28 };
        if (h.includes("convênio") || h.includes("lote")) return { wch: 22 };
        if (numFmtFor(c.header)) return { wch: 18 };
        if (h.includes("data") || h.includes("função") || h.includes("status") || h.includes("tipo")) return { wch: 15 };
        if (h.includes("qtd") || h.includes("nº")) return { wch: 11 };
        return { wch: 20 };
      });
      (ws as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = widths;
      (ws as unknown as { "!rows"?: Array<{ hpt?: number }> })["!rows"] = [{ hpt: 26 }];

      const totalRows = aoa.length;
      const thinBorder = { style: "thin", color: { rgb: "E2E8F0" } };
      for (let c = 0; c < EXPORT_COLS.length; c++) {
        const col = EXPORT_COLS[c];
        const palette = GROUP_STYLE[col.group] ?? fallbackStyle;
        const prevGroup = c > 0 ? EXPORT_COLS[c - 1].group : null;
        const isGroupStart = prevGroup !== col.group;
        const fmt = numFmtFor(col.header);

        const gAddr = XLSXStyle.utils.encode_cell({ r: 0, c });
        if (ws[gAddr]) {
          (ws[gAddr] as { s?: unknown }).s = {
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            font: { bold: true, color: { rgb: HEADER_TEXT }, sz: 11 },
            fill: { patternType: "solid", fgColor: { rgb: palette.header } },
            border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
          };
        }
        const hAddr = XLSXStyle.utils.encode_cell({ r: 1, c });
        if (ws[hAddr]) {
          (ws[hAddr] as { s?: unknown }).s = {
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            font: { bold: true, color: { rgb: HEADER_TEXT }, sz: 10 },
            fill: { patternType: "solid", fgColor: { rgb: palette.sub } },
            border: {
              top: thinBorder,
              bottom: { style: "thin", color: { rgb: BORDER_SOFT } },
              left: isGroupStart ? { style: "thin", color: { rgb: BORDER_SOFT } } : thinBorder,
              right: thinBorder,
            },
          };
        }
        for (let r = 2; r < totalRows; r++) {
          const addr = XLSXStyle.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          // Corpo neutro: só cabeçalhos recebem cor de grupo; linhas alternam branco/cinza muito claro.
          const zebra = r % 2 === 0 ? "FFFFFF" : "F8FAFC";
          (cell as { s?: unknown; z?: string; t?: string }).s = {
            alignment: { horizontal: fmt ? "right" : "left", vertical: "top", wrapText: true },
            font: { sz: 10, color: { rgb: "1E293B" } },
            fill: { patternType: "solid", fgColor: { rgb: zebra } },
            border: {
              top: { style: "hair", color: { rgb: "EEF2F6" } },
              bottom: { style: "hair", color: { rgb: "EEF2F6" } },
              left: isGroupStart ? { style: "thin", color: { rgb: BORDER_SOFT } } : { style: "hair", color: { rgb: "F1F5F9" } },
              right: { style: "hair", color: { rgb: "F1F5F9" } },
            },
          };
          if (fmt) {
            (cell as { z?: string }).z = fmt;
            if (typeof cell.v === "number") (cell as { t: string }).t = "n";
          }
        }
      }
      return ws;
    };

    // Modo split: duas abas (Por valor / Por presença) no mesmo arquivo,
    // ambas respeitando busca + status + apenas com pagamento.
    const isSplit = scope === "split";
    const listValor = isSplit ? list.filter((r) => r.tipo_analise === "valor") : [];
    const listPresenca = isSplit ? list.filter((r) => r.tipo_analise === "quantidade") : [];
    // Fix C — no split, SEMPRE geramos as duas abas (mesmo que uma esteja
    // vazia), para o analista enxergar que a categoria não tem itens em vez
    // de achar que o export bugou. Placeholder = header + linha vazia.
    const buildEmptyPlaceholder = (label: string) => {
      const groupRow = EXPORT_COLS.map((c) => c.group);
      const headerRow = EXPORT_COLS.map((c) => c.header);
      const emptyRow: (string | number)[] = [
        `Sem itens de "${label}" com os filtros atuais.`,
        ...EXPORT_COLS.slice(1).map(() => ""),
      ];
      const aoa: (string | number)[][] = [groupRow, headerRow, emptyRow];
      return XLSXStyle.utils.aoa_to_sheet(aoa);
    };
    const ws = isSplit ? null : buildDataSheet(list);
    const wsValor = isSplit ? (listValor.length > 0 ? buildDataSheet(listValor) : buildEmptyPlaceholder("Por valor")) : null;
    const wsPresenca = isSplit ? (listPresenca.length > 0 ? buildDataSheet(listPresenca) : buildEmptyPlaceholder("Por presença")) : null;


    // ============================================================
    // Aba "Legenda": vem antes da aba de dados para funcionar como
    // manual rápido. Duas seções: (1) glossário de conceitos que aparecem
    // no relatório e (2) dicionário de todas as colunas exportadas.
    // ============================================================
    const CONCEPT_GLOSSARY: Array<[string, string]> = [
      ["TASY hoje", "Estado atual da base do hospital (TASY). Reflete cancelamentos, glosas e correções feitas depois do repasse original."],
      ["Lote histórico", "Lote de repasse já processado e pago em competência anterior. Base 100% do convênio e valor pago ao médico registrados na época."],
      ["Base convênio (100%)", "Valor cheio da tabela do convênio para o procedimento — antes de aplicar qualquer acordo/percentual com o médico."],
      ["Pago ao médico (c/ acordo)", "Valor que o médico efetivamente recebeu naquele item, já com o percentual do acordo aplicado sobre a base."],
      ["Devido hoje", "Quanto o médico deveria receber HOJE se o motor reprocessasse o item com a base atual do TASY e o mesmo acordo do lote original."],
      ["Ajuste (pago no lote − devido hoje)", "Diferença entre o que foi pago e o que seria devido hoje. Positivo = pagamos a mais (recuperar). Negativo = pagamos a menos (complementar)."],
      ["A recuperar", "Valor que precisa voltar do médico porque o TASY reduziu a base (glosa/cancelamento) depois do repasse."],
      ["A complementar", "Valor extra a pagar ao médico porque o TASY aumentou a base ou apareceu item novo depois do repasse."],
      ["Ação sugerida", "Resumo em linguagem do analista do que fazer com o item — deriva do sinal do ajuste e do tipo de regra aplicada."],
      ["Tipo de análise · Valor (% convênio)", "Regras percentual_convenio: TASY e Exacta compartilham a mesma base do convênio, então comparamos em R$."],
      ["Tipo de análise · Quantidade (tabela própria)", "Regras de pacote, valor fixo ou tabela diferenciada: TASY não é base de R$, então comparamos presença e quantidade."],
      ["Sem lastro TASY", "Item foi pago no lote histórico mas hoje não aparece mais na base TASY — provável cancelamento total do procedimento."],
      ["Regra aplicada", "Nome da regra do acordo cadastrado que gerou o cálculo daquele item no lote histórico."],
      ["Linha do cálculo", "Linha específica dentro da regra (quando a regra tem múltiplas linhas/faixas) que foi aplicada ao item."],
      ["PJ provável (Faltou pagar)", "Para itens sem lastro no lote, sugerimos a PJ ativa do médico (doctor_companies com end_date null). Só preenche quando existe uma única PJ ativa — regra 1 PJ por médico por hospital."],
      ["Regra prevista (Faltou pagar)", "Para itens sem lastro no lote, sugerimos a última regra já aplicada para o mesmo médico + procedure_code neste hospital (heurística). É uma indicação — não é valor pago e não roda o motor de cálculo."],
      ["Badge 'prev.'", "Marca visual na tabela indicando que aquela informação (PJ ou Regra) é INFERIDA para um item Faltou pagar, não um dado real do repasse."],
    ];

    // Descrições por coluna. Chave = header exato usado no EXPORT_COLS.
    const COLUMN_DESCRIPTIONS: Record<string, string> = {
      "Status": "Situação do item na conciliação: OK, faltou pagar, pago a mais, pago a menos, sem lastro etc.",
      "Tipo de análise": "Natureza da regra do acordo — determina se comparamos em R$ ou por presença/quantidade.",
      "Sem lastro TASY": "Marcado quando o item foi pago no lote mas hoje não existe mais na base TASY.",
      "PJ": "Empresa (pessoa jurídica) para a qual o pagamento do médico foi direcionado no lote histórico. Em itens 'Faltou pagar' mostra a PJ provável com prefixo '[prev.]' (equivalente ao badge amarelo da tela).",
      "Médico": "Nome do médico responsável pelo procedimento.",
      "Atendimento": "Número do atendimento no TASY (chave principal de vínculo entre TASY e Exacta).",
      "Cód. TUSS": "Código TUSS de 8 dígitos do procedimento.",
      "Procedimento": "Descrição textual do procedimento conforme aparece no TASY.",
      "Paciente": "Nome do paciente do atendimento (dado sensível — uso restrito à conciliação).",
      "Data": "Data do procedimento registrada no TASY.",
      "Convênio": "Convênio/plano de saúde do atendimento.",
      "Função": "Papel do médico no procedimento (Cirurgião Principal, Primeiro Auxiliar, Anestesista etc.).",
      "Qtd": "Quantidade do procedimento na base TASY atual.",
      "Vlr unitário": "Valor unitário do procedimento na tabela do convênio (100%, sem acordo) na base TASY atual.",
      "Vlr total": "Valor total do procedimento na base TASY atual (qtd × unitário, 100% convênio).",
      "Qtd paga por função": "Quantidade que foi paga ao médico neste item no lote histórico, distribuída pela função.",
      "Nº de funções pagas": "Quantas funções distintas (Cirurgião, Auxiliar…) foram pagas neste atendimento+TUSS no lote.",
      "Quais funções pagas": "Lista textual das funções que receberam pagamento neste item no lote histórico.",
      "Lote(s) de origem": "Identificador(es) do lote de repasse em que este item foi pago.",
      "Base convênio (100%, época)": "Base 100% do convênio registrada NO LOTE (época do repasse), antes do acordo.",
      "Pago ao médico (c/ acordo)": "Valor efetivamente pago ao médico neste item no lote histórico, já com o acordo aplicado.",
      "Dif. quantidade": "Quantidade TASY hoje − quantidade paga no lote. Negativa = TASY reduziu (glosa/cancelamento).",
      "Dif. valor 100%": "Vlr total TASY hoje − base convênio no lote. Mede quanto a base 100% mudou depois do repasse.",
      "Valor devido hoje": "Quanto seria pago ao médico se o motor reprocessasse hoje, com a base TASY atual e o mesmo acordo do lote.",
      "Ajuste a fazer": "Pago no lote − Valor devido hoje. Positivo = pagamos a mais (recuperar). Negativo = pagamos a menos (complementar).",
      "A recuperar (paguei a mais)": "Valor a estornar do médico porque a base TASY reduziu depois do repasse.",
      "A complementar (paguei a menos)": "Valor extra a pagar ao médico porque a base TASY aumentou depois do repasse.",
      "Ação": "Ação sugerida em linguagem do analista (recuperar / complementar / sem ajuste).",
      "Motivo": "Explicação curta do porquê da ação — geralmente cita a natureza do acordo e o que mudou no TASY.",
      "Regra aplicada": "Nome da regra do acordo cadastrado que originou o cálculo no lote. Em 'Faltou pagar' mostra a regra prevista com prefixo '[prev.]' (mesmo badge da UI).",
      "Linha do cálculo": "Linha específica da regra aplicada (útil quando a regra tem várias linhas/faixas). Em 'Faltou pagar' cai para a linha prevista com prefixo '[prev.]'.",
      "ID do lote (payment_id)": "UUID do lote de repasse (tabela payments) — cola direto na URL /financeiro/pagamentos/<id>.",
      "ID do item (payment_item_id)": "UUID do item pago dentro do lote (tabela payment_items). Chave para conciliar linha do TASY com o registro de repasse.",
      "ID da regra (rule_id)": "UUID da regra do acordo aplicada (tabela rules). Em 'Faltou pagar' devolve o UUID da regra prevista inferida — mesmo comportamento da UI.",
      "ID do cálculo (rule_calculation_id)": "UUID da linha de cálculo da regra (tabela rule_calculations). Em 'Faltou pagar' devolve o UUID da linha prevista inferida.",
      "ID da PJ (company_id)": "UUID da empresa vinculada ao item no lote histórico (tabela companies). Em 'Faltou pagar' devolve o UUID da PJ provável inferida.",
      "ID do médico (doctor_id)": "UUID do médico do procedimento (tabela doctors).",
      "Chave canônica": "Chave interna que o motor usa para cruzar TASY × Exacta (Atend + Data + TUSS8 + Médico normalizado).",
      "PJ provável (Faltou pagar)": "Empresa sugerida para itens que nunca foram pagos — usa o vínculo ativo do médico em doctor_companies (regra: 1 PJ ativa por médico por hospital). Vazio quando o médico tem múltiplas PJs ativas (ambíguo).",
      "ID PJ provável": "UUID da PJ provável (tabela companies).",
      "Regra prevista (Faltou pagar)": "Regra sugerida para itens sem pagamento — última regra já aplicada para este médico + procedure_code neste hospital. Heurística, não invoca o motor de cálculo.",
      "ID regra prevista": "UUID da regra prevista (tabela rules).",
      "Cálculo previsto": "Linha de cálculo (label #ordem) associada à regra prevista.",
      "ID cálculo previsto": "UUID da linha de cálculo prevista (tabela rule_calculations).",


    };

    // Monta AoA da legenda: título + seção conceitos + seção colunas.
    const legAoa: (string | number)[][] = [];
    legAoa.push(["Legenda — TASY vs Repasse"]);
    legAoa.push([]);
    legAoa.push(["Conceitos-chave"]);
    legAoa.push(["Termo", "Significado"]);
    for (const [term, def] of CONCEPT_GLOSSARY) legAoa.push([term, def]);
    legAoa.push([]);
    legAoa.push(["Dicionário de colunas"]);
    legAoa.push(["Grupo", "Coluna", "Descrição"]);
    for (const col of EXPORT_COLS) {
      legAoa.push([col.group, col.header, COLUMN_DESCRIPTIONS[col.header] ?? ""]);
    }

    const wsLeg = XLSXStyle.utils.aoa_to_sheet(legAoa);
    (wsLeg as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = [
      { wch: 34 }, { wch: 30 }, { wch: 90 },
    ];
    // Merges: título (linha 0) ocupa 3 colunas; "Conceitos-chave" (linha 2) ocupa 2;
    // "Dicionário de colunas" (linha após conceitos) ocupa 3.
    const legMerges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
    legMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
    legMerges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } });
    const dictRow = 3 + CONCEPT_GLOSSARY.length + 2; // linha do "Dicionário de colunas"
    legMerges.push({ s: { r: dictRow, c: 0 }, e: { r: dictRow, c: 2 } });
    // Conceitos: 2ª coluna (definição) quebra linha; damos merge horizontal apenas
    // quando não há valor na 3ª coluna — não é necessário, colunas ficam como estão.
    (wsLeg as unknown as { "!merges"?: unknown[] })["!merges"] = legMerges;

    // Estilos: título grande, cabeçalhos de seção destacados, quebra de linha nas descrições.
    const setStyle = (addr: string, s: Record<string, unknown>) => {
      if (wsLeg[addr]) (wsLeg[addr] as { s?: unknown }).s = s;
    };
    setStyle("A1", {
      font: { bold: true, sz: 16, color: { rgb: "334155" } },
      alignment: { horizontal: "left", vertical: "center" },
      fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r: 2, c: 0 }), {
      font: { bold: true, sz: 12, color: { rgb: "334155" } },
      fill: { patternType: "solid", fgColor: { rgb: "DBEAFE" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r: dictRow, c: 0 }), {
      font: { bold: true, sz: 12, color: { rgb: "334155" } },
      fill: { patternType: "solid", fgColor: { rgb: "DBEAFE" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    // Linhas de header ("Termo/Significado" e "Grupo/Coluna/Descrição")
    const conceptHeaderRow = 3;
    const dictHeaderRow = dictRow + 1;
    for (let c = 0; c < 3; c++) {
      setStyle(XLSXStyle.utils.encode_cell({ r: conceptHeaderRow, c }), {
        font: { bold: true, color: { rgb: "1E293B" } },
        fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "94A3B8" } } },
      });
      setStyle(XLSXStyle.utils.encode_cell({ r: dictHeaderRow, c }), {
        font: { bold: true, color: { rgb: "1E293B" } },
        fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "94A3B8" } } },
      });
    }
    // Corpo — wrap nas colunas de definição/descrição para textos longos aparecerem inteiros.
    for (let r = conceptHeaderRow + 1; r < conceptHeaderRow + 1 + CONCEPT_GLOSSARY.length; r++) {
      setStyle(XLSXStyle.utils.encode_cell({ r, c: 0 }), {
        font: { bold: true, sz: 10, color: { rgb: "1E293B" } },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      });
      setStyle(XLSXStyle.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10, color: { rgb: "334155" } },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      });
    }
    for (let r = dictHeaderRow + 1; r < dictHeaderRow + 1 + EXPORT_COLS.length; r++) {
      setStyle(XLSXStyle.utils.encode_cell({ r, c: 0 }), {
        font: { sz: 10, color: { rgb: "6D28D9" }, bold: true },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      });
      setStyle(XLSXStyle.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10, color: { rgb: "1E293B" }, bold: true },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      });
      setStyle(XLSXStyle.utils.encode_cell({ r, c: 2 }), {
        font: { sz: 10, color: { rgb: "334155" } },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      });
    }

    // ============================================================
    // Aba "Parâmetros de cálculo": parâmetros brutos da regra/linha de cálculo
    // aplicada (e da regra prevista, quando existir) para cada item, mapeados
    // por payment_item_id / rule_id / rule_calculation_id. Permite auditar
    // fator, %, base e ver de qual cadastro o motor puxou.
    // ============================================================
    const wsParams = await (async () => {
      // Coleta todos os calc_ids envolvidos: aplicados e previstos.
      const allCalcIds = new Set<string>();
      const allRuleIds = new Set<string>();
      for (const r of list) {
        if (r.applied_calc_id) allCalcIds.add(String(r.applied_calc_id));
        if (r.calculo_previsto_id) allCalcIds.add(String(r.calculo_previsto_id));
        if (r.applied_rule_id) allRuleIds.add(String(r.applied_rule_id));
        if (r.regra_prevista_id) allRuleIds.add(String(r.regra_prevista_id));
      }

      const calcById = new Map<string, Record<string, unknown>>();
      const ruleNameById = new Map<string, string>();
      try {
        const CHUNK = 200;
        const calcIdsArr = Array.from(allCalcIds);
        for (let i = 0; i < calcIdsArr.length; i += CHUNK) {
          const slice = calcIdsArr.slice(i, i + CHUNK);
          const { data } = await supabase
            .from("rule_calculations")
            .select(
              "id, rule_id, sort_order, label, calculation_type, application_unit, fixed_amount, target_amount, multiplier, deflator_pct, bonus_amount, bonus_pct, repasse_pct, convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, include_auxiliaries, package_amount, package_subtype, package_main_code, reference_table_id, acrescimo_pct, adicional_fds_pct, adicional_feriado_pct, adicional_noturno_pct, adicional_urgencia_pct",
            )
            .in("id", slice);
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            if (row?.id) {
              calcById.set(String(row.id), row);
              if (row.rule_id) allRuleIds.add(String(row.rule_id));
            }
          }
        }
        const ruleIdsArr = Array.from(allRuleIds);
        for (let i = 0; i < ruleIdsArr.length; i += CHUNK) {
          const slice = ruleIdsArr.slice(i, i + CHUNK);
          const { data } = await supabase
            .from("rules")
            .select("id, name, code, calculation_type")
            .in("id", slice);
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            if (row?.id) {
              const nm = [row.code ? `[${row.code}]` : "", row.name ?? ""].filter(Boolean).join(" ").trim();
              ruleNameById.set(String(row.id), nm);
            }
          }
        }
      } catch (e) {
        console.warn("Falha ao carregar parâmetros de cálculo:", e);
      }

      const paramCols: Array<{ header: string; get: (calc: Record<string, unknown> | undefined) => string | number }> = [
        { header: "Tipo de cálculo",       get: (c) => (c?.calculation_type as string) ?? "" },
        { header: "Unidade de aplicação",  get: (c) => (c?.application_unit as string) ?? "" },
        { header: "Repasse %",             get: (c) => Number(c?.repasse_pct ?? 0) },
        { header: "Convênio %",            get: (c) => Number(c?.convenio_percentage ?? 0) },
        { header: "Multiplicador",         get: (c) => Number(c?.multiplier ?? 0) },
        { header: "Deflator %",            get: (c) => Number(c?.deflator_pct ?? 0) },
        { header: "Acréscimo %",           get: (c) => Number(c?.acrescimo_pct ?? 0) },
        { header: "Valor fixo",            get: (c) => Number(c?.fixed_amount ?? 0) },
        { header: "Valor alvo",            get: (c) => Number(c?.target_amount ?? 0) },
        { header: "Valor pacote",          get: (c) => Number(c?.package_amount ?? 0) },
        { header: "Bônus R$",              get: (c) => Number(c?.bonus_amount ?? 0) },
        { header: "Bônus %",               get: (c) => Number(c?.bonus_pct ?? 0) },
        { header: "Aux 1º %",              get: (c) => Number(c?.aux_first_pct ?? 0) },
        { header: "Aux 2º %",              get: (c) => Number(c?.aux_second_pct ?? 0) },
        { header: "Auxiliar %",            get: (c) => Number(c?.auxiliary_pct ?? 0) },
        { header: "Instrumentador %",      get: (c) => Number(c?.instrumentador_pct ?? 0) },
        { header: "Ad. FDS %",             get: (c) => Number(c?.adicional_fds_pct ?? 0) },
        { header: "Ad. Feriado %",         get: (c) => Number(c?.adicional_feriado_pct ?? 0) },
        { header: "Ad. Noturno %",         get: (c) => Number(c?.adicional_noturno_pct ?? 0) },
        { header: "Ad. Urgência %",        get: (c) => Number(c?.adicional_urgencia_pct ?? 0) },
        { header: "Pacote (subtype)",      get: (c) => (c?.package_subtype as string) ?? "" },
        { header: "Pacote (main code)",    get: (c) => (c?.package_main_code as string) ?? "" },
        { header: "Ref. table id",         get: (c) => (c?.reference_table_id as string) ?? "" },
      ];

      const fixedCols = [
        "Origem", "Atendimento", "TUSS", "Médico", "PJ",
        "payment_id", "payment_item_id", "rule_id", "Nome da regra",
        "rule_calculation_id", "Linha do cálculo",
        "Base aplicada (R$)", "Pago ao médico no lote (R$)", "Devido hoje (R$)",
      ];
      const headerRowP = [...fixedCols, ...paramCols.map((p) => p.header)];

      const bodyRows: (string | number)[][] = [];
      for (const r of list) {
        // Linha para regra APLICADA (quando o item foi pago no lote).
        if (r.applied_calc_id || r.applied_rule_id) {
          const calc = r.applied_calc_id ? calcById.get(String(r.applied_calc_id)) : undefined;
          const ruleId = String(r.applied_rule_id ?? calc?.rule_id ?? "");
          const idx = typeof calc?.sort_order === "number" ? (calc.sort_order as number) + 1 : null;
          const linha = [idx ? `#${idx}` : "", (calc?.label as string) ?? r.calculo_aplicado ?? ""].filter(Boolean).join(" ").trim();
          bodyRows.push([
            "aplicada",
            r.atendimento ?? "",
            r.tuss ?? "",
            r.medico ?? "",
            r.pj_conciliada ?? "",
            r.matched_payment_id ?? "",
            r.matched_payment_item_id ?? "",
            ruleId,
            ruleNameById.get(ruleId) ?? r.regra_aplicada ?? "",
            r.applied_calc_id ?? "",
            linha,
            Number(r.valor_pago_base ?? 0),
            Number(r.valor_com_acordo ?? 0),
            Number(r.valor_com_acordo_recalc ?? 0),
            ...paramCols.map((p) => p.get(calc)),
          ]);
        }
        // Linha para regra PREVISTA (heurística para Faltou pagar).
        if (r.calculo_previsto_id || r.regra_prevista_id) {
          const calc = r.calculo_previsto_id ? calcById.get(String(r.calculo_previsto_id)) : undefined;
          const ruleId = String(r.regra_prevista_id ?? calc?.rule_id ?? "");
          const idx = typeof calc?.sort_order === "number" ? (calc.sort_order as number) + 1 : null;
          const linha = [idx ? `#${idx}` : "", (calc?.label as string) ?? r.calculo_previsto ?? ""].filter(Boolean).join(" ").trim();
          bodyRows.push([
            "prevista",
            r.atendimento ?? "",
            r.tuss ?? "",
            r.medico ?? "",
            r.pj_provavel ?? "",
            "",
            "",
            ruleId,
            ruleNameById.get(ruleId) ?? r.regra_prevista ?? "",
            r.calculo_previsto_id ?? "",
            linha,
            0,
            0,
            0,
            ...paramCols.map((p) => p.get(calc)),
          ]);
        }
      }

      const aoaP: (string | number)[][] = [headerRowP, ...bodyRows];
      const wsP = XLSXStyle.utils.aoa_to_sheet(aoaP);

      // Larguras: IDs largos, headers curtos compactos.
      const widthsP: Array<{ wch: number }> = headerRowP.map((h) => {
        const s = String(h);
        if (s === "payment_id" || s === "payment_item_id" || s === "rule_id" || s === "rule_calculation_id" || s === "Ref. table id") return { wch: 38 };
        if (s === "Nome da regra" || s === "Linha do cálculo" || s === "Médico" || s === "PJ") return { wch: 32 };
        if (s === "Atendimento" || s === "TUSS" || s === "Origem") return { wch: 14 };
        if (s.includes("R$")) return { wch: 16 };
        return { wch: 14 };
      });
      (wsP as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = widthsP;
      (wsP as unknown as { "!views"?: unknown[] })["!views"] = [
        { state: "frozen", xSplit: 1, ySplit: 1, topLeftCell: "B2", activePane: "bottomRight" },
      ];

      // Estilo do cabeçalho.
      for (let c = 0; c < headerRowP.length; c++) {
        const addr = XLSXStyle.utils.encode_cell({ r: 0, c });
        if (wsP[addr]) {
          (wsP[addr] as { s?: unknown }).s = {
            font: { bold: true, color: { rgb: "334155" }, sz: 10 },
            fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: { bottom: { style: "thin", color: { rgb: "CBD5E1" } } },
          };
        }
      }

      // Formatos: % nas colunas de percentual, R$ nos valores, contagem nos demais.
      const pctHeaders = new Set([
        "Repasse %", "Convênio %", "Deflator %", "Acréscimo %", "Bônus %",
        "Aux 1º %", "Aux 2º %", "Auxiliar %", "Instrumentador %",
        "Ad. FDS %", "Ad. Feriado %", "Ad. Noturno %",
      ]);
      const moneyHeaders = new Set([
        "Valor fixo", "Valor alvo", "Valor pacote", "Bônus R$",
        "Base aplicada (R$)", "Pago ao médico no lote (R$)", "Devido hoje (R$)",
      ]);
      const PCT_FMT = '0.00"%";-0.00"%";"—"';
      const MONEY_FMT_P = '_-"R$" * #,##0.00_-;[Red]-"R$" * #,##0.00_-;_-"R$" * "—"_-;_-@_-';
      for (let c = 0; c < headerRowP.length; c++) {
        const h = String(headerRowP[c]);
        const fmt = pctHeaders.has(h) ? PCT_FMT : moneyHeaders.has(h) ? MONEY_FMT_P : null;
        if (!fmt) continue;
        for (let rr = 1; rr <= bodyRows.length; rr++) {
          const addr = XLSXStyle.utils.encode_cell({ r: rr, c });
          if (wsP[addr]) {
            (wsP[addr] as { s?: Record<string, unknown>; z?: string; t?: string }).z = fmt;
            (wsP[addr] as { t?: string }).t = "n";
          }
        }
      }

      return wsP;
    })();

    const wb = XLSXStyle.utils.book_new();
    // Legenda vem primeiro para servir como manual ao abrir o arquivo.
    XLSXStyle.utils.book_append_sheet(wb, wsLeg, "Legenda");
    if (isSplit) {
      // Duas abas separadas — nomes espelham as sub-abas da UI.
      if (wsValor) XLSXStyle.utils.book_append_sheet(wb, wsValor, `Por valor (${listValor.length})`);
      if (wsPresenca) XLSXStyle.utils.book_append_sheet(wb, wsPresenca, `Por presença (${listPresenca.length})`);
    } else if (ws) {
      XLSXStyle.utils.book_append_sheet(wb, ws, "TASY vs Repasse");
    }
    XLSXStyle.utils.book_append_sheet(wb, wsParams, "Parâmetros de cálculo");
    XLSXStyle.writeFile(wb, `${baseName}.xlsx`);
  };




  const persistResults = async (
    list: TvrResult[],
    onBatch?: (savedRows: number, totalRows: number) => void,
  ) => {
    const incompleteAusente = list
      .map((r) => ({ r, missing: getAusenteTasyMissingFields(r) }))
      .filter((x) => x.missing.length > 0);
    const rows = list.map((r) => {
      const missing = getAusenteTasyMissingFields(r);
      const warnings = missing.length > 0
        ? [`Ausente base faturamento incompleto — faltam: ${missing.join(", ")}`]
        : [];
      return {
        reconciliation_id: id,
        source: TVR_SOURCE,
        attendance: r.atendimento || null,
        tuss_code: r.tuss || null,
        procedure_date: dbDateOrNull(r.data),
        patient_name: r.paciente || null,
        function_label: r.funcao || r.funcoes_pagas || null,
        procedure_name: r.procedimento || null,
        claimed_amount: r.valor_total_tasy || null,
        claimed_quantity: r.qtd_tasy || null,
        paid_amount: r.valor_pago_base || null,
        paid_quantity: r.qtd_por_func || null,
        expected_amount: r.valor_com_acordo || null,
        gap_amount: r.dif_valor || null,
        classification: mapTvrStatusToStoredClassification(r.status),
        classification_reason: warnings.length > 0
          ? `${TVR_STATUS_LABEL[r.status]} · ${warnings[0]}`
          : TVR_STATUS_LABEL[r.status],
        raw: { mode: TVR_SOURCE, tvr_result: r, incomplete_fields: missing, warnings },
      };
    });

    await supabase
      .from("retroactive_reconciliation_items" as never)
      .delete()
      .eq("reconciliation_id", id)
      .eq("source", TVR_SOURCE);

    onBatch?.(0, rows.length);
    if (rows.length > 0) {
      // Insere em lotes para evitar "canceling statement due to statement timeout"
      // do Postgres quando o volume de linhas + payload JSON (raw) é grande.
      const BATCH = 300;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error: insertError } = await supabase
          .from("retroactive_reconciliation_items" as never)
          .insert(chunk as never);
        if (insertError) throw insertError;
        onBatch?.(Math.min(i + BATCH, rows.length), rows.length);
      }
    }


    const previousSummary = (recon?.summary ?? {}) as Record<string, unknown>;
    const summary = buildTvrReplaceSummary(list, previousSummary, {
      tasy_file: tasyFile,
      tasy_file_totals: tasyFileTotals,
      tasy_dropped_examples: tasyDroppedExamples,
      exclude_tuss: excludeTuss,
      excluded_convenios: excludedConvenios,
    });
    // Enriquecimento extra (não relevante para o teste de replace): chaves dos
    // ausentes incompletos, anexadas à última entrada do histórico.
    const history = (summary.tvr_validation_history as Array<Record<string, unknown>>) ?? [];
    if (history.length > 0) {
      history[history.length - 1] = {
        ...history[history.length - 1],
        ausente_incomplete_keys: incompleteAusente.slice(0, 50).map((x) => ({
          key: x.r.key,
          atendimento: x.r.atendimento,
          tuss: x.r.tuss,
          missing: x.missing,
        })),
      };
    }
    const { error: updateError } = await supabase
      .from("retroactive_reconciliations" as never)
      .update({ summary, status: "em_analise" } as never)
      .eq("id", id);

    if (updateError) throw updateError;
  };

  const handoff = recon?.summary?.handoff ?? null;
  const isLocked = !!handoff;

  const isActionableTvr = (r: TvrResult): boolean => {
    if (r._generatedAdjustmentId) return false; // já materializado em ajuste
    return (
      r.status === "nao_pago" ||
      r.status === "div_valor" ||
      r.status === "div_qtd_valor" ||
      r.status === "pago_a_mais"
    );
  };

  const isSelectableForEncaminhamento = (r: TvrResult): boolean => {
    if (r._generatedAdjustmentId) return false;
    if (isActionableTvr(r)) return true;
    // Glosa válida: item pago no lote, mas removido/zerado pela auditoria
    // hospitalar. Antes esse status ficava sem checkbox, bloqueando PJs como
    // C M FRANCA, CAIM e CIRURGIA BRASILIA mesmo com valor a recuperar.
    // "sem lastro TASY" é apenas um alerta qualitativo (pacote fechado pode não
    // faturar item a item) — não pode bloquear o encaminhamento quando existe
    // valor a recuperar apurado. Mesmo caso do "Por valor", agora no "Por presença".
    return r.status === "ausente_tasy" && getTvrValorRecuperar(r) > 0.5;
  };

  // Motivo textual pelo qual um item NÃO pode ser encaminhado — usado como
  // dica visual na coluna Ações quando o checkbox aparece desabilitado.
  const describeNaoAcionavel = (r: TvrResult): string | null => {
    if (r.excluir_do_encaminhamento) return null; // já tem badge próprio "Excluído"
    if (r._generatedAdjustmentId) return "Já encaminhado";
    if (isLocked) return "Apuração encaminhada";
    if (isSelectableForEncaminhamento(r)) return null;
    if (r.status === "ok") return "Sem divergência";
    if (r.status === "ausente_tasy") return "Sem valor a recuperar apurado";
    return null;
  };

  const describeAcao = (r: TvrResult) => describeTvrAcao(r);


  const sendHandoffToConfeccao = async (list: TvrResult[], opts?: { silent?: boolean }) => {
    const actionable = list.filter(isActionableTvr);
    if (actionable.length === 0) {
      toast({
        title: "Nenhum item acionável",
        description: "Só linhas Faltou pagar, Pago a menos (valor), Pago a menos (qtd) ou Pago a mais podem ir para confecção.",
        variant: "destructive",
      });
      return;
    }
    if (!opts?.silent) {
      const ok = window.confirm(
        `Encaminhar ${actionable.length} item(ns) para confecção de repasse?\n\n` +
        `A apuração ficará travada para edição e o ajuste seguirá pelo fluxo padrão de confecção.`,
      );
      if (!ok) return;
    }
    const financial = computeTvrFinancialTotals(actionable);
    const reconciliationId = id;
    const refSuggestion = `Retro #${reconciliationId.slice(0, 8)} · ${recon?.title ?? "TASY vs Repasse"}`;

    const previousSummary = (recon?.summary ?? {}) as Record<string, unknown>;
    const handoffPayload = {
      status: "encaminhada" as const,
      payment_id: null,
      payment_reference: refSuggestion,
      at: new Date().toISOString(),
      by: null,
      items_count: actionable.length,
      total_complementar: financial.totalComplementar,
      total_retirar: financial.totalRetirar,
      item_keys: actionable.slice(0, 500).map((r) => r.key),
    };
    const { error: updErr } = await supabase
      .from("retroactive_reconciliations" as never)
      .update({
        summary: { ...previousSummary, handoff: handoffPayload },
      } as never)
      .eq("id", reconciliationId);
    if (updErr) {
      toast({ title: "Falha ao travar apuração", description: updErr.message, variant: "destructive" });
      return;
    }
    setRecon((prev) => prev ? { ...prev, summary: { ...(prev.summary ?? {}), handoff: handoffPayload } } : prev);
    // Persistência via URL — sobrevive a reload e não depende de sessionStorage.
    navigate(`/pagamentos/novo?modo=confeccao&retro=${reconciliationId}`);
  };

  const toRetirarItems = (list: TvrResult[]) =>
    list.filter((r) => getTvrValorRecuperar(r) > 0.5);

  // Tópico 2: helper único para filtrar itens marcados como
  // "excluir do encaminhamento". Usado apenas nos fluxos que geram
  // apuração/glosa — a listagem principal continua exibindo tudo.
  const notExcluded = (r: TvrResult) => !r.excluir_do_encaminhamento;

  // ============================================================
  // T3 — Exclusão manual do encaminhamento (UI)
  // ============================================================
  type ExclusionReason =
    | "mudanca_data_administrativa"
    | "cancelamento_externo"
    | "duplicidade_ja_resolvida"
    | "acordo_diferenciado"
    | "outro";

  const REASON_LABEL: Record<ExclusionReason, string> = {
    mudanca_data_administrativa: "Mudança administrativa de data",
    cancelamento_externo: "Cancelamento externo",
    duplicidade_ja_resolvida: "Duplicidade já resolvida",
    acordo_diferenciado: "Acordo diferenciado",
    outro: "Outro",
  };
  const reasonLabel = (r?: TvrResult["exclusion_reason"]) =>
    r ? REASON_LABEL[r as ExclusionReason] ?? "Excluído" : "Excluído";

  const [excludeDialog, setExcludeDialog] = useState<{ open: boolean; targetIds: string[] }>({
    open: false,
    targetIds: [],
  });
  const [excludeReason, setExcludeReason] = useState<ExclusionReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const [excluding, setExcluding] = useState(false);

  const openExcludeDialog = (ids: string[]) => {
    if (ids.length === 0) return;
    setExcludeReason("");
    setExcludeNote("");
    setExcludeDialog({ open: true, targetIds: ids });
  };

  const markExcluded = async (
    itemIds: string[],
    reason: ExclusionReason,
    note: string | null,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (itemIds.length === 0) return { ok: true };
    if (reason === "outro" && !(note && note.trim().length > 0)) {
      return { ok: false, error: "Observação é obrigatória para 'Outro'." };
    }
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return { ok: false, error: "Usuário não autenticado." };
    const trimmed = note?.trim() || null;
    const { error } = await supabase
      .from("retroactive_reconciliation_items" as never)
      .update({
        excluir_do_encaminhamento: true,
        exclusion_reason: reason,
        exclusion_note: trimmed,
        excluded_by: uid,
        excluded_at: new Date().toISOString(),
      } as never)
      .in("id", itemIds);
    if (error) return { ok: false, error: error.message };
    const idSet = new Set(itemIds);
    setResults((prev) =>
      prev?.map((r) =>
        r._retroReconRowId && idSet.has(r._retroReconRowId)
          ? { ...r, excluir_do_encaminhamento: true, exclusion_reason: reason, exclusion_note: trimmed }
          : r,
      ) ?? prev,
    );
    return { ok: true };
  };

  const unmarkExcluded = async (
    itemIds: string[],
  ): Promise<{ ok: boolean; error?: string }> => {
    if (itemIds.length === 0) return { ok: true };
    const { error } = await supabase
      .from("retroactive_reconciliation_items" as never)
      .update({
        excluir_do_encaminhamento: false,
        exclusion_reason: null,
        exclusion_note: null,
        excluded_by: null,
        excluded_at: null,
      } as never)
      .in("id", itemIds);
    if (error) return { ok: false, error: error.message };
    const idSet = new Set(itemIds);
    setResults((prev) =>
      prev?.map((r) =>
        r._retroReconRowId && idSet.has(r._retroReconRowId)
          ? { ...r, excluir_do_encaminhamento: false, exclusion_reason: null, exclusion_note: null }
          : r,
      ) ?? prev,
    );
    return { ok: true };
  };

  const confirmExcludeDialog = async () => {
    if (!excludeReason) return;
    setExcluding(true);
    const res = await markExcluded(excludeDialog.targetIds, excludeReason as ExclusionReason, excludeNote);
    setExcluding(false);
    if (!res.ok) {
      toast({ title: "Falha ao excluir do encaminhamento", description: res.error, variant: "destructive" });
      return;
    }
    // Ao excluir em lote (via selectedKeys), limpa seleção.
    if (excludeDialog.targetIds.length > 1) {
      setSelectedKeys(new Set());
    }
    setExcludeDialog({ open: false, targetIds: [] });
    toast({ title: excludeDialog.targetIds.length === 1 ? "Item excluído do encaminhamento" : `${excludeDialog.targetIds.length} itens excluídos do encaminhamento` });
  };


  // ===== Agrupamento por médico (apuração só-PJ) =====
  type GlosaGroup = {
    doctor_id: string;
    doctor_name: string;
    doctor_crm: string | null;
    company_id: string | null;
    company_name: string | null;
    items: TvrResult[];
  };

  const modoMedicoUnico = !!recon?.doctor_id;

  // Map doctor_id → PJ ativa (regra: 1 PJ ativa por médico). Quando o médico
  // tem múltiplas PJs ativas, deixamos null e o backend resolve na hora do envio.
  const [doctorPjMap, setDoctorPjMap] = useState<Record<string, { company_id: string; company_name: string } | null>>({});
  // Todas as PJs ativas por médico (via doctor_companies). Usado pelo modal
  // "Reavaliar vínculos" para o analista escolher a PJ de destino quando
  // o vínculo é ambíguo ou divergiu do lote original.
  const [doctorAllPjsMap, setDoctorAllPjsMap] = useState<Record<string, Array<{ company_id: string; company_name: string }>>>({});

  // Carrega map id→{full_name,crm} para os doctor_ids presentes nos itens a retirar
  // quando a apuração é só-PJ. Em modo médico-único isso não é usado.
  useEffect(() => {
    if (modoMedicoUnico) return;
    const ids = Array.from(
      new Set(
        (results ?? [])
          .filter((r) => getTvrValorRecuperar(r) > 0.5)
          .map((r) => r.matched_doctor_id)
          .filter((x): x is string => !!x),
      ),
    );
    const missing = ids.filter((id) => !groupDoctorsMap[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("doctors" as never)
        .select("id, full_name, crm")
        .in("id", missing);
      if (cancelled) return;
      const next: Record<string, { full_name: string; crm: string | null }> = { ...groupDoctorsMap };
      for (const d of (data ?? []) as Array<{ id: string; full_name: string | null; crm: string | null }>) {
        next[d.id] = { full_name: d.full_name ?? "Médico", crm: d.crm ?? null };
      }
      setGroupDoctorsMap(next);
    })();
    return () => { cancelled = true; };
  }, [results, modoMedicoUnico, groupDoctorsMap]);

  // Carrega a PJ ativa de cada médico via doctor_companies (end_date null).
  // Só marca quando o médico tem exatamente 1 PJ ativa; múltiplas → ambíguo (null).
  useEffect(() => {
    if (modoMedicoUnico) return;
    const ids = Array.from(
      new Set(
        (results ?? [])
          .filter((r) => getTvrValorRecuperar(r) > 0.5)
          .map((r) => r.matched_doctor_id)
          .filter((x): x is string => !!x),
      ),
    );
    const missing = ids.filter((id) => !(id in doctorPjMap));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data: links } = await supabase
        .from("doctor_companies" as never)
        .select("doctor_id, company_id")
        .in("doctor_id", missing)
        .is("end_date", null);
      const rows = (links ?? []) as Array<{ doctor_id: string; company_id: string }>;
      const byDoctor = new Map<string, Set<string>>();
      for (const l of rows) {
        const s = byDoctor.get(l.doctor_id) ?? new Set<string>();
        s.add(l.company_id);
        byDoctor.set(l.doctor_id, s);
      }
      const companyIds = Array.from(new Set(rows.map((l) => l.company_id)));
      const { data: comps } = companyIds.length
        ? await supabase.from("companies" as never).select("id, name").in("id", companyIds)
        : { data: [] as Array<{ id: string; name: string }> };
      const nameById = new Map<string, string>();
      for (const c of (comps ?? []) as Array<{ id: string; name: string | null }>) {
        nameById.set(c.id, c.name ?? "PJ");
      }
      if (cancelled) return;
      const next: Record<string, { company_id: string; company_name: string } | null> = { ...doctorPjMap };
      const nextAll: Record<string, Array<{ company_id: string; company_name: string }>> = { ...doctorAllPjsMap };
      for (const did of missing) {
        const set = byDoctor.get(did);
        const list = set ? Array.from(set).map((cid) => ({ company_id: cid, company_name: nameById.get(cid) ?? "PJ" })) : [];
        nextAll[did] = list;
        if (list.length === 1) {
          next[did] = list[0];
        } else {
          next[did] = null;
        }
      }
      setDoctorPjMap(next);
      setDoctorAllPjsMap(nextAll);
    })();
    return () => { cancelled = true; };
  }, [results, modoMedicoUnico, doctorPjMap]);

  const buildGlosaGroups = (retirar: TvrResult[]): { groups: GlosaGroup[]; unassigned: TvrResult[] } => {
    if (modoMedicoUnico) {
      if (!doctorInfo.id || (!doctorInfo.name && !doctorInfo.crm)) {
        return { groups: [], unassigned: retirar };
      }
      return {
        groups: [{
          doctor_id: doctorInfo.id,
          doctor_name: doctorInfo.name ?? "Médico",
          doctor_crm: doctorInfo.crm,
          company_id: recon?.company_id ?? null,
          company_name: null,
          items: retirar,
        }],
        unassigned: [],
      };
    }
    // Agrupa por (médico + override de PJ). Se o analista reatribuiu itens do
    // mesmo médico para PJs diferentes via "Reavaliar vínculos", cada override
    // vira um grupo próprio para gerar débitos separados.
    const byKey = new Map<string, { did: string; override: string | null; items: TvrResult[] }>();
    const unassigned: TvrResult[] = [];
    for (const r of retirar) {
      const did = r.matched_doctor_id;
      if (!did) { unassigned.push(r); continue; }
      const override = r.retroactive_target_company_id ?? null;
      const key = `${did}|${override ?? ""}`;
      const entry = byKey.get(key) ?? { did, override, items: [] };
      entry.items.push(r);
      byKey.set(key, entry);
    }
    const groups: GlosaGroup[] = [];
    for (const { did, override, items } of byKey.values()) {
      const info = groupDoctorsMap[did];
      const pj = doctorPjMap[did] ?? null;
      // Prioridade: override manual → PJ ativa única → null (ambíguo/sem vínculo)
      const overridePj = override
        ? (doctorAllPjsMap[did] ?? []).find((p) => p.company_id === override) ?? { company_id: override, company_name: "PJ reatribuída" }
        : null;
      const chosen = overridePj ?? pj;
      groups.push({
        doctor_id: did,
        doctor_name: info?.full_name ?? "Médico",
        doctor_crm: info?.crm ?? null,
        company_id: chosen?.company_id ?? null,
        company_name: chosen?.company_name ?? null,
        items,
      });
    }
    // Ordena por PJ (ambíguas por último) e depois por médico — sempre tratamos a PJ primeiro.
    groups.sort((a, b) => {
      const ac = a.company_name ?? "\uFFFF";
      const bc = b.company_name ?? "\uFFFF";
      if (ac !== bc) return ac.localeCompare(bc);
      return a.doctor_name.localeCompare(b.doctor_name);
    });
    return { groups, unassigned };
  };

  // ===== Caminho B — gera glosa de auditoria por grupos (1 batch, N débitos) =====
  const createAuditoriaGlosaForGroups = async (
    groups: GlosaGroup[],
    parcelasByDoctor: Record<string, number>,
    parcelasFallback: number,
  ): Promise<{ batch_id: string | null; debts: number; items: number; total: number; parcelasResumo: string; skipped: Array<{ doctor_name: string; company_name: string | null; reason: string }> }> => {
    if (groups.length === 0) throw new Error("Nenhum grupo selecionado.");
    // Multi-PJ: cada grupo carrega sua própria company_id (via doctor_companies).
    // Só exige recon.company_id como fallback no modo médico único.
    const groupsSemPj = groups.filter((g) => !(g.company_id ?? recon?.company_id));
    if (groupsSemPj.length > 0) {
      const nomes = groupsSemPj.map((g) => g.doctor_name).join(", ");
      throw new Error(`Médico(s) sem PJ vinculada — não é possível gerar glosa: ${nomes}. Vincule a PJ no cadastro do médico.`);
    }
    const allItems = groups.flatMap((g) => g.items);
    if (allItems.length === 0) throw new Error("Nenhum item a retirar nos grupos selecionados.");

    const totalGlosa = allItems.reduce((s, r) => s + getTvrValorRecuperar(r), 0);
    const competence = competenceOfYmd(recon.period_start) ?? "";
    const title = recon.title ?? `Apuração ${recon.id.slice(0, 8)}`;

    // 1) Batch único
    const { data: batchData, error: batchErr } = await (supabase as never as typeof supabase)
      .from("glosa_batches" as never)
      .insert({
        source: "auditoria",
        reconciliation_id: recon.id,
        reference: `Auditoria — ${title}`,
        convenio: null,
        competence_month: competence || null,
        file_name: null,
        status: "concluido",
        total_items: allItems.length,
        matched_items: allItems.length,
        unmatched_items: 0,
        total_glosa_amount: Number(totalGlosa.toFixed(2)),
        hospital_id: hospitalIdRecon,
      } as never)
      .select("id")
      .single();
    if (batchErr || !batchData) throw new Error(batchErr?.message ?? "Falha ao criar lote de glosa.");
    const batchId = (batchData as { id: string }).id;

    // 2) Items — doctor_name/doctor_crm vêm do grupo (resolvidos via doctors), não do TASY
    const allInsertedIdsByGroup: Array<{ group: GlosaGroup; item_ids: string[] }> = [];
    try {
      for (const g of groups) {
        const groupCompanyId = g.company_id ?? recon?.company_id ?? null;
        const payload = g.items.map((r) => {
          const motivo =
            r.status === "ausente_tasy"
              ? "Retirado da conta após auditoria — procedimento pago sem registro de produção"
              : "Retirado da conta após auditoria — valor pago acima da produção registrada";
          return {
            batch_id: batchId,
            attendance_number: r.atendimento || null,
            procedure_code: r.tuss || null,
            procedure_name: r.procedimento || null,
            procedure_date: dbDateOrNull(r.data),
            patient_name: r.paciente || null,
            doctor_name: g.doctor_name,
            doctor_crm: g.doctor_crm,
            convenio: r.convenio || null,
            valor_cobrado: Number((r.valor_com_acordo || 0).toFixed(2)),
            valor_glosa: Number(getTvrValorRecuperar(r).toFixed(2)),
            motivo_glosa: motivo,
            complemento_glosa: `Apuração ${title} · Atend ${r.atendimento || "—"} · TUSS ${r.tuss || "—"}`,
            status: "vinculado",
            matched_payment_item_id: r.matched_payment_item_id ?? null,
            matched_payment_id: r.matched_payment_id ?? null,
            matched_company_id: groupCompanyId,
            match_source: "auditoria_retroativa",
            matched_at: new Date().toISOString(),
            hospital_id: hospitalIdRecon,
          };
        });
        const { data: insData, error: insErr } = await (supabase as never as typeof supabase)
          .from("glosa_items" as never)
          .insert(payload as never)
          .select("id");
        if (insErr || !insData) throw new Error(insErr?.message ?? `Falha ao gravar itens da glosa (${g.doctor_name}).`);
        allInsertedIdsByGroup.push({
          group: g,
          item_ids: (insData as Array<{ id: string }>).map((x) => x.id),
        });
      }
    } catch (e) {
      await supabase.from("glosa_items" as never).delete().eq("batch_id", batchId);
      await supabase.from("glosa_batches" as never).delete().eq("id", batchId);
      throw e;
    }

    // 3+4) Um RPC por grupo.
    //  - Se o grupo bater no unique-violation (23505 — já existe débito ATIVO
    //    para o par médico/PJ), NÃO abortar o lote: remove os glosa_items
    //    daquele grupo, registra em `skipped` e segue para os próximos médicos.
    //  - Qualquer outro erro faz rollback total (débitos criados + items + batch).
    const createdDebtIds: string[] = [];
    const skipped: Array<{ doctor_name: string; company_name: string | null; reason: string }> = [];
    const okGroups: GlosaGroup[] = [];
    try {
      for (const { group: g, item_ids } of allInsertedIdsByGroup) {
        const parcelasGrupo = Math.max(1, parcelasByDoctor[g.doctor_id] ?? parcelasFallback);
        const groupCompanyId = g.company_id ?? recon?.company_id ?? null;
        const { error: debtErr } = await supabase.rpc(
          "create_glosa_debt_with_items" as never,
          {
            p_company_id: groupCompanyId,
            p_doctor_crm: g.doctor_crm,
            p_doctor_name: g.doctor_name,
            p_parcelas: parcelasGrupo,
            p_item_ids: item_ids,
          } as never,
        );
        if (debtErr) {
          const raw = debtErr.message || String(debtErr);
          const isUnique = (debtErr as { code?: string })?.code === "23505"
            || /duplicate key|unique constraint|glosa_debts_company_doctor_active_key/i.test(raw);
          if (isUnique) {
            // Skip apenas este médico: apaga os glosa_items dele (ninguém foi
            // vinculado ainda) e segue. Não conta em `matched_items` do batch.
            await supabase.from("glosa_items" as never).delete().in("id", item_ids);
            skipped.push({
              doctor_name: g.doctor_name,
              company_name: g.company_name ?? null,
              reason: "Já existe débito ATIVO para este médico/PJ — quite/arquive em /glosas antes de gerar novo.",
            });
            continue;
          }
          // Erro estrutural: rollback total.
          throw new Error(`${g.doctor_name}: ${raw}`);
        }
        const { data: linkRows } = await supabase
          .from("glosa_debt_items" as never)
          .select("debt_id")
          .in("glosa_item_id", item_ids);
        const ids = Array.from(
          new Set(((linkRows ?? []) as Array<{ debt_id: string }>).map((x) => x.debt_id)),
        );
        createdDebtIds.push(...ids);
        okGroups.push(g);
      }
    } catch (e) {
      if (createdDebtIds.length > 0) {
        await supabase.from("glosa_debts" as never).delete().in("id", createdDebtIds);
      }
      await supabase.from("glosa_items" as never).delete().eq("batch_id", batchId);
      await supabase.from("glosa_batches" as never).delete().eq("id", batchId);
      throw e;
    }

    // Se TODOS foram pulados, o batch fica órfão — apaga.
    if (okGroups.length === 0) {
      await supabase.from("glosa_items" as never).delete().eq("batch_id", batchId);
      await supabase.from("glosa_batches" as never).delete().eq("id", batchId);
    }

    // Marca os itens efetivamente encaminhados (generated_adjustment_id =
    // referência do encaminhamento gerado). Sem isso o badge "Já encaminhado"
    // nunca aparece após gerar glosa — só no caminho de ajuste complementar.
    const forwardedRowIds = okGroups
      .flatMap((g) => g.items)
      .map((r) => r._retroReconRowId)
      .filter((x): x is string => !!x);
    if (forwardedRowIds.length > 0) {
      const { error: markErr } = await supabase
        .from("retroactive_reconciliation_items")
        .update({ generated_adjustment_id: batchId } as never)
        .in("id", forwardedRowIds);
      if (markErr) {
        console.error("Falha ao marcar itens como encaminhados:", markErr.message);
        toast({
          title: "Glosa gerada, mas a marcação falhou",
          description: "Os itens podem aparecer como não encaminhados até recarregar. Detalhe: " + markErr.message,
          variant: "destructive",
        });
      } else {
        const idSet = new Set(forwardedRowIds);
        setResults((prev) =>
          prev
            ? prev.map((r) =>
                r._retroReconRowId && idSet.has(r._retroReconRowId)
                  ? { ...r, _generatedAdjustmentId: batchId }
                  : r,
              )
            : prev,
        );
        setSelectedKeys(new Set());
      }
    }


    const usados = okGroups.map((g) => Math.max(1, parcelasByDoctor[g.doctor_id] ?? parcelasFallback));
    const min = usados.length ? Math.min(...usados) : 0;
    const max = usados.length ? Math.max(...usados) : 0;
    const parcelasResumo = usados.length === 0
      ? "—"
      : min === max ? `${min}×` : `variável (${min}–${max}×)`;

    const okItemsCount = okGroups.reduce((s, g) => s + g.items.length, 0);
    const okTotal = okGroups.reduce(
      (s, g) => s + g.items.reduce((ss, r) => ss + getTvrValorRecuperar(r), 0),
      0,
    );

    return {
      batch_id: okGroups.length ? batchId : null,
      debts: okGroups.length,
      items: okItemsCount,
      total: okTotal,
      parcelasResumo,
      skipped,
    };
  };

  const desfazerEncaminhamento = async (): Promise<void> => {
    if (!id || !recon?.summary) return;
    const ok = window.confirm(
      "Desfazer o encaminhamento desta apuração?\n\n" +
      "A marca de 'encaminhada' será removida e a apuração volta a ficar editável. " +
      "O histórico de processamentos e escopo selecionado são preservados. " +
      "Nenhum ajuste é revertido (este encaminhamento não gerou ajuste — apenas sugestão de confecção).",
    );
    if (!ok) return;
    const currentSummary = recon.summary as Record<string, unknown>;
    const nextSummary = { ...currentSummary };
    delete nextSummary.handoff;
    const { error } = await supabase
      .from("retroactive_reconciliations" as never)
      .update({ summary: nextSummary } as never)
      .eq("id", id);
    if (error) {
      toast({ title: "Falha ao desfazer encaminhamento", description: error.message, variant: "destructive" });
      return;
    }
    setRecon((prev) => prev ? { ...prev, summary: nextSummary as typeof prev.summary } : prev);
    toast({ title: "Encaminhamento desfeito", description: "A apuração voltou a ficar editável." });
  };



  const runEncaminharFluxo = async (opts: {
    includeComplementar: boolean;
    gerarGlosa: boolean;
    parcelas: number;
    parcelasByDoctor: Record<string, number>;
    selectedDoctorIds: string[];
  }) => {
    if (!results) return;
    // Tópico 2: itens marcados como excluir_do_encaminhamento saem
    // de TODO o pipeline de encaminhamento (complementar E glosa).
    const source = results.filter(notExcluded);
    const actionable = source.filter(isActionableTvr);
    const retirar = toRetirarItems(source);

    if (!opts.includeComplementar && !opts.gerarGlosa) {
      toast({ title: "Selecione ao menos um caminho", variant: "destructive" });
      return;
    }
    if (opts.includeComplementar && actionable.length === 0) {
      toast({ title: "Nada para complementar", variant: "destructive" });
      return;
    }
    if (opts.gerarGlosa && retirar.length === 0) {
      toast({ title: "Nada para retirar/gerar glosa", variant: "destructive" });
      return;
    }

    setEncaminharBusy(true);
    try {
      if (opts.gerarGlosa) {
        const { groups } = buildGlosaGroups(retirar);
        const selected = groups.filter((g) => opts.selectedDoctorIds.includes(g.doctor_id));
        if (selected.length === 0) {
          throw new Error("Nenhum médico selecionado para gerar glosa.");
        }
        const result = await createAuditoriaGlosaForGroups(selected, opts.parcelasByDoctor, opts.parcelas);
        const skippedMsg = result.skipped.length
          ? ` · ${result.skipped.length} pulado(s): ${result.skipped.map((s) => s.doctor_name).join(", ")}`
          : "";
        if (result.debts === 0) {
          toast({
            title: "Nenhuma glosa gerada",
            description: `Todos os médicos selecionados já possuem débito ATIVO na PJ. Quite/arquive em /glosas.${skippedMsg}`,
            variant: "destructive",
          });
        } else {
          toast({
            title: result.skipped.length ? "Glosa lançada parcialmente" : "Glosa de auditoria lançada",
            description: `${result.debts} débito(s) · ${result.items} itens · ${brl(result.total)} · parcelas ${result.parcelasResumo}${skippedMsg}. Veja em /glosas.`,
          });
        }
      }
      if (opts.includeComplementar) {
        setEncaminharOpen(false);
        await sendHandoffToConfeccao(actionable, { silent: true });
      } else {
        setEncaminharOpen(false);
      }
    } catch (e) {
      toast({
        title: "Falha no encaminhamento",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setEncaminharBusy(false);
    }
  };

  // ===== Reavaliar vínculos (Item 6) =====
  // Persiste o override retroactive_target_company_id em
  // retroactive_reconciliation_items e atualiza o resultado em memória.
  // `choices` é map de doctor_id → company_id escolhida (ou null para limpar).
  const applyReassignments = async (
    choices: Record<string, string | null>,
    reason: string,
  ): Promise<void> => {
    if (!results || Object.keys(choices).length === 0) return;
    setReavaliarBusy(true);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const nowIso = new Date().toISOString();
      // Agrupa items por (doctor_id, target). Só atualiza linhas com _retroReconRowId.
      const updates: Array<{ ids: string[]; target: string | null }> = [];
      for (const [did, target] of Object.entries(choices)) {
        const rowIds = results
          .filter((r) => r.matched_doctor_id === did && r._retroReconRowId && !r._generatedAdjustmentId)
          .map((r) => r._retroReconRowId!) as string[];
        if (rowIds.length > 0) updates.push({ ids: rowIds, target });
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("retroactive_reconciliation_items" as never)
          .update({
            retroactive_target_company_id: u.target,
            target_reassign_reason: u.target ? reason || "reatribuido_manual" : null,
            target_reassigned_by: u.target ? uid : null,
            target_reassigned_at: u.target ? nowIso : null,
          } as never)
          .in("id", u.ids);
        if (error) throw error;
      }
      // Atualiza estado em memória
      setResults((prev) =>
        prev
          ? prev.map((r) => {
              if (!r.matched_doctor_id || !(r.matched_doctor_id in choices)) return r;
              const target = choices[r.matched_doctor_id];
              return {
                ...r,
                retroactive_target_company_id: target,
                target_reassign_reason: target ? reason || "reatribuido_manual" : null,
              };
            })
          : prev,
      );
      toast({
        title: "Vínculos reavaliados",
        description: `${updates.length} médico(s) reatribuídos. Encaminhe a glosa quando quiser.`,
      });
      setReavaliarOpen(false);
    } catch (e) {
      toast({
        title: "Falha ao reatribuir vínculos",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setReavaliarBusy(false);
    }
  };








  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h3 className="text-lg font-semibold">{recon?.title ?? "TASY vs Repasse"}</h3>
            <p className="text-xs text-muted-foreground">
              TASY externo · repasse do sistema · resultado salvo na apuração
            </p>
          </div>
        </div>
        <Badge variant="outline">TASY vs Repasse</Badge>
      </div>

      {handoff && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3">
          <LockIcon className="h-5 w-5 text-amber-700 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              Apuração encaminhada para confecção · travada para edição
            </div>
            <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              {handoff.items_count} item(ns) enviados em {formatTvrDate(handoff.at.slice(0, 10))}
              {handoff.payment_reference ? ` · Ref. sugerida: ${handoff.payment_reference}` : ""}
              {typeof handoff.total_complementar === "number" ? ` · Complementar: ${brl(handoff.total_complementar)}` : ""}
              {typeof handoff.total_retirar === "number" ? ` · Retirar: ${brl(handoff.total_retirar)}` : ""}
            </div>
          </div>
          {handoff.payment_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/pagamentos/${handoff.payment_id}`)}
            >
              <ExternalLinkIcon className="h-3 w-3 mr-1" /> Abrir pagamento
            </Button>
          )}
          {!handoff.payment_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/pagamentos/novo?modo=confeccao&retro=${id}`)}
            >
              <SendIcon className="h-3 w-3 mr-1" /> Retomar confecção
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={desfazerEncaminhamento}
          >
            <RotateCcwIcon className="h-3 w-3 mr-1" /> Desfazer encaminhamento
          </Button>
        </div>
      )}



      {/* Step 1 — TASY file */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">1. Base TASY (realizado no hospital)</h4>
            <p className="text-[11px] text-muted-foreground">
              Um único arquivo .xlsx/.csv com o que foi realizado.
            </p>
          </div>
          {(tasyRows.length > 0 || tasyFileTotals) && (
            <Badge variant="default" className="text-[10px]">
              {tasyFileTotals
                ? `${tasyFileTotals.valid} de ${tasyFileTotals.file} linha(s) · ${tasyFile}`
                : `${tasyRows.length} linha(s) · ${tasyFile}`}
            </Badge>
          )}
        </div>
        <label className="flex items-center gap-3 border-2 border-dashed border-border rounded-lg py-4 px-4 cursor-pointer hover:bg-muted/40">
          <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm">{tasyRows.length > 0 ? "Substituir arquivo TASY" : "Selecionar arquivo TASY"}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickTasy(f);
              e.target.value = "";
            }}
          />
        </label>
        {tasyFileTotals && (tasyFileTotals.excluded > 0 || tasyFileTotals.dropped > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <Badge variant="outline">{tasyFileTotals.excluded} excluídas (visita/parecer/consulta)</Badge>
            <Badge variant="outline" className={tasyFileTotals.dropped > 0 ? "border-amber-500 text-amber-700" : ""}>
              {tasyFileTotals.dropped} descartadas (faltando dados)
            </Badge>
          </div>
        )}
        {tasyDroppedExamples.length > 0 && (
          <details className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px]">
            <summary className="cursor-pointer font-medium text-amber-800">
              Ver exemplos de linhas descartadas ({tasyDroppedExamples.length}{tasyFileTotals ? ` de ${tasyFileTotals.dropped}` : ""})
            </summary>
            <ul className="mt-2 space-y-0.5 text-amber-900">
              {tasyDroppedExamples.map((ex) => (
                <li key={ex.row_index}>
                  Linha {ex.row_index}: falta <strong>{ex.missing.join(", ")}</strong>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Step 2 — Repasse (auto, do sistema) */}
      <div className={cn("rounded-lg border border-border bg-card p-4 space-y-3", tasyRows.length === 0 && "opacity-60 pointer-events-none")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold">2. Repasse do sistema</h4>
            <p className="text-[11px] text-muted-foreground">
              Buscado em <code>payment_items</code>. Se lotes específicos foram selecionados na apuração, o motor
              filtra <strong>estritamente por eles</strong>; caso contrário, cai no mês da competência (pode misturar outros lotes).
              Use o filtro abaixo para restringir. Usa <code>procedure_amount</code> (valor base 100%, sem acordo).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loadingPayments && (
              <Badge variant="outline" className="text-[10px]">Buscando pagamentos do sistema…</Badge>
            )}
            {!loadingPayments && paymentsLoaded && (
              <Badge variant="default" className="text-[10px]">
                {pagRows.length} item(ns) carregados do sistema (payment_items)
              </Badge>
            )}
            {tasyRows.length > 0 && !loadingPayments && (
              <Button variant="outline" size="sm" onClick={() => void loadPaymentItems(recon)}>
                {paymentsLoaded ? "Recarregar" : "Buscar agora"}
              </Button>
            )}
          </div>
        </div>
        {paymentsLoaded && <LoteScopeFilter recon={recon} pagRows={pagRows} onChanged={() => void loadPaymentItems(recon)} />}
      </div>

      {/* Filtro: convênios excluídos da análise */}
      <details className={cn("border border-border rounded-lg text-xs bg-card", (tasyRows.length === 0 && pagRows.length === 0) && "opacity-60 pointer-events-none")}>
        <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2 select-none">
          <span className="font-medium text-foreground">Excluir convênios da análise</span>
          {excludedConvenios.length > 0 ? (
            <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
              {excludedConvenios.length} convênio(s) excluído(s)
            </span>
          ) : (
            <span className="ml-auto text-muted-foreground text-[11px]">nenhum</span>
          )}
        </summary>
        <div className="px-4 py-3 space-y-3 border-t border-border">
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Selecione convênios que operam por <strong>pacote / tratativa manual</strong> (ex.: Sul América, Particular).
            Itens desses convênios são <strong>removidos das duas bases</strong> (TASY e Repasse) antes do cruzamento —
            não geram "faltou pagar" nem "ausente base faturamento". Após alterar, clique em <strong>Processar</strong>.
          </p>
          {availableConvenios.length === 0 ? (
            <p className="text-muted-foreground italic">Nenhum convênio identificado nas bases carregadas.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
              {availableConvenios.map((conv) => {
                const checked = excludedConvenios.includes(conv.key);
                return (
                  <label
                    key={conv.key}
                    title={conv.label}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer transition-colors",
                      checked ? "border-primary/60 bg-accent/60" : "border-border bg-card hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setExcludedConvenios((prev) =>
                          checked ? prev.filter((c) => c !== conv.key) : [...prev, conv.key],
                        )
                      }
                      className="h-3.5 w-3.5 rounded"
                      style={{ accentColor: "hsl(var(--primary))" }}
                    />
                    <span className="flex-1 truncate text-[11px]">{conv.label}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{conv.count}</span>
                  </label>
                );
              })}
            </div>
          )}
          {excludedConvenios.length > 0 && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
                onClick={() => setExcludedConvenios([])}
              >
                Limpar seleção
              </button>
              {convenioFilterStats && (
                <span className="text-[11px] text-muted-foreground">
                  Último processamento: <strong className="text-foreground">{convenioFilterStats.tasyRemoved}</strong> linha(s) TASY e{' '}
                  <strong className="text-foreground">{convenioFilterStats.pagRemoved}</strong> linha(s) Repasse removida(s).
                </span>
              )}
            </div>
          )}
        </div>
      </details>

      {/* Painel informativo — PJs TASY sem vínculo no cadastro estadual */}
      {unresolvedPjPanel.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-medium text-foreground">
                PJs TASY fora do lote ({unresolvedPjPanel.reduce((s, x) => s + x.count, 0)} linha(s) ignoradas)
              </div>
              <div className="text-[11px] text-muted-foreground">
                Essas linhas não entram no cruzamento nem travam o processamento. Vincule apenas se alguma delas realmente pertencer ao lote atual.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void applyPjMapDraft()}
                disabled={pjMapApplying || Object.values(pjMapDraft).filter(Boolean).length === 0}
              >
                {pjMapApplying ? "Aplicando…" : "Aplicar vínculos"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setUnresolvedPjPanel([]);
                  setPjMapDraft({});
                }}
                disabled={pjMapApplying}
              >
                Fechar
              </Button>
            </div>
          </div>
          <div className="max-h-[320px] overflow-auto rounded border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">PJ na planilha (Empresa/Terceiro)</TableHead>
                  <TableHead className="w-[10%] text-right">Linhas</TableHead>
                  <TableHead>Vincular a PJ do cadastro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unresolvedPjPanel.map((s) => (
                  <TableRow key={s.raw}>
                    <TableCell className="font-mono text-xs">
                      {s.missing ? <span className="italic text-muted-foreground">(coluna Empresa vazia)</span> : s.raw}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                    <TableCell>
                      {s.missing ? (
                        <span className="text-[11px] text-muted-foreground">
                          Corrija a coluna na planilha e reimporte — sem PJ crua não dá para vincular.
                        </span>
                      ) : (
                        <Select
                          value={pjMapDraft[s.raw] ?? ""}
                          onValueChange={(v) => setPjMapDraft((prev) => ({ ...prev, [s.raw]: v }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione a PJ…" />
                          </SelectTrigger>
                          <SelectContent>
                            {companies.map((c) => (
                              <SelectItem key={c.id} value={c.id} className="text-xs">
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Step 3 — Process */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={async () => {
            if (tasyRows.length === 0 || loadingPayments) return;
            // Reprocessamento sempre recarrega o repasse do backend pelo lote/período
            // atual. Reutilizar `pagRows` salvo de rodada anterior reintroduzia itens
            // fora do escopo quando o analista ajustava o lote e clicava Processar.
            const rowsForProcess = await loadPaymentItems(recon);
            process(rowsForProcess);
          }}
          disabled={isLocked || processing || loadingPayments || tasyRows.length === 0}
          title={isLocked ? "Apuração encaminhada. Desfaça o encaminhamento antes de processar." : undefined}
        >
          <PlayIcon className="h-4 w-4 mr-1" />
          {processing ? "Processando…" : loadingPayments ? "Buscando repasse…" : "Processar"}
        </Button>
        {tasyRows.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Carregue a base TASY (etapa 1) para habilitar.</span>
        )}
        {tasyRows.length > 0 && pagRows.length === 0 && !loadingPayments && (
          <span className="text-[11px] text-muted-foreground">Repasse ainda não buscado — vamos buscar automaticamente ao processar.</span>
        )}
        {(tasyRows.length > 0 || pagRows.length > 0) && (
          <Button variant="outline" size="sm" onClick={() => void clearAll()} disabled={isLocked}>Limpar tudo</Button>
        )}
        {results && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Exportar</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Todos ({results.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportData("xlsx", "all")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("csv", "all")}>CSV (;)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("json", "all")}>JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filtrado — sub-aba atual ({visible.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportData("xlsx", "visible")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("csv", "visible")}>CSV (;)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("json", "visible")}>JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filtrado por tipo (ignora sub-aba)</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={visibleByTipo.valor === 0}
                onClick={() => void exportData("xlsx", "valor")}
              >
                Só Por valor ({visibleByTipo.valor}) — .xlsx
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={visibleByTipo.quantidade === 0}
                onClick={() => void exportData("xlsx", "presenca")}
              >
                Só Por presença ({visibleByTipo.quantidade}) — .xlsx
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={visibleByTipo.valor === 0 && visibleByTipo.quantidade === 0}
                onClick={() => void exportData("xlsx", "split")}
              >
                Ambas em 2 abas ({visibleByTipo.valor + visibleByTipo.quantidade}) — .xlsx
              </DropdownMenuItem>
            </DropdownMenuContent>

          </DropdownMenu>
        )}
        {results && !isLocked && (
          <div className="ml-auto flex items-center gap-2">
            {selectedKeys.size > 0 && (() => {
              // T3: dos selecionados, só os que NÃO estão excluídos e têm row id no banco
              // podem virar "excluir do encaminhamento" em lote.
              const excludableIds = (results ?? [])
                .filter((r) => selectedKeys.has(r.key) && !r.excluir_do_encaminhamento && r._retroReconRowId)
                .map((r) => r._retroReconRowId!) as string[];
              return (
                <>
                  <span className="text-[11px] text-muted-foreground">{selectedKeys.size} selecionado(s)</span>
                  {excludableIds.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openExcludeDialog(excludableIds)}
                      title="Marcar os selecionados como fora do encaminhamento (permanecem visíveis na lista)"
                    >
                      <BanIcon className="h-4 w-4 mr-1" />
                      Excluir do encaminhamento ({excludableIds.length})
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedKeys(new Set())}>
                    Limpar seleção
                  </Button>
                </>
              );
            })()}
            <Button
              size="sm"
              onClick={() => setEncaminharOpen(true)}
              disabled={results.filter(isActionableTvr).length === 0 && toRetirarItems(results).length === 0}
              title="Abrir revisão antes de encaminhar"
            >
              <SendIcon className="h-4 w-4 mr-1" />
              Encaminhar apuração
            </Button>
          </div>
        )}
      </div>

      {processing && procProgress && (() => {
        // Barra de progresso por etapa. Cruzando/enriquecendo mostram indeterminado
        // (uma varredura só); salvando mostra X/Y de linhas persistidas em lotes.
        const stepLabels: Record<ProcStep, string> = {
          cruzando: "Etapa 1/3 · Cruzando TASY × Repasse",
          enriquecendo: "Etapa 2/3 · Enriquecendo PJ e regras",
          salvando: "Etapa 3/3 · Salvando resultado",
        };
        const pct = procProgress.step === "salvando" && procProgress.total > 0
          ? Math.round((procProgress.current / procProgress.total) * 100)
          : procProgress.step === "cruzando" ? 20 : 60;
        const counter = procProgress.step === "salvando"
          ? `${procProgress.current.toLocaleString("pt-BR")} / ${procProgress.total.toLocaleString("pt-BR")} linhas`
          : `${procProgress.total.toLocaleString("pt-BR")} linha(s)`;
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{stepLabels[procProgress.step]}</span>
              <span className="text-muted-foreground tabular-nums">{counter}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        );
      })()}




      {/* Results */}
      {results && (
        <>
          {(() => {
            const knownSet = new Set<string>(TVR_STATUS_ORDER);
            const unknown = (results ?? []).filter((r) => !knownSet.has(r.status as string));
            const totalKnown = TVR_STATUS_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
            const missingTotal = (results?.length ?? 0) - totalKnown - unknown.length;
            const ausenteIncomplete = (results ?? []).filter((r) => getAusenteTasyMissingFields(r).length > 0);
            const missingByField = new Map<string, number>();
            for (const r of ausenteIncomplete) {
              for (const f of getAusenteTasyMissingFields(r)) {
                missingByField.set(f, (missingByField.get(f) ?? 0) + 1);
              }
            }
            return (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium uppercase tracking-wider text-muted-foreground">Validação</span>
                <span>Total: <b>{results.length}</b></span>
                {TVR_STATUS_ORDER.map((s) => (
                  <span key={s}>{TVR_STATUS_LABEL[s]}: <b>{counts[s] ?? 0}</b></span>
                ))}
                {unknown.length > 0 && (
                  <span className="text-destructive font-semibold">⚠ {unknown.length} classificação(ões) desconhecida(s): {Array.from(new Set(unknown.map((u) => String(u.status)))).join(", ")}</span>
                )}
                {missingTotal > 0 && (
                  <span className="text-destructive font-semibold">⚠ {missingTotal} sem status</span>
                )}
                {ausenteIncomplete.length > 0 && (
                  <span className="text-amber-700 font-semibold" title={ausenteIncomplete.map((r) => `${r.atendimento}/${r.tuss}: faltam ${getAusenteTasyMissingFields(r).join(", ")}`).join("\n")}>
                    ⚠ {ausenteIncomplete.length} Ausente base faturamento incompleta(s) — faltam: {Array.from(missingByField.entries()).map(([k, n]) => `${k} (${n})`).join(", ")}
                  </span>
                )}
                {unknown.length === 0 && missingTotal === 0 && ausenteIncomplete.length === 0 && (
                  <span className="text-emerald-700">✓ Todas as linhas classificadas e completas</span>
                )}
                {(() => {
                  const excluidos = (results ?? []).filter((r) => r.excluir_do_encaminhamento).length;
                  return excluidos > 0 ? (
                    <span className="text-[12px] text-muted-foreground">· {excluidos} excluído{excluidos === 1 ? "" : "s"} do encaminhamento</span>
                  ) : null;
                })()}
              </div>
            );
          })()}


          {(() => {
            // === Cards de resumo (redesign) ===
            // Base de leitura é a lista já filtrada pela sub-aba/filtros do
            // analista — assim os números batem com o que ele vê logo abaixo.
            const totalRecuperar = visible.reduce((s, r) => {
              if (r.excluir_do_encaminhamento) return s;
              const a = describeAcao(r);
              return s + (a.kind === "recuperar" ? Number(a.valor || 0) : 0);
            }, 0);
            const pjSet = new Set<string>();
            for (const r of visible) {
              const k = (r.pj_conciliada || r.pj_provavel || "").trim();
              if (k) pjSet.add(k);
            }
            const encaminhadosCount = (results ?? []).filter((r) => r.excluir_do_encaminhamento).length + selectedKeys.size;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Itens divergentes</div>
                  <div className="text-2xl font-semibold tabular-nums mt-1">{visible.length.toLocaleString("pt-BR")}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">de {results?.length ?? 0} no total</div>
                </div>
                <div className="rounded-lg border border-destructive/30 bg-destructive-soft/50 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-destructive">A recuperar</div>
                  <div className="text-2xl font-semibold tabular-nums text-destructive mt-1">{brl(totalRecuperar)}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">soma dos descontos sugeridos</div>
                </div>
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresas afetadas</div>
                  <div className="text-2xl font-semibold tabular-nums mt-1">{pjSet.size}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">PJs distintas na lista</div>
                </div>
                <div className="rounded-lg border border-success/30 bg-success-soft/40 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-success">Selecionados/tratados</div>
                  <div className="text-2xl font-semibold tabular-nums text-success mt-1">{encaminhadosCount}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">prontos para encaminhar ou já excluídos</div>
                </div>
              </div>
            );
          })()}

          {/* Grade antiga de status por contagem (mantida abaixo, colapsada,
              como referência técnica) */}
          <details className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground select-none">Detalhamento por status</summary>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-2">
              {TVR_STATUS_ORDER.map((s) => (
                <div key={s} className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{TVR_STATUS_LABEL[s]}</div>
                  <div className="text-lg font-semibold tabular-nums">{counts[s] ?? 0}</div>
                </div>
              ))}
            </div>
          </details>


          {/* Cards "Total a complementar" e "Total a retirar" removidos:
              em bases grandes divergiam do painel "Encaminhar apuração" porque
              esses cards agregam TODO o resultado (inclusive itens sem
              previsão de regra que só ganham valor real após a confecção),
              enquanto o painel só soma o subset actionable escolhido pelo
              analista. Como o valor definitivo só sai depois de encaminhar
              para apuração, o card virava fonte de falso positivo. O total
              autoritativo aparece no botão "Encaminhar apuração". */}



          {/* Card "Resumo de valores (grupo % sobre convênio)" removido:
              em hospitais com muitas variáveis de pagamento (ex.: DF Star) esses
              agregados macro geravam mais confusão do que clareza — o detalhe
              por linha na tabela abaixo já cobre a análise. */}





          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Sub-abas: cartões segmentados grandes, com ícone, cor por natureza da
                análise e contador destacado. Antes era uma barra fina com underline
                que passava despercebida — usuário demorava a notar que existiam duas. */}
            <div className="p-3 bg-muted/40 border-b border-border">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {([
                  {
                    key: "valor" as const,
                    label: "Por valor",
                    sublabel: "% do convênio",
                    hint: "Regras percentual_convenio — TASY e Exacta compartilham a base, então comparamos R$.",
                    Icon: PercentIcon,
                    // Tokens semânticos: azul para "análise por valor".
                    activeBg: "bg-primary/10",
                    activeBorder: "border-primary",
                    activeText: "text-primary",
                    accent: "bg-primary",
                  },
                  {
                    key: "quantidade" as const,
                    label: "Por presença",
                    sublabel: "pacote / valor fixo",
                    hint: "Regras com tabela própria — TASY não é base de R$, comparamos presença/quantidade.",
                    Icon: PackageIcon,
                    activeBg: "bg-amber-100/70 dark:bg-amber-500/15",
                    activeBorder: "border-amber-500",
                    activeText: "text-amber-800 dark:text-amber-300",
                    accent: "bg-amber-500",
                  },
                ]).map((tab) => {
                  const active = analysisTab === tab.key;
                  const n = countsByTipo[tab.key];
                  const Icon = tab.Icon;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setAnalysisTab(tab.key)}
                      title={tab.hint}
                      aria-pressed={active}
                      className={cn(
                        "relative flex items-center gap-3 rounded-md border-2 px-4 py-3 text-left transition-all",
                        active
                          ? cn(tab.activeBg, tab.activeBorder, "shadow-sm")
                          : "border-border bg-card hover:bg-muted/60 hover:border-muted-foreground/40",
                      )}
                    >
                      {/* Barra lateral colorida reforça o ativo */}
                      <span
                        className={cn(
                          "absolute left-0 top-0 bottom-0 w-1 rounded-l-sm",
                          active ? tab.accent : "bg-transparent",
                        )}
                        aria-hidden
                      />
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-md shrink-0",
                          active ? cn(tab.accent, "text-white") : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className={cn("text-sm font-semibold", active ? tab.activeText : "text-foreground")}>
                            {tab.label}
                          </span>
                          <span className={cn("text-xs", active ? tab.activeText : "text-muted-foreground")}>
                            {tab.sublabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                          {tab.hint}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "shrink-0 rounded-md px-2.5 py-1 text-sm font-bold tabular-nums",
                          active ? cn(tab.accent, "text-white") : "bg-muted text-muted-foreground",
                        )}
                      >
                        {n}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* === Barra de filtros simplificada === */}
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar PJ, médico, atendimento, TUSS..."
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 min-w-[170px] justify-between font-normal">
                    <span className="truncate text-xs">
                      {statusFilter.size === 0
                        ? "Todos os status"
                        : statusFilter.size === 1
                        ? TVR_STATUS_LABEL[Array.from(statusFilter)[0]]
                        : `${statusFilter.size} status`}
                    </span>
                    <ChevronsUpDownIcon className="h-3.5 w-3.5 opacity-50 ml-1 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-2" align="start">
                  <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-border">
                    <span className="text-[11px] font-medium text-muted-foreground">Filtrar status</span>
                    {statusFilter.size > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => setStatusFilter(new Set())}
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {TVR_STATUS_ORDER.map((s) => {
                      const checked = statusFilter.has(s);
                      return (
                        <label
                          key={s}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setStatusFilter((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(s);
                                else next.delete(s);
                                return next;
                              });
                            }}
                          />
                          <span>{TVR_STATUS_LABEL[s]}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <MultiSelectFilter
                label="PJ"
                allLabel="Todas as PJs"
                options={pjOptions}
                selected={pjFilter}
                onChange={setPjFilter}
              />
              <MultiSelectFilter
                label="Médico"
                allLabel="Todos os médicos"
                options={medicoOptions}
                selected={medicoFilter}
                onChange={setMedicoFilter}
              />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none px-2 h-9 rounded border border-border bg-card">
                <input
                  type="checkbox"
                  checked={onlyWithPayment}
                  onChange={(e) => setOnlyWithPayment(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Só com pagamento
              </label>
              <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setKeyAuditOpen(true)}>
                Auditoria de chave
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setReavaliarOpen(true)}
                disabled={isLocked}
                title="Escolher em qual PJ lançar a glosa quando o vínculo médico→PJ mudou desde o lote original"
              >
                Reavaliar vínculos
              </Button>
              {(() => {
                // Select-all global: só considera itens visíveis e efetivamente acionáveis
                // (selectable no grid). Marca/desmarca todos de uma vez respeitando os filtros.
                const globalSelectable = visible.filter((r) => isSelectableForEncaminhamento(r) && !isLocked && !r.excluir_do_encaminhamento);
                const selCount = globalSelectable.filter((r) => selectedKeys.has(r.key)).length;
                const allSel = globalSelectable.length > 0 && selCount === globalSelectable.length;
                const someSel = selCount > 0 && !allSel;
                return (
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none px-2 h-9 rounded border border-border bg-card">
                    <Checkbox
                      checked={allSel ? true : someSel ? "indeterminate" : false}
                      onCheckedChange={(v) => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (v) globalSelectable.forEach((r) => next.add(r.key));
                          else globalSelectable.forEach((r) => next.delete(r.key));
                          return next;
                        });
                      }}
                      disabled={globalSelectable.length === 0}
                    />
                    Selecionar todos
                  </label>
                );
              })()}
              <div className="text-xs text-muted-foreground tabular-nums">
                {visible.length} de {countsByTipo[analysisTab]}
              </div>
            </div>
            <KeyAuditDialog open={keyAuditOpen} onOpenChange={setKeyAuditOpen} results={results} />

            {/* === Legenda === */}
            <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wider">Legenda</span>
              <span className="inline-flex items-center gap-1.5">
                <ArrowDownIcon className="h-3.5 w-3.5 text-destructive" /> Valor reduzido pela auditoria
              </span>
              <span className="inline-flex items-center gap-1.5">
                <XIcon className="h-3.5 w-3.5 text-destructive" /> Removido do faturamento
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MinusIcon className="h-3.5 w-3.5 text-warning" /> Quantidade reduzida
              </span>
            </div>

            {/* === Lista agrupada por empresa === */}
            <div className={cn("p-3 space-y-2 bg-muted/10 max-h-[65vh] overflow-y-auto", selectedKeys.size > 0 && "pb-28")}>
              {visible.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-10">
                  Nenhum item corresponde ao filtro atual.
                </div>
              )}
              {(() => {
                const groups = new Map<string, TvrResult[]>();
                for (const r of visible) {
                  const pj = (r.pj_conciliada || r.pj_provavel || "— Sem PJ vinculada —").trim() || "— Sem PJ vinculada —";
                  if (!groups.has(pj)) groups.set(pj, []);
                  groups.get(pj)!.push(r);
                }
                const groupsList = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
                const GRID_COLS = "32px minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 160px";
                return groupsList.map(([pjName, items]) => {
                  const isOpen = !collapsedPjs.has(pjName);
                  const groupTotal = items.reduce((s, r) => {
                    if (r.excluir_do_encaminhamento) return s;
                    const a = describeAcao(r);
                    return s + (a.kind === "recuperar" ? Number(a.valor || 0) : 0);
                  }, 0);
                  // Checkbox no header da PJ: seleciona/desmarca todos os itens acionáveis daquele grupo.
                  const groupSelectable = items.filter((r) => isSelectableForEncaminhamento(r) && !isLocked && !r.excluir_do_encaminhamento);
                  const groupSelCount = groupSelectable.filter((r) => selectedKeys.has(r.key)).length;
                  const groupAllSel = groupSelectable.length > 0 && groupSelCount === groupSelectable.length;
                  const groupSomeSel = groupSelCount > 0 && !groupAllSel;
                  return (
                    <div key={pjName} className="rounded-lg border border-border bg-card overflow-hidden">
                      <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <Checkbox
                            checked={groupAllSel ? true : groupSomeSel ? "indeterminate" : false}
                            onCheckedChange={(v) => {
                              setSelectedKeys((prev) => {
                                const next = new Set(prev);
                                if (v) groupSelectable.forEach((r) => next.add(r.key));
                                else groupSelectable.forEach((r) => next.delete(r.key));
                                return next;
                              });
                            }}
                            disabled={groupSelectable.length === 0}
                            aria-label={`Selecionar todos os itens de ${pjName}`}
                          />
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePjCollapsed(pjName)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          {isOpen ? (
                            <ChevronDownIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <Building2Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm truncate flex-1" title={pjName}>
                            {pjName}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums">
                            {items.length} {items.length === 1 ? "item" : "itens"}
                          </span>
                          {groupTotal > 0 && (
                            <span className="inline-flex items-center rounded-full bg-destructive-soft border border-destructive/30 px-2 py-0.5 text-[11px] font-semibold text-destructive tabular-nums">
                              {brl(groupTotal)}
                            </span>
                          )}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="border-t border-border">
                          <div
                            className="grid gap-3 px-4 py-2 border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold"
                            style={{ gridTemplateColumns: GRID_COLS }}
                          >
                            <div />
                            <div>Procedimento</div>
                            <div className="text-right">Pago no lote</div>
                            <div className="text-right">Auditoria</div>
                            <div className="text-right">Desconto</div>
                            <div className="text-right">Ações</div>
                          </div>
                          <ul className="divide-y divide-border">
                            {items.map((r) => {
                              const acao = describeAcao(r);
                              const isExcluded = !!r.excluir_do_encaminhamento;
                              const isSelected = selectedKeys.has(r.key);
                              const selectable = isSelectableForEncaminhamento(r) && !isLocked && !isExcluded;
                              const pago = Number(r.valor_com_acordo ?? r.valor_pago_base ?? 0) || 0;
                              const auditoria = acao.kind === "recuperar"
                                ? Math.max(0, pago - Number(acao.valor || 0))
                                : pago;
                              const desconto = acao.kind === "recuperar" ? Number(acao.valor || 0) : 0;
                              return (
                                <li
                                  key={r.key}
                                  className={cn(
                                    "grid gap-3 px-4 py-3 items-start hover:bg-muted/20 transition-colors",
                                    isExcluded && "opacity-60",
                                    r._generatedAdjustmentId && "opacity-70 bg-muted/20",
                                    isSelected && "bg-primary/5",
                                  )}
                                  style={{ gridTemplateColumns: GRID_COLS }}
                                >
                                  <div className="pt-0.5">
                                    {selectable ? (
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(v) =>
                                          setSelectedKeys((prev) => {
                                            const n = new Set(prev);
                                            if (v) n.add(r.key);
                                            else n.delete(r.key);
                                            return n;
                                          })
                                        }
                                        aria-label="Selecionar item"
                                      />
                                    ) : null}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate" title={r.procedimento || undefined}>
                                      {r.procedimento || "—"}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      <span title={r.medico || undefined}>{r.medico || "—"}</span>
                                      <span className="mx-1">·</span>
                                      <span>Atend. {r.atendimento || "—"}</span>
                                      <span className="mx-1">·</span>
                                      <span>TUSS {r.tuss || "—"}</span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      <span>{formatTvrDate(r.data)}</span>
                                      <span className="mx-1">·</span>
                                      <span title={r.convenio || undefined}>{r.convenio || "—"}</span>
                                      <span className="mx-1">·</span>
                                      <span>{r.funcao || "—"}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                      <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", TVR_STATUS_TONE[r.status])}>
                                        {TVR_STATUS_LABEL[r.status]}
                                      </span>
                                      {r.sem_lastro_tasy && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-warning-soft text-warning border border-warning/30">
                                          sem lastro TASY
                                        </span>
                                      )}
                                      {r._generatedAdjustmentId && (
                                        <span
                                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          title="Este item já foi materializado em um ajuste financeiro anterior"
                                        >
                                          ✓ Já encaminhado
                                        </span>
                                      )}
                                      {r.retroactive_target_company_id && !r._generatedAdjustmentId && (
                                        <span
                                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-800 border border-blue-300"
                                          title="PJ de destino reatribuída manualmente pelo analista"
                                        >
                                          ↻ PJ reatribuída
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right tabular-nums text-sm text-muted-foreground line-through">
                                    {brl(pago)}
                                  </div>
                                  <div className="text-right tabular-nums text-sm font-medium text-primary">
                                    {brl(auditoria)}
                                  </div>
                                  <div className="text-right">
                                    <div className={cn("tabular-nums text-sm font-semibold", desconto > 0 ? "text-destructive" : "text-muted-foreground")}>
                                      {desconto > 0 ? `- ${brl(desconto)}` : acao.label}
                                    </div>
                                    {acao.hint && (
                                      <div className="text-[11px] text-muted-foreground leading-snug mt-0.5 text-right line-clamp-2" title={acao.hint}>
                                        {acao.hint}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1 items-stretch">
                                    {isExcluded ? (
                                      <>
                                        <span className="text-[10px] text-warning bg-warning-soft border border-warning/30 rounded px-2 py-1 text-center">
                                          Excluído · {reasonLabel(r.exclusion_reason)}
                                        </span>
                                        {r._retroReconRowId && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px]"
                                            onClick={async () => {
                                              const res = await unmarkExcluded([r._retroReconRowId!]);
                                              if (!res.ok) toast({ title: "Falha ao reincluir", description: res.error, variant: "destructive" });
                                              else toast({ title: "Item reincluído" });
                                            }}
                                          >
                                            <RotateCcwIcon className="h-3.5 w-3.5 mr-1" /> Reincluir
                                          </Button>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {/* Item 1: quando o checkbox está oculto por não-acionabilidade,
                                            mostrar um badge com o motivo (antes ficava vazio). */}
                                        {!selectable && describeNaoAcionavel(r) && (
                                          <span
                                            className="text-[10px] text-muted-foreground bg-muted border border-border rounded px-2 py-1 text-center"
                                            title="Este item não pode ser encaminhado nesta etapa"
                                          >
                                            {describeNaoAcionavel(r)}
                                          </span>
                                        )}
                                        {r._retroReconRowId && !isLocked && !r._generatedAdjustmentId && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] text-muted-foreground"
                                            onClick={() => openExcludeDialog([r._retroReconRowId!])}
                                          >
                                            <BanIcon className="h-3.5 w-3.5 mr-1" /> Ignorar
                                          </Button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}

      {wizard.kind === "tasy" && (
        <RetroactiveMappingWizard
          open
          fileName={wizard.fileName}
          headers={wizard.headers}
          rows={wizard.rows}
          targets={TASY_TARGETS}
          dialogTitle="Mapear colunas — Base TASY"
          companyMappingConfig={companies.length > 0 ? { companies, companyHintKey: "tasy_empresa" } : undefined}
          extraConfig={
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <Label className="text-[11px] text-muted-foreground">Códigos TUSS a excluir (separados por vírgula)</Label>
              <Input
                value={pendingTussExclude}
                onChange={(e) => setPendingTussExclude(e.target.value)}
                placeholder="Ex.: 10102019, 10102027"
                className="h-8 text-xs mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Itens com esses códigos são removidos de TASY <strong>e</strong> Repasse antes do cruzamento.
              </p>
            </div>
          }
          onCancel={() => setWizard({ kind: "none" })}
          onConfirm={confirmTasy}
        />
      )}

      {(() => {
        // Tópico 2: helper único para tirar do encaminhamento os itens
        // marcados como excluir_do_encaminhamento. Reutilizado pelo
        // runEncaminharFluxo — a lista principal da tela NÃO usa isso
        // (excluídos continuam visíveis, é só opt-out do envio).
        // Quando há seleção ativa, restringe encaminhaveis apenas aos itens
        // selecionados — assim tanto "Encaminhar apuração" (topo) quanto a
        // barra de ações flutuante (rodapé) operam sobre a mesma lista.
        const baseEncaminhaveis = (results ?? []).filter(notExcluded);
        const encaminhaveis = selectedKeys.size > 0
          ? baseEncaminhaveis.filter((r) => selectedKeys.has(r.key))
          : baseEncaminhaveis;
        const retirar = toRetirarItems(encaminhaveis);
        const { groups, unassigned } = buildGlosaGroups(retirar);
        // Modo médico único (apuração vinculada a 1 PJ+médico) exige recon.company_id.
        // Modo multi-médico: cada débito é criado por médico e a PJ é resolvida via
        // doctor_companies dentro de create_glosa_debt_with_items, então não faz
        // sentido travar pelo company_id do cabeçalho da apuração.
        const canGerarGlosa = groups.some((g) => g.items.length > 0)
          && (modoMedicoUnico ? !!recon?.company_id : true);
        return (
          <EncaminharApuracaoModal
            open={encaminharOpen}
            onOpenChange={(v) => { if (!encaminharBusy) setEncaminharOpen(v); }}
            headline={computeTvrHeadlineTotals(encaminhaveis)}
            actionable={encaminhaveis.filter(isActionableTvr)}
            retirar={retirar}
            groups={groups}
            unassigned={unassigned}
            canGerarGlosa={canGerarGlosa}
            modoMedicoUnico={modoMedicoUnico}
            busy={encaminharBusy}
            onConfirm={runEncaminharFluxo}
            refScope={{
              hospital_id: recon?.hospital_id ?? null,
              cost_center_code: recon?.cost_center_code ?? null,
              analysis_mode: recon?.analysis_mode ?? null,
            }}
          />
        );
      })()}

      {/* Item 6 — Reavaliar vínculos: escolher PJ de destino quando vínculo mudou */}
      <ReavaliarVinculosDialog
        open={reavaliarOpen}
        onOpenChange={(v) => { if (!reavaliarBusy) setReavaliarOpen(v); }}
        results={results ?? []}
        doctorPjMap={doctorPjMap}
        doctorAllPjsMap={doctorAllPjsMap}
        groupDoctorsMap={groupDoctorsMap}
        busy={reavaliarBusy}
        onConfirm={applyReassignments}
      />

      {/* T3 — Dialog de motivo para exclusão do encaminhamento */}
      <Dialog
        open={excludeDialog.open}
        onOpenChange={(v) => {
          if (excluding) return;
          if (!v) setExcludeDialog({ open: false, targetIds: [] });
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {excludeDialog.targetIds.length === 1
                ? "Excluir do encaminhamento"
                : `Excluir ${excludeDialog.targetIds.length} itens do encaminhamento`}
            </DialogTitle>
            <DialogDescription>
              Os itens somem da apuração mas continuam visíveis na lista.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo</Label>
              <Select value={excludeReason} onValueChange={(v) => setExcludeReason(v as ExclusionReason)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mudanca_data_administrativa">Mudança administrativa de data</SelectItem>
                  <SelectItem value="cancelamento_externo">Cancelamento externo</SelectItem>
                  <SelectItem value="duplicidade_ja_resolvida">Duplicidade já resolvida</SelectItem>
                  <SelectItem value="acordo_diferenciado">Acordo diferenciado</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {excludeReason === "outro" ? "Observação (obrigatória)" : "Observação (opcional)"}
              </Label>
              <Textarea
                value={excludeNote}
                onChange={(e) => setExcludeNote(e.target.value)}
                placeholder="Ex: data alterada em 12/07 conforme conferência com o setor…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcludeDialog({ open: false, targetIds: [] })} disabled={excluding}>
              Cancelar
            </Button>
            <Button
              onClick={() => void confirmExcludeDialog()}
              disabled={
                excluding ||
                !excludeReason ||
                (excludeReason === "outro" && excludeNote.trim().length === 0)
              }
            >
              {excluding ? "Excluindo…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Barra de ações em massa flutuante ===
          Aparece quando há ≥1 item selecionado. Reutiliza o mesmo fluxo
          individual (setEncaminharOpen abre o modal de revisão do
          encaminhamento; openExcludeDialog pede motivo e aplica em batch). */}
      {selectedKeys.size > 0 && !isLocked && (() => {
        const excludableIds = (results ?? [])
          .filter((r) => selectedKeys.has(r.key) && !r.excluir_do_encaminhamento && r._retroReconRowId)
          .map((r) => r._retroReconRowId!) as string[];
        const forwardableCount = (results ?? [])
          .filter((r) => selectedKeys.has(r.key) && isSelectableForEncaminhamento(r) && !r.excluir_do_encaminhamento)
          .length;
        return (
          <div
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur px-6 py-3 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.15)]"
            role="region"
            aria-label="Ações em massa"
          >
            <div className="mx-auto max-w-[1400px] flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold tabular-nums">{selectedKeys.size}</span>
                <span className="text-muted-foreground"> selecionado(s)</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => setEncaminharOpen(true)}
                  disabled={forwardableCount === 0}
                >
                  <SendIcon className="h-4 w-4 mr-1" />
                  Encaminhar selecionados{forwardableCount > 0 ? ` (${forwardableCount})` : ""}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openExcludeDialog(excludableIds)}
                  disabled={excludableIds.length === 0}
                >
                  <BanIcon className="h-4 w-4 mr-1" />
                  Ignorar selecionados{excludableIds.length > 0 ? ` (${excludableIds.length})` : ""}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedKeys(new Set())}
                >
                  <XIcon className="h-4 w-4 mr-1" />
                  Limpar seleção
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

