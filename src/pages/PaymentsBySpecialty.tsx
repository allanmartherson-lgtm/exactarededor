// Relatório "Pagamentos por especialidade / PJ".
//
// REGRA CRÍTICA: a especialidade de um item SEMPRE vem do cadastro do médico
// (payment_items.doctor_id -> doctors.specialties). O campo
// payment_items.specialty é texto livre digitado pelo analista e só aparece
// como coluna informativa na aba de auditoria — nunca como base de cálculo
// ou de filtro.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { useSpecialties } from "@/hooks/useSpecialties";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { formatCNPJ } from "@/lib/cnpj";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { BarChart3, Download, FileText, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  exportSpecialtyReportExcel,
  exportSpecialtyReportPdf,
  type SpecialtyReportGroupRow,
} from "@/lib/specialtyPaymentsReport";

/**
 * Linha AGREGADA de itens vinda da RPC get_specialty_payments_agg:
 * uma linha por (competência × lote × PJ × médico). Não baixamos mais os
 * ~50 mil itens crus — isso estourava o statement timeout do banco.
 */
interface ItemRow {
  payment_id: string | null;
  company_id: string | null;
  doctor_id: string | null;
  gross_amount: number | null;
  item_competence: string | null;
  /** Quantidade de itens representados por esta linha agregada. */
  qty: number;
}


interface DoctorRow {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
  specialties: string[] | null;
}

interface CompanyRow {
  id: string;
  name: string;
  document: string | null;
}

interface GroupRow {
  id: string;
  name: string;
}

interface GroupMemberRow {
  group_id: string;
  member_type: "specialty" | "doctor" | "company";
  specialty_code: string | null;
  doctor_id: string | null;
  company_id: string | null;
}

interface DoctorCompanyRow {
  doctor_id: string;
  company_id: string;
  start_date: string | null;
  end_date: string | null;
}

interface FinancialRow {
  payment_id: string;
  company_id: string;
  liquido: number | null;
}

type GroupBy = "company" | "doctor";
type DoctorMode = "doctor" | "company";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
};

/** Primeiro dia do mês N meses atrás, em YYYY-MM. */
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthStart = (ym: string) => `${ym}-01`;
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
};

export default function PaymentsBySpecialty() {
  const { hospital, loading: hospitalLoading } = useHospital();
  const hospitalId = hospital?.id ?? null;
  const { rows: specialtyRows } = useSpecialties();

  // ---------- filtros ----------
  const [fromMonth, setFromMonth] = useState(monthsAgo(5));
  const [toMonth, setToMonth] = useState(monthsAgo(0));
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
  const [doctorQuery, setDoctorQuery] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [doctorMode, setDoctorMode] = useState<DoctorMode>("doctor");
  const [companyQuery, setCompanyQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("company");

  // ---------- dados ----------
  const [items, setItems] = useState<ItemRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMemberRow[]>([]);
  const [doctorCompanies, setDoctorCompanies] = useState<DoctorCompanyRow[]>([]);
  const [financials, setFinancials] = useState<FinancialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Itens do período, já somados no banco pela RPC get_specialty_payments_agg.
   * Baixar os itens crus (~50 mil linhas no período) estourava o statement
   * timeout do PostgREST (erro 57014) e derrubava o relatório inteiro.
   * A RPC devolve ~3 mil linhas (competência × lote × PJ × médico), o que
   * preserva todos os filtros da tela: especialidade é derivada de doctor_id.
   */
  const fetchAggregatedItems = useCallback(
    async (hid: string, from: string, to: string): Promise<ItemRow[]> => {
      const { data, error: rErr } = await supabase.rpc("get_specialty_payments_agg", {
        p_hospital: hid,
        p_from: from,
        p_to: to,
      });
      if (rErr) throw rErr;
      return ((data ?? []) as Array<{
        competence: string | null;
        payment_id: string | null;
        company_id: string | null;
        doctor_id: string | null;
        gross: number | string | null;
        items: number | string | null;
      }>).map((r) => ({
        payment_id: r.payment_id,
        company_id: r.company_id,
        doctor_id: r.doctor_id,
        gross_amount: Number(r.gross ?? 0),
        item_competence: r.competence,
        qty: Number(r.items ?? 0),
      }));
    },
    [],
  );


  const load = useCallback(async () => {
    if (!hospitalId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const start = monthStart(fromMonth);
      const end = monthEnd(toMonth);

      // Itens primeiro: os médicos carregados depois são só os que aparecem no
      // período. Carregar a tabela `doctors` inteira por offset estourava o
      // statement timeout (RLS pesada, ~8s por página de 1000).
      const itemRows = await fetchAggregatedItems(hospitalId, start, end);

      const [companyRows, groupRes, memberRes, dcRows] = await Promise.all([
        fetchAllPaginated<CompanyRow>((from, to) =>
          supabase.from("companies").select("id,name,document").order("name").range(from, to),
        ),
        supabase
          .from("analysis_groups")
          .select("id,name")
          .eq("hospital_id", hospitalId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("analysis_group_members")
          .select("group_id,member_type,specialty_code,doctor_id,company_id")
          .eq("hospital_id", hospitalId),
        fetchAllPaginated<DoctorCompanyRow>((from, to) =>
          supabase
            .from("doctor_companies")
            .select("doctor_id,company_id,start_date,end_date")
            .eq("hospital_id", hospitalId)
            .range(from, to),
        ),
      ]);

      if (groupRes.error) throw groupRes.error;
      if (memberRes.error) throw memberRes.error;

      // Médicos necessários: os que têm itens no período + os citados
      // diretamente em grupos de análise + o médico selecionado no filtro.
      const doctorIdsNeeded = new Set<string>();
      itemRows.forEach((i) => i.doctor_id && doctorIdsNeeded.add(i.doctor_id));
      ((memberRes.data ?? []) as GroupMemberRow[]).forEach(
        (m) => m.doctor_id && doctorIdsNeeded.add(m.doctor_id),
      );
      if (selectedDoctorId) doctorIdsNeeded.add(selectedDoctorId);

      const doctorRows: DoctorRow[] = [];
      const doctorIdList = Array.from(doctorIdsNeeded);
      for (let i = 0; i < doctorIdList.length; i += 200) {
        const { data, error: dErr } = await supabase
          .from("doctors")
          .select("id,full_name,crm,crm_uf,specialties")
          .in("id", doctorIdList.slice(i, i + 200));
        if (dErr) throw dErr;
        doctorRows.push(...((data ?? []) as DoctorRow[]));
      }


      // A RPC já exclui itens cancelados.
      const live = itemRows;

      setItems(live);

      setDoctors(doctorRows);
      setCompanies(companyRows);
      setGroups((groupRes.data ?? []) as GroupRow[]);
      setGroupMembers((memberRes.data ?? []) as GroupMemberRow[]);
      setDoctorCompanies(dcRows);

      const paymentIds = Array.from(
        new Set(live.map((i) => i.payment_id).filter(Boolean) as string[]),
      );
      if (paymentIds.length > 0) {
        const chunks: FinancialRow[] = [];
        for (let i = 0; i < paymentIds.length; i += 200) {
          const { data, error: fErr } = await supabase
            .from("payment_company_financials")
            .select("payment_id,company_id,liquido")
            .in("payment_id", paymentIds.slice(i, i + 200));
          if (fErr) throw fErr;
          chunks.push(...((data ?? []) as FinancialRow[]));
        }
        setFinancials(chunks);
      } else {
        setFinancials([]);
      }
    } catch (e: unknown) {

      // Erros do PostgREST não são instâncias de Error — sem isto o usuário via
      // apenas "Falha ao carregar o relatório", escondendo a causa real.
      const err = e as { message?: string; code?: string; details?: string } | null;
      const base = err?.message || "Falha ao carregar o relatório";
      setError(err?.code ? `${base} (código ${err.code})` : base);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [hospitalId, fromMonth, toMonth, fetchAggregatedItems]);


  useEffect(() => {
    if (hospitalLoading) return;
    void load();
  }, [hospitalLoading, load]);

  const doctorById = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const specialtyNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    specialtyRows.forEach((s) => m.set(s.code, s.name));
    return m;
  }, [specialtyRows]);

  /** doctors.specialties (cadastro) normalizado por médico. */
  const doctorSpecialtiesNorm = useMemo(() => {
    const m = new Map<string, string[]>();
    doctors.forEach((d) => m.set(d.id, (d.specialties ?? []).map(norm)));
    return m;
  }, [doctors]);

  const selectedDoctor = selectedDoctorId ? doctorById.get(selectedDoctorId) ?? null : null;
  const selectedCompany = selectedCompanyId ? companyById.get(selectedCompanyId) ?? null : null;

  // ---------- resolução dos recortes ----------
  const periodStart = monthStart(fromMonth);
  const periodEnd = monthEnd(toMonth);

  /** PJ vigente do médico dentro do período filtrado (doctor_companies). */
  const doctorCompaniesInPeriod = useCallback(
    (doctorId: string): string[] => {
      return doctorCompanies
        .filter((dc) => dc.doctor_id === doctorId)
        .filter((dc) => {
          const s = dc.start_date ?? "0001-01-01";
          const e = dc.end_date ?? "9999-12-31";
          return s <= periodEnd && e >= periodStart;
        })
        .map((dc) => dc.company_id);
    },
    [doctorCompanies, periodStart, periodEnd],
  );

  const scope = useMemo(() => {
    const doctorSet = new Set<string>();
    const companySet = new Set<string>();
    let active = false;

    if (selectedGroupId !== "all") {
      active = true;
      const members = groupMembers.filter((m) => m.group_id === selectedGroupId);
      for (const m of members) {
        if (m.member_type === "doctor" && m.doctor_id) doctorSet.add(m.doctor_id);
        if (m.member_type === "company" && m.company_id) companySet.add(m.company_id);
        if (m.member_type === "specialty" && m.specialty_code) {
          // Especialidade expande para os médicos que a têm no CADASTRO.
          const specName = norm(specialtyNameByCode.get(m.specialty_code) ?? m.specialty_code);
          doctors.forEach((d) => {
            if ((doctorSpecialtiesNorm.get(d.id) ?? []).includes(specName)) doctorSet.add(d.id);
          });
        }
      }
    }

    if (selectedDoctorId) {
      active = true;
      if (doctorMode === "doctor") {
        doctorSet.add(selectedDoctorId);
      } else {
        doctorCompaniesInPeriod(selectedDoctorId).forEach((c) => companySet.add(c));
      }
    }

    if (selectedCompanyId) {
      active = true;
      companySet.add(selectedCompanyId);
    }

    return { doctorSet, companySet, active };
  }, [
    selectedGroupId,
    groupMembers,
    specialtyNameByCode,
    doctors,
    doctorSpecialtiesNorm,
    selectedDoctorId,
    doctorMode,
    doctorCompaniesInPeriod,
    selectedCompanyId,
  ]);

  const selectedSpecialtiesNorm = useMemo(
    () => selectedSpecialties.map(norm),
    [selectedSpecialties],
  );

  const computed = useMemo(() => {
    const matched: ItemRow[] = [];
    const noDoctor: ItemRow[] = [];
    let baseBruto = 0;
    let baseItems = 0;

    for (const it of items) {
      const gross = Number(it.gross_amount ?? 0);
      baseBruto += gross;
      baseItems += it.qty;

      // Itens sem doctor_id NUNCA são atribuídos a especialidade pelo cadastro:
      // ficam numa linha própria para o total do relatório bater com o real.
      if (!it.doctor_id) {
        noDoctor.push(it);
        continue;
      }

      const byCompany = scope.companySet.size > 0 && it.company_id
        ? scope.companySet.has(it.company_id)
        : false;
      const byDoctor = scope.doctorSet.size > 0 ? scope.doctorSet.has(it.doctor_id) : false;

      if (scope.active && !byCompany && !byDoctor) continue;

      // Membro do tipo "PJ" traz todos os itens da PJ, independente de especialidade.
      if (selectedSpecialtiesNorm.length > 0 && !byCompany) {
        const specs = doctorSpecialtiesNorm.get(it.doctor_id) ?? [];
        if (!specs.some((s) => selectedSpecialtiesNorm.includes(s))) continue;
      }

      matched.push(it);
    }

    const bruto = matched.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0);
    const semMedicoBruto = noDoctor.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0);

    const companySetOut = new Set(matched.map((i) => i.company_id).filter(Boolean) as string[]);
    const doctorSetOut = new Set(matched.map((i) => i.doctor_id).filter(Boolean) as string[]);

    // Líquido só existe por (lote × PJ) — não é rateável por especialidade.
    const pairs = new Set(
      matched
        .filter((i) => i.payment_id && i.company_id)
        .map((i) => `${i.payment_id}|${i.company_id}`),
    );
    const liquido = financials
      .filter((f) => pairs.has(`${f.payment_id}|${f.company_id}`))
      .reduce((s, f) => s + Number(f.liquido ?? 0), 0);

    // Série mensal
    const byMonth = new Map<string, { bruto: number; items: number }>();
    for (const i of matched) {
      const ym = (i.item_competence ?? "").slice(0, 7);
      if (!ym) continue;
      const cur = byMonth.get(ym) ?? { bruto: 0, items: 0 };
      cur.bruto += Number(i.gross_amount ?? 0);
      cur.items += i.qty;
      byMonth.set(ym, cur);
    }
    const months = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({ month: monthLabel(ym), bruto: v.bruto, items: v.items }));

    // Tabela agrupada
    const agg = new Map<string, { items: number; bruto: number; specialties: Set<string> }>();
    for (const i of matched) {
      const key = groupBy === "company" ? i.company_id ?? "sem_pj" : i.doctor_id ?? "sem_medico";
      const cur = agg.get(key) ?? { items: 0, bruto: 0, specialties: new Set<string>() };
      cur.items += i.qty;
      cur.bruto += Number(i.gross_amount ?? 0);
      if (i.doctor_id) {
        (doctorById.get(i.doctor_id)?.specialties ?? []).forEach((s) => cur.specialties.add(s));
      }
      agg.set(key, cur);
    }

    const rows: SpecialtyReportGroupRow[] = Array.from(agg.entries())
      .map(([key, v]) => {
        if (groupBy === "company") {
          const c = companyById.get(key);
          return {
            key,
            label: c?.name ?? "PJ não identificada",
            sublabel: c?.document ? formatCNPJ(c.document) : "—",
            specialties: Array.from(v.specialties).sort().join(", ") || "—",
            items: v.items,
            bruto: v.bruto,
          };
        }
        const d = doctorById.get(key);
        return {
          key,
          label: d?.full_name ?? "Médico não identificado",
          sublabel: d?.crm ? `CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : "—",
          specialties: (d?.specialties ?? []).join(", ") || "—",
          items: v.items,
          bruto: v.bruto,
        };
      })
      .sort((a, b) => b.bruto - a.bruto);

    return {
      matched,
      noDoctor,
      bruto,
      liquido,
      semMedicoBruto,
      companies: companySetOut.size,
      doctors: doctorSetOut.size,
      months,
      rows,
      baseBruto,
      baseItems,
    };
  }, [
    items,
    scope,
    selectedSpecialtiesNorm,
    doctorSpecialtiesNorm,
    financials,
    groupBy,
    companyById,
    doctorById,
  ]);

  // ---------- buscas de médico / PJ ----------
  const doctorResults = useMemo(() => {
    const q = norm(doctorQuery);
    if (!q) return [];
    return doctors
      .filter(
        (d) =>
          norm(d.full_name).includes(q) ||
          norm(`${d.crm ?? ""}${d.crm_uf ?? ""}`).includes(q.replace(/[^a-z0-9]/g, "")),
      )
      .slice(0, 8);
  }, [doctors, doctorQuery]);

  const companyResults = useMemo(() => {
    const q = norm(companyQuery);
    if (!q) return [];
    const digits = companyQuery.replace(/\D/g, "");
    return companies
      .filter(
        (c) =>
          norm(c.name).includes(q) ||
          (digits.length >= 3 && (c.document ?? "").replace(/\D/g, "").includes(digits)),
      )
      .slice(0, 8);
  }, [companies, companyQuery]);

  const filtersSummary = {
    hospitalName: hospital?.name ?? "—",
    periodLabel: `${monthLabel(fromMonth)} a ${monthLabel(toMonth)}`,
    specialtiesLabel: selectedSpecialties.length ? selectedSpecialties.join(", ") : "Todas",
    groupLabel: groups.find((g) => g.id === selectedGroupId)?.name ?? "Todos",
    doctorLabel: selectedDoctor
      ? `${selectedDoctor.full_name}${doctorMode === "company" ? " (total da PJ vinculada)" : ""}`
      : "Todos",
    companyLabel: selectedCompany?.name ?? "Todas",
  };

  const kpis = {
    bruto: computed.bruto,
    liquido: computed.liquido,
    items: computed.matched.reduce((s2, i) => s2 + i.qty, 0),
    companies: computed.companies,
    doctors: computed.doctors,
    semMedicoBruto: computed.semMedicoBruto,
    semMedicoItems: computed.noDoctor.reduce((s2, i) => s2 + i.qty, 0),
  };

  const clearFilters = () => {
    setSelectedSpecialties([]);
    setSelectedGroupId("all");
    setSelectedDoctorId(null);
    setDoctorQuery("");
    setDoctorMode("doctor");
    setSelectedCompanyId(null);
    setCompanyQuery("");
  };

  const handleExportExcel = () => {
    try {
      exportSpecialtyReportExcel({
        filters: filtersSummary,
        kpis,
        months: computed.months,
        rows: computed.rows,
        groupByLabel: groupBy === "company" ? "PJ / Empresa" : "Médico",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar Excel");
    }
  };

  const handleExportPdf = async () => {
    try {
      await exportSpecialtyReportPdf({
        filters: filtersSummary,
        kpis,
        rows: computed.rows,
        groupByLabel: groupBy === "company" ? "PJ / Empresa" : "Médico",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar PDF");
    }
  };

  return (
    <div>
      <PageHeader
        title="Pagamentos por especialidade / PJ"
        description="Especialidade sempre derivada do cadastro do médico (doctors.specialties), nunca do texto digitado no item."
        icon={BarChart3}
      />

      <div className="p-4 md:p-6 space-y-6">
        {/* ---------------- Filtros ---------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="from-month">Competência inicial</Label>
                <Input
                  id="from-month"
                  type="month"
                  value={fromMonth}
                  onChange={(e) => setFromMonth(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-month">Competência final</Label>
                <Input
                  id="to-month"
                  type="month"
                  value={toMonth}
                  onChange={(e) => setToMonth(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Especialidades (cadastro)</Label>
                <MultiSelectChips
                  values={selectedSpecialties}
                  onChange={setSelectedSpecialties}
                  options={specialtyRows.map((s) => s.name)}
                  allowCustom={false}
                  placeholder="Todas as especialidades"
                  emptyHint="Vazio = todas."
                />
              </div>

              <div className="space-y-1.5">
                <Label>Grupo de análise</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Médico */}
              <div className="space-y-1.5">
                <Label htmlFor="doctor-search">Médico</Label>
                {selectedDoctor ? (
                  <div className="space-y-2">
                    <Badge variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                      {selectedDoctor.full_name}
                      <button
                        type="button"
                        aria-label="Remover médico"
                        className="rounded p-0.5 hover:bg-destructive/15 hover:text-destructive"
                        onClick={() => {
                          setSelectedDoctorId(null);
                          setDoctorQuery("");
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                    <Tabs value={doctorMode} onValueChange={(v) => setDoctorMode(v as DoctorMode)}>
                      <TabsList>
                        <TabsTrigger value="doctor">Somente este médico</TabsTrigger>
                        <TabsTrigger value="company">Total da PJ vinculada</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    {doctorMode === "company" && (
                      <p className="text-xs text-muted-foreground">
                        PJ vigente no período:{" "}
                        {doctorCompaniesInPeriod(selectedDoctor.id)
                          .map((cid) => companyById.get(cid)?.name ?? "—")
                          .join(", ") || "nenhum vínculo vigente"}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="doctor-search"
                        className="pl-9"
                        value={doctorQuery}
                        onChange={(e) => setDoctorQuery(e.target.value)}
                        placeholder="Buscar por nome ou CRM"
                      />
                    </div>
                    {doctorResults.length > 0 && (
                      <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                        {doctorResults.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => setSelectedDoctorId(d.id)}
                          >
                            {d.full_name}
                            <span className="text-xs text-muted-foreground ml-2">
                              {d.crm ? `CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PJ */}
              <div className="space-y-1.5">
                <Label htmlFor="company-search">PJ / Empresa</Label>
                {selectedCompany ? (
                  <Badge variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                    {selectedCompany.name}
                    <button
                      type="button"
                      aria-label="Remover PJ"
                      className="rounded p-0.5 hover:bg-destructive/15 hover:text-destructive"
                      onClick={() => {
                        setSelectedCompanyId(null);
                        setCompanyQuery("");
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="company-search"
                        className="pl-9"
                        value={companyQuery}
                        onChange={(e) => setCompanyQuery(e.target.value)}
                        placeholder="Buscar por nome ou CNPJ"
                      />
                    </div>
                    {companyResults.length > 0 && (
                      <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                        {companyResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => setSelectedCompanyId(c.id)}
                          >
                            {c.name}
                            <span className="text-xs text-muted-foreground ml-2">
                              {c.document ? formatCNPJ(c.document) : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Recarregar
              </Button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleExportExcel}>
                  <Download className="h-4 w-4 mr-1.5" />
                  Excel
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportPdf()}>
                  <FileText className="h-4 w-4 mr-1.5" />
                  PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {!hospitalId ? (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            Selecione uma unidade hospitalar para ver o relatório.
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Não foi possível carregar o relatório</p>
            <p className="text-muted-foreground mt-1">{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              Tentar novamente
            </Button>
          </div>
        ) : loading ? (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* ---------------- KPIs ---------------- */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Total bruto" value={money(kpis.bruto)} tone="primary" />
              <KpiCard
                label="Total líquido (PJ/lote)"
                value={money(kpis.liquido)}
                hint="Líquido existe por lote × PJ; não é rateável por especialidade."
              />
              <KpiCard label="Itens" value={kpis.items.toLocaleString("pt-BR")} />
              <KpiCard label="PJs" value={kpis.companies} />
              <KpiCard label="Médicos" value={kpis.doctors} />
            </div>

            {/* Integridade: itens sem doctor_id não podem ser atribuídos a especialidade */}
            <div className="grid gap-3 md:grid-cols-2">
              <KpiCard
                label="Sem médico vinculado"
                value={money(kpis.semMedicoBruto)}
                tone="warning"
                hint={`${kpis.semMedicoItems} itens do período sem doctor_id — não atribuíveis a nenhuma especialidade pelo cadastro.`}
              />
              <KpiCard
                label="Total do período (sem recorte)"
                value={money(computed.baseBruto)}
                hint={`${computed.baseItems.toLocaleString("pt-BR")} itens na unidade e período filtrados (referência de conferência).`}
              />
            </div>

            {/* ---------------- Gráfico ---------------- */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Bruto por competência</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {computed.months.length === 0 ? (
                  <div className="h-full grid place-items-center text-sm text-muted-foreground">
                    Sem dados no recorte selecionado.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={computed.months}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => money(Number(v))}
                        labelFormatter={(l: string) => `Competência ${l}`}
                      />
                      <Bar dataKey="bruto" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* ---------------- Tabela ---------------- */}
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Detalhamento</CardTitle>
                <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                  <TabsList>
                    <TabsTrigger value="company">Por PJ</TabsTrigger>
                    <TabsTrigger value="doctor">Por médico</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{groupBy === "company" ? "PJ / Empresa" : "Médico"}</TableHead>
                        <TableHead className="w-44">
                          {groupBy === "company" ? "CNPJ" : "CRM"}
                        </TableHead>
                        <TableHead>Especialidades (cadastro)</TableHead>
                        <TableHead className="w-24 text-right">Itens</TableHead>
                        <TableHead className="w-36 text-right">Bruto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {computed.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                            Sem itens no recorte selecionado.
                          </TableCell>
                        </TableRow>
                      )}
                      {computed.rows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.sublabel}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.specialties}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.items}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(r.bruto)}</TableCell>
                        </TableRow>
                      ))}
                      {kpis.semMedicoItems > 0 && (
                        <TableRow className="bg-warning/10">
                          <TableCell className="font-medium">Sem médico vinculado</TableCell>
                          <TableCell className="text-sm text-muted-foreground">—</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            Não atribuível por cadastro
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{kpis.semMedicoItems}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(kpis.semMedicoBruto)}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
