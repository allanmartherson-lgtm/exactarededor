// Relatório "Pagamentos por especialidade / PJ".
//
// REGRA CRÍTICA: a especialidade de um item SEMPRE vem do cadastro do médico
// (payment_items.doctor_id -> doctors.specialties). O campo
// payment_items.specialty é texto livre digitado pelo analista e só aparece
// como coluna informativa na aba de auditoria — nunca como base de cálculo
// ou de filtro.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { useSpecialties } from "@/hooks/useSpecialties";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { formatCNPJ } from "@/lib/cnpj";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelectPopover } from "@/components/ui/MultiSelectPopover";
import { formatCompetence } from "@/lib/status";
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
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

import { BarChart3, Download, FileText, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useGlosaRiskForCompanies } from "@/hooks/useGlosaRiskForCompanies";
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
  /** Tipo de pagamento curado (FK item_types). Nunca texto livre. */
  item_type_id: string | null;
  /** Convênio curado do item (payment_items.convenio_slug). */
  convenio_slug: string | null;
  gross_amount: number | null;
  item_competence: string | null;
  /** Quantidade de itens representados por esta linha agregada. */
  qty: number;
}

interface ItemTypeRow {
  id: string;
  code: string;
  label: string;
}

/** Bucket sintético para itens sem item_type_id preenchido. */
const UNCLASSIFIED_TYPE = "__sem_tipo__";

/** Bucket sintético para itens sem convenio_slug preenchido. */
const UNKNOWN_CONVENIO = "__sem_convenio__";




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
/**
 * Modo de leitura dos totais:
 * - "specialty": só os itens que batem no recorte (bruto exato; líquido é do lote × PJ).
 * - "company": todos os itens das MESMAS PJs no período, ignorando especialidade/grupo,
 *   para comparar a fatia da especialidade com o total real recebido pela PJ.
 */
type ViewMode = "specialty" | "company";

// Colapsa espaços internos: o cadastro tem variações como
// "Paliativismo e  terminalidade" (2 espaços, caixa diferente) que não podem
// deixar de casar com "Paliativismo e Terminalidade" da tabela specialties.
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Formato curto para rótulos dentro do gráfico (evita poluir a barra). */
const moneyShort = (v: number) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
  return `R$ ${Math.round(n)}`;
};

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
  /**
   * Tipos de pagamento selecionados (ids de item_types; UNCLASSIFIED_TYPE para
   * itens sem item_type_id). Vazio = todos os tipos.
   */
  const [selectedItemTypes, setSelectedItemTypes] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("company");
  const [viewMode, setViewMode] = useState<ViewMode>("specialty");

  // ---------- dados ----------
  const [items, setItems] = useState<ItemRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMemberRow[]>([]);
  const [doctorCompanies, setDoctorCompanies] = useState<DoctorCompanyRow[]>([]);
  const [financials, setFinancials] = useState<FinancialRow[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tipos de pagamento ativos (catálogo curado; item_types é global, sem hospital_id).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("item_types")
        .select("id,code,label")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (!cancelled) setItemTypes((data ?? []) as ItemTypeRow[]);
    })();
    return () => { cancelled = true; };
  }, []);

  // Cadastro de convênios do hospital: usado só para exibir o NOME do convênio
  // a partir do slug curado gravado no item (convenios é escopado por hospital).
  const [convenioNameBySlug, setConvenioNameBySlug] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!hospitalId) { setConvenioNameBySlug(new Map()); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("convenios")
        .select("slug,name")
        .eq("hospital_id", hospitalId);
      if (cancelled) return;
      const rows = (data ?? []) as { slug: string; name: string | null }[];
      setConvenioNameBySlug(new Map(rows.map((r) => [r.slug, r.name || r.slug])));
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);




  /**
   * Competências disponíveis para os selects de período. Mesma fonte usada
   * pela tela de Pagamentos (payments_global_stats) para manter os rótulos
   * idênticos; unimos as competências dos itens já carregados e os valores
   * atuais para nunca perder uma opção selecionada.
   */
  const [hospitalCompetences, setHospitalCompetences] = useState<string[]>([]);

  useEffect(() => {
    if (!hospitalId) { setHospitalCompetences([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: rpcErr } = await supabase.rpc("payments_global_stats");
        if (rpcErr) throw rpcErr;
        const payload = (data ?? {}) as { competences?: string[] };
        if (!cancelled) {
          setHospitalCompetences(
            Array.isArray(payload.competences) ? payload.competences.map((c) => String(c).slice(0, 7)) : [],
          );
        }
      } catch {
        if (!cancelled) setHospitalCompetences([]);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  // Enquanto o usuário não mexer nos seletores, o período padrão acompanha o
  // último mês com dado real — o mês calendário de hoje pode não ter lançamento.
  const [periodTouched, setPeriodTouched] = useState(false);

  useEffect(() => {
    if (periodTouched || hospitalCompetences.length === 0) return;
    const sortedDesc = [...hospitalCompetences].sort((a, b) => b.localeCompare(a));
    const latest = sortedDesc[0];
    const earliest = sortedDesc[Math.min(5, sortedDesc.length - 1)];
    setFromMonth(earliest);
    setToMonth(latest);
  }, [hospitalCompetences, periodTouched]);

  const competenceOptions = useMemo(() => {
    const set = new Set<string>([fromMonth, toMonth, ...hospitalCompetences]);
    items.forEach((i) => { if (i.item_competence) set.add(i.item_competence.slice(0, 7)); });
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [fromMonth, toMonth, hospitalCompetences, items]);


  /**
   * Itens do período, já somados no banco pela RPC get_specialty_payments_agg.
   * Baixar os itens crus (~50 mil linhas no período) estourava o statement
   * timeout do PostgREST (erro 57014) e derrubava o relatório inteiro.
   * A RPC devolve ~3 mil linhas (competência × lote × PJ × médico), o que
   * preserva todos os filtros da tela: especialidade é derivada de doctor_id.
   */
  const fetchAggregatedItems = useCallback(
    async (hid: string, from: string, to: string): Promise<ItemRow[]> => {
      type AggRow = {
        competence: string | null;
        payment_id: string | null;
        company_id: string | null;
        doctor_id: string | null;
        item_type_id: string | null;
        convenio_slug: string | null;
        gross: number | string | null;
        items: number | string | null;
      };

      // PostgREST corta a resposta em 1000 linhas (max-rows) mesmo em RPC —
      // no período jan-jun/2026 a agregação tem 3.513 linhas, então sem
      // paginação o relatório perdia ~70% dos itens silenciosamente
      // (competências inteiras sumiam do gráfico). Paginar por .range() é
      // obrigatório aqui.
      const PAGE = 1000;
      const out: ItemRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error: rErr } = await supabase
          .rpc("get_specialty_payments_agg", { p_hospital: hid, p_from: from, p_to: to })
          .range(offset, offset + PAGE - 1);
        if (rErr) throw rErr;
        const rows = (data ?? []) as AggRow[];
        out.push(
          ...rows.map((r) => ({
            payment_id: r.payment_id,
            company_id: r.company_id,
            doctor_id: r.doctor_id,
            item_type_id: r.item_type_id ?? null,
            convenio_slug: r.convenio_slug ?? null,
            gross_amount: Number(r.gross ?? 0),
            item_competence: r.competence,
            qty: Number(r.items ?? 0),
          })),
        );
        if (rows.length < PAGE) break;
        if (out.length >= 200_000) break; // trava de segurança
      }
      return out;
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
    // Bruto do período por tipo de pagamento (antes dos demais recortes) —
    // usado só para leitura/auditoria do mix ambulatório × cirurgia × parecer.
    const brutoByType = new Map<string, { bruto: number; items: number }>();

    const typeFilter = new Set(selectedItemTypes);

    for (const it of items) {
      const gross = Number(it.gross_amount ?? 0);
      const typeKey = it.item_type_id ?? UNCLASSIFIED_TYPE;
      baseBruto += gross;
      baseItems += it.qty;
      const curType = brutoByType.get(typeKey) ?? { bruto: 0, items: 0 };
      curType.bruto += gross;
      curType.items += it.qty;
      brutoByType.set(typeKey, curType);

      // Tipo de pagamento (item_types) — campo curado, FK. Itens sem tipo caem
      // no bucket "Tipo não classificado" e podem ser filtrados explicitamente,
      // nunca são descartados em silêncio.
      if (typeFilter.size > 0 && !typeFilter.has(typeKey)) continue;

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
      brutoByType,
    };
  }, [
    items,
    scope,
    selectedSpecialtiesNorm,
    selectedItemTypes,
    doctorSpecialtiesNorm,
    financials,
    groupBy,
    companyById,
    doctorById,
  ]);

  /**
   * Modo "PJ no período": mesmas PJs do modo Especialidade, mas SEM o recorte de
   * especialidade/grupo — responde "quanto essa PJ recebeu no período, no total".
   * O filtro de tipo de pagamento continua valendo (é um recorte de escopo, não
   * de especialidade). Líquido aqui é comparável ao bruto, porque ambos passam a
   * ser do conjunto completo (lote × PJ).
   */
  const pjComputed = useMemo(() => {
    const companyScope = new Set(
      computed.matched.map((i) => i.company_id).filter(Boolean) as string[],
    );
    const typeFilter = new Set(selectedItemTypes);

    const matched = items.filter((i) => {
      if (!i.company_id || !companyScope.has(i.company_id)) return false;
      const typeKey = i.item_type_id ?? UNCLASSIFIED_TYPE;
      return typeFilter.size === 0 || typeFilter.has(typeKey);
    });

    const bruto = matched.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0);

    const pairs = new Set(
      matched.filter((i) => i.payment_id).map((i) => `${i.payment_id}|${i.company_id}`),
    );
    const liquidoByCompany = new Map<string, number>();
    let liquido = 0;
    for (const f of financials) {
      if (!pairs.has(`${f.payment_id}|${f.company_id}`)) continue;
      const v = Number(f.liquido ?? 0);
      liquido += v;
      liquidoByCompany.set(f.company_id, (liquidoByCompany.get(f.company_id) ?? 0) + v);
    }

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
            liquido: liquidoByCompany.get(key) ?? 0,
          };
        }
        const d = doctorById.get(key);
        return {
          key,
          label: d?.full_name ?? "Sem médico vinculado",
          sublabel: d?.crm ? `CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : "—",
          specialties: (d?.specialties ?? []).join(", ") || "—",
          items: v.items,
          bruto: v.bruto,
          // Líquido não é rateável por médico dentro do lote × PJ.
          liquido: null,
        };
      })
      .sort((a, b) => b.bruto - a.bruto);

    return {
      matched,
      bruto,
      liquido,
      companies: companyScope.size,
      doctors: new Set(matched.map((i) => i.doctor_id).filter(Boolean) as string[]).size,
      months,
      rows,
    };
  }, [items, computed.matched, selectedItemTypes, financials, groupBy, companyById, doctorById]);

  const isPjView = viewMode === "company";
  const view = {
    bruto: isPjView ? pjComputed.bruto : computed.bruto,
    liquido: isPjView ? pjComputed.liquido : computed.liquido,
    items: (isPjView ? pjComputed.matched : computed.matched).reduce((s, i) => s + i.qty, 0),
    companies: isPjView ? pjComputed.companies : computed.companies,
    doctors: isPjView ? pjComputed.doctors : computed.doctors,
    months: isPjView ? pjComputed.months : computed.months,
    rows: isPjView ? pjComputed.rows : computed.rows,
    matched: isPjView ? pjComputed.matched : computed.matched,
  };

  // ---------------------------------------------------------------------
  // Comparativo com o período imediatamente anterior de mesma duração.
  // Não é ano a ano: a base só tem dados a partir de jan/2026, então o
  // paralelo é com os N meses anteriores. Sem histórico suficiente antes do
  // período selecionado, o comparativo simplesmente não aparece.
  // ---------------------------------------------------------------------
  const shiftMonth = (ym: string, delta: number) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  const prevRange = useMemo(() => {
    if (!fromMonth || !toMonth || fromMonth > toMonth) return null;
    const [fy, fm] = fromMonth.split("-").map(Number);
    const [ty, tm] = toMonth.split("-").map(Number);
    const n = (ty - fy) * 12 + (tm - fm) + 1;
    if (n <= 0) return null;
    const prevTo = shiftMonth(fromMonth, -1);
    const prevFrom = shiftMonth(fromMonth, -n);
    const earliest = [...hospitalCompetences].sort()[0];
    // Sem competência conhecida antes do recorte → não há comparativo possível.
    if (!earliest || prevFrom < earliest) return null;
    return { from: prevFrom, to: prevTo, months: n };
  }, [fromMonth, toMonth, hospitalCompetences]);

  const [prevItems, setPrevItems] = useState<ItemRow[]>([]);
  const [prevFinancials, setPrevFinancials] = useState<FinancialRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hospitalId || !prevRange) {
        setPrevItems([]);
        setPrevFinancials([]);
        return;
      }
      try {
        const rows = await fetchAggregatedItems(
          hospitalId,
          monthStart(prevRange.from),
          monthEnd(prevRange.to),
        );
        if (cancelled) return;
        setPrevItems(rows);

        const paymentIds = Array.from(
          new Set(rows.map((i) => i.payment_id).filter(Boolean) as string[]),
        );
        const fin: FinancialRow[] = [];
        for (let i = 0; i < paymentIds.length; i += 200) {
          const { data, error: fErr } = await supabase
            .from("payment_company_financials")
            .select("payment_id,company_id,liquido")
            .in("payment_id", paymentIds.slice(i, i + 200));
          if (fErr) throw fErr;
          fin.push(...((data ?? []) as FinancialRow[]));
        }
        if (!cancelled) setPrevFinancials(fin);
      } catch {
        // Comparativo é informativo: falha aqui não pode derrubar o relatório.
        if (!cancelled) {
          setPrevItems([]);
          setPrevFinancials([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId, prevRange, fetchAggregatedItems]);

  /** Mesmo recorte de filtros do período atual, aplicado ao período anterior. */
  const prevTotals = useMemo(() => {
    if (!prevRange || prevItems.length === 0) return null;
    const typeFilter = new Set(selectedItemTypes);
    // No modo "PJ no período" o recorte é o conjunto de PJs da visão atual.
    const companyScope = isPjView
      ? new Set(computed.matched.map((i) => i.company_id).filter(Boolean) as string[])
      : null;

    const matched: ItemRow[] = [];
    for (const it of prevItems) {
      const typeKey = it.item_type_id ?? UNCLASSIFIED_TYPE;
      if (typeFilter.size > 0 && !typeFilter.has(typeKey)) continue;

      if (companyScope) {
        if (!it.company_id || !companyScope.has(it.company_id)) continue;
        matched.push(it);
        continue;
      }

      if (!it.doctor_id) continue;
      const byCompany = scope.companySet.size > 0 && it.company_id
        ? scope.companySet.has(it.company_id)
        : false;
      const byDoctor = scope.doctorSet.size > 0 ? scope.doctorSet.has(it.doctor_id) : false;
      if (scope.active && !byCompany && !byDoctor) continue;
      if (selectedSpecialtiesNorm.length > 0 && !byCompany) {
        const specs = doctorSpecialtiesNorm.get(it.doctor_id) ?? [];
        if (!specs.some((s) => selectedSpecialtiesNorm.includes(s))) continue;
      }
      matched.push(it);
    }

    const pairs = new Set(
      matched.filter((i) => i.payment_id && i.company_id).map((i) => `${i.payment_id}|${i.company_id}`),
    );
    return {
      bruto: matched.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0),
      items: matched.reduce((s, i) => s + i.qty, 0),
      liquido: prevFinancials
        .filter((f) => pairs.has(`${f.payment_id}|${f.company_id}`))
        .reduce((s, f) => s + Number(f.liquido ?? 0), 0),
    };
  }, [
    prevRange,
    prevItems,
    prevFinancials,
    selectedItemTypes,
    isPjView,
    computed.matched,
    scope,
    selectedSpecialtiesNorm,
    doctorSpecialtiesNorm,
  ]);

  /** Texto de variação abaixo do valor do KPI — verde sobe, vermelho cai. */
  const renderDelta = (current: number, previous: number | undefined, primary = false) => {
    if (!prevRange || previous == null) return null;
    // Base zero não tem variação percentual definida — mostra só o absoluto.
    const pct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
    const up = current >= previous;
    const label = pct == null
      ? "sem base no período anterior"
      : `${up ? "+" : ""}${pct.toFixed(1)}% vs período anterior`;
    const toneClass = primary
      ? "text-primary-foreground/80"
      : up
        ? "text-success"
        : "text-destructive";
    return (
      <span className={`text-xs font-medium ${toneClass}`}>
        {label}
        <span className={primary ? "" : "text-muted-foreground"}>
          {" "}({monthLabel(prevRange.from)}{prevRange.months > 1 ? `–${monthLabel(prevRange.to)}` : ""})
        </span>
      </span>
    );
  };



  /**
   * Quebra por convênio do MESMO recorte já filtrado (período, especialidade,
   * tipo de pagamento, grupo, PJ/médico e modo de visão). A fonte é o campo
   * curado payment_items.convenio_slug — itens sem slug caem no bucket
   * "Sem convênio identificado", que fica no fim da lista e nunca é descartado.
   */
  const convenioRows = useMemo(() => {
    const agg = new Map<string, { items: number; bruto: number }>();
    let total = 0;
    for (const i of view.matched) {
      const key = i.convenio_slug ?? UNKNOWN_CONVENIO;
      const cur = agg.get(key) ?? { items: 0, bruto: 0 };
      const gross = Number(i.gross_amount ?? 0);
      cur.items += i.qty;
      cur.bruto += gross;
      total += gross;
      agg.set(key, cur);
    }
    const rows = Array.from(agg.entries()).map(([key, v]) => ({
      key,
      label:
        key === UNKNOWN_CONVENIO
          ? "Sem convênio identificado"
          : convenioNameBySlug.get(key) ?? key,
      items: v.items,
      bruto: v.bruto,
      pct: total > 0 ? (v.bruto / total) * 100 : 0,
    }));
    return rows.sort((a, b) => {
      // O bucket sem convênio sempre fecha a lista, independente do valor.
      if (a.key === UNKNOWN_CONVENIO) return 1;
      if (b.key === UNKNOWN_CONVENIO) return -1;
      return b.bruto - a.bruto;
    });
  }, [view.matched, convenioNameBySlug]);






  // ---------- buscas de médico / PJ ----------
  // A busca de médico é feita no servidor: só carregamos localmente os médicos
  // com itens no período, então filtrar a lista local esconderia médicos válidos.
  const [doctorResults, setDoctorResults] = useState<DoctorRow[]>([]);
  useEffect(() => {
    const q = doctorQuery.trim();
    if (q.length < 2) {
      setDoctorResults([]);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(async () => {
      const digits = q.replace(/\D/g, "");
      const or = [`full_name.ilike.*${q.replace(/[,()*]/g, "")}*`];
      if (digits.length >= 3) or.push(`crm.ilike.*${digits}*`);
      const { data } = await supabase
        .from("doctors")
        .select("id,full_name,crm,crm_uf,specialties")
        .or(or.join(","))
        .order("full_name")
        .limit(8);
      if (cancel) return;
      const rows = (data ?? []) as DoctorRow[];
      setDoctorResults(rows);
      // Mantém o cadastro do médico buscado disponível para nome/CRM/especialidades.
      setDoctors((prev) => {
        const known = new Set(prev.map((d) => d.id));
        const extra = rows.filter((d) => !known.has(d.id));
        return extra.length ? [...prev, ...extra] : prev;
      });
    }, 300);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [doctorQuery]);


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

  /**
   * Opções do filtro "Tipo de pagamento": catálogo ativo de item_types
   * (ordenado por sort_order) + bucket "Tipo não classificado", que só aparece
   * quando existem itens sem item_type_id no período.
   */
  const itemTypeOptions = useMemo(() => {
    const opts = itemTypes.map((t) => ({ value: t.id, label: t.label }));
    const unclassified = computed.brutoByType.get(UNCLASSIFIED_TYPE);
    if (unclassified && unclassified.items > 0) {
      opts.push({ value: UNCLASSIFIED_TYPE, label: "Tipo não classificado" });
    }
    return opts;
  }, [itemTypes, computed.brutoByType]);

  const itemTypeLabelByValue = useMemo(
    () => new Map(itemTypeOptions.map((o) => [o.value, o.label])),
    [itemTypeOptions],
  );

  const filtersSummary = {
    hospitalName: hospital?.name ?? "—",
    periodLabel: `${monthLabel(fromMonth)} a ${monthLabel(toMonth)}`,
    specialtiesLabel: selectedSpecialties.length ? selectedSpecialties.join(", ") : "Todas",
    groupLabel: groups.find((g) => g.id === selectedGroupId)?.name ?? "Todos",
    doctorLabel: selectedDoctor
      ? `${selectedDoctor.full_name}${doctorMode === "company" ? " (total da PJ vinculada)" : ""}`
      : "Todos",
    companyLabel: selectedCompany?.name ?? "Todas",
    itemTypesLabel: selectedItemTypes.length
      ? selectedItemTypes.map((v) => itemTypeLabelByValue.get(v) ?? v).join(", ")
      : "Todos",
    viewModeLabel: isPjView ? "PJ no período (todas as especialidades)" : "Especialidade",
  };

  // Valor em risco: glosas ativas das PJs presentes no recorte filtrado.
  const companyIdsInScope = useMemo(
    () => Array.from(new Set(view.matched.map((i) => i.company_id).filter(Boolean) as string[])),
    [view.matched],
  );
  const { valorEmRisco } = useGlosaRiskForCompanies(companyIdsInScope);

  const kpis = {
    bruto: view.bruto,
    liquido: view.liquido,
    items: view.items,
    companies: view.companies,
    doctors: view.doctors,
    // No modo "PJ no período" os itens sem médico já entram no total da PJ,
    // então não existe fatia "não atribuível" para destacar.
    semMedicoBruto: isPjView ? 0 : computed.semMedicoBruto,
    semMedicoItems: isPjView ? 0 : computed.noDoctor.reduce((s2, i) => s2 + i.qty, 0),
  };


  const clearFilters = () => {
    setSelectedSpecialties([]);
    setSelectedGroupId("all");
    setSelectedItemTypes([]);
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
        months: view.months,
        rows: view.rows,
        convenios: convenioRows,
        groupByLabel: groupBy === "company" ? "PJ / Empresa" : "Médico",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar Excel");
    }
  };

  // Captura o SVG do recharts já renderizado e o converte em PNG, sem
  // dependência extra. Falha silenciosa: o PDF sai só com as tabelas.
  const chartRef = useRef<HTMLDivElement>(null);
  const captureChartPng = async (): Promise<string | undefined> => {
    try {
      const svg = chartRef.current?.querySelector("svg");
      if (!svg) return undefined;
      // Tamanho fixo orientado a impressão: o viewBox do recharts preserva as
      // proporções internas, então re-escala sem distorcer o container h-72.
      const width = 1100;
      const height = 480;

      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(width));
      clone.setAttribute("height", String(height));

      // Alinha a tipografia do gráfico com a fonte padrão do jsPDF (Helvetica).
      clone.style.fontFamily = "helvetica, Arial, sans-serif";
      clone.querySelectorAll("text, tspan").forEach((el) => {
        (el as SVGElement).style.fontFamily = "helvetica, Arial, sans-serif";
      });


      // Tokens CSS (hsl(var(--x))) não resolvem em SVG isolado: trocamos pelo
      // valor computado do :root antes de serializar.
      const rootStyle = getComputedStyle(document.documentElement);
      let markup = new XMLSerializer().serializeToString(clone);
      markup = markup.replace(/hsl\(var\((--[a-z0-9-]+)\)([^)]*)\)/gi, (_m, name: string, rest: string) => {
        const val = rootStyle.getPropertyValue(name).trim();
        return val ? `hsl(${val}${rest})` : "#94a3b8";
      });

      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });

      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } catch {
      return undefined;
    }
  };

  const handleExportPdf = async () => {
    try {
      await exportSpecialtyReportPdf({
        filters: filtersSummary,
        kpis,
        months: view.months,
        rows: view.rows,
        convenios: convenioRows,
        groupByLabel: groupBy === "company" ? "PJ / Empresa" : "Médico",
        chartPng: await captureChartPng(),
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

      <div className="p-6 space-y-6">
        {/* ---------------- Filtros (mesmo padrão da tela de Pagamentos) ----------------
            Barra compacta: primários inline + secundários dentro do popover
            "Mais filtros" com badge de contagem. Nada de Card "FILTROS" aberto. */}
        {(() => {
          const advancedCount = [!!selectedDoctorId, !!selectedCompanyId].filter(Boolean).length;
          const anyActive =
            advancedCount > 0 ||
            selectedSpecialties.length > 0 ||
            selectedItemTypes.length > 0 ||
            selectedGroupId !== "all";

          const advancedFilters = (
            <div className="grid grid-cols-1 gap-3 w-full">
              {/* Médico */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Médico
                </label>
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
                      <p className="text-[11px] text-muted-foreground">
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
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  PJ / Empresa
                </label>
                {selectedCompany ? (
                  <div>
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
                  </div>
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
          );

          return (
            <div className="flex flex-wrap items-center gap-2">
              {/* Competência de/até — Select com as competências existentes
                  (mesmo componente e mesmo formatCompetence da tela Pagamentos). */}
              <Select value={fromMonth} onValueChange={(v) => { setPeriodTouched(true); setFromMonth(v); }}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Competência inicial">
                    {`De: ${formatCompetence(`${fromMonth}-01`)}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {competenceOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {formatCompetence(`${c}-01`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={toMonth} onValueChange={(v) => { setPeriodTouched(true); setToMonth(v); }}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Competência final">
                    {`Até: ${formatCompetence(`${toMonth}-01`)}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {competenceOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {formatCompetence(`${c}-01`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Filtro principal desta tela — fica visível */}
              <MultiSelectPopover
                width="w-[240px]"
                placeholder="Todas especialidades"
                allLabel="Todas especialidades"
                values={selectedSpecialties}
                onChange={setSelectedSpecialties}
                options={specialtyRows.map((s) => ({ value: s.name, label: s.name }))}
              />

              {/* Tipo de pagamento — item_types (campo curado, FK). Evita
                  somar ambulatório/consulta junto com visita, parecer e cirurgia. */}
              <MultiSelectPopover
                width="w-[230px]"
                placeholder="Todos os tipos"
                allLabel="Todos os tipos"
                values={selectedItemTypes}
                onChange={setSelectedItemTypes}
                options={itemTypeOptions}
              />


              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Grupo de análise" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os grupos</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Secundários — dentro de popover "Mais filtros" */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="relative">
                    <SlidersHorizontal className="h-4 w-4 mr-1" /> Mais filtros
                    {advancedCount > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1">
                        {advancedCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[480px] max-w-[90vw] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">Filtros avançados</h4>
                    {advancedCount > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          setSelectedDoctorId(null);
                          setDoctorQuery("");
                          setDoctorMode("doctor");
                          setSelectedCompanyId(null);
                          setCompanyQuery("");
                        }}
                      >
                        Limpar avançados
                      </button>
                    )}
                  </div>
                  {advancedFilters}
                </PopoverContent>
              </Popover>

              {anyActive && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" /> Limpar filtros
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                  Recarregar
                </Button>
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
          );
        })()}


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
            {/* ---------------- KPIs ----------------
                Padrão BI: um único card de destaque (tone="primary") ancora a
                leitura; os demais permanecem neutros para não competir. */}
            {/* Alternador de modo: o "líquido" só é comparável ao bruto quando a
                visão é da PJ inteira no período. */}
            <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <TabsList>
                  <TabsTrigger value="specialty">Especialidade</TabsTrigger>
                  <TabsTrigger value="company">PJ no período</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Especialidade: só o que bate no filtro (bruto exato; líquido é do lote × PJ
                inteiro). PJ no período: tudo que essas mesmas PJs receberam no período, todas as
                especialidades — para comparação.
              </p>
            </div>

            <div className="grid gap-4 grid-cols-2 lg:grid-cols-6 items-stretch">
              <KpiCard
                className="h-full"
                label="Total bruto"
                // Valores em milhões estouram o text-3xl padrão do KpiCard.
                value={<span className="text-2xl">{money(kpis.bruto)}</span>}
                tone="primary"
                extra={renderDelta(kpis.bruto, prevTotals?.bruto, true)}
                hint={`${monthLabel(fromMonth)} a ${monthLabel(toMonth)}`}
              />
              <KpiCard
                className="h-full"
                label={isPjView ? "Total líquido (PJ)" : "Total líquido (PJ/lote)"}
                value={<span className="text-2xl">{money(kpis.liquido)}</span>}
                extra={renderDelta(kpis.liquido, prevTotals?.liquido)}
                hint={
                  isPjView
                    ? "Líquido total dessas PJs nos lotes do período — comparável ao bruto acima."
                    : "Líquido existe por lote × PJ; não é rateável por especialidade."
                }
              />

              <KpiCard
                className="h-full"
                label="Valor em risco"
                value={<span className="text-2xl">{money(valorEmRisco)}</span>}
                tone={valorEmRisco > 0 ? "warning" : undefined}
                hint={`${kpis.bruto > 0 ? ((valorEmRisco / kpis.bruto) * 100).toFixed(1) : "0.0"}% do bruto — glosas ativas das PJs do recorte.`}
              />
              <KpiCard className="h-full" label="Itens" value={kpis.items.toLocaleString("pt-BR")} hint="No recorte atual" />
              <KpiCard className="h-full" label="PJs" value={kpis.companies} hint="Com pagamento no recorte" />
              <KpiCard className="h-full" label="Médicos" value={kpis.doctors} hint="Com pagamento no recorte" />
            </div>



            {/* Integridade: itens sem doctor_id não podem ser atribuídos a especialidade */}
            <div className="grid gap-4 md:grid-cols-2">
              {!isPjView && (
                <KpiCard
                  label="Sem médico vinculado"
                  value={money(kpis.semMedicoBruto)}
                  tone="warning"
                  hint={`${kpis.semMedicoItems} itens do período cujo nome na planilha não bate com nenhum médico do cadastro nem com apelido cadastrado — cadastre o apelido em Médicos para recuperá-los.`}
                />
              )}
              <KpiCard
                label="Total do período (sem recorte)"
                value={money(computed.baseBruto)}
                hint={`${computed.baseItems.toLocaleString("pt-BR")} itens na unidade e período filtrados (referência de conferência).`}
              />
            </div>


            {/* ---------------- Gráfico ---------------- */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Bruto por competência
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Valores em reais sobre cada barra; passe o mouse para o valor exato.
                </p>
              </div>
              <div className="h-72" ref={chartRef}>
                {view.months.length === 0 ? (
                  <div className="h-full grid place-items-center text-sm text-muted-foreground">
                    Sem dados no recorte selecionado.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={view.months} margin={{ top: 24, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                        formatter={(v: number) => money(Number(v))}
                        labelFormatter={(l: string) => `Competência ${l}`}
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="bruto" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={64}>
                        <LabelList
                          dataKey="bruto"
                          position="top"
                          offset={8}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            fill: "hsl(var(--foreground))",
                          }}
                          formatter={(v: number) => (Number(v) ? moneyShort(Number(v)) : "")}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* ---------------- Tabela ---------------- */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Detalhamento
                  </h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {isPjView
                      ? "Total de cada PJ no período (todas as especialidades). Especialidades exibidas vêm do cadastro do médico."
                      : "Especialidades exibidas vêm do cadastro do médico."}
                  </p>
                </div>
                <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                  <TabsList>
                    <TabsTrigger value="company">Por PJ</TabsTrigger>
                    <TabsTrigger value="doctor">Por médico</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div>
                <div className="rounded-xl border border-border/60 overflow-x-auto">

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
                        {isPjView && <TableHead className="w-36 text-right">Líquido</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={isPjView ? 6 : 5} className="text-center text-sm text-muted-foreground py-8">
                            Sem itens no recorte selecionado.
                          </TableCell>
                        </TableRow>
                      )}
                      {view.rows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.sublabel}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.specialties}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.items}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(r.bruto)}</TableCell>
                          {isPjView && (
                            <TableCell className="text-right tabular-nums">
                              {/* Líquido só existe por lote × PJ: sem valor no agrupamento por médico. */}
                              {r.liquido == null ? "—" : money(r.liquido)}
                            </TableCell>
                          )}
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
              </div>
            </div>

            {/* ---------------- Por convênio ---------------- */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Por convênio
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Convênio curado do item (não é texto livre). Mesmo recorte de filtros do relatório;
                  % calculado sobre o bruto do período filtrado.
                </p>
              </div>
              <div className="rounded-xl border border-border/60 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Convênio</TableHead>
                      <TableHead className="w-24 text-right">Itens</TableHead>
                      <TableHead className="w-36 text-right">Bruto</TableHead>
                      <TableHead className="w-28 text-right">% do total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {convenioRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                          Sem itens no recorte selecionado.
                        </TableCell>
                      </TableRow>
                    )}
                    {convenioRows.map((c) => (
                      <TableRow key={c.key} className={c.key === "__sem_convenio__" ? "bg-warning/10" : undefined}>
                        <TableCell className="font-medium">{c.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.items}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.bruto)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.pct.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>



          </>
        )}
      </div>
    </div>
  );
}
