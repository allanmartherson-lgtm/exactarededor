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
import {
  Tabs as InnerTabs,
  TabsList as InnerTabsList,
  TabsTrigger as InnerTabsTrigger,
  TabsContent as InnerTabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { parseYmdLocal, addDaysYmd, competenceOfYmd, assertYmd } from "@/lib/dateUtils";
import { dbDateOrNull } from "@/lib/dateNormalize";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PlusIcon,
  Trash2Icon,
  PlayIcon,
  FileCheckIcon,
  UploadCloudIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  SendIcon,
  LockIcon,
  ExternalLinkIcon,
  CalendarIcon,
  PercentIcon,
  PackageIcon,
  BanIcon,
  RotateCcwIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  ArrowDown as ArrowDownIcon,
  X as XIcon,
  Minus as MinusIcon,
  Building2 as Building2Icon,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { computeTvrRulePreview } from "@/lib/tvrRulePreview";
import {
  deriveTipoAnaliseFromCalcType,
  formatPrevistoSourceLabel,
} from "@/lib/tvrSimulationMapping";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import RetroactiveMappingWizard, {
  readRawSheet,
  TASY_TARGETS,
  type TargetField,
} from "./RetroactiveMappingWizard";
import { DateInput } from "@/components/ui/date-input";
import { CompanyMappingList } from "@/components/shared/CompanyMappingList";
import { learnCompanyAlias, shouldLearnAlias } from "@/lib/learnCompanyAlias";

/** Campo de data com input mascarado dd/mm/aaaa + botão de calendário. */
function DatePickerCombo({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseYmdLocal(value) : undefined;
  return (
    <div className="flex gap-1">
      <DateInput value={value} onChange={onChange} className="flex-1" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Abrir calendário">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={selected}
            onSelect={(d) => {
              if (d) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                onChange(`${y}-${m}-${dd}`);
              } else {
                onChange("");
              }
              setOpen(false);
            }}
            initialFocus
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}


type ReconMode = "alegacao_medico" | "tasy_vs_repasse";
const MODE_STORAGE_PREFIX = "retro_mode__";
function getStoredMode(id: string): ReconMode {
  if (typeof window === "undefined") return "alegacao_medico";
  const v = window.sessionStorage.getItem(MODE_STORAGE_PREFIX + id);
  return v === "tasy_vs_repasse" ? "tasy_vs_repasse" : "alegacao_medico";
}
function setStoredMode(id: string, m: ReconMode) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MODE_STORAGE_PREFIX + id, m);
}

type Doctor = { id: string; full_name: string; crm: string; crm_uf: string };
type Company = { id: string; name: string; document: string | null };

type ReconRow = {
  id: string;
  doctor_id: string | null;
  company_id: string | null;
  hospital_id?: string | null;
  period_start: string;
  period_end: string;
  status: "em_analise" | "concluida" | "cancelada";
  title: string | null;
  // Origem do lote que gerou a apuração — usado para cruzar centro de custos
  // e trilha (prioritária/habitual) com o lote vigente da PJ na hora da glosa.
  source_payment_id?: string | null;
  cost_center_code?: string | null;
  analysis_mode?: string | null;
  summary: {
    mode?: ReconMode;
    total?: number;
    ok_pago?: number;
    pago_a_menos?: number;
    pago_a_mais?: number;
    nao_pago?: number;
    pago_outro_mes?: number;
    sem_lastro?: number;
    tuss_divergente?: number;
    total_gap?: number;
    total_excess?: number;
    tasy_file?: string;
    exclude_tuss?: string;
    excluded_convenios?: string[];
    processed_at?: string;
    tvr_counts?: Partial<Record<TvrStatus, number>>;
    tvr_ausente_incomplete?: number;
    tvr_validation_history?: Array<Record<string, unknown>>;
    tasy_file_totals?: { file: number; valid: number; excluded: number; dropped: number };
    tasy_dropped_examples?: Array<{ row_index: number; missing: string[] }>;
    // Escopo de PJ na criação
    scope?: "individual" | "multi_pj";
    multi_company_ids?: string[];
    multi_doctor_ids?: string[];
    multi_labels?: { companies?: string[]; doctors?: string[] };
    handoff?: {
      status: "encaminhada";
      payment_id?: string | null;
      payment_reference?: string | null;
      at: string;
      by?: string | null;
      items_count: number;
      total_complementar?: number;
      total_retirar?: number;
      item_keys?: string[];
    };
    // Lotes (payment_ids) que o analista fixou como universo da apuração.
    // Quando presente, o motor filtra por eles em vez do fallback por competência.
    selected_payment_ids?: string[];
    selected_payment_labels?: string[];
  } | null;
  adjustment_ids: string[];
  created_at: string;
  concluded_at: string | null;
};

type ItemRow = {
  id: string;
  attendance: string | null;
  tuss_code: string | null;
  procedure_date: string | null;
  patient_name: string | null;
  function_label: string | null;
  procedure_name: string | null;
  claimed_amount: number | null;
  claimed_quantity: number | null;
  paid_amount: number | null;
  paid_quantity: number | null;
  expected_amount: number | null;
  gap_amount: number | null;
  matched_payment_date: string | null;
  classification:
    | "ok_pago"
    | "pago_a_menos"
    | "pago_a_mais"
    | "nao_pago"
    | "pago_outro_mes"
    | "sem_lastro"
    | "tuss_divergente"
    | "pendente";
  classification_reason: string | null;
  payment_id: string | null;
};

type DraftItem = {
  _localId: string;
  source: "form" | "upload" | "paste";
  attendance: string;
  tuss_code: string;
  procedure_date: string;
  patient_name: string;
  function_label: string;
  procedure_name: string;
  claimed_amount: string;
  claimed_quantity: string;
  /** Nome bruto da PJ vindo da planilha (quando a coluna foi mapeada). */
  company_hint?: string;
  /** id da PJ cadastrada resolvida no passo "Vincular PJs" do wizard. */
  resolved_company_id?: string | null;
};

// Rótulos do fluxo legado (ItemRow). Mantidos alinhados aos novos rótulos do TVR
// para não gerar duas nomenclaturas para o mesmo conceito na UI.
const CLASS_LABEL: Record<ItemRow["classification"], string> = {
  ok_pago: "OK pago",
  pago_a_menos: "Pago a menos",
  pago_a_mais: "Pago a mais",
  nao_pago: "Faltou pagar",
  pago_outro_mes: "Pago em outro mês",
  sem_lastro: "Ausente base faturamento",
  tuss_divergente: "Pendência (TUSS faltante)",
  pendente: "Pendente",
};
const CLASS_TONE: Record<ItemRow["classification"], string> = {
  ok_pago: "bg-emerald-100 text-emerald-800",
  pago_a_menos: "bg-amber-100 text-amber-800",
  pago_a_mais: "bg-rose-100 text-rose-800",
  nao_pago: "bg-red-100 text-red-800",
  pago_outro_mes: "bg-blue-100 text-blue-800",
  sem_lastro: "bg-zinc-100 text-zinc-800",
  tuss_divergente: "bg-purple-100 text-purple-800",
  pendente: "bg-zinc-100 text-zinc-800",
};


function emptyDraft(): DraftItem {
  return {
    _localId: crypto.randomUUID(),
    source: "form",
    attendance: "",
    tuss_code: "",
    procedure_date: "",
    patient_name: "",
    function_label: "",
    procedure_name: "",
    claimed_amount: "",
    claimed_quantity: "",
  };
}

function brl(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Parser heurístico para texto colado (linhas com tab, ; ou múltiplos espaços) */
function parsePastedText(raw: string): DraftItem[] {
  const out: DraftItem[] = [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = line
      .split(/\t|;|\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 1) continue;
    // Heurística: [atendimento] [data?] [paciente?] [tuss?] [função?] [valor?]
    const d = emptyDraft();
    d.source = "paste";
    d.attendance = cols[0] ?? "";
    for (const c of cols.slice(1)) {
      const dateMatch = c.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})$/);
      const tussMatch = c.match(/^\d{6,10}$/);
      const moneyMatch = c.match(
        /^R?\$?\s?-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(\.\d+)?$/,
      );
      if (dateMatch && !d.procedure_date) {
        const yr = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
        d.procedure_date = `${yr}-${dateMatch[2]}-${dateMatch[1]}`;
      } else if (tussMatch && !d.tuss_code) {
        d.tuss_code = c;
      } else if (moneyMatch && !d.claimed_amount) {
        d.claimed_amount = c
          .replace(/[^\d,.-]/g, "")
          .replace(/\.(?=\d{3}(\D|$))/g, "")
          .replace(",", ".");
      } else if (!d.patient_name) {
        d.patient_name = c;
      } else if (!d.function_label) {
        d.function_label = c;
      }
    }
    out.push(d);
  }
  return out;
}

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
function ListView({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [items, setItems] = useState<ReconRow[]>([]);
  const [doctors, setDoctors] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<ReconRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("retroactive_reconciliations" as never)
      .select(
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, source_payment_id, cost_center_code, analysis_mode",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    const list = (data ?? []) as unknown as ReconRow[];
    setItems(list);
    const docIds = Array.from(new Set(list.map((r) => r.doctor_id).filter(Boolean))) as string[];
    const compIds = Array.from(new Set(list.map((r) => r.company_id).filter(Boolean))) as string[];
    if (docIds.length > 0) {
      const { data: docs } = await supabase.from("doctors").select("id, full_name").in("id", docIds);
      const m: Record<string, string> = {};
      (docs ?? []).forEach((d: { id: string; full_name: string }) => { m[d.id] = d.full_name; });
      setDoctors(m);
    }
    if (compIds.length > 0) {
      const { data: cs } = await supabase.from("companies").select("id, name").in("id", compIds);
      const m: Record<string, string> = {};
      (cs ?? []).forEach((c: { id: string; name: string }) => { m[c.id] = c.name; });
      setCompanies(m);
    }
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  const canDelete = (r: ReconRow) =>
    r.status !== "concluida" && (!r.adjustment_ids || r.adjustment_ids.length === 0);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    // Delete items first (FK), then the recon
    await supabase
      .from("retroactive_reconciliation_items" as never)
      .delete()
      .eq("reconciliation_id", toDelete.id);
    const { error } = await supabase
      .from("retroactive_reconciliations" as never)
      .delete()
      .eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Apuração excluída" });
    setToDelete(null);
    await reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Conciliação retroativa</h3>
          <p className="text-sm text-muted-foreground">
            Apure faltas alegadas pelo médico ou PJ em competências anteriores cruzando com o que já foi pago.
          </p>
        </div>
        <Button onClick={onNew} size="sm">
          <PlusIcon className="h-4 w-4 mr-1" /> Nova apuração
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aberta em</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>A complementar</TableHead>
              <TableHead>A descontar</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  Nenhuma apuração retroativa ainda.
                </TableCell>
              </TableRow>
            )}
            {!loading && items.map((r) => {
              const isMultiScope = r.summary?.scope === "multi_pj";
              const multiCompanyCount = r.summary?.multi_company_ids?.length ?? 0;
              const multiDoctorCount = r.summary?.multi_doctor_ids?.length ?? 0;
              const scope = isMultiScope
                ? `Múltiplas empresas · ${multiCompanyCount} PJ${multiCompanyCount === 1 ? "" : "s"}${multiDoctorCount > 0 ? ` · ${multiDoctorCount} médico${multiDoctorCount === 1 ? "" : "s"}` : ""}`
                : [
                    r.doctor_id ? doctors[r.doctor_id] ?? "Médico" : null,
                    r.company_id ? companies[r.company_id] ?? "PJ" : null,
                  ].filter(Boolean).join(" · ");
              const deletable = canDelete(r);
              return (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(r.id)}>
                  <TableCell className="text-[12.5px] whitespace-nowrap">
                    {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="font-medium">{scope || "—"}</TableCell>
                  <TableCell className="text-[12.5px]">
                    {format(parseYmdLocal(r.period_start), "dd/MM/yy")} → {format(parseYmdLocal(r.period_end), "dd/MM/yy")}
                  </TableCell>
                  <TableCell>{r.summary?.total ?? 0}</TableCell>
                  <TableCell className="font-semibold text-warning">{brl(r.summary?.total_gap)}</TableCell>
                  <TableCell className="font-semibold text-destructive">{brl(r.summary?.total_excess)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "concluida" ? "outline" : "default"}>
                      {r.status === "concluida" ? "Concluída" : r.status === "cancelada" ? "Cancelada" : "Em análise"}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!deletable}
                      title={deletable ? "Excluir apuração" : "Apuração com ajuste gerado não pode ser excluída"}
                      onClick={() => setToDelete(r)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir apuração retroativa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a apuração e todos os itens cruzados. Não afeta pagamentos já existentes.
              Apurações com ajuste de complemento já gerado não podem ser excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------- NEW -------------------------- */
function NewView({
  hospitalId,
  userId,
  onCreated,
  onCancel,
}: {
  hospitalId: string | null;
  userId: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<"individual" | "multi_pj">("individual");
  const [doctorId, setDoctorId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [multiCompanyIds, setMultiCompanyIds] = useState<string[]>([]);
  const [multiDoctorIds, setMultiDoctorIds] = useState<string[]>([]);
  const [docOpen, setDocOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ReconMode>("alegacao_medico");
  // Lotes elegíveis no período (só usado em TASY vs Repasse).
  type LoteOpt = {
    id: string;
    label: string;
    competence: string;
    reference: string;
    company_ids: string[];
    doctor_ids: string[];
    // Centro de custos e trilha (prioritária/habitual/padrao) do lote —
    // herdados pela apuração para casar com o lote vigente na hora da glosa.
    cost_center_code: string | null;
    analysis_mode: string | null;
  };
  const [availableLotes, setAvailableLotes] = useState<LoteOpt[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);

  useEffect(() => {
    void (async () => {
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const [all, cs] = await Promise.all([
        fetchAllPaginated<Doctor>((from, to) =>
          supabase
            .from("doctors")
            .select("id, full_name, crm, crm_uf")
            .eq("active", true)
            .order("full_name")
            .range(from, to),
        ),
        fetchAllPaginated<Company>((from, to) =>
          supabase
            .from("companies")
            .select("id, name, document")
            .eq("active", true)
            .order("name")
            .range(from, to),
        ),
      ]);
      setDoctors(all);
      setCompanies(cs);
    })();
  }, []);

  // Busca lotes elegíveis no período (qualquer escopo de TASY vs Repasse).
  // Um lote é elegível quando seu competence_month cai entre start..end.
  // Necessário também no escopo individual para o analista fixar o universo —
  // sem lote fixo, o motor cai no fallback por competência e mistura outros lotes.
  useEffect(() => {
    if (mode !== "tasy_vs_repasse") {
      setAvailableLotes([]);
      setSelectedPaymentIds([]);
      return;
    }
    if (!hospitalId || !start || !end) {
      setAvailableLotes([]);
      setSelectedPaymentIds([]);
      return;
    }
    let cancelled = false;
    setLoadingLotes(true);
    void (async () => {
      try {
        const startComp = start.slice(0, 7);
        const endComp = end.slice(0, 7);
        const { data: payments } = await supabase
          .from("payments")
          .select("id, reference, competence_month, cost_center_code, analysis_mode")
          .eq("hospital_id", hospitalId)
          .gte("competence_month", `${startComp}-01`)
          .lte("competence_month", `${endComp}-01`)
          .order("competence_month", { ascending: false })
          .order("reference", { ascending: true });
        if (cancelled) return;
        const paymentRows = (payments ?? []) as Array<{
          id: string;
          reference: string | null;
          competence_month: string | null;
          cost_center_code: string | null;
          analysis_mode: string | null;
        }>;
        if (paymentRows.length === 0) {
          setAvailableLotes([]);
          setSelectedPaymentIds([]);
          setLoadingLotes(false);
          return;
        }
        const paymentIds = paymentRows.map((p) => p.id);
        const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
        const items = await fetchAllPaginated<{ payment_id: string; company_id: string | null; doctor_id: string | null }>(
          (from, to) =>
            supabase
              .from("payment_items")
              .select("payment_id, company_id, doctor_id")
              .in("payment_id", paymentIds)
              .range(from, to),
        );
        if (cancelled) return;
        const compsByPayment = new Map<string, Set<string>>();
        const docsByPayment = new Map<string, Set<string>>();
        for (const it of items) {
          if (!it.payment_id) continue;
          if (it.company_id) {
            const s = compsByPayment.get(it.payment_id) ?? new Set<string>();
            s.add(it.company_id);
            compsByPayment.set(it.payment_id, s);
          }
          if (it.doctor_id) {
            const s = docsByPayment.get(it.payment_id) ?? new Set<string>();
            s.add(it.doctor_id);
            docsByPayment.set(it.payment_id, s);
          }
        }
        const opts: LoteOpt[] = paymentRows.map((p) => {
          const comp = p.competence_month ? String(p.competence_month).slice(0, 7) : "";
          const ref = String(p.reference ?? "").trim();
          const label = ref
            ? `${comp || "?"} · ${ref}`
            : `${comp || "?"} · ${p.id.slice(0, 8)}`;
          return {
            id: p.id,
            label,
            competence: comp,
            reference: ref,
            company_ids: Array.from(compsByPayment.get(p.id) ?? []),
            doctor_ids: Array.from(docsByPayment.get(p.id) ?? []),
            cost_center_code: p.cost_center_code,
            analysis_mode: p.analysis_mode,
          };
        });
        setAvailableLotes(opts);
        // Padrão: nenhum lote pré-selecionado — analista decide.
        setSelectedPaymentIds([]);
      } finally {
        if (!cancelled) setLoadingLotes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, hospitalId, start, end]);

  // Deriva PJs/médicos candidatos a partir dos lotes selecionados.
  // PJs padrão = todas dos lotes escolhidos; médicos padrão = nenhum (opcional).
  useEffect(() => {
    if (mode !== "tasy_vs_repasse" || scope !== "multi_pj") return;
    if (selectedPaymentIds.length === 0) {
      setMultiCompanyIds([]);
      setMultiDoctorIds([]);
      return;
    }
    const selected = availableLotes.filter((l) => selectedPaymentIds.includes(l.id));
    const comps = new Set<string>();
    for (const l of selected) for (const cid of l.company_ids) comps.add(cid);
    setMultiCompanyIds(Array.from(comps));
    setMultiDoctorIds([]);
  }, [selectedPaymentIds, availableLotes, mode, scope]);

  // Médicos candidatos derivados dos lotes selecionados.
  const candidateDoctorIds = React.useMemo(() => {
    if (mode !== "tasy_vs_repasse" || scope !== "multi_pj") return new Set<string>();
    const set = new Set<string>();
    for (const l of availableLotes) {
      if (!selectedPaymentIds.includes(l.id)) continue;
      for (const did of l.doctor_ids) set.add(did);
    }
    return set;
  }, [availableLotes, selectedPaymentIds, mode, scope]);

  const selectedDoctor = doctors.find((d) => d.id === doctorId);
  const selectedCompany = companies.find((c) => c.id === companyId);

  const submit = async () => {
    if (!hospitalId) {
      toast({ title: "Selecione um hospital ativo", variant: "destructive" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const effStart = mode === "tasy_vs_repasse" ? (start || today) : start;
    const effEnd = mode === "tasy_vs_repasse" ? (end || today) : end;
    // "Múltiplas empresas" só existe em TASY vs Repasse. Em Alegação do
    // médico o escopo é sempre individual (1 médico e/ou 1 PJ).
    const isMulti = mode === "tasy_vs_repasse" && scope === "multi_pj";
    if (!title.trim()) {
      toast({ title: "Informe um título para a apuração", variant: "destructive" });
      return;
    }
    if (mode === "alegacao_medico") {
      if ((!doctorId && !companyId) || !start || !end) {
        toast({ title: "Selecione médico e/ou PJ e o período", variant: "destructive" });
        return;
      }
    } else if (mode === "tasy_vs_repasse") {
      if (!start || !end) {
        toast({ title: "Selecione o período (De/Até) antes de continuar", variant: "destructive" });
        return;
      }
      // Sem lote fixo, o motor cai no fallback por competência do mês e
      // mistura outros lotes na conta — bloqueamos a criação até o analista escolher.
      if (selectedPaymentIds.length === 0) {
        toast({ title: "Selecione ao menos um lote a analisar", variant: "destructive" });
        return;
      }
      if (isMulti && multiCompanyIds.length === 0 && multiDoctorIds.length === 0) {
        toast({ title: "Selecione ao menos uma PJ ou médico no mapeamento", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const effectiveScope: "individual" | "multi_pj" = isMulti ? "multi_pj" : "individual";
    const summary: Record<string, unknown> = { mode, scope: effectiveScope };
    if (isMulti) {
      summary.multi_company_ids = multiCompanyIds;
      summary.multi_doctor_ids = multiDoctorIds;
      summary.multi_labels = {
        companies: multiCompanyIds.map((cid) => companies.find((c) => c.id === cid)?.name).filter(Boolean),
        doctors: multiDoctorIds.map((did) => doctors.find((d) => d.id === did)?.full_name).filter(Boolean),
      };
    }
    // Persiste os lotes selecionados INDEPENDENTE do modo/escopo — sem isso o
    // motor cai no filtro por competência e mistura outros lotes do mês.
    if (selectedPaymentIds.length > 0) {
      summary.selected_payment_ids = selectedPaymentIds;
      summary.selected_payment_labels = availableLotes
        .filter((l) => selectedPaymentIds.includes(l.id))
        .map((l) => l.label);
    }
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
        };
      };
    })
      .from("retroactive_reconciliations")
      .insert({
        hospital_id: hospitalId,
        doctor_id: isMulti ? null : (doctorId || null),
        company_id: isMulti ? null : (companyId || null),
        period_start: effStart,
        period_end: effEnd,
        title: title.trim(),
        summary,
        created_by: userId,
        // Herda origem do PRIMEIRO lote selecionado — âncora para casar
        // centro de custos + trilha na hora de calcular parcelamento da glosa.
        // Se múltiplos lotes tiverem CC/trilha diferentes, guarda o do primeiro
        // (analista pode revisar depois; a UI da glosa avisa quando divergir).
        source_payment_id: selectedPaymentIds[0] ?? null,
        cost_center_code:
          availableLotes.find((l) => l.id === selectedPaymentIds[0])?.cost_center_code ?? null,
        analysis_mode:
          availableLotes.find((l) => l.id === selectedPaymentIds[0])?.analysis_mode ?? null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar apuração", description: error?.message, variant: "destructive" });
      return;
    }
    const newId = (data as { id: string }).id;
    setStoredMode(newId, mode);
    onCreated(newId);
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={onCancel} className="self-start">
        <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
      </Button>
      <h3 className="text-lg font-semibold">Nova apuração retroativa</h3>

      <div className="rounded-lg border border-border bg-card p-3">
        <Label className="text-xs">Modo de apuração</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
          {([
            ["alegacao_medico", "Alegação do médico", "Médico/PJ informa o que faltou — cruza com o que já foi pago no sistema."],
            ["tasy_vs_repasse", "TASY vs Repasse", "Compara base TASY (realizado) com o repasse já gravado no sistema (payment_items). Análise ad-hoc, sem cruzamento via edge function."],
          ] as const).map(([k, lbl, desc]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={cn(
                "text-left rounded-md border px-3 py-2 transition-colors",
                mode === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                {mode === k && <CheckIcon className="h-3.5 w-3.5 text-primary" />}
                {lbl}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {mode === "tasy_vs_repasse" && (
        <div className="rounded-lg border border-border bg-card p-3">
          <Label className="text-xs">Escopo da apuração</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
            {([
              ["individual", "Análise individual", "1 médico e/ou 1 PJ. Cruzamento restrito a esse par."],
              ["multi_pj", "Múltiplas empresas", "Várias PJs de vários médicos. Você seleciona o mapeamento manual."],
            ] as const).map(([k, lbl, desc]) => (
              <button
                key={k}
                type="button"
                onClick={() => setScope(k)}
                className={cn(
                  "text-left rounded-md border px-3 py-2 transition-colors",
                  scope === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  {scope === k && <CheckIcon className="h-3.5 w-3.5 text-primary" />}
                  {lbl}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground -mt-1">
        {mode === "alegacao_medico"
          ? "Informe o médico, a PJ, ou ambos. Selecionar a PJ restringe o cruzamento aos pagamentos daquela empresa."
          : (scope === "multi_pj"
              ? "Escolha primeiro o período. O sistema traz os lotes elegíveis; ao selecionar um ou mais, PJs e médicos ficam restritos ao universo desses lotes."
              : "Médico, PJ e período são opcionais — servem apenas para identificar esta apuração.")}
      </p>

      {/* Passo Data — visível em qualquer TASY vs Repasse (individual e multi_pj).
          Data é pré-requisito pra listar os lotes elegíveis abaixo. */}
      {mode === "tasy_vs_repasse" && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <Label className="text-xs">1. Período da apuração</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">De</Label>
              <DatePickerCombo value={start} onChange={setStart} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Até</Label>
              <DatePickerCombo value={end} onChange={setEnd} />
            </div>
          </div>
        </div>
      )}

      {/* Passo Lotes — visível em qualquer TASY vs Repasse após período preenchido.
          Sem lote fixado, o motor cai no fallback por competência do mês e
          contamina os totais com outros lotes — por isso é obrigatório. */}
      {mode === "tasy_vs_repasse" && start && end && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              2. Lote(s) a analisar {availableLotes.length > 0 && (
                <span className="text-muted-foreground font-normal">
                  · {selectedPaymentIds.length}/{availableLotes.length} selecionado{selectedPaymentIds.length === 1 ? "" : "s"}
                </span>
              )}
            </Label>
            {availableLotes.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPaymentIds(availableLotes.map((l) => l.id))}
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPaymentIds([])}
                >
                  Limpar
                </button>
              </div>
            )}
          </div>
          {loadingLotes ? (
            <div className="text-xs text-muted-foreground py-4 text-center">Buscando lotes no período…</div>
          ) : availableLotes.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Nenhum lote encontrado com competência entre {start.slice(0, 7)} e {end.slice(0, 7)}.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
              {availableLotes.map((l) => {
                const checked = selectedPaymentIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedPaymentIds((cur) =>
                          e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id),
                        );
                      }}
                      className="h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {l.company_ids.length} PJ{l.company_ids.length === 1 ? "" : "s"} · {l.doctor_ids.length} médico{l.doctor_ids.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {(mode === "alegacao_medico" || scope === "individual") && (
          <div className="md:col-span-2">
            <Label>Médico</Label>
            <Popover open={docOpen} onOpenChange={setDocOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !selectedDoctor && "text-muted-foreground")}>
                    {selectedDoctor
                      ? `${selectedDoctor.full_name} (${selectedDoctor.crm}/${selectedDoctor.crm_uf})`
                      : "Buscar médico por nome ou CRM…"}
                  </span>
                  <ChevronsUpDownIcon className="h-4 w-4 opacity-50 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command
                  filter={(value, search) => {
                    const s = search.toLowerCase();
                    return value.toLowerCase().includes(s) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Digite nome ou CRM…" />
                  <CommandList>
                    <CommandEmpty>Nenhum médico.</CommandEmpty>
                    <CommandGroup>
                      {doctorId && (
                        <CommandItem
                          value="__clear__"
                          onSelect={() => { setDoctorId(""); setDocOpen(false); }}
                        >
                          <span className="text-muted-foreground">Limpar seleção</span>
                        </CommandItem>
                      )}
                      {doctors.map((d) => {
                        const v = `${d.full_name} ${d.crm} ${d.crm_uf}`;
                        return (
                          <CommandItem
                            key={d.id}
                            value={v}
                            onSelect={() => { setDoctorId(d.id); setDocOpen(false); }}
                          >
                            <CheckIcon className={cn("h-4 w-4 mr-2", doctorId === d.id ? "opacity-100" : "opacity-0")} />
                            {d.full_name} <span className="ml-1 text-muted-foreground">({d.crm}/{d.crm_uf})</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {(mode === "alegacao_medico" || scope === "individual") && (
          <div className="md:col-span-2">
            <Label>PJ / Empresa</Label>
            <Popover open={compOpen} onOpenChange={setCompOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !selectedCompany && "text-muted-foreground")}>
                    {selectedCompany
                      ? `${selectedCompany.name}${selectedCompany.document ? ` · ${selectedCompany.document}` : ""}`
                      : "Buscar PJ por nome ou CNPJ…"}
                  </span>
                  <ChevronsUpDownIcon className="h-4 w-4 opacity-50 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Digite nome ou CNPJ…" />
                  <CommandList>
                    <CommandEmpty>Nenhuma PJ.</CommandEmpty>
                    <CommandGroup>
                      {companyId && (
                        <CommandItem
                          value="__clear__"
                          onSelect={() => { setCompanyId(""); setCompOpen(false); }}
                        >
                          <span className="text-muted-foreground">Limpar seleção</span>
                        </CommandItem>
                      )}
                      {companies.map((c) => {
                        const v = `${c.name} ${c.document ?? ""}`;
                        return (
                          <CommandItem
                            key={c.id}
                            value={v}
                            onSelect={() => { setCompanyId(c.id); setCompOpen(false); }}
                          >
                            <CheckIcon className={cn("h-4 w-4 mr-2", companyId === c.id ? "opacity-100" : "opacity-0")} />
                            {c.name}
                            {c.document && <span className="ml-1 text-muted-foreground">· {c.document}</span>}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {mode === "tasy_vs_repasse" && scope === "multi_pj" && selectedPaymentIds.length > 0 && (() => {
          const loteCompanyIds = new Set<string>();
          for (const l of availableLotes) {
            if (!selectedPaymentIds.includes(l.id)) continue;
            for (const cid of l.company_ids) loteCompanyIds.add(cid);
          }
          const scopedCompanies = companies.filter((c) => loteCompanyIds.has(c.id));
          return (
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>3. PJs incluídas ({multiCompanyIds.length}/{scopedCompanies.length})</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiCompanyIds(scopedCompanies.map((c) => c.id))}
                  >
                    Marcar todas
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiCompanyIds([])}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                PJs derivadas do(s) lote(s) selecionado(s). Padrão: todas incluídas.
              </p>
              <CompanyMappingList
                variant="checkbox"
                rows={scopedCompanies.map((c) => ({
                  key: c.id,
                  rawLabel: c.document ? `${c.name} · ${c.document}` : c.name,
                  level: null,
                }))}
                value={Object.fromEntries(scopedCompanies.map((c) => [c.id, multiCompanyIds.includes(c.id) ? c.id : null]))}
                onChange={(cid, next) =>
                  setMultiCompanyIds((cur) =>
                    next ? (cur.includes(cid) ? cur : [...cur, cid]) : cur.filter((x) => x !== cid),
                  )
                }
                maxHeight={220}
              />
            </div>
          );
        })()}

        {mode === "tasy_vs_repasse" && scope === "multi_pj" && selectedPaymentIds.length > 0 && (() => {
          const scopedDoctors = doctors.filter((d) => candidateDoctorIds.has(d.id));
          return (
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>
                  4. Médicos ({multiDoctorIds.length}/{scopedDoctors.length}){" "}
                  <span className="text-muted-foreground font-normal">— opcional</span>
                </Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiDoctorIds(scopedDoctors.map((d) => d.id))}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiDoctorIds([])}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Médicos derivados do(s) lote(s). Deixe todos desmarcados para incluir todos.
              </p>
              <CompanyMappingList
                variant="checkbox"
                rows={scopedDoctors.map((d) => ({
                  key: d.id,
                  rawLabel: `${d.full_name} (${d.crm}/${d.crm_uf})`,
                  level: null,
                }))}
                value={Object.fromEntries(scopedDoctors.map((d) => [d.id, multiDoctorIds.includes(d.id) ? d.id : null]))}
                onChange={(did, next) =>
                  setMultiDoctorIds((cur) =>
                    next ? (cur.includes(did) ? cur : [...cur, did]) : cur.filter((x) => x !== did),
                  )
                }
                maxHeight={220}
              />
            </div>
          );
        })()}

        {/* Datas em modos que não usam o passo de lotes (alegação ou individual) */}
        {!(mode === "tasy_vs_repasse" && scope === "multi_pj") && (
          <>
            <div>
              <Label>De</Label>
              <DatePickerCombo value={start} onChange={setStart} />
            </div>
            <div>
              <Label>Até</Label>
              <DatePickerCombo value={end} onChange={setEnd} />
            </div>
          </>
        )}
        <div className="md:col-span-2">
          <Label>Título <span className="text-destructive">*</span></Label>
          <Input
            placeholder="Ex.: Falta de pagamentos março/2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving ? "Criando…" : "Criar e seguir"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/* -------------------------- DETAIL -------------------------- */
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

function AlegacaoDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  // hospitalId não usado neste view — companies aqui é cadastro estadual (sem escopo por hospital)
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [doctorName, setDoctorName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([emptyDraft()]);
  const [pasted, setPasted] = useState("");
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; aliases: string[] }>>([]);
  const [wizard, setWizard] = useState<
    | { open: false }
    | { open: true; fileName: string; headers: string[]; rows: Record<string, unknown>[] }
  >({ open: false });

  // Universo de PJs candidatas para o passo "Vincular PJs" do wizard.
  // companies é tabela de cadastro estadual (sem hospital_id) — alinhado ao
  // resto do fluxo de criação (linhas 577-585).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, name, aliases")
        .eq("active", true)
        .order("name");
      if (cancelled) return;
      setCompanies(((data ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>).map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases ?? [],
      })));
    })();
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    const { data: r } = await supabase
      .from("retroactive_reconciliations" as never)
      .select(
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, source_payment_id, cost_center_code, analysis_mode",
      )
      .eq("id", id)
      .single();
    const row = r as unknown as ReconRow | null;
    setRecon(row);
    if (row?.doctor_id) {
      const { data: d } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", row.doctor_id)
        .single();
      setDoctorName((d as { full_name?: string } | null)?.full_name ?? "");
    } else {
      setDoctorName("");
    }
    if (row?.company_id) {
      const { data: c } = await supabase
        .from("companies")
        .select("name")
        .eq("id", row.company_id)
        .single();
      setCompanyName((c as { name?: string } | null)?.name ?? "");
    } else {
      setCompanyName("");
    }
    // Pagina — sem isso apurações com >1000 itens ficam truncadas.
    const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
    const its = await fetchAllPaginated<ItemRow>((from, to) =>
      supabase
        .from("retroactive_reconciliation_items" as never)
        .select(
          "id, attendance, tuss_code, procedure_date, patient_name, function_label, procedure_name, claimed_amount, claimed_quantity, paid_amount, paid_quantity, expected_amount, gap_amount, matched_payment_date, classification, classification_reason, payment_id",
        )
        .eq("reconciliation_id", id)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    setItems(its as unknown as ItemRow[]);
  };

  useEffect(() => {
    void load();
  }, [id]);

  const addDraft = () => setDrafts((d) => [...d, emptyDraft()]);
  const updateDraft = (idx: number, patch: Partial<DraftItem>) =>
    setDrafts((d) => d.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const removeDraft = (idx: number) => setDrafts((d) => d.filter((_, i) => i !== idx));

  const onUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadedFileName(file.name);
    try {
      const { headers, rows } = await readRawSheet(file);
      if (rows.length === 0) {
        toast({
          title: "Planilha vazia",
          description: "A primeira aba não tem linhas de dados.",
          variant: "destructive",
        });
        setUploadLoading(false);
        return;
      }
      setWizard({ open: true, fileName: file.name, headers, rows });
    } catch (e) {
      toast({
        title: "Erro ao ler planilha",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUploadLoading(false);
    }
  };

  const applyMapping = (
    mapped: Record<string, string>[],
    meta?: { companyMapping?: Record<string, string | null> },
  ) => {
    const cMap = meta?.companyMapping ?? {};

    // Validação de schema: normaliza data e coleta linhas inválidas
    // (sem chave mínima ou com data em formato irreconhecível).
    const rejected: { line: number; reason: string }[] = [];
    const accepted: DraftItem[] = [];

    mapped.forEach((m, idx) => {
      const line = idx + 2; // header + 1-based
      const attendance = (m.attendance ?? "").trim();
      const tuss = (m.tuss_code ?? "").trim();
      const rawDate = (m.procedure_date ?? "").trim();

      if (!attendance && !tuss) {
        rejected.push({ line, reason: "sem atendimento nem TUSS" });
        return;
      }

      let normalizedDate = "";
      if (rawDate) {
        const ymd = dbDateOrNull(rawDate);
        if (!ymd) {
          rejected.push({ line, reason: `data inválida "${rawDate}" (use YYYY-MM-DD ou DD/MM/YYYY)` });
          return;
        }
        normalizedDate = ymd;
      }

      const claimedAmount = (m.claimed_amount ?? "").trim();
      if (claimedAmount && !Number.isFinite(num(claimedAmount))) {
        rejected.push({ line, reason: `valor inválido "${claimedAmount}"` });
        return;
      }

      const raw = (m.company_hint ?? "").trim();
      const resolvedCompanyId = raw ? cMap[raw] ?? null : null;
      accepted.push({
        _localId: crypto.randomUUID(),
        source: "upload",
        attendance,
        tuss_code: tuss,
        procedure_date: normalizedDate,
        patient_name: m.patient_name ?? "",
        function_label: m.function_label ?? "",
        procedure_name: m.procedure_name ?? "",
        claimed_amount: claimedAmount,
        claimed_quantity: m.claimed_quantity ?? "",
        company_hint: raw,
        resolved_company_id: resolvedCompanyId,
      });
    });

    setDrafts((d) => [...d.filter((x) => x.attendance || x.tuss_code), ...accepted]);
    setWizard({ open: false });

    // Persiste vínculos aprendidos (alias) + salva mapping no summary da reconciliação.
    void (async () => {
      if (!meta?.companyMapping) return;
      const entries = Object.entries(meta.companyMapping);
      let learned = 0;
      for (const [raw, companyId] of entries) {
        if (!companyId) continue;
        const company = companies.find((c) => c.id === companyId);
        if (!company) continue;
        if (!shouldLearnAlias(raw, company)) continue;
        const res = await learnCompanyAlias(supabase, { companyId, rawName: raw });
        if (res.ok) learned++;
      }
      // Persistir mapping no summary (auditoria, reaproveitamento).
      if (recon) {
        const nextSummary = {
          ...(recon.summary ?? {}),
          company_mapping: meta.companyMapping,
        };
        await supabase
          .from("retroactive_reconciliations" as never)
          .update({ summary: nextSummary } as never)
          .eq("id", id);
      }
      if (learned > 0) {
        toast({ title: `${learned} apelido(s) de PJ aprendido(s) para próximas importações` });
      }
    })();

    if (rejected.length > 0) {
      const preview = rejected.slice(0, 5).map((r) => `linha ${r.line}: ${r.reason}`).join(" · ");
      const extra = rejected.length > 5 ? ` (+${rejected.length - 5} outras)` : "";
      toast({
        title: `${rejected.length} linha(s) rejeitada(s) na validação`,
        description: `${preview}${extra}`,
        variant: "destructive",
      });
    }
    if (accepted.length > 0) {
      toast({ title: `${accepted.length} linha(s) carregadas da planilha` });
    } else if (rejected.length === 0) {
      toast({ title: "Nenhuma linha aproveitada", variant: "destructive" });
    }
  };

  const onPasteApply = () => {
    const parsed = parsePastedText(pasted);
    if (parsed.length === 0) {
      toast({ title: "Nada parseado do texto colado", variant: "destructive" });
      return;
    }
    setDrafts((d) => [...d.filter((x) => x.attendance || x.tuss_code), ...parsed]);
    setPasted("");
    toast({ title: `${parsed.length} linha(s) adicionadas` });
  };

  const runReconciliation = async () => {
    const valid = drafts.filter((d) => d.attendance || d.tuss_code || d.claimed_amount);
    if (valid.length === 0) {
      toast({ title: "Adicione ao menos um item", variant: "destructive" });
      return;
    }
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("run-retroactive-reconciliation", {
      body: {
        reconciliation_id: id,
        items: valid.map((d) => ({
          source: d.source,
          attendance: d.attendance || null,
          tuss_code: d.tuss_code || null,
          procedure_date: d.procedure_date || null,
          patient_name: d.patient_name || null,
          function_label: d.function_label || null,
          procedure_name: d.procedure_name || null,
          claimed_amount: d.claimed_amount ? Number(d.claimed_amount) : null,
          claimed_quantity: d.claimed_quantity ? Number(d.claimed_quantity) : 1,
        })),
      },
    });
    setRunning(false);
    if (error) {
      toast({ title: "Erro no cruzamento", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cruzamento concluído" });
    setDrafts([emptyDraft()]);
    await load();
    void data;
  };

  const generateAdjustment = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("generate-retroactive-adjustment", {
      body: { reconciliation_id: id },
    });
    setGenerating(false);
    if (error || (data as { error?: string })?.error) {
      let msg = error?.message ?? (data as { error?: string })?.error ?? "Falha desconhecida";
      try {
        const ctxBody = (error?.context as { body?: unknown } | undefined)?.body;
        if (typeof ctxBody === "string") {
          const parsed = JSON.parse(ctxBody);
          if (parsed?.error) msg = String(parsed.error);
        }
      } catch {
        // keep msg
      }
      toast({ title: "Erro ao gerar ajuste", description: String(msg), variant: "destructive" });
      return;
    }
    toast({
      title: "Ajuste de complemento gerado",
      description: `Total ${brl((data as { total?: number })?.total)}`,
    });
    await load();
  };

  const [statusFilter, setStatusFilter] = useState<ItemRow["classification"] | "all">("all");
  const [procSearch, setProcSearch] = useState("");
  const filteredItems = useMemo(() => {
    const q = procSearch.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.classification !== statusFilter) return false;
      if (q && !(i.procedure_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, statusFilter, procSearch]);

  // Extrai dos motivos da divergência ("...com TUSS X, Y, Z — alegado ...")
  function parseDivergence(reason: string | null): { tuss: string; valor: string } {
    if (!reason) return { tuss: "", valor: "" };
    const tussMatch = reason.match(/com TUSS\s+([0-9,\s]+?)\s+—/i);
    const valMatch = reason.match(/pago\s*\(R\$\s*([\d.,]+)\)/i);
    return {
      tuss: tussMatch ? tussMatch[1].trim() : "",
      valor: valMatch ? valMatch[1].trim() : "",
    };
  }

  // Formato seguro de data (evita shift de timezone com "YYYY-MM-DD")
  function fmtDate(d: string | null, pattern = "dd/MM/yyyy"): string {
    if (!d) return "—";
    const iso = d.slice(0, 10);
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return d;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return format(dt, pattern);
  }

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const rows = items.map((it) => {
      const div = parseDivergence(it.classification_reason);
      return {
        Médico: doctorName ?? "",
        Atendimento: it.attendance ?? "",

        "TUSS alegado": it.tuss_code ?? "",
        "TUSS pago no atendimento": div.tuss,
        "Valor pago no atendimento (divergência)": div.valor,
        Procedimento: it.procedure_name ?? "",
        "Data procedimento": fmtDate(it.procedure_date),
        Paciente: it.patient_name ?? "",
        Função: it.function_label ?? "",
        "Qtd alegada": it.claimed_quantity ?? "",
        "Qtd paga": it.paid_quantity ?? "",
        "Valor alegado": Number(it.claimed_amount ?? 0),
        "Valor pago": Number(it.paid_amount ?? 0),
        "Valor esperado": Number(it.expected_amount ?? 0),
        Gap: Number(it.gap_amount ?? 0),
        "Data pagamento encontrado": fmtDate(it.matched_payment_date),
        Status: CLASS_LABEL[it.classification],
        Motivo: it.classification_reason ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Apuração");
    const stamp = format(new Date(), "yyyyMMdd_HHmm");
    XLSX.writeFile(wb, `apuracao-retroativa_${stamp}.xlsx`);
  };


  const totalComplemento = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.classification === "nao_pago" ||
            i.classification === "pago_a_menos" ||
            i.classification === "tuss_divergente",
        )
        .reduce((s, i) => s + Number(i.gap_amount ?? 0), 0),
    [items],
  );




  if (!recon)
    return (
      <div>
        <Skeleton className="h-6 w-1/3" />
      </div>
    );

  const concluded = recon.status === "concluida";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h3 className="text-lg font-semibold">
              {recon.title ?? "Apuração retroativa"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {[doctorName, companyName].filter(Boolean).join(" · ") || "—"} · {format(parseYmdLocal(recon.period_start), "dd/MM/yy")} →{" "}
              {format(parseYmdLocal(recon.period_end), "dd/MM/yy")}
            </p>
          </div>
        </div>
        <Badge variant={concluded ? "outline" : "default"}>
          {concluded ? "Concluída" : "Em análise"}
        </Badge>
      </div>

      <div className="sticky top-0 z-30 -mx-1 rounded-lg border border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2 text-xs shadow-sm">
        <div className="font-medium text-foreground mb-2">
          Legenda dos status · significado, gap e ação recomendada
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-1.5">
          {(
            [
              ["ok_pago", "Pago conforme regra.", "Gap: 0.", "Nenhuma."],
              ["pago_a_menos", "Pago menos que o esperado (valor/quantidade).", "Gap: esperado − pago.", "Complementar a diferença."],
              ["pago_a_mais", "Pago mais que o alegado (quantidade excedente).", "Excedente: unitário × qtd a mais.", "Revisar duplicidade / cobrar de volta."],
              ["tuss_divergente", "Atendimento pago, mas TUSS alegado não está no lote.", "Gap: valor alegado integral.", "Complementar — TUSS faltou."],
              ["nao_pago", "Atendimento inteiro não localizado nos pagamentos.", "Gap: valor alegado integral.", "Investigar antes de pagar."],
              ["pago_outro_mes", "Pago fora da janela apurada.", "Gap: 0 nesta apuração.", "Verificar outra apuração."],
              ["sem_lastro", "Sem match e sem valor alegado.", "Gap: indeterminado.", "Pedir mais informação ao médico."],
            ] as const
          ).map(([k, sig, gap, acao]) => (
            <div key={k} className="flex items-start gap-2">
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${CLASS_TONE[k]}`}>
                {CLASS_LABEL[k]}
              </span>
              <div className="leading-tight">
                <div>{sig}</div>
                <div className="text-muted-foreground"><strong>{gap}</strong> · {acao}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground border-t border-border pt-1.5">
          <strong>Total a complementar</strong> = <em>Pago a menos</em> + <em>Não pago</em> + <em>Pendência (TUSS faltante)</em>.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {(
          [
            ["ok_pago", "OK pago"],
            ["pago_a_menos", "Pago a menos"],
            ["pago_a_mais", "Pago a mais"],
            ["tuss_divergente", "TUSS divergente"],
            ["nao_pago", "Não pago"],
            ["pago_outro_mes", "Outro mês"],
            ["sem_lastro", "Sem lastro"],
          ] as const

        ).map(([k, lbl]) => (
          <div key={k} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {lbl}
            </div>
            <div className="text-xl font-semibold">{recon.summary?.[k] ?? 0}</div>
          </div>
        ))}
      </div>


      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Total a complementar
          </div>
          <div className="text-2xl font-semibold text-primary">{brl(totalComplemento)}</div>
        </div>
        {!concluded && totalComplemento > 0 && (
          <Button onClick={generateAdjustment} disabled={generating}>
            <FileCheckIcon className="h-4 w-4 mr-1" />
            {generating ? "Gerando…" : "Gerar ajuste de complemento"}
          </Button>
        )}
        {concluded && recon.adjustment_ids.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Ajuste gerado: <span className="font-mono">{recon.adjustment_ids[0].slice(0, 8)}…</span>
          </div>
        )}
      </div>

      {!concluded && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-3">Lista alegada pelo médico</h4>
          <InnerTabs defaultValue="form">
            <InnerTabsList>
              <InnerTabsTrigger value="form">Formulário</InnerTabsTrigger>
              <InnerTabsTrigger value="upload">Planilha</InnerTabsTrigger>
              <InnerTabsTrigger value="paste">Colar texto</InnerTabsTrigger>
            </InnerTabsList>

            <InnerTabsContent value="form" className="mt-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-2 py-1">Atendimento</th>
                      <th className="px-2 py-1">TUSS</th>
                      <th className="px-2 py-1">Data</th>
                      <th className="px-2 py-1">Paciente</th>
                      <th className="px-2 py-1">Função</th>
                      <th className="px-2 py-1">Qtd</th>
                      <th className="px-2 py-1">Valor alegado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, idx) => (
                      <tr key={d._localId} className="border-t border-border">
                        <td className="p-1">
                          <Input
                            value={d.attendance}
                            onChange={(e) => updateDraft(idx, { attendance: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.tuss_code}
                            onChange={(e) => updateDraft(idx, { tuss_code: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <DateInput value={d.procedure_date} onChange={(v) => updateDraft(idx, { procedure_date: v })} />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.patient_name}
                            onChange={(e) => updateDraft(idx, { patient_name: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.function_label}
                            onChange={(e) => updateDraft(idx, { function_label: e.target.value })}
                          />
                        </td>
                        <td className="p-1 w-20">
                          <Input
                            value={d.claimed_quantity}
                            onChange={(e) => updateDraft(idx, { claimed_quantity: e.target.value })}
                            placeholder="1"
                          />
                        </td>
                        <td className="p-1 w-32">
                          <Input
                            value={d.claimed_amount}
                            onChange={(e) => updateDraft(idx, { claimed_amount: e.target.value })}
                            placeholder="0,00"
                          />
                        </td>
                        <td className="p-1">
                          <Button variant="ghost" size="icon" onClick={() => removeDraft(idx)}>
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" onClick={addDraft} className="mt-2">
                <PlusIcon className="h-4 w-4 mr-1" /> Adicionar linha
              </Button>
            </InnerTabsContent>

            <InnerTabsContent value="upload" className="mt-3 space-y-3">
              <label
                className={cn(
                  "flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-8 cursor-pointer hover:bg-muted/40",
                  uploadLoading && "opacity-60 pointer-events-none",
                )}
              >
                <UploadCloudIcon className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm">
                  {uploadLoading ? "Lendo planilha…" : "Selecionar arquivo (.xlsx ou .csv)"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Após selecionar, abre o mapeamento de colunas. Linhas só entram depois de você confirmar.
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={uploadLoading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>

              {(() => {
                const uploadedCount = drafts.filter(
                  (d) => d.source === "upload" && (d.attendance || d.tuss_code),
                ).length;
                if (uploadedCount === 0 && !uploadedFileName) return null;
                return (
                  <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckIcon className="h-4 w-4 text-emerald-600" />
                      <span>
                        <strong>{uploadedCount}</strong> linha(s) carregada(s)
                        {uploadedFileName && <> de <span className="font-mono">{uploadedFileName}</span></>}
                        . Vá para <strong>Formulário</strong> para revisar ou clique em <strong>Rodar cruzamento</strong>.
                      </span>
                    </div>
                    {uploadedCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDrafts((d) => d.filter((x) => x.source !== "upload"));
                          setUploadedFileName("");
                          toast({ title: "Linhas da planilha removidas" });
                        }}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                );
              })()}
            </InnerTabsContent>

            <InnerTabsContent value="paste" className="mt-3">
              <Textarea
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Cole uma linha por item. Separadores aceitos: tab, ; ou múltiplos espaços."
              />
              <Button size="sm" onClick={onPasteApply} className="mt-2">
                Adicionar
              </Button>
            </InnerTabsContent>
          </InnerTabs>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground max-w-xl leading-relaxed">
              O cruzamento <strong>não recalcula regras</strong>. Ele compara cada linha alegada com o
              <code className="mx-1 px-1 bg-muted rounded">expected_amount</code> já gravado em
              <code className="mx-1 px-1 bg-muted rounded">payment_items</code> do médico/PJ na janela ±90d.
              Itens sem match aparecem como <em>não pago</em> ou <em>sem lastro</em>.
            </p>
            <Button onClick={runReconciliation} disabled={running}>
              <PlayIcon className="h-4 w-4 mr-1" />
              {running ? "Cruzando…" : `Rodar cruzamento (${drafts.filter((d) => d.attendance || d.tuss_code || d.claimed_amount).length})`}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold">Resultado</h4>
            <span className="text-xs text-muted-foreground">
              {filteredItems.length} de {items.length} item(ns)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={procSearch}
              onChange={(e) => setProcSearch(e.target.value)}
              placeholder="Buscar procedimento…"
              className="h-8 w-[200px] text-xs"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Filtrar status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {(["ok_pago", "pago_a_menos", "pago_a_mais", "tuss_divergente", "nao_pago", "pago_outro_mes", "sem_lastro"] as const).map((k) => (
                  <SelectItem key={k} value={k}>{CLASS_LABEL[k]}</SelectItem>
                ))}

              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportXlsx} disabled={items.length === 0}>
              Exportar Excel
            </Button>
          </div>

        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Médico</TableHead>
                <TableHead>Atendimento</TableHead>

                <TableHead>TUSS</TableHead>
                <TableHead>Procedimento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead className="text-center">Qtd aleg.</TableHead>
                <TableHead className="text-center">Qtd paga</TableHead>
                <TableHead>Alegado</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Esperado</TableHead>
                <TableHead>Gap</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                    {items.length === 0
                      ? "Nenhum item processado ainda."
                      : "Nenhum item neste filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filteredItems.map((it) => {
                const qtyShort =
                  it.claimed_quantity != null &&
                  it.paid_quantity != null &&
                  Number(it.paid_quantity) < Number(it.claimed_quantity);
                const outOfWindow = it.classification === "pago_outro_mes";
                return (
                  <TableRow key={it.id}>
                    <TableCell className="max-w-[160px] truncate" title={doctorName ?? undefined}>
                      {doctorName ?? "—"}
                    </TableCell>
                    <TableCell>{it.attendance ?? "—"}</TableCell>

                    <TableCell>{it.tuss_code ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={it.procedure_name ?? undefined}>
                      {it.procedure_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {fmtDate(it.procedure_date, "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{it.patient_name ?? "—"}</TableCell>
                    <TableCell className="text-center">{it.claimed_quantity ?? "—"}</TableCell>
                    <TableCell className={`text-center ${qtyShort ? "font-semibold text-amber-700" : ""}`}>
                      {it.paid_quantity ?? "—"}
                    </TableCell>
                    <TableCell>{brl(it.claimed_amount)}</TableCell>
                    <TableCell>{brl(it.paid_amount)}</TableCell>
                    <TableCell>{brl(it.expected_amount)}</TableCell>
                    <TableCell
                      className={
                        Number(it.gap_amount ?? 0) > 0
                          ? "font-semibold text-red-700"
                          : "text-muted-foreground"
                      }
                    >
                      {brl(it.gap_amount)}
                    </TableCell>
                    <TableCell className={outOfWindow ? "text-blue-700 font-medium" : "text-muted-foreground"}>
                      {fmtDate(it.matched_payment_date, "dd/MM/yyyy")}

                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${CLASS_TONE[it.classification]}`}
                        title={it.classification_reason ?? undefined}
                      >
                        {CLASS_LABEL[it.classification]}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {wizard.open && (
        <RetroactiveMappingWizard
          open={wizard.open}
          fileName={wizard.fileName}
          headers={wizard.headers}
          rows={wizard.rows}
          companyMappingConfig={companies.length > 0 ? { companies } : undefined}
          onCancel={() => setWizard({ open: false })}
          onConfirm={applyMapping}
        />
      )}
    </div>
  );
}

/* ===================================================================
 * TASY vs Repasse — modo independente, 100% em memória, sem edge function
 * =================================================================== */

type TasyRow = {
  tasy_atendimento: string;
  tasy_tuss: string;
  tasy_qtd: string;
  tasy_valor_unit: string;
  tasy_procedimento?: string;
  tasy_paciente?: string;
  tasy_data?: string;
  tasy_convenio?: string;
  tasy_medico?: string;
  tasy_funcao?: string;
  tasy_empresa?: string;
  tasy_resolved_company_id?: string | null;
};

type PagRow = {
  pag_atendimento: string;
  pag_tuss: string;
  pag_qtd: string;
  pag_valor_base: string;
  pag_valor_com_acordo?: string;
  pag_funcao?: string;
  pag_medico?: string;
  pag_data?: string;
  pag_paciente?: string;
  pag_convenio?: string;
  pag_procedimento?: string;
  pag_lote?: string;
  pag_payment_item_id?: string;
  pag_payment_id?: string;
  pag_doctor_id?: string;
  pag_company_id?: string;
  pag_applied_rule_id?: string;
  pag_applied_rule_label?: string;
  pag_applied_calc_id?: string;
  pag_applied_calc_method?: string;
};


export type TvrStatus = "nao_pago" | "div_qtd_valor" | "div_valor" | "pago_a_mais" | "ausente_tasy" | "ok";


export type TvrResult = {
  key: string;
  atendimento: string;
  tuss: string;
  procedimento: string;
  paciente: string;
  data: string;
  convenio: string;
  medico: string;
  funcao: string;
  qtd_tasy: number;
  valor_unit_tasy: number;
  valor_total_tasy: number;
  qtd_por_func: number;
  n_funcs: number;
  funcoes_pagas: string;
  lotes: string;
  valor_pago_base: number;
  valor_com_acordo: number;
  dif_qtd: number;
  dif_valor: number;
  valor_recuperar_acordo: number; // legado: max(0, ajuste_acordo)
  // Valor que a regra pagaria HOJE aplicando o mesmo % de acordo sobre a base TASY.
  valor_com_acordo_recalc: number;
  // valor_com_acordo (histórico) − valor_com_acordo_recalc.
  // Positivo = a recuperar (paguei a mais). Negativo = a complementar (paguei a menos).
  ajuste_acordo: number;
  // "valor" = regra é % sobre convênio (TASY e Exacta compartilham base) → compara R$.
  // "quantidade" = regra usa tabela própria (valor_fixo/pacote/tabela_diferenciada/bonus)
  //   → TASY não é base de valor; compara só presença e quantidade.
  tipo_analise: "valor" | "quantidade";
  // Apenas para tipo_analise="quantidade" + status="ausente_tasy": marca "sem lastro TASY"
  // sem calcular R$ (pacote fechado pode não faturar itens individualmente).
  sem_lastro_tasy?: boolean;
  matched_payment_item_id?: string;
  matched_payment_id?: string;
  matched_doctor_id?: string;
  matched_doctor_ids?: string[];
  matched_company_id?: string;
  tasy_empresa?: string;
  tasy_resolved_company_id?: string | null;
  pj_conciliada?: string;
  regra_aplicada?: string;
  calculo_aplicado?: string;
  // IDs opcionais usados apenas em rastreio/export — payment_items.applied_rule_id
  // e payment_items.applied_calc_id da regra que gerou o cálculo no lote.
  applied_rule_id?: string;
  applied_calc_id?: string;
  // ==== Inferência para itens "Faltou pagar" (sem lastro no lote) ====
  // Regra do sistema: 1 PJ por médico por hospital → resolvemos via doctor_companies
  // (vínculo ativo). Se o médico tiver múltiplas ativas, marcamos ambíguo e não sugerimos.
  pj_provavel?: string;
  pj_provavel_id?: string;
  // Regra "provável" = última regra já aplicada para (médico + procedure_code) neste
  // hospital. Heurística — não invoca o motor, respeita "nunca inferir valor".
  regra_prevista?: string;
  regra_prevista_id?: string;
  calculo_previsto?: string;
  calculo_previsto_id?: string;
  // Valor que a regra prevista pagaria hoje sobre este item (nao_pago).
  // undefined = não conseguimos estimar → consumidor cai para valor_total_tasy.
  valor_previsto_regra?: number;
  tipo_analise_previsto?: "valor" | "quantidade";
  // Origem do valor previsto exibido ao analista, por ordem de confiança:
  //  "simulacao" = motor real rodou (simulate-rule-batch) e devolveu valor esperado
  //  "regra"     = preview local a partir do calc_raw do histórico (percentual/valor_fixo/exclusao)
  //  "historico" = regra veio do histórico, sem valor calculado localmente (ex.: pacote)
  //  "bruto"     = tipo não coberto e sem simulação → fallback exibindo bruto TASY
  //  "sem_regra" = motor real rodou e não achou regra aplicável
  previsto_source?: "simulacao" | "regra" | "historico" | "bruto" | "sem_regra";


  // Auditoria da chave canônica (Atend + Data + TUSS8 + Médico).
  key_audit?: {
    att: string;
    date: string;
    tuss8: string;
    doctor: {
      // 'repasse_id' = doctor_id veio direto do payment_items.
      // 'name_to_id' = TASY só tinha nome, resolveu para id via índice do Repasse.
      // 'name_only'  = casou por nome normalizado dos dois lados (sem id).
      // 'missing'    = não foi possível compor a parte do médico.
      source: "repasse_id" | "name_to_id" | "name_only" | "missing";
      id?: string;
      name_raw?: string;
      name_norm?: string;
    };
  };
  status: TvrStatus;
  // Tópico 2 (opt-out do encaminhamento): campos vindos das colunas
  // adicionadas em retroactive_reconciliation_items no Tópico 1.
  // Undefined em resultados recém-calculados que ainda não foram persistidos.
  excluir_do_encaminhamento?: boolean;
  exclusion_reason?:
    | "mudanca_data_administrativa"
    | "cancelamento_externo"
    | "duplicidade_ja_resolvida"
    | "acordo_diferenciado"
    | "outro"
    | null;
  exclusion_note?: string | null;
  // T3: id da linha em retroactive_reconciliation_items (necessário
  // p/ UPDATEs de exclusão — matched_payment_item_id NÃO serve como PK).
  _retroReconRowId?: string;
  // Preenchido quando este item já foi materializado em um ajuste financeiro
  // (encaminhamento anterior). Serve para bloquear novo envio e sinalizar na UI.
  _generatedAdjustmentId?: string | null;
  // Override manual: PJ escolhida pelo analista quando o vínculo médico→PJ
  // mudou desde o lote original. Quando null, `buildGlosaGroups` cai para
  // a PJ ativa via doctor_companies. Grava em retroactive_reconciliation_items.
  retroactive_target_company_id?: string | null;
  target_reassign_reason?: string | null;
};

// Rótulos padronizados pela perspectiva do PAGAMENTO — deixa os pares simétricos:
//   Faltou pagar ↔ Ausente base faturamento (extremos: só num lado)
//   Pago a menos (valor/qtd) ↔ Pago a mais (match completo)
// O nome "base faturamento" substitui "TASY" para permitir outros sistemas por hospital.
const TVR_STATUS_LABEL: Record<TvrStatus, string> = {
  nao_pago: "Faltou pagar",
  div_qtd_valor: "Pago a menos (qtd)",
  div_valor: "Pago a menos (valor)",
  pago_a_mais: "Pago a mais",
  ausente_tasy: "Ausente base faturamento",
  ok: "OK",
};

const TVR_STATUS_TONE: Record<TvrStatus, string> = {
  nao_pago: "bg-red-100 text-red-800",
  div_qtd_valor: "bg-rose-100 text-rose-800",
  div_valor: "bg-amber-100 text-amber-800",
  pago_a_mais: "bg-fuchsia-100 text-fuchsia-800",
  ausente_tasy: "bg-purple-100 text-purple-800",
  ok: "bg-emerald-100 text-emerald-800",
};

const TVR_STATUS_ORDER: TvrStatus[] = ["nao_pago", "div_qtd_valor", "div_valor", "pago_a_mais", "ausente_tasy", "ok"];

// Fonte única de verdade para o status exibido/filtrado: em "quantidade" o
// status nunca depende de R$ (TASY não é base), só de presença/quantidade.
// Assim badge, filtro, contagem e coluna de ação sempre concordam, mesmo em
// rodadas antigas cujo r.status persistido ficou derivado do valor.
export function effectiveTvrStatus(r: TvrResult): TvrStatus {
  if (r.tipo_analise !== "quantidade") return r.status;
  if (r.status === "nao_pago" || r.status === "ausente_tasy") return r.status;
  if (r.dif_qtd < -0.5) return "pago_a_mais";
  if (r.dif_qtd > 0.5) return "div_qtd_valor";
  return "ok";
}

export function computeTvrCounts(list: TvrResult[]): Record<TvrStatus, number> {
  const c: Record<TvrStatus, number> = {
    nao_pago: 0,
    div_qtd_valor: 0,
    div_valor: 0,
    pago_a_mais: 0,
    ausente_tasy: 0,
    ok: 0,
  };
  for (const r of list) c[effectiveTvrStatus(r)]++;
  return c;
}


const TVR_SOURCE = "tasy_vs_repasse";

/**
 * Cards financeiros do relatório usam a mesma base operacional do export
 * (planilha "abas") — o que o analista efetivamente vai descontar/complementar:
 *   - Regra "valor" (% sobre convênio ou sem acordo cadastrado): base é o
 *     100% convênio (dif_valor). É o que o médico recebe/deveria receber.
 *   - Regra "quantidade" (pacote/valor_fixo/tabela_diferenciada/bonus):
 *     base é o `ajuste_acordo` — valor efetivamente pago pela qtd em excesso,
 *     não o convênio bruto (pacote não paga item a item pelo convênio).
 *   - `ausente_tasy`: paguei sem lastro TASY hoje → retirar o valor pós-regra
 *     (`valor_com_acordo`), com fallback ao `valor_pago_base` para rodadas
 *     antigas sem esse campo persistido.
 */
export function computeTvrFinancialTotals(list: TvrResult[]): { totalComplementar: number; totalRetirar: number } {
  const totalComplementar = list.reduce((sum, r) => {
    if (r.status === "ok" || r.status === "ausente_tasy") return sum;
    // "Faltou pagar" (nao_pago) só soma quando há previsão de regra
    // (simulação real ou preview do histórico). Sem previsão, o bruto TASY
    // é apenas o TETO — não é compromisso e não pode inflar o total, senão
    // gera falso positivo no card e no handoff. O teto aparece em separado
    // via `computeTvrComplementarBreakdown().tasyCeiling`.
    if (r.status === "nao_pago") {
      return typeof r.valor_previsto_regra === "number"
        ? sum + r.valor_previsto_regra
        : sum;
    }
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      return ajuste < -0.5 ? sum + Math.abs(ajuste) : sum;
    }
    return r.dif_valor > 0.5 ? sum + r.dif_valor : sum;
  }, 0);
  const totalRetirar = list.reduce((sum, r) => {
    if (r.status === "ausente_tasy") {
      const operacional = r.valor_com_acordo && r.valor_com_acordo > 0.5 ? r.valor_com_acordo : r.valor_pago_base;
      return sum + operacional;
    }
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      return ajuste > 0.5 ? sum + ajuste : sum;
    }
    return r.dif_valor < -0.5 ? sum + Math.abs(r.dif_valor) : sum;
  }, 0);
  return { totalComplementar, totalRetirar };
}

/**
 * Recorta o "Total a complementar" em duas camadas:
 *  - `simulated`: soma dos `valor_previsto_regra` para "Faltou pagar" que já
 *    tiveram previsão calculada (motor real ou preview de histórico). Também
 *    inclui pago_a_menos/div_qtd_valor onde a diferença é confiável — esses
 *    já vêm do lote com lastro.
 *  - `tasyCeiling`: teto bruto = soma do `valor_total_tasy` dos "Faltou pagar"
 *    SEM previsão. É o máximo que aquele universo pode virar — o valor real
 *    só sai quando o item entra em confecção e o motor recalcula.
 *  - `coverage`: fração simulada / total de "Faltou pagar" (0..1). Serve
 *    para o card avisar quando a cobertura é baixa.
 */
export function computeTvrComplementarBreakdown(list: TvrResult[]): {
  simulated: number;
  tasyCeiling: number;
  naoPagoTotal: number;
  naoPagoSimulated: number;
  coverage: number; // 0..1
} {
  let simulated = 0;
  let tasyCeiling = 0;
  let naoPagoTotal = 0;
  let naoPagoSimulated = 0;
  for (const r of list) {
    if (r.status === "nao_pago") {
      naoPagoTotal += 1;
      if (typeof r.valor_previsto_regra === "number") {
        simulated += r.valor_previsto_regra;
        naoPagoSimulated += 1;
      } else {
        tasyCeiling += r.valor_total_tasy || 0;
      }
      continue;
    }
    if (r.status === "ok" || r.status === "ausente_tasy") continue;
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      if (ajuste < -0.5) simulated += Math.abs(ajuste);
    } else if (r.dif_valor > 0.5) {
      simulated += r.dif_valor;
    }
  }
  const coverage = naoPagoTotal > 0 ? naoPagoSimulated / naoPagoTotal : 1;
  return { simulated, tasyCeiling, naoPagoTotal, naoPagoSimulated, coverage };
}

function computeTvrAgreementTotals(list: TvrResult[]): { totalComplementarAcordo: number; totalRetirarAcordo: number } {
  return list.reduce(
    (acc, r) => {
      const ajuste = r.ajuste_acordo ?? 0;
      if (ajuste < -0.5) acc.totalComplementarAcordo += Math.abs(ajuste);
      if (ajuste > 0.5) acc.totalRetirarAcordo += ajuste;
      return acc;
    },
    { totalComplementarAcordo: 0, totalRetirarAcordo: 0 },
  );
}

/**
 * FONTE ÚNICA de todos os headline numbers do relatório TVR.
 *
 * Consumidores: card "Total a complementar", card "Total a retirar",
 * modal "Encaminhar apuração". Se qualquer um desses precisar exibir
 * um número, DEVE vir daqui — não recalcular inline. Testes de
 * invariante em `tvrMenuCardConsistency.test.ts` bloqueiam divergência.
 */
export function computeTvrHeadlineTotals(list: TvrResult[]): {
  totalComplementar: number;
  totalRetirar: number;
  totalComplementarAcordo: number;
  totalRetirarAcordo: number;
  tetoTasy: number;
  naoPagoTotal: number;
  naoPagoSimulated: number;
  coverage: number;
} {
  const financial = computeTvrFinancialTotals(list);
  const acordo = computeTvrAgreementTotals(list);
  const bd = computeTvrComplementarBreakdown(list);
  return {
    totalComplementar: financial.totalComplementar,
    totalRetirar: financial.totalRetirar,
    totalComplementarAcordo: acordo.totalComplementarAcordo,
    totalRetirarAcordo: acordo.totalRetirarAcordo,
    tetoTasy: bd.tasyCeiling,
    naoPagoTotal: bd.naoPagoTotal,
    naoPagoSimulated: bd.naoPagoSimulated,
    coverage: bd.coverage,
  };
}

export type TvrAcao = {
  kind: "recuperar" | "complementar" | "validar" | "ok";
  valor: number;
  label: string;
  hint: string;
};

/**
 * Descreve, em linguagem do analista, o que fazer com uma linha do relatório
 * TVR. Pura — usada tanto na coluna "Ação sugerida" da UI quanto no export
 * Excel. Testada em describeTvrAcao.test.ts.
 *
 * Ordem de decisão (não regredir):
 *   1. status "nao_pago" (Faltou pagar): SEMPRE complementar valor_total_tasy.
 *      Não pode cair no fallback "sem ajuste" só porque ajuste_acordo=0.
 *   2. status "ausente_tasy": SEMPRE recuperar (valor_com_acordo ?? valor_pago_base).
 *   3. sem_lastro_tasy (pacote/valor fixo sem lastro): "Validar manualmente".
 *   4. tipo_analise === "quantidade": decide por dif_qtd (TASY não é base de R$).
 *   5. tipo_analise === "valor": decide por ajuste_acordo (fallback fica só aqui).
 */
export function describeTvrAcao(r: TvrResult): TvrAcao {
  const method = (r.calculo_aplicado ?? "").toLowerCase();
  const prettyMethod =
    method.includes("pacote") ? "pacote"
    : method.includes("valor_fixo") ? "valor fixo"
    : method.includes("tabela_diferenciada") ? "tabela diferenciada"
    : method.includes("bonus") ? "bônus"
    : method.includes("percentual") ? "% do convênio"
    : "acordo do lote";
  if (r.status === "nao_pago") {
    // Preferimos o valor que a regra prevista pagaria hoje (mesma lógica do
    // motor no lote original). Se não conseguimos estimar (pacote/tabela ou
    // dado faltante), caímos para valor_total_tasy — bruto 100% convênio.
    const usouRegra = typeof r.valor_previsto_regra === "number";
    const valor = usouRegra ? r.valor_previsto_regra! : (r.valor_total_tasy || 0);
    const hint = usouRegra
      ? `Regra prevista aplicada${r.calculo_previsto ? `: ${r.calculo_previsto}` : ""} — mesmo cálculo do lote anterior.`
      : `Item no TASY (${prettyMethod}) sem pagamento no lote — sem regra prevista, exibindo valor bruto 100% convênio. Revisar antes de complementar.`;
    return {
      kind: "complementar",
      valor,
      label: `↑ Complementar ${brl(valor)}`,
      hint,
    };
  }
  if (r.status === "ausente_tasy") {
    const valor = r.valor_com_acordo && r.valor_com_acordo > 0.5 ? r.valor_com_acordo : r.valor_pago_base;
    const compRef = r.lotes ? r.lotes : "competência anterior";
    return {
      kind: "recuperar",
      valor,
      label: `↓ Recuperar ${brl(valor)}`,
      hint: `Procedimento (${r.tuss || "—"} - ${r.procedimento || "—"}) pago em ${compRef} mas removido pela auditoria hospitalar. Valor de ${brl(valor)} a descontar.`,
    };
  }
  if (r.sem_lastro_tasy) {
    return {
      kind: "validar",
      valor: r.valor_com_acordo || 0,
      label: "— Validar manualmente",
      hint: `Pago no lote (${prettyMethod}) mas ausente no TASY hoje. Pacote/valor fixo pode não faturar item individual — analista decide.`,
    };
  }
  if (r.tipo_analise === "quantidade") {
    if (r.dif_qtd < -0.5) {
      const diffValor = r.valor_com_acordo || 0;
      return {
        kind: "recuperar",
        valor: diffValor,
        label: `↓ Recuperar ${brl(diffValor)}`,
        hint: `Auditoria reduziu de ${r.qtd_por_func.toFixed(0)} para ${r.qtd_tasy.toFixed(0)} unidade(s) do procedimento ${r.tuss || "—"}. Diferença de ${brl(diffValor)} a descontar · ${prettyMethod}.`,
      };
    }
    if (r.dif_qtd > 0.5) {
      return {
        kind: "complementar",
        valor: 0,
        label: `↑ Complementar (+${r.dif_qtd.toFixed(2)} un)`,
        hint: `TASY hoje tem ${r.dif_qtd.toFixed(2)} un a mais · ${prettyMethod}. Valor depende da tabela do acordo.`,
      };
    }
    return { kind: "ok", valor: 0, label: "— Sem ajuste", hint: `Quantidade bate · ${prettyMethod}` };
  }
  if (r.ajuste_acordo > 0.5) {
    const compRef = r.lotes ? r.lotes : "competência anterior";
    return {
      kind: "recuperar",
      valor: r.ajuste_acordo,
      label: `↓ Recuperar ${brl(r.ajuste_acordo)}`,
      hint: `Auditoria hospitalar ajustou valor de ${brl(r.valor_pago_base)} para ${brl(r.valor_com_acordo_recalc)}. Diferença de ${brl(r.ajuste_acordo)} a descontar (ref. ${compRef}).`,
    };
  }
  if (r.ajuste_acordo < -0.5) {
    const fator = r.valor_pago_base > 0 ? (r.valor_com_acordo / r.valor_pago_base) * 100 : 0;
    const dif = Math.abs(r.dif_valor);
    const direcao = r.dif_valor > 0 ? "subiu" : "reduziu";
    return {
      kind: "complementar",
      valor: Math.abs(r.ajuste_acordo),
      label: `↑ Complementar ${brl(Math.abs(r.ajuste_acordo))}`,
      hint: `TASY ${direcao} ${brl(dif)} · acordo ${fator.toFixed(0)}% convênio`,
    };
  }
  return { kind: "ok", valor: 0, label: "— Sem ajuste", hint: "Pago no lote bate com devido hoje" };
}

function isYmdWithinInclusive(value: string | null, start: string, end: string): boolean {
  if (!value) return false;
  return value >= start.slice(0, 10) && value <= end.slice(0, 10);
}

// Detector de "escala suspeita" (ratio TASY/Pag) foi removido: o TASY vs
// Repasse compara valores já em Reais e um ratio alto é natural (100%
// convênio × repasse do médico). Erros de escala reais são evitados na
// leitura (parseCellMoney trata todo valor monetário como BRL) e ficam
// visíveis no wizard pela amostra da coluna.


export function mapTvrStatusToStoredClassification(status: TvrStatus): string {
  // Grava o status TVR direto (sem CHECK constraint na coluna).
  // Único alias: "ok" -> "ok_pago" (equivalente, mantido por compatibilidade com relatórios).
  if (status === "ok") return "ok_pago";
  return status;
}

/**
 * Constrói o objeto `summary` persistido em retroactive_reconciliations a
 * cada reprocessamento TVR.
 *
 * Regra-chave (não regredir): SOBRESCREVE tudo; nunca faz merge com
 * `previousSummary`. Preserva explicitamente apenas:
 *   - `handoff` (estado de envio para confecção)
 *   - `tvr_validation_history` (append-only, truncado em 20)
 *
 * Garante que contadores de rodadas antigas (ex.: div_qtd, pago_sem_tasy)
 * jamais reapareçam por mesclagem residual.
 */
export function buildTvrReplaceSummary(
  list: TvrResult[],
  previousSummary: Record<string, unknown> | null | undefined,
  ctx: {
    tasy_file?: string;
    tasy_file_totals?: { file: number; valid: number; excluded: number; dropped: number } | null;
    tasy_dropped_examples?: Array<{ row_index: number; missing: string[] }>;
    exclude_tuss?: string;
    excluded_convenios?: string[];
    processed_at?: string;
  },
): Record<string, unknown> {
  const financial = computeTvrFinancialTotals(list);
  const tvrCounts = computeTvrCounts(list);
  const incompleteAusente = list.filter((r) => getAusenteTasyMissingFields(r).length > 0);
  const prev = (previousSummary ?? {}) as Record<string, unknown>;
  const prevHistory = Array.isArray(prev.tvr_validation_history)
    ? (prev.tvr_validation_history as Array<Record<string, unknown>>)
    : [];
  const historyEntry: Record<string, unknown> = {
    at: ctx.processed_at ?? new Date().toISOString(),
    total: list.length,
    counts: tvrCounts,
    ausente_incomplete: incompleteAusente.length,
  };
  const trimmedHistory = [...prevHistory.slice(-19), historyEntry];
  // Preserva chaves de escopo definidas no Passo 1/2 — sem elas o trigger do
  // banco (enforce_tvr_selected_payment_ids) rejeita o UPDATE pós-processamento
  // e o motor volta a misturar lotes de outros meses no reprocesso.
  const preservedScope = (prev as { scope?: unknown }).scope;
  const preservedSelectedIds = (prev as { selected_payment_ids?: unknown }).selected_payment_ids;
  const preservedSelectedLabels = (prev as { selected_payment_labels?: unknown }).selected_payment_labels;
  const preservedMultiCompanyIds = (prev as { multi_company_ids?: unknown }).multi_company_ids;
  const preservedMultiDoctorIds = (prev as { multi_doctor_ids?: unknown }).multi_doctor_ids;
  const preservedMultiLabels = (prev as { multi_labels?: unknown }).multi_labels;
  // handoff NÃO é preservado: se a apuração está encaminhada, o botão Processar
  // fica bloqueado (obriga desfazer primeiro). Se algum caminho de código chegar
  // aqui com handoff antigo, é bug — deixe cair para o próximo estado sem handoff.

  return {
    mode: "tasy_vs_repasse",
    total: list.length,
    total_gap: financial.totalComplementar,
    total_excess: financial.totalRetirar,
    tasy_file: ctx.tasy_file ?? "",
    tasy_file_totals: ctx.tasy_file_totals ?? null,
    tasy_dropped_examples: ctx.tasy_dropped_examples ?? [],
    exclude_tuss: ctx.exclude_tuss ?? "",
    excluded_convenios: ctx.excluded_convenios ?? [],
    processed_at: ctx.processed_at ?? new Date().toISOString(),
    tvr_counts: tvrCounts,
    tvr_ausente_incomplete: incompleteAusente.length,
    tvr_validation_history: trimmedHistory,
    ...(preservedScope !== undefined ? { scope: preservedScope } : {}),
    ...(preservedSelectedIds !== undefined ? { selected_payment_ids: preservedSelectedIds } : {}),
    ...(preservedSelectedLabels !== undefined ? { selected_payment_labels: preservedSelectedLabels } : {}),
    ...(preservedMultiCompanyIds !== undefined ? { multi_company_ids: preservedMultiCompanyIds } : {}),
    ...(preservedMultiDoctorIds !== undefined ? { multi_doctor_ids: preservedMultiDoctorIds } : {}),
    ...(preservedMultiLabels !== undefined ? { multi_labels: preservedMultiLabels } : {}),
    
  };
}


const AUSENTE_TASY_ESSENTIAL_FIELDS = [
  ["paciente", "Paciente"],
  ["convenio", "Convênio"],
  ["procedimento", "Procedimento"],
] as const;

export function getAusenteTasyMissingFields(r: TvrResult): string[] {
  if (r.status !== "ausente_tasy") return [];
  const out: string[] = [];
  for (const [key, label] of AUSENTE_TASY_ESSENTIAL_FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[key];
    if (!v || String(v).trim() === "") out.push(label);
  }
  return out;
}



// dbDateOrNull agora vive em @/lib/dateNormalize (testado em __tests__/dateNormalize.test.ts).




function formatTvrDate(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const br = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (br) return `${br[1]}-${br[2]}-${br[3]}`;
  return value;
}

function isTvrResult(value: unknown): value is TvrResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  // Alias status legados (rodadas antigas) para os canônicos atuais — evita
  // que linhas salvas como "pago_sem_tasy"/"div_qtd" desapareçam da lista após
  // a renomeação dos status.
  if (r.status === "pago_sem_tasy") r.status = "ausente_tasy";
  if (r.status === "div_qtd") r.status = "div_qtd_valor";
  // Re-derivação retroativa: rodadas antigas gravaram "status" a partir do R$
  // mesmo em análise por presença/quantidade. Recalcula em memória para bater
  // com a coluna de ação (sem exigir reprocessar a apuração).
  if (r.tipo_analise === "quantidade" && r.status !== "nao_pago" && r.status !== "ausente_tasy") {
    const difQtd = typeof r.dif_qtd === "number" ? r.dif_qtd : Number(r.dif_qtd ?? 0);
    if (difQtd < -0.5) r.status = "pago_a_mais";
    else if (difQtd > 0.5) r.status = "div_qtd_valor";
    else r.status = "ok";
  }
  return typeof r.key === "string" && TVR_STATUS_ORDER.includes(r.status as TvrStatus);
}


function num(v: string | number | undefined | null): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // BR "1.234,56": ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Múltiplos pontos = separador de milhar BR ("1.234.567" → 1234567).
    // Um único ponto: SEMPRE decimal. Não adivinhamos "900.025" como milhar
    // aqui: valores de planilha já vêm normalizados por parseCellMoney,
    // e valores de re-hidratação são sempre `String(number)` do JS
    // (ponto = decimal). O heurístico antigo (3 dígitos após o ponto = milhar)
    // inflacionava unit_tasy de 1800.05/2 = 900.025 em 1000×, produzindo
    // R$ 900.025,00 no lugar de R$ 900,03.
    const parts = s.split(".");
    if (parts.length > 2) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normTuss(v: string | undefined): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 8);
}

function tvrTussKey(v: string | undefined): string {
  // Chave TUSS estrita em 8 dígitos (usuário confirmou uso da coluna 8d).
  // Se vier com menos dígitos, mantém o que houver — nunca "encurta" para 7.
  return normTuss(v);
}

function isExcludedTvrTuss(v: string | undefined, excluded: Set<string>): boolean {
  const full = normTuss(v);
  if (!full) return false;
  return excluded.has(full);
}

function normAtt(v: string | undefined): string {
  return String(v ?? "").trim();
}

// Normaliza nome do médico: remove acentos, prefixos ("dr", "dra"), pontuação e
// colapsa espaços. Usada só como fallback quando não há doctor_id do lado TASY.
function normDoctorName(v: string | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bdr[a]?\.?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Prefere doctor_id (confiável). Cai para nome normalizado quando id ausente.
// `nameToId` é um índice compartilhado (construído a partir do lado Repasse) que
// permite ao lado TASY também "cair" em `d:<id>` quando o nome bate.
function doctorKeyPart(id: string | undefined, name: string | undefined, nameToId?: Map<string, string>): string {
  const did = (id ?? "").trim();
  if (did) return `d:${did}`;
  const n = normDoctorName(name);
  if (!n) return "";
  const mapped = nameToId?.get(n);
  if (mapped) return `d:${mapped}`;
  return `n:${n}`;
}

// Extrai Y-M-D puro sem passar por fuso. Aceita "YYYY-MM-DD[Thh:mm...]" ou
// "DD/MM/YYYY". Retorna "" quando não conseguir identificar.
function dateKeyPart(v: string | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}

// Compõe a chave canônica de cruzamento TASY×Repasse.
// Atendimento + Data (Y-M-D) + TUSS (8d) + Médico (doctor_id ou nome normalizado).
function tvrMatchKey(att: string | undefined, date: string | undefined, tuss: string | undefined, doctorId: string | undefined, doctorName: string | undefined, nameToId?: Map<string, string>): string {
  return `${normAtt(att)}|${dateKeyPart(date)}|${tvrTussKey(tuss)}|${doctorKeyPart(doctorId, doctorName, nameToId)}`;
}

const KEY_AUDIT_SOURCE_LABEL: Record<NonNullable<TvrResult["key_audit"]>["doctor"]["source"], string> = {
  repasse_id: "doctor_id (Repasse)",
  name_to_id: "Nome → doctor_id (fallback)",
  name_only: "Só nome",
  missing: "Sem médico",
};

const KEY_AUDIT_SOURCE_TONE: Record<NonNullable<TvrResult["key_audit"]>["doctor"]["source"], string> = {
  repasse_id: "bg-emerald-100 text-emerald-800 border-emerald-200",
  name_to_id: "bg-amber-100 text-amber-800 border-amber-200",
  name_only: "bg-orange-100 text-orange-800 border-orange-200",
  missing: "bg-red-100 text-red-800 border-red-200",
};

function KeyAuditDialog({
  open,
  onOpenChange,
  results,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  results: TvrResult[] | null;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | keyof typeof KEY_AUDIT_SOURCE_LABEL>("all");
  const [search, setSearch] = useState("");

  const list = results ?? [];
  const counts = useMemo(() => {
    const c = { repasse_id: 0, name_to_id: 0, name_only: 0, missing: 0 } as Record<keyof typeof KEY_AUDIT_SOURCE_LABEL, number>;
    for (const r of list) {
      const src = r.key_audit?.doctor.source ?? "missing";
      c[src]++;
    }
    return c;
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (sourceFilter !== "all" && (r.key_audit?.doctor.source ?? "missing") !== sourceFilter) return false;
      if (!q) return true;
      const hay = `${r.key_audit?.att ?? ""} ${r.key_audit?.date ?? ""} ${r.key_audit?.tuss8 ?? ""} ${r.key_audit?.doctor.name_raw ?? ""} ${r.key_audit?.doctor.name_norm ?? ""} ${r.key_audit?.doctor.id ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [list, sourceFilter, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Auditoria da chave de cruzamento</DialogTitle>
          <DialogDescription>
            Composição da chave canônica por linha reconciliada: <b>Atendimento + Data (Y-M-D) + TUSS (8d) + Médico</b>.
            Quando o TASY não trazia <code>doctor_id</code>, marcamos o fallback <b>Nome → doctor_id</b> (índice construído a partir dos itens do Repasse).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          {(Object.keys(KEY_AUDIT_SOURCE_LABEL) as Array<keyof typeof KEY_AUDIT_SOURCE_LABEL>).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSourceFilter((cur) => (cur === k ? "all" : k))}
              className={cn(
                "text-[11px] px-2 py-1 rounded border transition-all",
                KEY_AUDIT_SOURCE_TONE[k],
                sourceFilter === k ? "ring-2 ring-offset-1 ring-primary" : "opacity-90 hover:opacity-100",
              )}
            >
              {KEY_AUDIT_SOURCE_LABEL[k]}: <b>{counts[k]}</b>
            </button>
          ))}
          {sourceFilter !== "all" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSourceFilter("all")}>
              Limpar filtro
            </Button>
          )}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar atend., TUSS, médico…"
            className="h-8 w-[280px] text-xs ml-auto"
          />
        </div>

        <div className="max-h-[60vh] overflow-auto rounded border border-border">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="text-[11px]">Atendimento</TableHead>
                <TableHead className="text-[11px]">Data (Y-M-D)</TableHead>
                <TableHead className="text-[11px]">TUSS (8d)</TableHead>
                <TableHead className="text-[11px]">Médico (bruto)</TableHead>
                <TableHead className="text-[11px]">Nome normalizado</TableHead>
                <TableHead className="text-[11px]">doctor_id resolvido</TableHead>
                <TableHead className="text-[11px]">Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-xs">
                    Nenhuma linha corresponde aos filtros.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const a = r.key_audit;
                const src = a?.doctor.source ?? "missing";
                return (
                  <TableRow key={r.key}>
                    <TableCell className="text-xs font-mono">{a?.att || "—"}</TableCell>
                    <TableCell className={cn("text-xs font-mono", !a?.date && "text-red-600")}>{a?.date || "faltando"}</TableCell>
                    <TableCell className={cn("text-xs font-mono", (a?.tuss8?.length ?? 0) < 8 && "text-amber-700")}>
                      {a?.tuss8 || "—"}
                      {a?.tuss8 && a.tuss8.length < 8 && (
                        <span className="ml-1 text-[10px] text-amber-700">({a.tuss8.length}d)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{a?.doctor.name_raw || "—"}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{a?.doctor.name_norm || "—"}</TableCell>
                    <TableCell className="text-[11px] font-mono">{a?.doctor.id ? a.doctor.id.slice(0, 8) + "…" : "—"}</TableCell>
                    <TableCell>
                      <span className={cn("inline-block text-[10px] px-1.5 py-0.5 rounded border", KEY_AUDIT_SOURCE_TONE[src])}>
                        {KEY_AUDIT_SOURCE_LABEL[src]}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <div className="text-[11px] text-muted-foreground mr-auto">
            {filtered.length} de {list.length} linha(s) · Chave = <code>Atend | Data | TUSS8 | Médico</code>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Filtro de lotes na tela de análise TASY vs Repasse. Permite ao analista
 * restringir quais lotes (payment_id) fazem parte da apuração — sem isso,
 * apurações criadas sem lote fixo caem no fallback por competência do mês
 * e misturam outros lotes na conta.
 *
 * Persiste em `summary.selected_payment_ids` e dispara reload do Passo 2.
 */
function LoteScopeFilter({
  recon,
  pagRows,
  onChanged,
}: {
  recon: ReconRow | null;
  pagRows: PagRow[];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  // Agrupa itens carregados por lote (payment_id) — conta linhas, atendimentos
  // distintos, quantidade total e valores base/acordo. Serve tanto para o filtro
  // (checkboxes) quanto para o resumo por lote mostrado abaixo.
  const lotesLoaded = useMemo(() => {
    const map = new Map<string, {
      id: string;
      label: string;
      count: number;
      atendimentos: Set<string>;
      qtd_total: number;
      valor_base: number;
      valor_com_acordo: number;
    }>();
    for (const r of pagRows) {
      const pid = (r.pag_payment_id ?? "").trim();
      if (!pid) continue;
      const label = (r.pag_lote ?? "").trim() || pid.slice(0, 8);
      const qtd = num(r.pag_qtd) || 1;
      const vb = num(r.pag_valor_base);
      const va = num(r.pag_valor_com_acordo);
      const att = (r.pag_atendimento ?? "").trim();
      const cur = map.get(pid);
      if (cur) {
        cur.count += 1;
        cur.qtd_total += qtd;
        cur.valor_base += vb;
        cur.valor_com_acordo += va;
        if (att) cur.atendimentos.add(att);
      } else {
        const atts = new Set<string>();
        if (att) atts.add(att);
        map.set(pid, {
          id: pid,
          label,
          count: 1,
          atendimentos: atts,
          qtd_total: qtd,
          valor_base: vb,
          valor_com_acordo: va,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [pagRows]);

  const persistedIds = useMemo(
    () => new Set((recon?.summary?.selected_payment_ids ?? []).filter(Boolean)),
    [recon?.summary?.selected_payment_ids],
  );

  if (lotesLoaded.length <= 1 && persistedIds.size === 0) {
    // Só um lote e nenhum filtro salvo — nada a decidir.
    return null;
  }

  const toggleLote = async (pid: string, include: boolean) => {
    if (!recon) return;
    if (persistedIds.size === 0) {
      toast({
        title: "Filtro de lote não salvo",
        description: "Volte e crie a apuração selecionando o lote; não vamos inferir escopo por linhas carregadas.",
        variant: "destructive",
      });
      return;
    }
    const currentIds = persistedIds.size > 0
      ? new Set(persistedIds)
      : new Set(lotesLoaded.map((l) => l.id));
    if (include) currentIds.add(pid);
    else currentIds.delete(pid);
    if (currentIds.size === 0) {
      toast({ title: "Selecione ao menos um lote", variant: "destructive" });
      return;
    }
    const nextIds = Array.from(currentIds);
    const nextLabels = lotesLoaded
      .filter((l) => currentIds.has(l.id))
      .map((l) => l.label);
    setSaving(true);
    try {
      const nextSummary = {
        ...(recon.summary ?? {}),
        selected_payment_ids: nextIds,
        selected_payment_labels: nextLabels,
      };
      const { error } = await supabase
        .from("retroactive_reconciliations" as never)
        .update({ summary: nextSummary } as never)
        .eq("id", recon.id);
      if (error) throw error;
      // Muta o recon local para o próximo loadPaymentItems ler o filtro novo.
      // Isso evita depender de round-trip do estado antes do reload.
      (recon as ReconRow).summary = nextSummary as ReconRow["summary"];
      onChanged();
    } catch (e) {
      toast({
        title: "Erro ao salvar filtro de lote",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasFilter = persistedIds.size > 0;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-foreground">Lotes no escopo desta apuração</span>
        {hasFilter ? (
          <Badge variant="default" className="text-[10px]">Filtro ativo · {persistedIds.size} lote(s)</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Sem filtro · todos os lotes da competência</Badge>
        )}
        {saving && <span className="text-[10px] text-muted-foreground">salvando…</span>}
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Desmarque os lotes que não devem entrar na análise. O motor recarrega o Passo 2 com o novo escopo
        (impede que itens de outros lotes do mesmo mês contaminem os totais).
        Os valores abaixo já refletem <strong>somente os itens carregados</strong> — se um lote for desmarcado
        e recarregado, ele some da conta.
      </p>
      {(() => {
        // Totais consolidados: soma apenas dos lotes que estão dentro do escopo
        // atual (para o analista ver de onde vem o "total final" da análise).
        const inScope = lotesLoaded.filter((l) => (hasFilter ? persistedIds.has(l.id) : true));
        const tot = inScope.reduce(
          (acc, l) => {
            acc.count += l.count;
            acc.qtd += l.qtd_total;
            acc.atts += l.atendimentos.size;
            acc.base += l.valor_base;
            acc.acordo += l.valor_com_acordo;
            return acc;
          },
          { count: 0, qtd: 0, atts: 0, base: 0, acordo: 0 },
        );
        return (
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Incluir</th>
                    <th className="text-left px-2 py-1.5 font-medium">Lote</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Linhas de payment_items">Itens</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Atendimentos distintos">Atend.</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma das quantidades">Qtd</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma de procedure_amount (base 100%, sem acordo)">Valor Base</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Soma de expected_amount (valor efetivo com % do acordo)">Vlr c/ Acordo</th>
                  </tr>
                </thead>
                <tbody>
                  {lotesLoaded.map((l) => {
                    const isIn = hasFilter ? persistedIds.has(l.id) : true;
                    return (
                      <tr key={l.id} className={cn("border-t border-border", !isIn && "opacity-50")}>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void toggleLote(l.id, !isIn)}
                            className={cn(
                              "inline-flex items-center justify-center h-5 w-5 rounded border transition-colors",
                              isIn
                                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                                : "border-border bg-background hover:bg-muted",
                            )}
                            title={isIn ? "Remover este lote do escopo" : "Incluir este lote no escopo"}
                            aria-label={isIn ? `Remover lote ${l.label}` : `Incluir lote ${l.label}`}
                          >
                            {isIn ? <CheckIcon className="h-3 w-3" /> : <PlusIcon className="h-3 w-3" />}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 font-mono max-w-[220px] truncate" title={l.label}>{l.label}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.count.toLocaleString("pt-BR")}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.atendimentos.size.toLocaleString("pt-BR")}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.qtd_total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{brl(l.valor_base)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{brl(l.valor_com_acordo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/40 font-semibold text-foreground">
                  <tr className="border-t border-border">
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5">
                      Total no escopo ({inScope.length}/{lotesLoaded.length} lote{lotesLoaded.length === 1 ? "" : "s"})
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.count.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.atts.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{tot.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{brl(tot.base)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{brl(tot.acordo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
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

  // Normalização de convênio para comparação/exclusão (sem acento, minúsculo,
  // só alfanumérico). Espelha o filtro da conciliação por lote.
  const normConv = (s: unknown): string =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const availableConvenios = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    const add = (raw: unknown) => {
      const label = String(raw ?? "").trim();
      if (!label) return;
      const key = normConv(label);
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
      const excluded = new Set(
        excludeTuss.split(",").flatMap((s) => {
          const full = normTuss(s.trim());
          const key = tvrTussKey(full);
          return [full, key].filter(Boolean);
        }),
      );
      const excludedConvSet = new Set(excludedConvenios.map((k) => normConv(k)).filter(Boolean));
      const isExcludedConv = (raw: unknown) => excludedConvSet.size > 0 && excludedConvSet.has(normConv(raw));
      let convTasyRemoved = 0;
      let convPagRemoved = 0;
      let companyTasyRemoved = 0;

      // Índice nome→doctor_id extraído do lado Repasse. Permite ao lado TASY
      // (que só tem o nome) cair em `d:<id>` e casar com o Repasse.
      const nameToDoctorId = new Map<string, string>();
      // Índice `${company_id}|${nomeNorm}` → doctor_id. Serve pra desambiguar
      // médicos homônimos que atendem por PJs diferentes — quando a linha TASY
      // trouxer a empresa, priorizamos o doctor_id daquela PJ.
      const nameByCompanyToDoctor = new Map<string, string>();
      for (const r of effectivePagRows) {
        const did = (r.pag_doctor_id ?? "").trim();
        const nn = normDoctorName(r.pag_medico);
        const cid = (r.pag_company_id ?? "").trim();
        if (did && nn && !nameToDoctorId.has(nn)) nameToDoctorId.set(nn, did);
        if (did && nn && cid) {
          const k = `${cid}|${nn}`;
          if (!nameByCompanyToDoctor.has(k)) nameByCompanyToDoctor.set(k, did);
        }
      }

      // Resolver PJ (Terceiro) do TASY → company_id. Aceita vínculo manual do
      // wizard, CNPJ (dígitos), razão social ou alias do cadastro estadual.
      const normCompanyName = (s: unknown) =>
        String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const companyByDoc = new Map<string, string>();
      const companyByName = new Map<string, string>();
      try {
        const { data: companiesData } = await supabase
          .from("companies" as never)
          .select("id, name, document, aliases");
        for (const c of (companiesData ?? []) as Array<Record<string, unknown>>) {
          const docDigits = String(c.document ?? "").replace(/\D+/g, "");
          const cid = String(c.id ?? "");
          if (!cid) continue;
          if (docDigits) companyByDoc.set(docDigits, cid);
          const nn = normCompanyName(c.name);
          if (nn && !companyByName.has(nn)) companyByName.set(nn, cid);
          const aliases = Array.isArray(c.aliases) ? c.aliases : [];
          for (const alias of aliases) {
            const aliasKey = normCompanyName(alias);
            if (aliasKey && !companyByName.has(aliasKey)) companyByName.set(aliasKey, cid);
          }
        }
      } catch (e) {
        console.warn("TVR: falha carregando companies para resolver empresa do TASY", e);
      }
      const resolveTasyCompany = (row: TasyRow): string | null => {
        const manualId = String(row.tasy_resolved_company_id ?? "").trim();
        if (manualId) return manualId;
        const raw = row.tasy_empresa;
        const s = String(raw ?? "").trim();
        if (!s) return null;
        const digits = s.replace(/\D+/g, "");
        if (digits.length >= 11) {
          const hit = companyByDoc.get(digits) || (digits.length > 14 ? companyByDoc.get(digits.slice(-14)) : undefined);
          if (hit) return hit;
        }
        const nn = normCompanyName(s);
        return companyByName.get(nn) ?? null;
      };

      // Escopo de PJs da apuração — usado pra filtrar linhas TASY que sejam de
      // empresas fora do escopo. Em TVR com lote fixado, linha TASY sem PJ
      // resolvida não pode virar "Não Pago", porque não há como provar que
      // pertence ao universo do lote escolhido.
      const scopedCompanyIds = new Set<string>();
      const summaryScope = (recon?.summary as Record<string, unknown> | null) ?? {};
      const reconMultiCompanyIds = ((summaryScope.multi_company_ids as string[] | undefined) ?? []).filter(Boolean);
      const reconIsMulti = summaryScope.scope === "multi_pj" && reconMultiCompanyIds.length > 0;
      if (reconIsMulti) {
        for (const cid of reconMultiCompanyIds) if (cid) scopedCompanyIds.add(String(cid));
      } else if (recon?.company_id) {
        scopedCompanyIds.add(String(recon.company_id));
      } else {
        for (const r of effectivePagRows) if (r.pag_company_id) scopedCompanyIds.add(r.pag_company_id);
      }

      const tasyCompanyByRow = new Map<TasyRow, string | null>();
      const effectiveTasyRows: TasyRow[] = [];
      let tasyOutOfPeriodRemoved = 0;
      let tasyMissingDateRemoved = 0;
      let tasyMissingCompany = 0;
      let tasyUnresolvedCompany = 0;
      // Amostragem por valor cru da coluna Empresa/PJ — alimenta o painel de
      // mapeamento inline sem bloquear o processamento do lote.
      const unresolvedByRaw = new Map<string, { count: number; missing: boolean }>();
      for (const r of tasyRows) {
        const ymd = dbDateOrNull(r.tasy_data);
        if (!ymd) {
          tasyMissingDateRemoved++;
          continue;
        }
        if (recon && !isYmdWithinInclusive(ymd, recon.period_start, recon.period_end)) {
          tasyOutOfPeriodRemoved++;
          continue;
        }
        const cid = resolveTasyCompany(r);
        tasyCompanyByRow.set(r, cid);
        if (scopedCompanyIds.size > 0) {
          const rawEmpresa = String(r.tasy_empresa ?? "").trim();
          if (!rawEmpresa) {
            // Linha TASY sem PJ na origem: não pode ser atribuída ao lote,
            // então é tratada como fora de escopo (não bloqueia processamento).
            tasyMissingCompany++;
            const key = "(vazio)";
            const cur = unresolvedByRaw.get(key) ?? { count: 0, missing: true };
            unresolvedByRaw.set(key, { count: cur.count + 1, missing: true });
            companyTasyRemoved++;
            continue;
          }
          if (!cid) {
            // PJ não cadastrada/sem alias: se não está no escopo do lote de
            // pagamento, não faz sentido bloquear — apenas apontar no painel
            // para o analista mapear se quiser incluir no cruzamento.
            tasyUnresolvedCompany++;
            const cur = unresolvedByRaw.get(rawEmpresa) ?? { count: 0, missing: false };
            unresolvedByRaw.set(rawEmpresa, { count: cur.count + 1, missing: false });
            companyTasyRemoved++;
            continue;
          }
          if (!scopedCompanyIds.has(cid)) {
            companyTasyRemoved++;
            continue;
          }
        }
        effectiveTasyRows.push(r);
      }

      // Painel informativo (não bloqueia): permite ao analista mapear PJs
      // cruas a cadastros quando quiser resgatar essas linhas para o lote.
      if (tasyMissingCompany > 0 || tasyUnresolvedCompany > 0) {
        const samples = Array.from(unresolvedByRaw.entries())
          .map(([raw, v]) => ({ raw, count: v.count, missing: v.missing }))
          .sort((a, b) => b.count - a.count);
        setUnresolvedPjPanel(samples);
        setPjMapDraft((prev) => prev ?? {});
        toast({
          title: "Algumas linhas TASY ficaram fora do escopo",
          description: `${tasyMissingCompany + tasyUnresolvedCompany} linha(s) com PJ não vinculada foram ignoradas. Use o painel para mapear se precisar incluí-las.`,
        });
      } else {
        setUnresolvedPjPanel([]);
      }


      if (effectiveTasyRows.length === 0 && companyTasyRemoved === 0) {
        toast({
          title: "Nenhuma linha TASY dentro do escopo",
          description: "Revise o período selecionado e a coluna de data da planilha antes de processar.",
          variant: "destructive",
        });
        setProcessing(false); setProcProgress(null);
        return;
      }

      // Resolve doctor_id da linha TASY: PJ+nome tem prioridade sobre só-nome.
      const resolveTasyDoctorId = (row: TasyRow): string | undefined => {
        const nn = normDoctorName(row.tasy_medico);
        if (!nn) return undefined;
        const cid = tasyCompanyByRow.get(row);
        if (cid) {
          const v = nameByCompanyToDoctor.get(`${cid}|${nn}`);
          if (v) return v;
        }
        return nameToDoctorId.get(nn);
      };




      // Aggregate Repasse by (atendimento, data, tuss8, médico)
      type PAgg = {
        atendimento: string;
        tuss: string;
        qtd_total: number;
        funcs: Set<string>;
        lotes: Set<string>;
        valor_base: number;
        valor_com_acordo: number;
        payment_item_id_first: string;
        payment_id_first: string;
        sample: PagRow;
        doctor_ids_order: string[];
        doctor_principal_id: string | null;
      };
      const pMap = new Map<string, PAgg>();
      const isPrincipal = (fn: string) => /cirurgi[aã]o\s*principal/i.test(fn);
      for (const r of effectivePagRows) {
        if (isExcludedTvrTuss(r.pag_tuss, excluded)) continue;
        if (isExcludedConv(r.pag_convenio)) { convPagRemoved++; continue; }
        if (!dbDateOrNull(r.pag_data)) continue;
        const key = tvrMatchKey(r.pag_atendimento, r.pag_data, r.pag_tuss, r.pag_doctor_id, r.pag_medico, nameToDoctorId);
        const q = num(r.pag_qtd) || 1;
        const vb = num(r.pag_valor_base);
        const va = num(r.pag_valor_com_acordo);
        const fn = (r.pag_funcao ?? "").trim();
        const lote = (r.pag_lote ?? "").trim();
        const did = (r.pag_doctor_id ?? "").trim();
        const cur = pMap.get(key);
        if (cur) {
          cur.qtd_total += q;
          cur.valor_base += vb;
          cur.valor_com_acordo += va;
          if (fn) cur.funcs.add(fn);
          if (lote) cur.lotes.add(lote);
          if (!cur.payment_item_id_first && r.pag_payment_item_id) cur.payment_item_id_first = r.pag_payment_item_id;
          if (!cur.payment_id_first && r.pag_payment_id) cur.payment_id_first = r.pag_payment_id;
          if (did && !cur.doctor_ids_order.includes(did)) cur.doctor_ids_order.push(did);
          if (did && !cur.doctor_principal_id && isPrincipal(fn)) cur.doctor_principal_id = did;
          // enrich sample with non-empty fields from later rows
          const s = cur.sample;
          if (!s.pag_medico && r.pag_medico) s.pag_medico = r.pag_medico;
          if (!s.pag_paciente && r.pag_paciente) s.pag_paciente = r.pag_paciente;
          if (!s.pag_convenio && r.pag_convenio) s.pag_convenio = r.pag_convenio;
          if (!s.pag_procedimento && r.pag_procedimento) s.pag_procedimento = r.pag_procedimento;
          if (!s.pag_data && r.pag_data) s.pag_data = r.pag_data;
          if (!s.pag_funcao && r.pag_funcao) s.pag_funcao = r.pag_funcao;
          if (!s.pag_company_id && r.pag_company_id) s.pag_company_id = r.pag_company_id;
          if (!s.pag_applied_rule_id && r.pag_applied_rule_id) s.pag_applied_rule_id = r.pag_applied_rule_id;
          if (!s.pag_applied_rule_label && r.pag_applied_rule_label) s.pag_applied_rule_label = r.pag_applied_rule_label;
          if (!s.pag_applied_calc_id && r.pag_applied_calc_id) s.pag_applied_calc_id = r.pag_applied_calc_id;
          if (!s.pag_applied_calc_method && r.pag_applied_calc_method) s.pag_applied_calc_method = r.pag_applied_calc_method;
        } else {
          const funcs = new Set<string>();
          const lotes = new Set<string>();
          if (fn) funcs.add(fn);
          if (lote) lotes.add(lote);
          pMap.set(key, {
            atendimento: r.pag_atendimento,
            tuss: r.pag_tuss,
            qtd_total: q,
            funcs,
            lotes,
            valor_base: vb,
            valor_com_acordo: va,
            payment_item_id_first: r.pag_payment_item_id ?? "",
            payment_id_first: r.pag_payment_id ?? "",
            sample: { ...r },
            doctor_ids_order: did ? [did] : [],
            doctor_principal_id: did && isPrincipal(fn) ? did : null,
          });
        }
      }

      // Sem detector de ratio: valores monetários já são BRL (ver parseCellMoney).

      // Aggregate TASY by (atendimento, tuss). O arquivo TASY pode trazer a coluna
      // de valor como unitária ou como total da linha; detectamos pelo que melhor
      // reconcilia com `procedure_amount` já gravado nos itens pagos.
      type TAgg = {
        atendimento: string;
        tuss: string;
        qtd: number;
        valor_total: number;
        valor_unit_first: number;
        sample: TasyRow;
      };
      // Coluna "Valor" do relatório TASY é o TOTAL da linha (já multiplicado por qtd).
      // Nunca multiplicar novamente por quantidade — inflacionaria totais e complementos.
      const tasyValueIsLineTotal = true;

      const tMap = new Map<string, TAgg>();
      for (const r of effectiveTasyRows) {
        if (isExcludedTvrTuss(r.tasy_tuss, excluded)) continue;
        if (isExcludedConv(r.tasy_convenio)) { convTasyRemoved++; continue; }
        const key = tvrMatchKey(r.tasy_atendimento, r.tasy_data, r.tasy_tuss, resolveTasyDoctorId(r), r.tasy_medico, nameToDoctorId);
        const q = num(r.tasy_qtd) || 1;
        const v = num(r.tasy_valor_unit);
        const lineTotal = tasyValueIsLineTotal ? v : v * q;
        const unitValue = tasyValueIsLineTotal && q > 0 ? v / q : v;
        const cur = tMap.get(key);
        if (cur) {
          cur.qtd += q;
          cur.valor_total += lineTotal;
        } else {
          tMap.set(key, { atendimento: r.tasy_atendimento, tuss: r.tasy_tuss, qtd: q, valor_total: lineTotal, valor_unit_first: unitValue, sample: r });
        }
      }


      const allKeys = new Set<string>([...tMap.keys(), ...pMap.keys()]);
      const out: TvrResult[] = [];

      for (const key of allKeys) {
        const t = tMap.get(key);
        const p = pMap.get(key);

        const atendimento = t?.atendimento ?? p?.atendimento ?? "";
        const tuss = t?.tuss ?? p?.tuss ?? "";

        const qtd_tasy = t?.qtd ?? 0;
        const valor_total_tasy = t?.valor_total ?? 0;
        const valor_unit_tasy = t ? (t.qtd > 0 ? t.valor_total / t.qtd : t.valor_unit_first) : 0;

        const n_funcs = p ? Math.max(p.funcs.size, p.qtd_total > 0 ? 1 : 0) : 0;
        const qtd_por_func = p && n_funcs > 0 ? p.qtd_total / n_funcs : (p ? p.qtd_total : 0);
        const valor_pago_base = p?.valor_base ?? 0;
        const valor_com_acordo = p?.valor_com_acordo ?? 0;
        const funcoes_pagas = p ? Array.from(p.funcs).join(", ") : "";
        const lotes = p ? Array.from(p.lotes).join(", ") : "";

        const dif_qtd = qtd_tasy - qtd_por_func;
        const dif_valor = valor_total_tasy - valor_pago_base;

        // Determina o tipo de análise a partir do método de cálculo aplicado.
        // Grupo "valor": regras que usam o valor do convênio como base (TASY e Exacta
        //   partem da mesma tabela) → comparar valores em R$ faz sentido. Inclui
        //   também `bonus`, que por definição é aditivo sobre uma base faturada —
        //   se o TASY não faturou a base, o bônus não deveria existir e precisa
        //   entrar como glosa financeira normal.
        // Grupo "quantidade": tabela própria (valor_fixo, pacote, tabela diferenciada)
        //   → valor TASY não é comparável; só quantidade e presença.
        const rawMethod = (p?.sample.pag_applied_calc_method ?? "").trim().toLowerCase();
        const isFixedMethod =
          rawMethod === "valor_fixo" ||
          rawMethod === "tabela_diferenciada" ||
          rawMethod.startsWith("pacote");

        const tipo_analise: "valor" | "quantidade" = isFixedMethod ? "quantidade" : "valor";

        // Status deriva do tipo de análise: em "quantidade" nunca consideramos
        // diferenças de R$ (TASY não é base), só presença e quantidade — assim o
        // badge e a coluna de ação sempre concordam.
        let status: TvrStatus;
        if (!p && t) status = "nao_pago";
        else if (!t && p) status = "ausente_tasy";
        else if (tipo_analise === "quantidade") {
          if (dif_qtd < -0.5) status = "pago_a_mais";
          else if (dif_qtd > 0.5) status = "div_qtd_valor";
          else status = "ok";
        }
        else if (dif_valor < -0.5) status = "pago_a_mais";
        else if (Math.abs(dif_qtd) >= 0.5 && Math.abs(dif_valor) > 0.5) status = "div_qtd_valor";
        else if (Math.abs(dif_valor) > 0.5) status = "div_valor";
        else status = "ok";


        // Comparação: valor com acordo pago no histórico (Exacta) vs
        // valor que o mesmo acordo pagaria HOJE se aplicado sobre a base TASY.
        // fator_acordo é o % de acordo que a regra praticou no lote
        // (ex.: 100%, 88% para hemo, 27,51% para valor_fixo etc.).
        const fator_acordo = valor_pago_base > 0 ? valor_com_acordo / valor_pago_base : 0;
        const valor_com_acordo_recalc = valor_total_tasy * fator_acordo;
        // Positivo => paguei a mais (a recuperar).
        // Negativo => paguei a menos (a complementar).
        let ajuste_acordo = 0;
        let sem_lastro_tasy = false;
        if (tipo_analise === "quantidade") {
          // Grupo B: só compara quantidade. Divergência de valor TASY não é erro.
          if (status === "ausente_tasy") {
            // Pacote/valor_fixo pode não faturar item individualmente no TASY →
            // marca "sem lastro" como alerta qualitativo, sem cobrar R$.
            sem_lastro_tasy = true;
            ajuste_acordo = 0;
          } else if (status === "nao_pago") {
            ajuste_acordo = 0;
          } else if (qtd_por_func > 0 && qtd_tasy + 0.0001 < qtd_por_func) {
            // Proporcional: pagou N, TASY comprova M<N → recupera (N−M)/N do pago.
            const deficit = (qtd_por_func - qtd_tasy) / qtd_por_func;
            ajuste_acordo = valor_com_acordo * deficit;
          }
        } else {
          // Grupo A: regra % sobre convênio → compara valor com acordo recalculado.
          if (status === "ausente_tasy") {
            // TASY zerado/inexistente => item não deveria ter sido pago.
            ajuste_acordo = valor_pago_base;
          } else if (status === "nao_pago") {
            ajuste_acordo = 0; // sem base de acordo — tratado na tela de confecção
          } else if (valor_pago_base > 0) {
            ajuste_acordo = valor_com_acordo - valor_com_acordo_recalc;
          }
        }
        const valor_recuperar_acordo = Math.max(0, ajuste_acordo);

        // ---- Auditoria da chave ----
        const auditAtt = normAtt(t?.atendimento ?? p?.atendimento ?? "");
        const auditDate = dateKeyPart(t?.sample.tasy_data || p?.sample.pag_data || "");
        const auditTuss8 = tvrTussKey(t?.tuss ?? p?.tuss ?? "");
        const pagDoctorIdRaw = (p?.sample.pag_doctor_id ?? "").trim();
        const tasyName = t?.sample.tasy_medico ?? "";
        const pagName = p?.sample.pag_medico ?? "";
        const nameRawForAudit = tasyName || pagName;
        const nameNormForAudit = normDoctorName(nameRawForAudit);
        let doctorSource: "repasse_id" | "name_to_id" | "name_only" | "missing";
        let doctorIdForAudit: string | undefined;
        if (pagDoctorIdRaw) {
          doctorSource = "repasse_id";
          doctorIdForAudit = pagDoctorIdRaw;
        } else if (nameNormForAudit && nameToDoctorId.get(nameNormForAudit)) {
          doctorSource = "name_to_id";
          doctorIdForAudit = nameToDoctorId.get(nameNormForAudit);
        } else if (nameNormForAudit) {
          doctorSource = "name_only";
        } else {
          doctorSource = "missing";
        }

        out.push({
          key,
          atendimento,
          tuss,
          procedimento: t?.sample.tasy_procedimento || p?.sample.pag_procedimento || "",
          paciente: t?.sample.tasy_paciente || p?.sample.pag_paciente || "",
          data: t?.sample.tasy_data || p?.sample.pag_data || "",
          convenio: t?.sample.tasy_convenio || p?.sample.pag_convenio || "",
          medico: t?.sample.tasy_medico || p?.sample.pag_medico || "",
          funcao: t?.sample.tasy_funcao || p?.sample.pag_funcao || "",

          qtd_tasy,
          valor_unit_tasy,
          valor_total_tasy,
          qtd_por_func,
          n_funcs,
          funcoes_pagas,
          lotes,
          valor_pago_base,
          valor_com_acordo,
          dif_qtd,
          dif_valor,
          valor_recuperar_acordo,
          valor_com_acordo_recalc,
          ajuste_acordo,
          tipo_analise,
          sem_lastro_tasy,
          matched_payment_item_id: p?.payment_item_id_first || undefined,
          matched_payment_id: p?.payment_id_first || undefined,
          matched_doctor_id: p ? (p.doctor_principal_id || p.doctor_ids_order[0] || undefined) : undefined,
          matched_doctor_ids: p && p.doctor_ids_order.length > 0 ? [...p.doctor_ids_order] : undefined,
          matched_company_id: p?.sample.pag_company_id || undefined,
          tasy_empresa: t?.sample.tasy_empresa || undefined,
          tasy_resolved_company_id: t ? tasyCompanyByRow.get(t.sample) ?? null : null,
          regra_aplicada: p?.sample.pag_applied_rule_label || undefined,
          calculo_aplicado: undefined, // preenchido depois via lookup em rule_calculations
          key_audit: {
            att: auditAtt,
            date: auditDate,
            tuss8: auditTuss8,
            doctor: {
              source: doctorSource,
              id: doctorIdForAudit,
              name_raw: nameRawForAudit || undefined,
              name_norm: nameNormForAudit || undefined,
            },
          },
          status,
        });
      }

      out.sort((a, b) => {
        const oa = TVR_STATUS_ORDER.indexOf(a.status);
        const ob = TVR_STATUS_ORDER.indexOf(b.status);
        if (oa !== ob) return oa - ob;
        if (a.atendimento !== b.atendimento) return a.atendimento.localeCompare(b.atendimento);
        return a.tuss.localeCompare(b.tuss);
      });

      // Etapa 2: enriquecimento de PJ e labels de regra (queries auxiliares).
      setProcProgress({ step: "enriquecendo", current: 0, total: out.length });

      // Enriquecer com nome da PJ e label da linha de cálculo aplicada
      try {
        const companyIds = Array.from(new Set(out.map((r) => r.matched_company_id).filter(Boolean))) as string[];
        const calcIds = Array.from(new Set(out.map((r) => (pMap.get(r.key)?.sample.pag_applied_calc_id || "")).filter(Boolean))) as string[];
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
          const cid = pMap.get(r.key)?.sample.pag_applied_calc_id;
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
        setConvenioFilterStats(excludedConvSet.size > 0 ? { tasyRemoved: convTasyRemoved, pagRemoved: convPagRemoved } : null);
        setSelectedKeys(new Set());
        await loadTvrReconciliation();
        const companyMsg = companyTasyRemoved > 0 ? ` · ${companyTasyRemoved} linha(s) TASY fora do escopo de PJ` : "";
        const periodMsg = tasyOutOfPeriodRemoved + tasyMissingDateRemoved > 0
          ? ` · ${tasyOutOfPeriodRemoved + tasyMissingDateRemoved} linha(s) TASY fora do período/sem data`
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
    { group: "Ajuste (pago no lote − devido hoje)", header: "A recuperar (paguei a mais)", get: (r) => Number((r.valor_recuperar_acordo ?? 0).toFixed(2)) },
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
    return r.status === "ausente_tasy" && (r.valor_recuperar_acordo ?? 0) > 0.5;
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
    list.filter((r) => (r.valor_recuperar_acordo ?? 0) > 0.5);

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
          .filter((r) => (r.valor_recuperar_acordo ?? 0) > 0.5)
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
          .filter((r) => (r.valor_recuperar_acordo ?? 0) > 0.5)
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

    const totalGlosa = allItems.reduce((s, r) => s + (r.valor_recuperar_acordo ?? 0), 0);
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
            valor_glosa: Number((r.valor_recuperar_acordo ?? 0).toFixed(2)),
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
      (s, g) => s + g.items.reduce((ss, r) => ss + (r.valor_recuperar_acordo ?? 0), 0),
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

type GlosaGroupView = {
  doctor_id: string;
  doctor_name: string;
  doctor_crm: string | null;
  company_id: string | null;
  company_name: string | null;
  items: TvrResult[];
};

type EncaminharModalProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  headline: ReturnType<typeof computeTvrHeadlineTotals>;
  actionable: TvrResult[];
  retirar: TvrResult[];
  groups: GlosaGroupView[];
  unassigned: TvrResult[];
  canGerarGlosa: boolean;
  modoMedicoUnico: boolean;
  busy: boolean;
  onConfirm: (opts: {
    includeComplementar: boolean;
    gerarGlosa: boolean;
    parcelas: number;
    parcelasByDoctor: Record<string, number>;
    selectedDoctorIds: string[];
  }) => void;
  // Escopo do lote de referência para cruzar líquido da PJ.
  // Vem da apuração e casa hospital + centro de custos + trilha (prioritária/habitual).
  refScope: {
    hospital_id: string | null;
    cost_center_code: string | null;
    analysis_mode: string | null;
  };
};

function EncaminharApuracaoModal({
  open, onOpenChange, headline, actionable, retirar,
  groups, unassigned, canGerarGlosa, modoMedicoUnico, busy, onConfirm, refScope,
}: EncaminharModalProps) {
  const [includeComplementar, setIncludeComplementar] = useState(false);
  const [gerarGlosa, setGerarGlosa] = useState<"agora" | "depois">("agora");
  const [parcelas, setParcelas] = useState<number>(0);
  const [parcelasByDoctor, setParcelasByDoctor] = useState<Record<string, number>>({});
  const [showCompList, setShowCompList] = useState(false);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Sugestão automática de parcelas por porte do débito.
  // Valores pequenos ficam em 1× (não faz sentido parcelar R$ 200);
  // valores maiores vão diluindo para reduzir impacto no próximo lote da PJ.
  const suggestParcelas = (subtotal: number): number => {
    if (subtotal <= 500) return 1;
    if (subtotal <= 2000) return 2;
    if (subtotal <= 5000) return 3;
    if (subtotal <= 15000) return 6;
    if (subtotal <= 30000) return 10;
    return 12;
  };

  // Chave estável dos grupos — evita re-semear o estado a cada render do pai
  // (buildGlosaGroups gera um novo array de referência em toda passagem, o que
  // fazia o efeito abaixo reexecutar e sobrescrever as seleções do usuário,
  // remarcando todos os médicos ao clicar em "Confirmar encaminhamento").
  const groupsKey = useMemo(
    () => groups.map((g) => g.doctor_id).sort().join("|"),
    [groups],
  );

  // Só (re)inicializa quando o modal abre OU quando a composição real de
  // grupos muda enquanto ele já está aberto (ex.: novo médico apareceu).
  const wasOpenRef = useRef(false);
  const lastGroupsKeyRef = useRef<string>("");
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    const groupsChangedWhileOpen = open && wasOpenRef.current && groupsKey !== lastGroupsKeyRef.current;
    wasOpenRef.current = open;
    if (!open) return;
    lastGroupsKeyRef.current = groupsKey;
    if (!justOpened && !groupsChangedWhileOpen) return;

    if (justOpened) {
      // Default por etapa: encaminhar glosa primeiro. Confecção de novo lote
      // fica opt-in — o analista precisa marcar explicitamente para gerar
      // itens a pagar. Item 3 do briefing.
      setIncludeComplementar(false);
      setGerarGlosa(retirar.length > 0 && canGerarGlosa ? "agora" : "depois");
      setParcelas(1);
      setShowCompList(false);
      setExpandedGroups(new Set());
    }
    // Ao abrir: seleciona todos. Se grupos mudarem enquanto aberto: preserva
    // as escolhas atuais e apenas adiciona os novos médicos como selecionados.
    setSelectedDoctorIds((prev) => {
      if (justOpened) return new Set(groups.map((g) => g.doctor_id));
      const next = new Set(prev);
      for (const g of groups) if (!next.has(g.doctor_id)) next.add(g.doctor_id);
      return next;
    });
    setParcelasByDoctor((prev) => {
      const next: Record<string, number> = justOpened ? {} : { ...prev };
      for (const g of groups) {
        if (!justOpened && next[g.doctor_id] != null) continue;
        const subtotal = g.items.reduce((s, r) => s + (r.valor_recuperar_acordo ?? 0), 0);
        next[g.doctor_id] = suggestParcelas(subtotal);
      }
      return next;
    });
  }, [open, groupsKey, actionable.length, retirar.length, canGerarGlosa, groups]);

  // Líquido da PJ no lote vigente, casando hospital + centro de custos + trilha.
  // Chave: company_id → snapshot do lote (referência, competência, líquido).
  // Sem lote → PJ vai para "débito futuro" (fila de espera até nova produção).
  type RefLote = {
    payment_id: string;
    reference: string;
    competence_month: string;
    liquido_total: number;
    status: string;
  };
  const [refLoteByCompany, setRefLoteByCompany] = useState<Record<string, RefLote>>({});
  const [refLoteLoading, setRefLoteLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const companyIds = Array.from(
      new Set(groups.map((g) => g.company_id).filter((v): v is string => !!v)),
    );
    if (
      companyIds.length === 0
      || !refScope.hospital_id
      || !refScope.cost_center_code
      || !refScope.analysis_mode
    ) {
      setRefLoteByCompany({});
      return;
    }
    let cancelled = false;
    setRefLoteLoading(true);
    (async () => {
      // Buscamos todos os pagamentos abertos (não cancelados) do mesmo CC+trilha
      // e cruzamos com payment_company_groups pra achar o líquido da PJ.
      // Ordem: competência mais recente primeiro; ficamos com o 1º por company_id.
      const { data: payments, error: payErr } = await supabase
        .from("payments")
        .select("id, reference, competence_month, status")
        .eq("hospital_id", refScope.hospital_id)
        .eq("cost_center_code", refScope.cost_center_code)
        .eq("analysis_mode", refScope.analysis_mode as never)
        .neq("status", "cancelado" as never)
        .order("competence_month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (payErr || !payments || payments.length === 0) {
        setRefLoteByCompany({});
        setRefLoteLoading(false);
        return;
      }
      const paymentIds = payments.map((p) => p.id as string);
      const { data: pcgs, error: pcgErr } = await supabase
        .from("payment_company_groups")
        .select("payment_id, company_id, liquido_total, status")
        .in("payment_id", paymentIds)
        .in("company_id", companyIds);
      if (cancelled) return;
      if (pcgErr || !pcgs) {
        setRefLoteByCompany({});
        setRefLoteLoading(false);
        return;
      }
      const paymentIndex = new Map(payments.map((p, i) => [p.id as string, i]));
      const bestByCompany = new Map<string, { pcg: typeof pcgs[number]; order: number }>();
      for (const g of pcgs) {
        const order = paymentIndex.get(g.payment_id as string) ?? 999;
        const prev = bestByCompany.get(g.company_id as string);
        if (!prev || order < prev.order) {
          bestByCompany.set(g.company_id as string, { pcg: g, order });
        }
      }
      const out: Record<string, RefLote> = {};
      for (const [companyId, { pcg }] of bestByCompany) {
        const p = payments.find((pp) => pp.id === pcg.payment_id);
        if (!p) continue;
        out[companyId] = {
          payment_id: p.id as string,
          reference: (p.reference as string) ?? "",
          competence_month: (p.competence_month as string) ?? "",
          liquido_total: Number(pcg.liquido_total ?? 0),
          status: String(pcg.status ?? ""),
        };
      }
      setRefLoteByCompany(out);
      setRefLoteLoading(false);
    })().catch(() => { if (!cancelled) setRefLoteLoading(false); });
    return () => { cancelled = true; };
  }, [open, groups, refScope.hospital_id, refScope.cost_center_code, refScope.analysis_mode]);

  // Números aqui vêm literalmente do mesmo objeto que alimenta os cards
  // "Total a complementar" / "Total a retirar" do relatório — o pai calcula
  // uma vez via computeTvrHeadlineTotals(results) e passa pra cá.
  // Divergência é impossível por construção.
  const totalBaseComp = headline.totalComplementar;
  const totalAcordoRet = headline.totalRetirar;


  const toggleDoctor = (id: string) => {
    setSelectedDoctorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2 shrink-0">
          <DialogTitle>Encaminhar apuração</DialogTitle>
          <DialogDescription>
            Revise os dois caminhos antes de confirmar. Ações são executadas em sequência.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-6 py-2 flex-1 min-h-0">
          {/* Caminho A */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                checked={includeComplementar}
                disabled={actionable.length === 0 || busy}
                onCheckedChange={(v) => setIncludeComplementar(!!v)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  ✅ A complementar → novo repasse para confecção
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {actionable.length} item(ns) · Base {brl(totalBaseComp)} (regra aplica acordo na confecção)
                </div>
                {actionable.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-primary mt-1 underline"
                    onClick={() => setShowCompList((v) => !v)}
                  >
                    {showCompList ? "ocultar itens ▴" : "ver itens ▾"}
                  </button>
                )}
                {showCompList && (
                  <div className="mt-2 max-h-40 overflow-auto rounded border border-border bg-background text-[11px]">
                    {actionable.map((r) => (
                      <div key={r.key} className="flex justify-between gap-2 px-2 py-1 border-b border-border last:border-b-0">
                        <span className="truncate">{r.atendimento}/{r.tuss} · {r.procedimento || "—"}</span>
                        <span className="font-mono">{brl(r.status === "nao_pago" ? r.valor_total_tasy : Math.max(0, r.dif_valor))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Caminho B */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 text-base">⚠️</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  A retirar → Glosa de auditoria {modoMedicoUnico ? "" : "(por médico)"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {retirar.length} item(ns) · <span className="font-semibold text-destructive">C/ acordo {brl(totalAcordoRet)}</span>
                  {!modoMedicoUnico && groups.length > 0 && ` · ${groups.length} médico(s)`}
                </div>
                {!canGerarGlosa && retirar.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    {modoMedicoUnico
                      ? "Apuração precisa ter PJ e médico vinculados para gerar a glosa."
                      : "Apuração precisa ter PJ vinculada e itens com médico identificado nos pagamentos para gerar a glosa."}
                  </div>
                )}
                {unassigned.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    {unassigned.length} item(ns) sem médico identificado no pagamento — não atribuíveis e serão ignorados.
                  </div>
                )}
                <RadioGroup
                  value={gerarGlosa}
                  onValueChange={(v) => setGerarGlosa(v as "agora" | "depois")}
                  className="mt-2"
                  disabled={busy || retirar.length === 0}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="g-agora" value="agora" disabled={!canGerarGlosa || retirar.length === 0} />
                    <Label htmlFor="g-agora" className="text-xs font-normal">
                      Gerar glosa agora
                    </Label>
                  </div>
                  {gerarGlosa === "agora" && groups.length > 0 && (
                    <div className="ml-6 mt-2 space-y-2">

                      {!modoMedicoUnico && (
                        <div className="flex items-center justify-between gap-2 text-[11px] rounded border border-border bg-muted/30 px-2 py-1.5">
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{selectedDoctorIds.size}</span> de {groups.length} médico(s) selecionado(s)
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="text-primary underline disabled:opacity-40 disabled:no-underline"
                              disabled={busy || selectedDoctorIds.size === groups.length}
                              onClick={() => setSelectedDoctorIds(new Set(groups.map((g) => g.doctor_id)))}
                            >
                              Selecionar todos
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground underline disabled:opacity-40 disabled:no-underline"
                              disabled={busy || selectedDoctorIds.size === 0}
                              onClick={() => setSelectedDoctorIds(new Set())}
                            >
                              Limpar
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground rounded border border-dashed border-border bg-background/60 px-2 py-1.5 leading-snug">
                        Cada débito fica <span className="font-semibold text-foreground">ativo</span> por médico e é abatido
                        automaticamente no próximo lote da PJ. Médicos sem pagamento em aberto entram na fila e são
                        cobrados assim que houver produção — não precisa tratar em separado.
                      </div>
                      <div className="rounded border border-border bg-background divide-y divide-border">
                        {(() => {
                          // Agrupa visualmente por PJ — sempre tratamos a PJ primeiro,
                          // depois os médicos vinculados a ela. PJs ambíguas ficam por último.
                          const byPj = new Map<string, { key: string; company_name: string; items: typeof groups }>();
                          for (const g of groups) {
                            const key = g.company_id ?? "__ambigua__";
                            const label = g.company_name ?? "PJ a resolver no envio (múltiplas ativas)";
                            const bucket = byPj.get(key) ?? { key, company_name: label, items: [] };
                            bucket.items.push(g);
                            byPj.set(key, bucket);
                          }
                          const pjList = Array.from(byPj.values()).sort((a, b) => {
                            if (a.key === "__ambigua__") return 1;
                            if (b.key === "__ambigua__") return -1;
                            return a.company_name.localeCompare(b.company_name);
                          });
                          return pjList.map((pj) => {
                            const pjSubtotal = pj.items.reduce(
                              (s, g) => s + g.items.reduce((ss, r) => ss + (r.valor_recuperar_acordo ?? 0), 0),
                              0,
                            );
                            const pjDoctorIds = pj.items.map((g) => g.doctor_id);
                            const pjAllSel = pjDoctorIds.every((id) => selectedDoctorIds.has(id));
                            const pjSomeSel = pjDoctorIds.some((id) => selectedDoctorIds.has(id));
                            const refLote = pj.key !== "__ambigua__" ? refLoteByCompany[pj.key] : undefined;
                            // Somamos o parcelamento previsto por médico dentro da PJ
                            // pra estimar quanto entra no PRÓXIMO lote (1ª parcela).
                            const proximaParcelaPJ = pj.items
                              .filter((g) => selectedDoctorIds.has(g.doctor_id))
                              .reduce((s, g) => {
                                const sub = g.items.reduce((ss, r) => ss + (r.valor_recuperar_acordo ?? 0), 0);
                                const n = Math.max(1, parcelasByDoctor[g.doctor_id] ?? 1);
                                return s + sub / n;
                              }, 0);
                            const liquido = refLote?.liquido_total ?? 0;
                            const cabe = refLote ? proximaParcelaPJ <= liquido + 0.005 : false;
                            const faltando = refLote ? Math.max(0, proximaParcelaPJ - liquido) : 0;
                            const fitParcelas = (): void => {
                              // Ajusta cada médico da PJ pra que a soma das 1ªs parcelas caiba no líquido.
                              // Distribuímos proporcionalmente ao subtotal de cada médico.
                              if (!refLote || liquido <= 0) return;
                              setParcelasByDoctor((prev) => {
                                const next = { ...prev };
                                for (const g of pj.items) {
                                  if (!selectedDoctorIds.has(g.doctor_id)) continue;
                                  const sub = g.items.reduce((ss, r) => ss + (r.valor_recuperar_acordo ?? 0), 0);
                                  if (sub <= 0) continue;
                                  const share = (sub / pjSubtotal) * liquido;
                                  const nCalc = Math.ceil(sub / Math.max(share, 0.01));
                                  next[g.doctor_id] = Math.min(24, Math.max(1, nCalc));
                                }
                                return next;
                              });
                            };
                            return (
                              <div key={pj.key}>
                                <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40 text-[11px] font-semibold sticky top-0">
                                  <Checkbox
                                    checked={pjAllSel ? true : pjSomeSel ? "indeterminate" : false}
                                    disabled={busy}
                                    onCheckedChange={() => {
                                      // Alterna todos os médicos da PJ de uma vez.
                                      setSelectedDoctorIds((prev) => {
                                        const next = new Set(prev);
                                        if (pjAllSel) {
                                          for (const id of pjDoctorIds) next.delete(id);
                                        } else {
                                          for (const id of pjDoctorIds) next.add(id);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="flex-1 min-w-0 truncate uppercase tracking-wide text-[10px] text-muted-foreground">
                                    PJ · <span className="text-foreground normal-case tracking-normal">{pj.company_name}</span>
                                  </span>
                                  <span className="text-muted-foreground font-normal">{pj.items.length} médico(s)</span>
                                  <span className="font-mono w-24 text-right">{brl(pjSubtotal)}</span>
                                </div>
                                {/* UI de parcelamento/fit removida: encaminhar
                                    é só encaminhar. Débito ativa e é abatido
                                    integralmente no próximo lote da PJ. */}
                                {pj.items.map((g) => {
                                  const subtotal = g.items.reduce((s, r) => s + (r.valor_recuperar_acordo ?? 0), 0);
                                  const isExpanded = expandedGroups.has(g.doctor_id);
                                  const isSel = selectedDoctorIds.has(g.doctor_id);
                                  return (
                                    <div key={g.doctor_id} className="px-2 py-1.5 pl-6 text-[11px] border-t border-border/40">
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          checked={isSel}
                                          disabled={busy}
                                          onCheckedChange={() => toggleDoctor(g.doctor_id)}
                                        />
                                        <div className="flex-1 min-w-0 truncate">
                                          <span className="font-medium">{g.doctor_name}</span>
                                          {g.doctor_crm && <span className="text-muted-foreground"> ({g.doctor_crm})</span>}
                                        </div>
                                        <span className="text-muted-foreground">{g.items.length} itens</span>
                                        <span className="font-mono w-24 text-right">{brl(subtotal)}</span>
                                        {/* Select de parcelas removido — encaminhamento é sempre 1× */}
                                        <button
                                          type="button"
                                          className="text-[10px] text-destructive underline"
                                          onClick={() => toggleGroupExpand(g.doctor_id)}
                                        >
                                          {isExpanded ? "ocultar" : "ver itens"}
                                        </button>
                                      </div>
                                      {isExpanded && (
                                        <div className="mt-1 ml-6 max-h-32 overflow-auto rounded bg-muted/40">
                                          {g.items.map((r) => (
                                            <div key={r.key} className="flex justify-between gap-2 px-2 py-1 border-b border-border/50 last:border-b-0">
                                              <span className="truncate">{r.atendimento}/{r.tuss} · {r.procedimento || "—"}</span>
                                              <span className="font-mono">{brl(r.valor_recuperar_acordo ?? 0)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="g-depois" value="depois" />
                    <Label htmlFor="g-depois" className="text-xs font-normal">
                      Não gerar — tratar depois
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-3 border-t shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm({
              includeComplementar,
              gerarGlosa: gerarGlosa === "agora" && retirar.length > 0 && canGerarGlosa && selectedDoctorIds.size > 0,
              parcelas: parcelas > 0 ? parcelas : 1,
              parcelasByDoctor,
              selectedDoctorIds: Array.from(selectedDoctorIds),
            })}
            disabled={
              busy ||
              (!includeComplementar &&
                (gerarGlosa !== "agora" || retirar.length === 0 || selectedDoctorIds.size === 0))
            }
          >
            {busy ? "Processando..." : "Confirmar encaminhamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Suppress unused-import warnings for fields that may be imported but only used conditionally.
void ([] as TargetField[]);

// Popover multi-seleção com busca — usado nos filtros de PJ e Médico no
// toolbar dos resultados. Mesmo padrão visual do filtro de status.
function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Array<{ key: string; label: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);
  const summary =
    selected.size === 0
      ? allLabel
      : selected.size === 1
      ? options.find((o) => o.key === Array.from(selected)[0])?.label ?? `${label}: 1`
      : `${label}: ${selected.size} selecionados`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-[180px] text-xs justify-between font-normal">
          <span className="truncate">{summary}</span>
          <ChevronsUpDownIcon className="h-3.5 w-3.5 opacity-50 ml-1 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-2" align="end">
        <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-border">
          <span className="text-[11px] font-medium text-muted-foreground">Filtrar por {label.toLowerCase()}</span>
          {selected.size > 0 && (
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => onChange(new Set())}
            >
              Limpar
            </button>
          )}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Buscar ${label.toLowerCase()}…`}
          className="h-7 text-xs mb-1"
        />
        <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-2 py-2 text-center">Nenhum resultado</div>
          )}
          {filtered.map((o) => {
            const checked = selected.has(o.key);
            return (
              <label
                key={o.key}
                className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(o.key);
                    else next.delete(o.key);
                    onChange(next);
                  }}
                />
                <span className="truncate" title={o.label}>{o.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}


// ============================================================================
// ReavaliarVinculosDialog — Item 6
// Permite ao analista escolher em qual PJ lançar a glosa quando o vínculo
// médico→PJ mudou desde o lote original ou quando o médico tem múltiplas PJs
// ativas (ambíguo). Não re-roda o motor: só grava override no item.
// ============================================================================
function ReavaliarVinculosDialog({
  open,
  onOpenChange,
  results,
  doctorPjMap,
  doctorAllPjsMap,
  groupDoctorsMap,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  results: TvrResult[];
  doctorPjMap: Record<string, { company_id: string; company_name: string } | null>;
  doctorAllPjsMap: Record<string, Array<{ company_id: string; company_name: string }>>;
  groupDoctorsMap: Record<string, { full_name: string; crm: string | null }>;
  busy: boolean;
  onConfirm: (choices: Record<string, string | null>, reason: string) => void | Promise<void>;
}) {
  // Constrói lista de médicos com "situação" para reavaliar:
  //  - ambiguous: >1 PJ ativa em doctor_companies
  //  - divergent: PJ ativa única difere da PJ do lote pago (matched_company_id)
  //  - orphan: sem PJ ativa alguma
  //  - reassigned: já tem override aplicado
  const situations = React.useMemo(() => {
    const byDoctor = new Map<string, {
      doctor_id: string;
      doctor_name: string;
      items_count: number;
      lote_company_ids: Set<string>;
      lote_company_names: Set<string>;
      active_pjs: Array<{ company_id: string; company_name: string }>;
      current_override: string | null;
      already_forwarded: number;
    }>();
    for (const r of results) {
      const did = r.matched_doctor_id;
      if (!did) continue;
      if (r.excluir_do_encaminhamento) continue;
      const entry = byDoctor.get(did) ?? {
        doctor_id: did,
        doctor_name: groupDoctorsMap[did]?.full_name ?? r.medico ?? "Médico",
        items_count: 0,
        lote_company_ids: new Set<string>(),
        lote_company_names: new Set<string>(),
        active_pjs: doctorAllPjsMap[did] ?? [],
        current_override: r.retroactive_target_company_id ?? null,
        already_forwarded: 0,
      };
      entry.items_count += 1;
      if (r._generatedAdjustmentId) entry.already_forwarded += 1;
      if (r.matched_company_id) entry.lote_company_ids.add(r.matched_company_id);
      if (r.pj_conciliada) entry.lote_company_names.add(r.pj_conciliada);
      // Override mais recente vence (todos itens do mesmo doctor devem ter o mesmo)
      if (r.retroactive_target_company_id) entry.current_override = r.retroactive_target_company_id;
      byDoctor.set(did, entry);
    }
    type Row = {
      doctor_id: string;
      doctor_name: string;
      items_count: number;
      already_forwarded: number;
      lote_company_ids: string[];
      lote_company_names: string[];
      active_pjs: Array<{ company_id: string; company_name: string }>;
      active_single: { company_id: string; company_name: string } | null;
      current_override: string | null;
      status: "ambiguous" | "divergent" | "orphan" | "reassigned" | "ok";
    };
    const rows: Row[] = [];
    for (const [did, e] of byDoctor) {
      const single = doctorPjMap[did] ?? null;
      const loteIds = Array.from(e.lote_company_ids);
      let status: Row["status"] = "ok";
      if (e.current_override) status = "reassigned";
      else if (e.active_pjs.length > 1) status = "ambiguous";
      else if (e.active_pjs.length === 0) status = "orphan";
      else if (single && loteIds.length > 0 && !loteIds.includes(single.company_id)) status = "divergent";
      rows.push({
        doctor_id: did,
        doctor_name: e.doctor_name,
        items_count: e.items_count,
        already_forwarded: e.already_forwarded,
        lote_company_ids: loteIds,
        lote_company_names: Array.from(e.lote_company_names),
        active_pjs: e.active_pjs,
        active_single: single,
        current_override: e.current_override,
        status,
      });
    }
    // Prioriza os que precisam de decisão
    const order: Record<Row["status"], number> = { ambiguous: 0, divergent: 1, orphan: 2, reassigned: 3, ok: 4 };
    rows.sort((a, b) => order[a.status] - order[b.status] || a.doctor_name.localeCompare(b.doctor_name));
    return rows;
  }, [results, doctorPjMap, doctorAllPjsMap, groupDoctorsMap]);

  const needsAttention = situations.filter((s) => s.status !== "ok");
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState("");

  React.useEffect(() => {
    if (open) {
      // Pré-carrega escolhas com o override atual (se houver)
      const initial: Record<string, string | null> = {};
      for (const s of situations) {
        if (s.current_override) initial[s.doctor_id] = s.current_override;
      }
      setChoices(initial);
      setReason("");
    }
  }, [open, situations]);

  const dirty = Object.keys(choices).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Reavaliar vínculos médico → PJ</DialogTitle>
          <DialogDescription>
            Quando o vínculo mudou desde o lote original ou o médico tem mais de uma PJ ativa,
            escolha aqui em qual PJ a glosa deve ser lançada. Não re-roda o motor — só grava o
            destino do encaminhamento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {needsAttention.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Nenhum médico com vínculo ambíguo ou divergente entre lote e cadastro atual.
            </div>
          )}
          {needsAttention.map((s) => {
            const currentChoice = choices[s.doctor_id] ?? null;
            const loteOptions = s.lote_company_ids
              .filter((cid) => !s.active_pjs.some((p) => p.company_id === cid))
              .map((cid, i) => ({
                company_id: cid,
                company_name: s.lote_company_names[i] ?? "PJ do lote original",
              }));
            const allOptions = [...s.active_pjs, ...loteOptions];
            const statusLabel: Record<typeof s.status, string> = {
              ambiguous: `${s.active_pjs.length} PJs ativas — escolha uma`,
              divergent: "PJ do lote difere da ativa hoje",
              orphan: "Sem PJ ativa no cadastro",
              reassigned: "Já reatribuído — pode alterar",
              ok: "OK",
            };
            const statusTone: Record<typeof s.status, string> = {
              ambiguous: "bg-amber-100 text-amber-800 border-amber-300",
              divergent: "bg-blue-100 text-blue-800 border-blue-300",
              orphan: "bg-red-100 text-red-800 border-red-300",
              reassigned: "bg-emerald-100 text-emerald-800 border-emerald-300",
              ok: "bg-muted text-muted-foreground border-border",
            };
            return (
              <div key={s.doctor_id} className="rounded-lg border border-border p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{s.doctor_name}</span>
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", statusTone[s.status])}>
                    {statusLabel[s.status]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.items_count} item(ns){s.already_forwarded > 0 ? ` · ${s.already_forwarded} já encaminhado(s) — não afetados` : ""}
                  </span>
                </div>
                {allOptions.length === 0 ? (
                  <div className="text-xs text-red-700">
                    Nenhuma PJ disponível. Cadastre um vínculo médico→PJ antes de gerar a glosa.
                  </div>
                ) : (
                  <RadioGroup
                    value={currentChoice ?? "__none__"}
                    onValueChange={(v) =>
                      setChoices((prev) => ({ ...prev, [s.doctor_id]: v === "__none__" ? null : v }))
                    }
                    className="space-y-1"
                  >
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <RadioGroupItem value="__none__" id={`${s.doctor_id}-none`} />
                      <span className="text-muted-foreground">Manter automático (PJ ativa única, quando houver)</span>
                    </label>
                    {allOptions.map((opt) => {
                      const isActive = s.active_pjs.some((p) => p.company_id === opt.company_id);
                      const isLote = s.lote_company_ids.includes(opt.company_id);
                      return (
                        <label key={opt.company_id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <RadioGroupItem value={opt.company_id} id={`${s.doctor_id}-${opt.company_id}`} />
                          <span className="font-medium">{opt.company_name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">PJ ativa</span>
                          )}
                          {isLote && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">PJ do lote</span>
                          )}
                        </label>
                      );
                    })}
                  </RadioGroup>
                )}
              </div>
            );
          })}
        </div>

        {needsAttention.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-xs">Motivo da reatribuição (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: médico trocou de PJ em jun/26; PJ anterior encerrada; contrato revisado…"
              rows={2}
              className="text-xs"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(choices, reason)}
            disabled={busy || !dirty || needsAttention.length === 0}
          >
            {busy ? "Aplicando…" : "Aplicar reatribuições"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



