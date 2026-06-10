import { useEffect, useMemo, useState } from "react";
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
import {
  ArrowLeftIcon,
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
} from "lucide-react";
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
  period_start: string;
  period_end: string;
  status: "em_analise" | "concluida" | "cancelada";
  title: string | null;
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
    processed_at?: string;
    tvr_counts?: Partial<Record<TvrStatus, number>>;
    tvr_ausente_incomplete?: number;
    tvr_validation_history?: Array<Record<string, unknown>>;
    tasy_file_totals?: { file: number; valid: number; excluded: number; dropped: number };
    tasy_dropped_examples?: Array<{ row_index: number; missing: string[] }>;
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
};

const CLASS_LABEL: Record<ItemRow["classification"], string> = {
  ok_pago: "OK pago",
  pago_a_menos: "Pago a menos",
  pago_a_mais: "Pago a mais",
  nao_pago: "Não pago",
  pago_outro_mes: "Pago em outro mês",
  sem_lastro: "Sem lastro",
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
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at",
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
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  Nenhuma apuração retroativa ainda.
                </TableCell>
              </TableRow>
            )}
            {!loading && items.map((r) => {
              const scope = [
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
                    {format(new Date(r.period_start), "dd/MM/yy")} → {format(new Date(r.period_end), "dd/MM/yy")}
                  </TableCell>
                  <TableCell>{r.summary?.total ?? 0}</TableCell>
                  <TableCell className="font-semibold">{brl(r.summary?.total_gap)}</TableCell>
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
  const [doctorId, setDoctorId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [docOpen, setDocOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ReconMode>("alegacao_medico");

  useEffect(() => {
    void (async () => {
      // Pagina para garantir todos os médicos ativos (4k+).
      const PAGE = 1000;
      const all: Doctor[] = [];
      for (let from = 0; from < 10000; from += PAGE) {
        const { data } = await supabase
          .from("doctors")
          .select("id, full_name, crm, crm_uf")
          .eq("active", true)
          .order("full_name")
          .range(from, from + PAGE - 1);
        const rows = (data ?? []) as Doctor[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      setDoctors(all);
      const { data: cs } = await supabase
        .from("companies")
        .select("id, name, document")
        .eq("active", true)
        .order("name")
        .limit(5000);
      setCompanies((cs ?? []) as Company[]);
    })();
  }, []);

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
    if (mode === "alegacao_medico" && ((!doctorId && !companyId) || !start || !end)) {
      toast({ title: "Selecione médico e/ou PJ e o período", variant: "destructive" });
      return;
    }
    setSaving(true);
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
        doctor_id: doctorId || null,
        company_id: companyId || null,
        period_start: effStart,
        period_end: effEnd,
        title: title || null,
        summary: { mode },
        created_by: userId,
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

      <p className="text-xs text-muted-foreground -mt-1">
        {mode === "alegacao_medico"
          ? "Informe o médico, a PJ, ou ambos. Selecionar a PJ restringe o cruzamento aos pagamentos daquela empresa."
          : "Médico, PJ e período são opcionais — servem apenas para identificar esta apuração."}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

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
        <div>
          <Label>De</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Título (opcional)</Label>
          <Input
            placeholder="Ex.: Falta de pagamentos março/2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
  const [wizard, setWizard] = useState<
    | { open: false }
    | { open: true; fileName: string; headers: string[]; rows: Record<string, unknown>[] }
  >({ open: false });

  const load = async () => {
    const { data: r } = await supabase
      .from("retroactive_reconciliations" as never)
      .select(
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at",
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
    const { data: its } = await supabase
      .from("retroactive_reconciliation_items" as never)
      .select(
        "id, attendance, tuss_code, procedure_date, patient_name, function_label, procedure_name, claimed_amount, claimed_quantity, paid_amount, paid_quantity, expected_amount, gap_amount, matched_payment_date, classification, classification_reason, payment_id",
      )
      .eq("reconciliation_id", id)
      .order("created_at", { ascending: true });
    setItems((its ?? []) as unknown as ItemRow[]);
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

  const applyMapping = (mapped: Record<string, string>[]) => {
    const newDrafts: DraftItem[] = mapped.map((m) => ({
      _localId: crypto.randomUUID(),
      source: "upload",
      attendance: m.attendance ?? "",
      tuss_code: m.tuss_code ?? "",
      procedure_date: m.procedure_date ?? "",
      patient_name: m.patient_name ?? "",
      function_label: m.function_label ?? "",
      procedure_name: m.procedure_name ?? "",
      claimed_amount: m.claimed_amount ?? "",
      claimed_quantity: m.claimed_quantity ?? "",
    }));
    setDrafts((d) => [...d.filter((x) => x.attendance || x.tuss_code), ...newDrafts]);
    setWizard({ open: false });
    toast({ title: `${newDrafts.length} linha(s) carregadas da planilha` });
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
              {[doctorName, companyName].filter(Boolean).join(" · ") || "—"} · {format(new Date(recon.period_start), "dd/MM/yy")} →{" "}
              {format(new Date(recon.period_end), "dd/MM/yy")}
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
                          <Input
                            type="date"
                            value={d.procedure_date}
                            onChange={(e) => updateDraft(idx, { procedure_date: e.target.value })}
                          />
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
  valor_recuperar_acordo: number;
  matched_payment_item_id?: string;
  matched_payment_id?: string;
  status: TvrStatus;
};

const TVR_STATUS_LABEL: Record<TvrStatus, string> = {
  nao_pago: "Não Pago",
  div_qtd_valor: "Div. Qtd / Valor",
  div_valor: "Div. Valor",
  pago_a_mais: "Pago a mais",
  ausente_tasy: "Ausente TASY",
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

export function computeTvrCounts(list: TvrResult[]): Record<TvrStatus, number> {
  const c: Record<TvrStatus, number> = {
    nao_pago: 0,
    div_qtd_valor: 0,
    div_valor: 0,
    pago_a_mais: 0,
    ausente_tasy: 0,
    ok: 0,
  };
  for (const r of list) c[r.status]++;
  return c;
}

const TVR_SOURCE = "tasy_vs_repasse";

export function computeTvrFinancialTotals(list: TvrResult[]): { totalComplementar: number; totalRetirar: number } {

  const totalComplementar = list.reduce((sum, r) => {
    if (r.status === "ok" || r.status === "ausente_tasy") return sum;
    if (r.status === "nao_pago") return sum + r.valor_total_tasy;
    if (r.dif_valor > 0.5) return sum + r.dif_valor;
    return sum;
  }, 0);
  const totalRetirar = list.reduce((sum, r) => {
    if (r.status === "ausente_tasy") return sum + r.valor_pago_base;
    if (r.dif_valor < -0.5) return sum + Math.abs(r.dif_valor);
    return sum;
  }, 0);
  return { totalComplementar, totalRetirar };
}

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
  const preservedHandoff = (prev as { handoff?: unknown }).handoff;

  return {
    mode: "tasy_vs_repasse",
    total: list.length,
    total_gap: financial.totalComplementar,
    total_excess: financial.totalRetirar,
    tasy_file: ctx.tasy_file ?? "",
    tasy_file_totals: ctx.tasy_file_totals ?? null,
    tasy_dropped_examples: ctx.tasy_dropped_examples ?? [],
    exclude_tuss: ctx.exclude_tuss ?? "",
    processed_at: ctx.processed_at ?? new Date().toISOString(),
    tvr_counts: tvrCounts,
    tvr_ausente_incomplete: incompleteAusente.length,
    tvr_validation_history: trimmedHistory,
    ...(preservedHandoff ? { handoff: preservedHandoff } : {}),
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



function dbDateOrNull(value: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

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
    // "1.234" (milhar BR) vs "1234.56" (decimal US)
    const parts = s.split(".");
    if (parts.length > 2) {
      s = s.replace(/\./g, "");
    } else if (parts[1] && parts[1].length === 3 && parts[0].length <= 3) {
      s = s.replace(".", "");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normTuss(v: string | undefined): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 8);
}

function normAtt(v: string | undefined): string {
  return String(v ?? "").trim();
}

function TasyVsRepasseView({ id, onBack }: { id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [tasyRows, setTasyRows] = useState<TasyRow[]>([]);
  const [tasyFile, setTasyFile] = useState<string>("");
  const [tasyFileTotals, setTasyFileTotals] = useState<{ file: number; valid: number; excluded: number; dropped: number } | null>(null);
  const [tasyDroppedExamples, setTasyDroppedExamples] = useState<Array<{ row_index: number; missing: string[] }>>([]);
  const [pagRows, setPagRows] = useState<PagRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [excludeTuss, setExcludeTuss] = useState<string>("");
  const [pendingTussExclude, setPendingTussExclude] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<TvrResult[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<TvrStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [doctorInfo, setDoctorInfo] = useState<{ id: string | null; name: string | null; crm: string | null }>({ id: null, name: null, crm: null });
  const [hospitalIdRecon, setHospitalIdRecon] = useState<string | null>(null);
  const [encaminharOpen, setEncaminharOpen] = useState(false);
  const [encaminharBusy, setEncaminharBusy] = useState(false);

  const [wizard, setWizard] = useState<
    | { kind: "none" }
    | { kind: "tasy"; fileName: string; headers: string[]; rows: Record<string, unknown>[] }
  >({ kind: "none" });

  const loadTvrReconciliation = async () => {
    const { data } = await supabase
      .from("retroactive_reconciliations" as never)
      .select("id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, hospital_id")
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
    setTasyFile(row?.summary?.tasy_file ?? "");
    setTasyFileTotals(row?.summary?.tasy_file_totals ?? null);
    setTasyDroppedExamples(row?.summary?.tasy_dropped_examples ?? []);

    const { data: savedItems } = await supabase
      .from("retroactive_reconciliation_items" as never)
      .select("raw")
      .eq("reconciliation_id", id)
      .eq("source", TVR_SOURCE)
      .order("created_at", { ascending: true });
    const savedResults = ((savedItems ?? []) as Array<{ raw?: { tvr_result?: unknown } }>)
      .map((item) => item.raw?.tvr_result)
      .filter(isTvrResult);
    if (savedResults.length > 0) {
      setResults(savedResults);
      setTasyRows(savedResults.filter((r) => r.status !== "ausente_tasy").map<TasyRow>((r) => ({
        tasy_atendimento: r.atendimento,
        tasy_tuss: r.tuss,
        tasy_qtd: String(r.qtd_tasy || 1),
        tasy_valor_unit: String(r.valor_unit_tasy || 0),
        tasy_procedimento: r.procedimento,
        tasy_paciente: r.paciente,
        tasy_data: r.data,
        tasy_convenio: r.convenio,
        tasy_medico: r.medico,
        tasy_funcao: r.funcao,
      })));
      setPagRows(savedResults.filter((r) => r.status !== "nao_pago").map<PagRow>((r) => ({
        pag_atendimento: r.atendimento,
        pag_tuss: r.tuss,
        pag_qtd: String(r.qtd_por_func || 1),
        pag_valor_base: String(r.valor_pago_base || 0),
        pag_valor_com_acordo: String(r.valor_com_acordo || 0),
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
        .select("id, name, crm")
        .eq("id", row.doctor_id)
        .maybeSingle();
      const d = doc as unknown as { id: string; name: string | null; crm: string | null } | null;
      setDoctorInfo({ id: d?.id ?? row.doctor_id, name: d?.name ?? null, crm: d?.crm ?? null });
    } else {
      setDoctorInfo({ id: null, name: null, crm: null });
    }
  };

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

  const loadPaymentItems = async (currentRecon: ReconRow | null) => {
    const r = currentRecon ?? recon;
    if (!r) return;
    setLoadingPayments(true);
    setPaymentsLoaded(false);
    try {
      const start = new Date(r.period_start);
      const end = new Date(r.period_end);
      start.setDate(start.getDate() - 90);
      end.setDate(end.getDate() + 90);

      let query = supabase
        .from("payment_items" as never)
        .select("id, attendance_number, procedure_code, quantity, procedure_amount, expected_amount, doctor_role, doctor_name, procedure_date, patient_name, procedure_name, convenio_slug, payment_id")
        .gte("procedure_date", start.toISOString().slice(0, 10))
        .lte("procedure_date", end.toISOString().slice(0, 10));

      if (r.doctor_id) query = query.eq("doctor_id", r.doctor_id);
      if (r.company_id) query = query.eq("company_id", r.company_id);

      const { data, error } = await query.limit(5000);
      if (error) {
        toast({ title: "Erro ao buscar pagamentos", description: error.message, variant: "destructive" });
        return;
      }
      const rawItems = (data ?? []) as Array<Record<string, unknown>>;
      const paymentIds = Array.from(new Set(rawItems.map((it) => String(it.payment_id ?? "")).filter(Boolean)));
      const loteByPaymentId = new Map<string, string>();
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
        }
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
      })).filter((x) => x.pag_atendimento && x.pag_tuss);

      setPagRows(rows);
      setPaymentsLoaded(true);
      toast({ title: `${rows.length} item(ns) carregados do sistema` });
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
    },
  ) => {
    const excluded = new Set(
      pendingTussExclude
        .split(",")
        .map((s) => normTuss(s.trim()))
        .filter(Boolean),
    );
    setExcludeTuss(pendingTussExclude);
    const filtered = drafts
      .filter((d) => !excluded.has(normTuss(d.tuss_code)))
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
    // Dispara busca automática dos payment_items
    void loadPaymentItems(recon);
  };



  const clearAll = async () => {
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

  const process = () => {
    if (tasyRows.length === 0 || pagRows.length === 0) {
      toast({ title: "Carregue o TASY e aguarde a busca dos pagamentos do sistema", variant: "destructive" });
      return;
    }
    setProcessing(true);
    setTimeout(async () => {
      const excluded = new Set(
        excludeTuss.split(",").map((s) => normTuss(s.trim())).filter(Boolean),
      );

      // Aggregate Repasse by (atendimento, tuss)
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
      };
      const pMap = new Map<string, PAgg>();
      for (const r of pagRows) {
        if (excluded.has(r.pag_tuss)) continue;
        const key = `${r.pag_atendimento}|${r.pag_tuss}`;
        const q = num(r.pag_qtd) || 1;
        const vb = num(r.pag_valor_base);
        const va = num(r.pag_valor_com_acordo);
        const fn = (r.pag_funcao ?? "").trim();
        const lote = (r.pag_lote ?? "").trim();
        const cur = pMap.get(key);
        if (cur) {
          cur.qtd_total += q;
          cur.valor_base += vb;
          cur.valor_com_acordo += va;
          if (fn) cur.funcs.add(fn);
          if (lote) cur.lotes.add(lote);
          if (!cur.payment_item_id_first && r.pag_payment_item_id) cur.payment_item_id_first = r.pag_payment_item_id;
          if (!cur.payment_id_first && r.pag_payment_id) cur.payment_id_first = r.pag_payment_id;
          // enrich sample with non-empty fields from later rows
          const s = cur.sample;
          if (!s.pag_medico && r.pag_medico) s.pag_medico = r.pag_medico;
          if (!s.pag_paciente && r.pag_paciente) s.pag_paciente = r.pag_paciente;
          if (!s.pag_convenio && r.pag_convenio) s.pag_convenio = r.pag_convenio;
          if (!s.pag_procedimento && r.pag_procedimento) s.pag_procedimento = r.pag_procedimento;
          if (!s.pag_data && r.pag_data) s.pag_data = r.pag_data;
          if (!s.pag_funcao && r.pag_funcao) s.pag_funcao = r.pag_funcao;
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
          });
        }
      }

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
      type TasyCandidate = { qtd: number; asLineTotal: number; asUnitValue: number };
      const candidates = new Map<string, TasyCandidate>();
      for (const r of tasyRows) {
        if (excluded.has(r.tasy_tuss)) continue;
        const key = `${r.tasy_atendimento}|${r.tasy_tuss}`;
        const q = num(r.tasy_qtd) || 1;
        const v = num(r.tasy_valor_unit);
        const cur = candidates.get(key);
        if (cur) {
          cur.qtd += q;
          cur.asLineTotal += v;
          cur.asUnitValue += v * q;
        } else {
          candidates.set(key, { qtd: q, asLineTotal: v, asUnitValue: v * q });
        }
      }
      let lineTotalDelta = 0;
      let unitValueDelta = 0;
      let comparable = 0;
      for (const [key, c] of candidates) {
        const paidBase = pMap.get(key)?.valor_base ?? 0;
        if (paidBase <= 0 || Math.abs(c.asLineTotal - c.asUnitValue) <= 0.01) continue;
        lineTotalDelta += Math.abs(c.asLineTotal - paidBase);
        unitValueDelta += Math.abs(c.asUnitValue - paidBase);
        comparable++;
      }
      const tasyValueIsLineTotal = comparable > 0 && lineTotalDelta < unitValueDelta;

      const tMap = new Map<string, TAgg>();
      for (const r of tasyRows) {
        if (excluded.has(r.tasy_tuss)) continue;
        const key = `${r.tasy_atendimento}|${r.tasy_tuss}`;
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

        let status: TvrStatus;
        if (!p && t) status = "nao_pago";
        else if (!t && p) status = "ausente_tasy";
        else if (dif_valor < -0.5) status = "pago_a_mais";
        else if (Math.abs(dif_qtd) >= 0.5 && Math.abs(dif_valor) > 0.5) status = "div_qtd_valor";
        else if (Math.abs(dif_valor) > 0.5) status = "div_valor";
        else status = "ok";

        let valor_recuperar_acordo = 0;
        if (status === "ausente_tasy") {
          valor_recuperar_acordo = valor_com_acordo;
        } else if (dif_valor < -0.5) {
          const fator = valor_pago_base > 0 ? valor_com_acordo / valor_pago_base : 1;
          valor_recuperar_acordo = Math.abs(dif_valor) * fator;
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
          matched_payment_item_id: p?.payment_item_id_first || undefined,
          matched_payment_id: p?.payment_id_first || undefined,
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

      try {
        await persistResults(out);
        setResults(out);
        setSelectedKeys(new Set());
        await loadTvrReconciliation();
        toast({ title: `Processamento concluído · ${out.length} linha(s) salvas` });
      } catch (e) {
        toast({ title: "Erro ao salvar resultado", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      } finally {
        setProcessing(false);
      }
    }, 50);
  };

  const [onlyWithPayment, setOnlyWithPayment] = useState(false);

  const visible = useMemo(() => {
    const list = (results ?? []).filter((r) => r.status !== "ok" || statusFilter === "ok");
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (onlyWithPayment && r.status === "nao_pago") return false;
      if (q) {
        const hay = `${r.atendimento} ${r.tuss} ${r.procedimento} ${r.paciente} ${r.medico} ${r.convenio} ${r.funcao} ${r.funcoes_pagas} ${r.lotes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [results, statusFilter, search, onlyWithPayment]);

  const counts = useMemo(() => {
    const c: Record<TvrStatus, number> = {
      nao_pago: 0, div_qtd_valor: 0, div_valor: 0, pago_a_mais: 0, ausente_tasy: 0, ok: 0,
    };

    for (const r of results ?? []) c[r.status]++;
    return c;
  }, [results]);

  const buildExportRows = (list: TvrResult[]) => list.map((r) => ({
    Status: TVR_STATUS_LABEL[r.status],
    Atendimento: r.atendimento,
    "Cód. TUSS": r.tuss,
    Procedimento: r.procedimento,
    Paciente: r.paciente,
    Data: formatTvrDate(r.data),
    Convênio: r.convenio,
    Médico: r.medico,
    Função: r.funcao,
    "Qtd TASY": r.qtd_tasy,
    "Valor Unit. TASY": r.valor_unit_tasy,
    "Valor Total TASY": r.valor_total_tasy,
    "Qtd Paga/Func": Number(r.qtd_por_func.toFixed(4)),
    "Nº Funcs": r.n_funcs,
    "Funções Pagas": r.funcoes_pagas,
    "Lote(s)": r.lotes,
    "Valor Pago Base": r.valor_pago_base,
    "Valor c/ Acordo": r.valor_com_acordo,
    "Dif. Qtd": Number(r.dif_qtd.toFixed(4)),
    "Dif. Valor": Number(r.dif_valor.toFixed(2)),
    "A Recuperar (c/ acordo)": Number((r.valor_recuperar_acordo ?? 0).toFixed(2)),
  }));

  const exportData = async (fmt: "xlsx" | "csv" | "json", scope: "all" | "visible") => {
    if (!results) return;
    const list = scope === "visible" ? visible : results;
    if (list.length === 0) {
      toast({ title: "Nada para exportar neste filtro", variant: "destructive" });
      return;
    }
    const stamp = format(new Date(), "yyyyMMdd_HHmm");
    const baseName = `tasy-vs-repasse_${scope === "visible" ? "filtrado_" : ""}${stamp}`;
    if (fmt === "json") {
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.json`; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const rows = buildExportRows(list);
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows);
    if (fmt === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.csv`; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TASY vs Repasse");
    XLSX.writeFile(wb, `${baseName}.xlsx`);
  };

  const persistResults = async (list: TvrResult[]) => {
    const incompleteAusente = list
      .map((r) => ({ r, missing: getAusenteTasyMissingFields(r) }))
      .filter((x) => x.missing.length > 0);
    const rows = list.map((r) => {
      const missing = getAusenteTasyMissingFields(r);
      const warnings = missing.length > 0
        ? [`Ausente TASY incompleto — faltam: ${missing.join(", ")}`]
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

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("retroactive_reconciliation_items" as never)
        .insert(rows as never);
      if (insertError) throw insertError;
    }

    const previousSummary = (recon?.summary ?? {}) as Record<string, unknown>;
    const summary = buildTvrReplaceSummary(list, previousSummary, {
      tasy_file: tasyFile,
      tasy_file_totals: tasyFileTotals,
      tasy_dropped_examples: tasyDroppedExamples,
      exclude_tuss: excludeTuss,
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

  const isActionableTvr = (r: TvrResult): boolean =>
    r.status === "nao_pago" ||
    r.status === "div_valor" ||
    r.status === "div_qtd_valor" ||
    r.status === "pago_a_mais";

  const sendHandoffToConfeccao = async (list: TvrResult[], opts?: { silent?: boolean }) => {
    const actionable = list.filter(isActionableTvr);
    if (actionable.length === 0) {
      toast({
        title: "Nenhum item acionável",
        description: "Só linhas Não Pago, Div. Valor, Div. Qtd/Valor ou Pago a mais podem ir para confecção.",
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

  // ===== Caminho B — gera glosa de auditoria a partir dos itens "a retirar" =====
  const toRetirarItems = (list: TvrResult[]) =>
    list.filter((r) => (r.valor_recuperar_acordo ?? 0) > 0.5);

  const createAuditoriaGlosaBatch = async (
    retirar: TvrResult[],
    parcelas: number,
  ): Promise<{ batch_id: string; total: number; items: number; parcelas: number }> => {
    if (retirar.length === 0) throw new Error("Nenhum item a retirar.");
    if (!recon?.company_id) throw new Error("Apuração sem PJ vinculada — não é possível gerar glosa.");
    if (!doctorInfo.name && !doctorInfo.crm) {
      throw new Error("Apuração sem médico vinculado — não é possível gerar glosa.");
    }

    const totalGlosa = retirar.reduce((s, r) => s + (r.valor_recuperar_acordo ?? 0), 0);
    const competence = (recon.period_start ?? "").slice(0, 7);
    const title = recon.title ?? `Apuração ${recon.id.slice(0, 8)}`;

    // 1) Batch
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
        total_items: retirar.length,
        matched_items: retirar.length,
        unmatched_items: 0,
        total_glosa_amount: Number(totalGlosa.toFixed(2)),
        hospital_id: hospitalIdRecon,
      } as never)
      .select("id")
      .single();
    if (batchErr || !batchData) throw new Error(batchErr?.message ?? "Falha ao criar lote de glosa.");
    const batchId = (batchData as { id: string }).id;

    // 2) Items
    const itemsPayload = retirar.map((r) => {
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
        doctor_name: doctorInfo.name ?? r.medico ?? null,
        doctor_crm: doctorInfo.crm ?? null,
        convenio: r.convenio || null,
        valor_cobrado: Number((r.valor_com_acordo || 0).toFixed(2)),
        valor_glosa: Number((r.valor_recuperar_acordo ?? 0).toFixed(2)),
        motivo_glosa: motivo,
        complemento_glosa: `Apuração ${title} · Atend ${r.atendimento || "—"} · TUSS ${r.tuss || "—"}`,
        status: "vinculado",
        matched_payment_item_id: r.matched_payment_item_id ?? null,
        matched_payment_id: r.matched_payment_id ?? null,
        matched_company_id: recon.company_id,
        match_source: "auditoria_retroativa",
        matched_at: new Date().toISOString(),
        hospital_id: hospitalIdRecon,
      };
    });
    const { data: itemsData, error: itemsErr } = await (supabase as never as typeof supabase)
      .from("glosa_items" as never)
      .insert(itemsPayload as never)
      .select("id, valor_glosa");
    if (itemsErr || !itemsData) {
      await supabase.from("glosa_batches" as never).delete().eq("id", batchId);
      throw new Error(itemsErr?.message ?? "Falha ao gravar itens da glosa.");
    }
    const insertedItems = itemsData as Array<{ id: string; valor_glosa: number }>;

    // 3) Débito por médico/PJ (uma apuração = um médico × uma PJ)
    const docName = doctorInfo.name ?? "Médico";
    const docCrm = doctorInfo.crm ?? "";
    // Upsert: tenta achar débito ativo existente para somar
    const { data: existingDebt } = await supabase
      .from("glosa_debts" as never)
      .select("id, total_debt")
      .eq("doctor_name", docName)
      .eq("doctor_crm", docCrm)
      .maybeSingle();

    let debtId: string;
    if (existingDebt) {
      debtId = (existingDebt as { id: string }).id;
      const prev = Number((existingDebt as { total_debt: number }).total_debt ?? 0);
      await supabase
        .from("glosa_debts" as never)
        .update({
          total_debt: Number((prev + totalGlosa).toFixed(2)),
          company_id: recon.company_id,
          parcelas_default: parcelas,
          status: "ativo",
          resolution_status: "vinculada",
          hospital_id: hospitalIdRecon,
        } as never)
        .eq("id", debtId);
    } else {
      const { data: debtData, error: debtErr } = await (supabase as never as typeof supabase)
        .from("glosa_debts" as never)
        .insert({
          doctor_name: docName,
          doctor_crm: docCrm,
          total_debt: Number(totalGlosa.toFixed(2)),
          status: "ativo",
          resolution_status: "vinculada",
          company_id: recon.company_id,
          parcelas_default: parcelas,
          hospital_id: hospitalIdRecon,
        } as never)
        .select("id")
        .single();
      if (debtErr || !debtData) {
        await supabase.from("glosa_items" as never).delete().eq("batch_id", batchId);
        await supabase.from("glosa_batches" as never).delete().eq("id", batchId);
        throw new Error(debtErr?.message ?? "Falha ao criar débito de glosa.");
      }
      debtId = (debtData as { id: string }).id;
    }

    // 4) Vincular itens ao débito
    const debtItemsPayload = insertedItems.map((it) => ({
      debt_id: debtId,
      glosa_item_id: it.id,
      amount: Number((it.valor_glosa ?? 0).toFixed(2)),
      hospital_id: hospitalIdRecon,
    }));
    const { error: debtItemsErr } = await supabase
      .from("glosa_debt_items" as never)
      .insert(debtItemsPayload as never);
    if (debtItemsErr) {
      throw new Error(debtItemsErr.message);
    }

    return { batch_id: batchId, total: totalGlosa, items: retirar.length, parcelas };
  };

  const runEncaminharFluxo = async (opts: {
    includeComplementar: boolean;
    gerarGlosa: boolean;
    parcelas: number;
  }) => {
    if (!results) return;
    const actionable = results.filter(isActionableTvr);
    const retirar = toRetirarItems(results);

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
      // 1) Glosa primeiro (fire-and-forget, mas se falhar aborta tudo).
      if (opts.gerarGlosa) {
        const result = await createAuditoriaGlosaBatch(retirar, opts.parcelas);
        toast({
          title: "Glosa de auditoria lançada",
          description: `${result.items} itens · ${brl(result.total)} em ${result.parcelas} parcela(s). Veja em /glosas.`,
        });
      }
      // 2) Complementar → confecção (navega no final).
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
      <div className={cn("rounded-lg border border-border bg-card p-4 space-y-2", tasyRows.length === 0 && "opacity-60 pointer-events-none")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold">2. Repasse do sistema</h4>
            <p className="text-[11px] text-muted-foreground">
              Buscado automaticamente em <code>payment_items</code> com base no escopo da apuração (médico/PJ + período ±90 dias). Usa <code>procedure_amount</code> (valor base 100%, sem acordo).
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
      </div>

      {/* Step 3 — Process */}
      <div className="flex items-center gap-2">
        <Button onClick={process} disabled={isLocked || processing || tasyRows.length === 0 || pagRows.length === 0}>
          <PlayIcon className="h-4 w-4 mr-1" />
          {processing ? "Processando…" : "Processar"}
        </Button>
        {(tasyRows.length > 0 || pagRows.length > 0) && (
          <Button variant="outline" size="sm" onClick={() => void clearAll()} disabled={isLocked}>Limpar tudo</Button>
        )}
        {results && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Exportar</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Todos ({results.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportData("xlsx", "all")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("csv", "all")}>CSV (;)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("json", "all")}>JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filtrado ({visible.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportData("xlsx", "visible")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("csv", "visible")}>CSV (;)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportData("json", "visible")}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {results && !isLocked && (
          <div className="ml-auto flex items-center gap-2">
            {selectedKeys.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedKeys(new Set())}>
                Limpar seleção
              </Button>
            )}
            <Button
              size="sm"
              variant={selectedKeys.size > 0 ? "default" : "outline"}
              onClick={() => {
                const picked = results.filter((r) => selectedKeys.has(r.key));
                void sendHandoffToConfeccao(picked);
              }}
              disabled={selectedKeys.size === 0}
              title="Envia somente os itens marcados nas checkboxes"
            >
              <SendIcon className="h-4 w-4 mr-1" />
              Encaminhar selecionados ({selectedKeys.size})
            </Button>
            <Button
              size="sm"
              variant={selectedKeys.size > 0 ? "outline" : "default"}
              onClick={() => void sendHandoffToConfeccao(results)}
              disabled={results.filter(isActionableTvr).length === 0}
              title="Encaminha todos os itens acionáveis desta apuração"
            >
              <SendIcon className="h-4 w-4 mr-1" />
              Encaminhar todos ({results.filter(isActionableTvr).length})
            </Button>
          </div>
        )}
      </div>


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
                    ⚠ {ausenteIncomplete.length} Ausente TASY incompleta(s) — faltam: {Array.from(missingByField.entries()).map(([k, n]) => `${k} (${n})`).join(", ")}
                  </span>
                )}
                {unknown.length === 0 && missingTotal === 0 && ausenteIncomplete.length === 0 && (
                  <span className="text-emerald-700">✓ Todas as linhas classificadas e completas</span>
                )}
              </div>
            );
          })()}


          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {TVR_STATUS_ORDER.map((s) => (
              <div key={s} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{TVR_STATUS_LABEL[s]}</div>
                <div className="text-xl font-semibold">{counts[s] ?? 0}</div>
              </div>
            ))}
          </div>


          {(() => {
            const totalComplementar = results.reduce((sum, r) => {
              if (r.status === "ok" || r.status === "ausente_tasy") return sum;
              if (r.status === "nao_pago") return sum + r.valor_total_tasy;
              if (r.dif_valor > 0.5) return sum + r.dif_valor;
              return sum;
            }, 0);
            const totalRetirar = results.reduce((sum, r) => {
              if (r.status === "ausente_tasy") return sum + r.valor_pago_base;
              if (r.dif_valor < -0.5) return sum + Math.abs(r.dif_valor);
              return sum;
            }, 0);
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total a complementar</div>
                  <div className={cn("text-2xl font-bold", totalComplementar > 0 ? "text-primary" : "text-muted-foreground")}>
                    {totalComplementar > 0 ? brl(totalComplementar) : "R$ -"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Não pago + subpagamentos</div>
                </div>
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total a retirar / recuperar</div>
                  <div className={cn("text-2xl font-bold", totalRetirar > 0 ? "text-destructive" : "text-muted-foreground")}>
                    {totalRetirar > 0 ? brl(totalRetirar) : "R$ -"}
                  </div>
                  {(() => {
                    const totalRecuperarAcordo = results.reduce(
                      (sum, r) => sum + (r.valor_recuperar_acordo ?? 0),
                      0,
                    );
                    return (
                      <div className="text-xs text-muted-foreground mt-1">
                        Base: {brl(totalRetirar)} ·{" "}
                        <span className="font-semibold text-destructive">
                          C/ acordo: {brl(totalRecuperarAcordo)}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}



          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-semibold">Resultado · {visible.length} de {results.length}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar atend., TUSS, lote, convênio, médico, paciente, função…"
                  className="h-8 w-[340px] text-xs"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none px-2 py-1 rounded border border-border">
                  <input
                    type="checkbox"
                    checked={onlyWithPayment}
                    onChange={(e) => setOnlyWithPayment(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Apenas com pagamento
                </label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos (exceto OK)</SelectItem>
                    {TVR_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{TVR_STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">
                      {(() => {
                        const selectableKeys = visible.filter(isActionableTvr).map((r) => r.key);
                        const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selectedKeys.has(k));
                        const someSelected = selectableKeys.some((k) => selectedKeys.has(k));
                        return (
                          <Checkbox
                            checked={allSelected ? true : someSelected ? "indeterminate" : false}
                            disabled={isLocked || selectableKeys.length === 0}
                            onCheckedChange={(v) => {
                              setSelectedKeys((prev) => {
                                const next = new Set(prev);
                                if (v) selectableKeys.forEach((k) => next.add(k));
                                else selectableKeys.forEach((k) => next.delete(k));
                                return next;
                              });
                            }}
                            aria-label="Selecionar todos os acionáveis visíveis"
                          />
                        );
                      })()}
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Atend.</TableHead>
                    <TableHead>TUSS</TableHead>
                    <TableHead>Procedimento</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Convênio</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead className="text-center">Qtd TASY</TableHead>
                    <TableHead>Vlr Unit.</TableHead>
                    <TableHead>Vlr Total TASY</TableHead>
                    <TableHead className="text-center">Qtd/Func</TableHead>
                    <TableHead className="text-center">Nº Func</TableHead>
                    <TableHead>Funções pagas</TableHead>
                    <TableHead>Lote(s)</TableHead>
                    <TableHead>Vlr Pago Base</TableHead>
                    <TableHead>Vlr c/ Acordo</TableHead>
                    <TableHead className="text-center">Dif. Qtd</TableHead>
                    <TableHead>Dif. Valor</TableHead>
                    <TableHead>A Recuperar (c/ acordo)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 && (
                    <TableRow><TableCell colSpan={22} className="text-center text-muted-foreground py-8">Nenhuma linha neste filtro.</TableCell></TableRow>
                  )}
                  {visible.map((r) => {
                    const selectable = isActionableTvr(r) && !isLocked;
                    return (
                    <TableRow key={r.key} data-state={selectedKeys.has(r.key) ? "selected" : undefined}>
                      <TableCell className="text-center">
                        {selectable ? (
                          <Checkbox
                            checked={selectedKeys.has(r.key)}
                            onCheckedChange={(v) => {
                              setSelectedKeys((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(r.key); else next.delete(r.key);
                                return next;
                              });
                            }}
                            aria-label={`Selecionar ${r.atendimento}/${r.tuss}`}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${TVR_STATUS_TONE[r.status]}`}>
                          {TVR_STATUS_LABEL[r.status]}
                        </span>
                      </TableCell>
                      <TableCell>{r.atendimento || "—"}</TableCell>
                      <TableCell>{r.tuss || "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.procedimento}>{r.procedimento || "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={r.paciente}>{r.paciente || "—"}</TableCell>
                      <TableCell>{formatTvrDate(r.data)}</TableCell>
                      <TableCell className="max-w-[140px] truncate" title={r.convenio}>{r.convenio || "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={r.medico}>{r.medico || "—"}</TableCell>
                      <TableCell>{r.funcao || "—"}</TableCell>
                      <TableCell className="text-center">{r.qtd_tasy || "—"}</TableCell>
                      <TableCell>{brl(r.valor_unit_tasy)}</TableCell>
                      <TableCell>{brl(r.valor_total_tasy)}</TableCell>
                      <TableCell className="text-center">{r.qtd_por_func ? r.qtd_por_func.toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-center">{r.n_funcs || "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={r.funcoes_pagas}>{r.funcoes_pagas || "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate font-mono text-[11px]" title={r.lotes}>{r.lotes || "—"}</TableCell>
                      <TableCell>{brl(r.valor_pago_base)}</TableCell>
                      <TableCell className="text-muted-foreground">{brl(r.valor_com_acordo)}</TableCell>
                      <TableCell className={cn("text-center", Math.abs(r.dif_qtd) >= 0.5 && "font-semibold text-amber-700")}>
                        {r.dif_qtd ? r.dif_qtd.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className={cn(Math.abs(r.dif_valor) > 0.5 && "font-semibold text-red-700")}>
                        {brl(r.dif_valor)}
                      </TableCell>
                      <TableCell className={cn((r.valor_recuperar_acordo ?? 0) > 0.5 && "font-semibold text-destructive")}>
                        {(r.valor_recuperar_acordo ?? 0) > 0.5 ? brl(r.valor_recuperar_acordo) : "—"}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
    </div>
  );
}

// Suppress unused-import warnings for fields that may be imported but only used conditionally.
void ([] as TargetField[]);

