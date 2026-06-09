import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import * as XLSX from "xlsx";
import RetroactiveMappingWizard, {
  readRawSheet,
  type MappedDraft,
} from "./RetroactiveMappingWizard";

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
    total?: number;
    ok_pago?: number;
    pago_a_menos?: number;
    nao_pago?: number;
    pago_outro_mes?: number;
    sem_lastro?: number;
    total_gap?: number;
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
  claimed_amount: number | null;
  paid_amount: number | null;
  expected_amount: number | null;
  gap_amount: number | null;
  classification:
    | "ok_pago"
    | "pago_a_menos"
    | "nao_pago"
    | "pago_outro_mes"
    | "sem_lastro"
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
  claimed_amount: string;
};

const CLASS_LABEL: Record<ItemRow["classification"], string> = {
  ok_pago: "OK pago",
  pago_a_menos: "Pago a menos",
  nao_pago: "Não pago",
  pago_outro_mes: "Pago em outro mês",
  sem_lastro: "Sem lastro",
  pendente: "Pendente",
};
const CLASS_TONE: Record<ItemRow["classification"], string> = {
  ok_pago: "bg-emerald-100 text-emerald-800",
  pago_a_menos: "bg-amber-100 text-amber-800",
  nao_pago: "bg-red-100 text-red-800",
  pago_outro_mes: "bg-blue-100 text-blue-800",
  sem_lastro: "bg-zinc-100 text-zinc-800",
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
    claimed_amount: "",
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

async function parseSpreadsheet(file: File): Promise<DraftItem[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });
  const norm = (k: string) =>
    k
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  const findCol = (row: Record<string, unknown>, candidates: string[]) => {
    for (const key of Object.keys(row)) {
      const nk = norm(key);
      if (candidates.some((c) => nk.includes(c))) return key;
    }
    return null;
  };
  if (rows.length === 0) return [];
  const sample = rows[0];
  const colAtt = findCol(sample, ["atendiment", "atend", "guia"]);
  const colTuss = findCol(sample, ["tuss", "procedimentocodig", "codproc", "codigo"]);
  const colDate = findCol(sample, ["datacir", "dataprocedi", "data"]);
  const colPat = findCol(sample, ["paciente", "nomepaciente"]);
  const colFunc = findCol(sample, ["funcao", "papel", "role"]);
  const colVal = findCol(sample, ["valor", "valorpago", "valoralegado"]);

  return rows.map((r) => {
    const d = emptyDraft();
    d.source = "upload";
    d.attendance = String((colAtt && r[colAtt]) ?? "").trim();
    d.tuss_code = String((colTuss && r[colTuss]) ?? "")
      .replace(/\D/g, "")
      .slice(0, 8);
    const rawDate = (colDate && r[colDate]) ?? "";
    if (typeof rawDate === "number") {
      // Excel serial date
      const epoch = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
      d.procedure_date = epoch.toISOString().slice(0, 10);
    } else if (rawDate) {
      const s = String(rawDate).trim();
      const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})$/);
      if (m) {
        const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
        d.procedure_date = `${yr}-${m[2]}-${m[1]}`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        d.procedure_date = s.slice(0, 10);
      }
    }
    d.patient_name = String((colPat && r[colPat]) ?? "").trim();
    d.function_label = String((colFunc && r[colFunc]) ?? "").trim();
    const rawVal = (colVal && r[colVal]) ?? "";
    if (typeof rawVal === "number") d.claimed_amount = String(rawVal);
    else if (rawVal) {
      d.claimed_amount = String(rawVal)
        .replace(/[^\d,.-]/g, "")
        .replace(/\.(?=\d{3}(\D|$))/g, "")
        .replace(",", ".");
    }
    return d;
  });
}

export default function RetroactiveReconciliationsTab() {
  const hospitalId = useActiveHospitalId();
  const { user } = useAuth();
  const [view, setView] = useState<{ kind: "list" } | { kind: "detail"; id: string } | { kind: "new" }>(
    { kind: "list" },
  );

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
  return <DetailView id={view.id} onBack={() => setView({ kind: "list" })} />;
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
    if ((!doctorId && !companyId) || !start || !end) {
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
        period_start: start,
        period_end: end,
        title: title || null,
        created_by: userId,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar apuração", description: error?.message, variant: "destructive" });
      return;
    }
    onCreated((data as { id: string }).id);
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={onCancel} className="self-start">
        <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
      </Button>
      <h3 className="text-lg font-semibold">Nova apuração retroativa</h3>
      <p className="text-xs text-muted-foreground -mt-2">
        Informe o médico, a PJ, ou ambos. Médico sempre está vinculado a uma PJ — selecionar a PJ
        restringe o cruzamento aos pagamentos daquela empresa.
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
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [doctorName, setDoctorName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([emptyDraft()]);
  const [pasted, setPasted] = useState("");
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
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
        "id, attendance, tuss_code, procedure_date, patient_name, function_label, claimed_amount, paid_amount, expected_amount, gap_amount, classification, classification_reason, payment_id",
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
    try {
      const { headers, rows } = await readRawSheet(file);
      if (rows.length === 0) {
        toast({
          title: "Planilha vazia",
          description: "A primeira aba não tem linhas de dados.",
          variant: "destructive",
        });
        return;
      }
      setWizard({ open: true, fileName: file.name, headers, rows });
    } catch (e) {
      toast({
        title: "Erro ao ler planilha",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const applyMapping = (mapped: MappedDraft[]) => {
    const newDrafts: DraftItem[] = mapped.map((m) => ({
      _localId: crypto.randomUUID(),
      source: "upload",
      attendance: m.attendance,
      tuss_code: m.tuss_code,
      procedure_date: m.procedure_date,
      patient_name: m.patient_name,
      function_label: m.function_label,
      claimed_amount: m.claimed_amount,
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
          claimed_amount: d.claimed_amount ? Number(d.claimed_amount) : null,
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
    if (error) {
      const msg = (error.context as { body?: string } | undefined)?.body ?? error.message;
      toast({ title: "Erro ao gerar ajuste", description: msg, variant: "destructive" });
      return;
    }
    toast({
      title: "Ajuste de complemento gerado",
      description: `Total ${brl((data as { total?: number })?.total)}`,
    });
    await load();
  };

  const totalComplemento = useMemo(
    () =>
      items
        .filter((i) => i.classification === "nao_pago" || i.classification === "pago_a_menos")
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(
          [
            ["ok_pago", "OK pago"],
            ["pago_a_menos", "Pago a menos"],
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

            <InnerTabsContent value="upload" className="mt-3">
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-8 cursor-pointer hover:bg-muted/40">
                <UploadCloudIcon className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm">Selecionar arquivo (.xlsx ou .csv)</span>
                <span className="text-[11px] text-muted-foreground">
                  Colunas reconhecidas: atendimento, TUSS, data, paciente, função, valor
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                  }}
                />
              </label>
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

          <div className="flex justify-end mt-4">
            <Button onClick={runReconciliation} disabled={running}>
              <PlayIcon className="h-4 w-4 mr-1" />
              {running ? "Cruzando…" : "Rodar cruzamento"}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold">Resultado</h4>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Atendimento</TableHead>
              <TableHead>TUSS</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Alegado</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Esperado</TableHead>
              <TableHead>Gap</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum item processado ainda.
                </TableCell>
              </TableRow>
            )}
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell>{it.attendance ?? "—"}</TableCell>
                <TableCell>{it.tuss_code ?? "—"}</TableCell>
                <TableCell>
                  {it.procedure_date ? format(new Date(it.procedure_date), "dd/MM/yy") : "—"}
                </TableCell>
                <TableCell className="max-w-[180px] truncate">{it.patient_name ?? "—"}</TableCell>
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
                <TableCell>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${CLASS_TONE[it.classification]}`}
                    title={it.classification_reason ?? undefined}
                  >
                    {CLASS_LABEL[it.classification]}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
