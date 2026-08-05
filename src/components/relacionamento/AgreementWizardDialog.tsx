// Wizard de Cadastro de Acordos (6 etapas) — grava em agreement_registrations.
// Cada avanço persiste como rascunho, permitindo sair e continuar depois.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { useHospital } from "@/contexts/HospitalContext";
import { useRequireHospital } from "@/hooks/useRequireHospital";
import { formatCNPJ } from "@/lib/cnpj";
import { FormDialog } from "@/components/FormDialog";
import { AgreementAttachmentsPanel } from "@/components/relacionamento/AgreementAttachmentsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  RuleCalculationsEditor,
  makeEmptyCalc,
  type CalcItem,
} from "@/components/rules/RuleCalculationsEditor";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import type {
  AgreementRegistration,
  AgreementRegistrationType,
  ExtraItem,
} from "@/lib/agreementRegistrations";
import {
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_TYPE_LABEL,
  PAYMENT_TABLE_BASE_LABEL,
} from "@/lib/agreementRegistrations";
import { AgreementExportButtons } from "@/components/relacionamento/AgreementExportButtons";
import { fmtExportDate, type AgreementExportModel } from "@/lib/agreementExport";

interface CompanyOption {
  id: string;
  name: string;
  document: string | null;
  active: boolean;
}
interface ConvenioOption {
  // convenios não tem uuid: a chave do cadastro é o slug
  slug: string;
  name: string;
}
interface DoctorOption {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
}
interface HospitalOption {
  id: string;
  name: string;
}
/** Acordo já cadastrado, usado como referência em aditivo/retirada. */
interface RelatedAgreementOption {
  id: string;
  code: string;
  company_id: string | null;
}
/** Linha da lista de PJs do acordo de equipe (antes de virar agreement_registration_parties). */
interface PartyDraft {
  key: string;
  companyId: string | null;
  allDoctors: boolean;
  doctorIds: string[];
}

/** Modelo de pagamento do acordo (payment_models): Produção, Remessa, Plantão, etc. */
interface PaymentModelOption {
  id: string;
  code: string;
  label: string;
}

/** Bloco do contrato de valor fixo — vive dentro de calculation_draft. */
interface FixedValueDraft {
  amount: string;
  installments: string;
  periodicity: string;
}

const EMPTY_FIXED_VALUE: FixedValueDraft = { amount: "", installments: "", periodicity: "mensal" };

const FIXED_PERIODICITY_LABEL: Record<string, string> = {
  mensal: "Mensal",
  quinzenal: "Quinzenal",
  semanal: "Semanal",
  unico: "Pagamento único",
};

const MIN_GARANTIDO_ESCOPO_LABEL: Record<string, string> = {
  medico_empresa: "Por médico dentro da PJ",
  empresa: "Por PJ (consolidado)",
};

/** Códigos que exigem a etapa de cálculo por produção. */
const PRODUCTION_LIKE_CODES = ["producao", "remessa", "plantao", "hora_trabalhada"];
/** Códigos que habilitam o toggle de mínimo garantido. */
const MIN_GARANTIDO_CODES = ["producao", "remessa"];

const STEPS = [
  "Identificação",
  "Abrangência",
  "Cálculo de Pagamento",
  "Regras especiais",
  "Itens extras",
  "Observações",
] as const;


const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const numOrNull = (v: string): number | null => {
  const t = v.replace(",", ".").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: AgreementRegistration | null;
  onSaved: () => void;
}

export function AgreementWizardDialog({ open, onOpenChange, record, onSaved }: Props) {
  const { hospital } = useHospital();
  const { hospitalId, ensure } = useRequireHospital();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState<string | null>(null);

  // Etapa 1
  const [registrationType, setRegistrationType] =
    useState<AgreementRegistrationType>("novo_acordo");
  const [referenceNote, setReferenceNote] = useState("");
  const [relatedAgreementId, setRelatedAgreementId] = useState<string | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [relatedOptions, setRelatedOptions] = useState<RelatedAgreementOption[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  // Acordo de equipe: várias PJs, cada uma com todos os médicos ou uma lista específica
  const [multiParty, setMultiParty] = useState(false);
  const [parties, setParties] = useState<PartyDraft[]>([]);
  // Falso até as PJs já vinculadas serem lidas do banco (evita apagá-las ao salvar cedo demais)
  const [partiesLoaded, setPartiesLoaded] = useState(true);

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  // Replicação regional: hospitais adicionais que recebem o mesmo acordo
  const [replicaHospitalIds, setReplicaHospitalIds] = useState<string[]>([]);
  const [hospitalsOpen, setHospitalsOpen] = useState(false);
  const [hospitalOptions, setHospitalOptions] = useState<HospitalOption[]>([]);
  const [lockedHospitalIds, setLockedHospitalIds] = useState<string[]>([]);


  // Etapa 1 — tipo de pagamento e mínimo garantido
  const [paymentModels, setPaymentModels] = useState<PaymentModelOption[]>([]);
  const [paymentModelIds, setPaymentModelIds] = useState<string[]>([]);
  const [minGarantidoAtivo, setMinGarantidoAtivo] = useState(false);
  const [minGarantidoValor, setMinGarantidoValor] = useState("");
  const [minGarantidoEscopo, setMinGarantidoEscopo] = useState("medico_empresa");
  const [minGarantidoPeriodicidade, setMinGarantidoPeriodicidade] = useState("competencia");
  const [minGarantidoBase, setMinGarantidoBase] = useState("liquido");

  // Etapa 2
  const [allConvenios, setAllConvenios] = useState(true);
  const [convenioExceptions, setConvenioExceptions] = useState<string[]>([]);
  const [allDoctors, setAllDoctors] = useState(true);
  const [doctorExceptions, setDoctorExceptions] = useState<string[]>([]);
  const [includesAuxiliary, setIncludesAuxiliary] = useState(false);
  const [includesAccessRoute, setIncludesAccessRoute] = useState(false);
  // Etapa 3 — rascunho de cálculo no MESMO formato da tela de Regras
  const [calcItems, setCalcItems] = useState<CalcItem[]>([]);
  const [fixedValue, setFixedValue] = useState<FixedValueDraft>({ ...EMPTY_FIXED_VALUE });
  const [hasGlosa, setHasGlosa] = useState(false);
  const [glosaConditions, setGlosaConditions] = useState("");

  // Etapa 4
  const [urgencyDiff, setUrgencyDiff] = useState(false);
  const [urgencyPct, setUrgencyPct] = useState("");
  const [weekendAdd, setWeekendAdd] = useState(false);
  const [weekendPct, setWeekendPct] = useState("");
  const [hasFixedValues, setHasFixedValues] = useState(false);
  const [fixedUrgencyDiff, setFixedUrgencyDiff] = useState(false);
  const [exclusionsNotes, setExclusionsNotes] = useState("");
  // Etapa 5/6
  const [extraItems, setExtraItems] = useState<ExtraItem[]>([]);
  const [freeNotes, setFreeNotes] = useState("");

  // Cadastros
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [convenios, setConvenios] = useState<ConvenioOption[]>([]);
  // Somente os médicos vinculados à clínica selecionada (doctor_companies).
  // Carregar o cadastro inteiro estourava o statement timeout do banco.
  const [linkedDoctors, setLinkedDoctors] = useState<DoctorOption[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [registriesLoading, setRegistriesLoading] = useState(false);
  // Cadastros exigidos pelo RuleCalculationsEditor (mesma fonte usada na tela de Regras)
  const [refTables, setRefTables] = useState<{ id: string; name: string; purpose?: string }[]>([]);
  const [specialCaseTypes, setSpecialCaseTypes] = useState<{ code: string; label: string }[]>([]);
  const { list: paymentTypesList } = usePaymentTypes({ onlyActive: true });

  const selectedModelCodes = useMemo(
    () => paymentModels.filter((m) => paymentModelIds.includes(m.id)).map((m) => m.code),
    [paymentModels, paymentModelIds],
  );
  // Produção/Remessa/Plantão/Hora trabalhada exigem o motor de cálculo completo
  const showProductionBlock = useMemo(
    () => selectedModelCodes.some((c) => PRODUCTION_LIKE_CODES.includes(c)),
    [selectedModelCodes],
  );
  const showFixedValueBlock = useMemo(
    () => selectedModelCodes.includes("valor_fixo"),
    [selectedModelCodes],
  );
  // Contrato só de valor fixo não tem convênio, glosa nem via de acesso
  const onlyFixedValue = showFixedValueBlock && !showProductionBlock;
  const showGlosaBlock = !onlyFixedValue;
  const canHaveMinGarantido = useMemo(
    () => selectedModelCodes.some((c) => MIN_GARANTIDO_CODES.includes(c)),
    [selectedModelCodes],
  );

  // Mínimo garantido só existe para produção/remessa: limpa ao desmarcar
  useEffect(() => {
    if (!canHaveMinGarantido && minGarantidoAtivo) setMinGarantidoAtivo(false);
  }, [canHaveMinGarantido, minGarantidoAtivo]);


  // Reidrata o formulário sempre que abre (novo ou continuação de rascunho)
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setId(record?.id ?? null);
    setCompanyId(record?.company_id ?? null);
    setRegistrationType(record?.registration_type ?? "novo_acordo");
    setReferenceNote(record?.reference_note ?? "");
    setRelatedAgreementId(record?.related_agreement_id ?? null);
    setMultiParty(false);
    setParties([]);
    // Enquanto as PJs do banco não chegam, persist() não pode regravá-las
    setPartiesLoaded(!record?.id);

    setEffectiveFrom(record?.effective_from ?? "");

    setEffectiveTo(record?.effective_to ?? "");
    setAllConvenios(record?.applies_to_all_convenios ?? true);
    setConvenioExceptions(record?.convenio_exceptions ?? []);
    setAllDoctors(record?.applies_to_all_doctors ?? true);
    setDoctorExceptions(record?.doctor_exceptions ?? []);
    setIncludesAuxiliary(record?.includes_auxiliary ?? false);
    setIncludesAccessRoute(record?.includes_access_route ?? false);
    setPaymentModelIds(((record as unknown as { payment_model_ids?: string[] } | null)?.payment_model_ids) ?? []);
    setMinGarantidoAtivo(!!(record as unknown as { minimo_garantido_ativo?: boolean } | null)?.minimo_garantido_ativo);
    setMinGarantidoValor(
      (record as unknown as { minimo_garantido_valor?: number | null } | null)?.minimo_garantido_valor != null
        ? String((record as unknown as { minimo_garantido_valor?: number }).minimo_garantido_valor)
        : "",
    );
    setMinGarantidoEscopo(
      (record as unknown as { minimo_garantido_escopo?: string | null } | null)?.minimo_garantido_escopo ?? "medico_empresa",
    );
    setMinGarantidoPeriodicidade(
      (record as unknown as { minimo_garantido_periodicidade?: string | null } | null)?.minimo_garantido_periodicidade ??
        "competencia",
    );
    setMinGarantidoBase(
      (record as unknown as { minimo_garantido_base?: string | null } | null)?.minimo_garantido_base ?? "liquido",
    );
    {
      // calculation_draft guarda o rascunho no MESMO formato do RuleCalculationsEditor
      const draft = ((record as unknown as { calculation_draft?: unknown } | null)?.calculation_draft ?? {}) as {
        items?: CalcItem[];
        fixed_value?: FixedValueDraft;
      };
      setCalcItems(Array.isArray(draft.items) && draft.items.length ? draft.items : [makeEmptyCalc()]);
      setFixedValue({ ...EMPTY_FIXED_VALUE, ...(draft.fixed_value ?? {}) });
    }
    setHasGlosa(record?.has_glosa ?? false);
    setGlosaConditions(record?.glosa_conditions ?? "");
    setUrgencyDiff(record?.urgency_differentiation ?? false);
    setUrgencyPct(record?.urgency_addition_pct != null ? String(record.urgency_addition_pct) : "");
    setWeekendAdd(record?.weekend_holiday_addition ?? false);
    setWeekendPct(
      record?.weekend_holiday_addition_pct != null ? String(record.weekend_holiday_addition_pct) : "",
    );
    setHasFixedValues(record?.has_fixed_values ?? false);
    setFixedUrgencyDiff(record?.fixed_value_urgency_differentiation ?? false);
    setExclusionsNotes(record?.exclusions_notes ?? "");
    setExtraItems(record?.extra_items ?? []);
    setFreeNotes(record?.free_notes ?? "");
    setReplicaHospitalIds([]);
    setLockedHospitalIds([]);
  }, [open, record]);

  // Hospitais já vinculados ao acordo (replicação regional)
  useEffect(() => {
    if (!open || !record?.id) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("agreement_registration_hospitals")
        .select("hospital_id,is_primary,status")
        .eq("agreement_id", record.id);
      if (cancel) return;
      if (error) {
        toast.error("Falha ao carregar hospitais do acordo");
        return;
      }
      const rows = data ?? [];
      setReplicaHospitalIds(rows.filter((r) => !r.is_primary).map((r) => r.hospital_id));
      // Já aprovado/rejeitado pelo diretor: não pode mais ser removido pelo analista
      setLockedHospitalIds(
        rows.filter((r) => !r.is_primary && r.status !== "aguardando_diretor").map((r) => r.hospital_id),
      );
    })();
    return () => {
      cancel = true;
    };
  }, [open, record?.id]);

  // PJs já vinculadas ao acordo (acordo de equipe)
  useEffect(() => {
    if (!open || !record?.id) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("agreement_registration_parties")
        .select("company_id,doctor_id")
        .eq("agreement_id", record.id);
      if (cancel) return;
      if (error) {
        toast.error("Falha ao carregar as PJs do acordo");
        return;
      }
      const rows = data ?? [];
      if (rows.length === 0) {
        setPartiesLoaded(true);
        return;
      }
      const byCompany = new Map<string, PartyDraft>();
      rows.forEach((r) => {
        const cur =
          byCompany.get(r.company_id) ??
          { key: r.company_id, companyId: r.company_id, allDoctors: false, doctorIds: [] };
        if (r.doctor_id) cur.doctorIds = [...cur.doctorIds, r.doctor_id];
        else cur.allDoctors = true;
        byCompany.set(r.company_id, cur);
      });
      setParties(Array.from(byCompany.values()));
      setMultiParty(true);
      setPartiesLoaded(true);
    })();
    return () => {
      cancel = true;
    };
  }, [open, record?.id]);

  // Acordos já cadastrados na unidade — referência para aditivo/retirada
  useEffect(() => {
    if (!open || !hospitalId) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("agreement_registrations")
        .select("id,code,company_id")
        .eq("hospital_id", hospitalId)
        .order("code", { ascending: false })
        .limit(300);
      if (cancel || error) return;
      setRelatedOptions((data ?? []).filter((r) => r.id !== record?.id) as RelatedAgreementOption[]);
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId, record?.id]);


  useEffect(() => {
    if (!open || !hospitalId) return;
    let cancel = false;
    (async () => {
      setRegistriesLoading(true);
      try {
        const [comps, convRes, hospRes, modelsRes, refRes, sctRes] = await Promise.all([
          fetchAllPaginated<CompanyOption>((from, to) =>
            supabase.from("companies").select("id,name,document,active").order("name").range(from, to),
          ),
          supabase
            .from("convenios")
            .select("slug,name")
            .or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
            .eq("active", true)
            .order("name"),
          supabase.from("hospitals").select("id,name").order("name"),
          supabase.from("payment_models").select("id,code,label").eq("active", true).order("sort_order"),
          supabase.from("reference_tables").select("id,name,purpose").order("name"),
          supabase.from("special_case_types").select("code,label").order("label"),
        ]);
        if (cancel) return;
        setCompanies(comps);
        if (convRes.error) throw convRes.error;
        setConvenios((convRes.data ?? []) as ConvenioOption[]);
        if (hospRes.error) throw hospRes.error;
        setHospitalOptions((hospRes.data ?? []) as HospitalOption[]);
        if (modelsRes.error) throw modelsRes.error;
        setPaymentModels((modelsRes.data ?? []) as PaymentModelOption[]);
        setRefTables((refRes.data ?? []) as { id: string; name: string; purpose?: string }[]);
        setSpecialCaseTypes((sctRes.data ?? []) as { code: string; label: string }[]);
      } catch (e: unknown) {
        if (!cancel) toast.error(e instanceof Error ? e.message : "Falha ao carregar cadastros");
      } finally {
        if (!cancel) setRegistriesLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId]);

  // Acordos já cadastrados: só carregados quando o comunicado é aditivo/retirada.
  useEffect(() => {
    if (!open || !hospitalId || registrationType === "novo_acordo") return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("agreement_registrations")
        .select("id,code,company_id")
        .neq("id", id ?? "00000000-0000-0000-0000-000000000000")
        .order("code", { ascending: false })
        .limit(200);
      if (cancel) return;
      if (error) {
        toast.error("Falha ao carregar acordos de referência");
        return;
      }
      setRelatedOptions((data ?? []) as RelatedAgreementOption[]);
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId, registrationType, id]);


  // Médicos vinculados à clínica selecionada (doctor_companies).
  // Busca em duas etapas e só dos ids vinculados — evita varrer a tabela inteira.
  useEffect(() => {
    if (!open || !hospitalId || !companyId) {
      setLinkedDoctors([]);
      return;
    }
    let cancel = false;
    (async () => {
      setDoctorsLoading(true);
      try {
        const { data, error } = await supabase
          .from("doctor_companies")
          .select("doctor_id")
          .eq("hospital_id", hospitalId)
          .eq("company_id", companyId);
        if (error) throw error;
        const ids = Array.from(new Set((data ?? []).map((r: { doctor_id: string }) => r.doctor_id)));
        if (cancel) return;
        if (ids.length === 0) {
          setLinkedDoctors([]);
          return;
        }
        const { data: docs, error: docsError } = await supabase
          .from("doctors")
          .select("id,full_name,crm,crm_uf")
          .in("id", ids)
          .order("full_name");
        if (docsError) throw docsError;
        if (!cancel) setLinkedDoctors((docs ?? []) as DoctorOption[]);
      } catch {
        if (!cancel) {
          toast.error("Falha ao carregar médicos vinculados à clínica");
          setLinkedDoctors([]);
        }
      } finally {
        if (!cancel) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId, companyId]);

  const company = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  // Dados mínimos da Etapa 1 para permitir exportar uma prévia do acordo
  const canExport = !!companyId && !!effectiveFrom;

  /** Monta o estado atual do formulário no modelo de exportação (Word/Excel). */
  const buildExportModel = useCallback((): AgreementExportModel => {
    const companyName = companies.find((c) => c.id === companyId)?.name ?? "Clínica não informada";
    const doctorName = (dId: string) =>
      linkedDoctors.find((d) => d.id === dId)?.full_name ?? dId;
    const hospitalName = (hId: string) => hospitalOptions.find((h) => h.id === hId)?.name ?? hId;
    const pctText = (v: string) => (numOrNull(v) != null ? `${numOrNull(v)}%` : "—");
    const yn = (b: boolean) => (b ? "Sim" : "Não");

    return {
      code: record?.code ?? "Novo acordo",
      companyName,
      statusLabel: record ? (AGREEMENT_STATUS_LABEL[record.status] ?? record.status) : "Rascunho",
      identification: [
        { label: "Código", value: record?.code ?? "(a gerar)" },
        { label: "Tipo de comunicado", value: AGREEMENT_TYPE_LABEL[registrationType] },
        { label: "Clínica (PJ)", value: companyName },
        {
          label: "Vigência",
          value: `${fmtExportDate(effectiveFrom)} a ${fmtExportDate(effectiveTo)}`,
        },
        {
          label: "Referência",
          value:
            relatedOptions.find((o) => o.id === relatedAgreementId)?.code ??
            referenceNote.trim() ??
            "—",
        },
        { label: "Hospital de origem", value: hospital?.name ?? "—" },
      ],
      scope: [
        { label: "Todos os convênios", value: yn(allConvenios) },
        {
          label: "Convênios de exceção",
          value: convenioExceptions.length ? convenioExceptions.join(", ") : "—",
        },
        { label: "Todos os médicos da PJ", value: yn(allDoctors) },
        {
          label: "Médicos de exceção",
          value: doctorExceptions.length ? doctorExceptions.map(doctorName).join(", ") : "—",
        },
        { label: "Inclui auxiliares", value: yn(includesAuxiliary) },
        { label: "Considera via de acesso", value: yn(includesAccessRoute) },
      ],
      paymentTable: [
        {
          label: "Tipo de pagamento",
          value:
            paymentModels
              .filter((m) => paymentModelIds.includes(m.id))
              .map((m) => m.label)
              .join(", ") || "—",
        },
        {
          label: "Mínimo garantido",
          value: minGarantidoAtivo ? `Sim — ${minGarantidoValor || "valor não informado"}` : "Não",
        },
        {
          label: "Método de cálculo",
          value: calcItems.map((c) => c.calculation_type).join(", ") || "—",
        },
        {
          label: "Valor fixo",
          value: fixedValue.amount
            ? `${fixedValue.amount} — ${FIXED_PERIODICITY_LABEL[fixedValue.periodicity] ?? fixedValue.periodicity}`
            : "—",
        },
        { label: "Sujeito a glosa", value: yn(hasGlosa) },
        { label: "Condições de glosa", value: glosaConditions.trim() || "—" },
        {
          label: "Diferenciação por urgência",
          value: `${yn(urgencyDiff)} ${urgencyDiff ? pctText(urgencyPct) : ""}`.trim(),
        },
        {
          label: "Adicional fim de semana/feriado",
          value: `${yn(weekendAdd)} ${weekendAdd ? pctText(weekendPct) : ""}`.trim(),
        },
        { label: "Possui valores fixos", value: yn(hasFixedValues) },
        { label: "Valores fixos com urgência diferenciada", value: yn(fixedUrgencyDiff) },
        { label: "Exclusões", value: exclusionsNotes.trim() || "—" },
      ],
      parties: multiParty
        ? parties.map((p) => ({
            company: companies.find((c) => c.id === p.companyId)?.name ?? "—",
            doctors: p.allDoctors
              ? "Todos os médicos da PJ"
              : `${p.doctorIds.length} médico(s) selecionado(s)`,
          }))
        : [{ company: companyName, doctors: allDoctors ? "Todos os médicos da PJ" : "Ver exceções" }],
      hospitals: [
        ...(hospital ? [{ id: hospital.id, primary: true }] : []),
        ...replicaHospitalIds
          .filter((h) => h !== hospital?.id)
          .map((h) => ({ id: h, primary: false })),
      ].map((h) => ({
        name: `${hospitalName(h.id)}${h.primary ? " (origem)" : ""}`,
        status: "Aguardando diretor",
        director: "—",
        approvedAt: "—",
        rule: "Pendente",
      })),
      extraItems: extraItems.map((i) => ({ label: i.label, value: i.value })),
      timeline: [],
      freeNotes: freeNotes.trim(),
    };
  }, [
    allConvenios,
    allDoctors,
    companies,
    companyId,
    convenioExceptions,
    doctorExceptions,
    effectiveFrom,
    effectiveTo,
    exclusionsNotes,
    extraItems,
    fixedUrgencyDiff,
    freeNotes,
    glosaConditions,
    hasFixedValues,
    hasGlosa,
    hospital,
    hospitalOptions,
    includesAccessRoute,
    includesAuxiliary,
    linkedDoctors,
    multiParty,
    parties,
    paymentModels,
    paymentModelIds,
    minGarantidoAtivo,
    minGarantidoValor,
    calcItems,
    fixedValue,
    record,
    referenceNote,
    registrationType,
    relatedAgreementId,
    relatedOptions,
    replicaHospitalIds,
    urgencyDiff,
    urgencyPct,
    weekendAdd,
    weekendPct,
  ]);


  const stepError = useMemo((): string | null => {
    if (step === 0) {
      if (!companyId) return "Selecione a clínica no cadastro de empresas";
      if (registrationType !== "novo_acordo" && !relatedAgreementId && !referenceNote.trim())
        return "Informe o acordo de referência (busca no sistema ou texto livre)";
      if (multiParty) {
        if (parties.length === 0) return "Adicione ao menos uma PJ ao acordo de equipe";
        if (parties.some((p) => !p.companyId)) return "Selecione a PJ em todas as linhas";
        if (parties.some((p) => !p.allDoctors && p.doctorIds.length === 0))
          return "Selecione os médicos da PJ ou marque “todos os médicos”";
        const ids = parties.map((p) => p.companyId);
        if (new Set(ids).size !== ids.length) return "Há PJ repetida na lista";
      }
      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom)
        return "Fim da vigência anterior ao início";
      return null;
    }
    if (step === 1) {
      if (!allConvenios && convenioExceptions.length === 0)
        return "Selecione ao menos um convênio";
      if (!allDoctors && doctorExceptions.length === 0) return "Selecione ao menos um médico";
      return null;
    }
    if (step === 2) {
      if (showFixedValueBlock && fixedValue.amount && numOrNull(fixedValue.amount) == null)
        return "Valor fixo inválido";
      if (showProductionBlock && calcItems.length === 0) return "Adicione ao menos um cálculo";
      if (showGlosaBlock && hasGlosa && !glosaConditions.trim())
        return "Descreva as condições de glosa";
      return null;
    }
    if (step === 3) {
      if (urgencyDiff && numOrNull(urgencyPct) == null) return "Informe o acréscimo de urgência";
      if (weekendAdd && numOrNull(weekendPct) == null)
        return "Informe o acréscimo de fim de semana/feriado";
      return null;
    }
    if (step === 4) {
      if (extraItems.some((i) => !i.label.trim())) return "Preencha o rótulo dos itens extras";
      return null;
    }
    return null;
  }, [
    step, companyId, registrationType, relatedAgreementId, referenceNote, multiParty, parties,
    effectiveFrom, effectiveTo, allConvenios, convenioExceptions, allDoctors,
    doctorExceptions, paymentModelIds, minGarantidoAtivo, minGarantidoValor, calcItems, fixedValue,
    showFixedValueBlock, showProductionBlock, showGlosaBlock,
    hasGlosa, glosaConditions, urgencyDiff,
    urgencyPct, weekendAdd, weekendPct, extraItems,
  ]);

  const buildPayload = useCallback(
    (status: string) => ({
      hospital_id: hospitalId as string,
      company_id: companyId,
      registration_type: registrationType,
      reference_note: registrationType === "novo_acordo" ? null : referenceNote.trim() || null,
      related_agreement_id: registrationType === "novo_acordo" ? null : relatedAgreementId,
      effective_from: effectiveFrom || null,
      effective_to: effectiveTo || null,

      applies_to_all_convenios: allConvenios,
      convenio_exceptions: allConvenios ? [] : convenioExceptions,
      applies_to_all_doctors: allDoctors,
      doctor_exceptions: allDoctors ? [] : doctorExceptions,
      includes_auxiliary: includesAuxiliary,
      includes_access_route: includesAccessRoute,
      payment_model_ids: paymentModelIds,
      minimo_garantido_ativo: minGarantidoAtivo,
      minimo_garantido_valor: minGarantidoAtivo ? numOrNull(minGarantidoValor) : null,
      minimo_garantido_escopo: minGarantidoAtivo ? minGarantidoEscopo : null,
      minimo_garantido_periodicidade: minGarantidoAtivo ? minGarantidoPeriodicidade : null,
      minimo_garantido_base: minGarantidoAtivo ? minGarantidoBase : null,
      // Rascunho no formato do RuleCalculationsEditor: o Analista carrega sem redigitar
      calculation_draft: {
        items: showProductionBlock ? calcItems : [],
        fixed_value: showFixedValueBlock ? fixedValue : null,
      } as unknown as Json,
      has_glosa: hasGlosa,
      glosa_conditions: hasGlosa ? glosaConditions.trim() || null : null,
      urgency_differentiation: urgencyDiff,
      urgency_addition_pct: urgencyDiff ? numOrNull(urgencyPct) : null,
      weekend_holiday_addition: weekendAdd,
      weekend_holiday_addition_pct: weekendAdd ? numOrNull(weekendPct) : null,
      has_fixed_values: hasFixedValues,
      fixed_value_urgency_differentiation: hasFixedValues ? fixedUrgencyDiff : false,
      exclusions_notes: exclusionsNotes.trim() || null,
      extra_items: extraItems.filter((i) => i.label.trim()) as unknown as Json,
      free_notes: freeNotes.trim() || null,
      status,
    }),
    [
      hospitalId, companyId, registrationType, referenceNote, relatedAgreementId,
      effectiveFrom, effectiveTo, allConvenios, convenioExceptions,
      allDoctors, doctorExceptions, includesAuxiliary, includesAccessRoute,
      paymentModelIds, minGarantidoAtivo, minGarantidoValor, minGarantidoEscopo,
      minGarantidoPeriodicidade, minGarantidoBase, calcItems, fixedValue,
      showProductionBlock, showFixedValueBlock,
      hasGlosa, glosaConditions, urgencyDiff, urgencyPct, weekendAdd,
      weekendPct, hasFixedValues, fixedUrgencyDiff, exclusionsNotes, extraItems, freeNotes,
    ],

  );

  const persist = useCallback(
    async (status: string): Promise<boolean> => {
      if (!ensure("salvar o cadastro de acordo")) return false;
      setSaving(true);
      try {
        const payload = buildPayload(status);
        let agreementId = id;
        if (agreementId) {
          const { error } = await supabase
            .from("agreement_registrations")
            .update(payload)
            .eq("id", agreementId);
          if (error) throw error;
        } else {
          const { data: userRes } = await supabase.auth.getUser();
          const { data, error } = await supabase
            .from("agreement_registrations")
            .insert({ ...payload, filled_by: userRes?.user?.id ?? null })
            .select("id")
            .single();
          if (error) throw error;
          agreementId = data.id as string;
          setId(agreementId);
        }

        // Replicação regional: o hospital principal é criado pelo banco (is_primary).
        // Aqui sincronizamos apenas os hospitais adicionais ainda aguardando diretor.
        const { data: existing, error: existingErr } = await supabase
          .from("agreement_registration_hospitals")
          .select("hospital_id,is_primary,status")
          .eq("agreement_id", agreementId);
        if (existingErr) throw existingErr;
        const current = (existing ?? []).filter((r) => !r.is_primary);
        const desired = new Set(replicaHospitalIds.filter((h) => h !== hospitalId));
        const toInsert = [...desired].filter((h) => !current.some((r) => r.hospital_id === h));
        const toRemove = current
          .filter((r) => !desired.has(r.hospital_id) && r.status === "aguardando_diretor")
          .map((r) => r.hospital_id);

        if (toInsert.length > 0) {
          const { error } = await supabase.from("agreement_registration_hospitals").insert(
            toInsert.map((h) => ({ agreement_id: agreementId as string, hospital_id: h, is_primary: false })),
          );
          if (error) throw error;
        }
        if (toRemove.length > 0) {
          const { error } = await supabase
            .from("agreement_registration_hospitals")
            .delete()
            .eq("agreement_id", agreementId)
            .in("hospital_id", toRemove);
          if (error) throw error;
        }

        // PJs do acordo de equipe: regravadas por inteiro a cada salvamento.
        // Só mexe nelas depois que as PJs existentes foram lidas do banco — salvar
        // antes disso apagaria silenciosamente as PJs já vinculadas.
        if (partiesLoaded) {
          const { error: delPartiesErr } = await supabase
            .from("agreement_registration_parties")
            .delete()
            .eq("agreement_id", agreementId);
          if (delPartiesErr) throw delPartiesErr;
          if (multiParty) {
            const rows = parties.flatMap((p) =>
              !p.companyId
                ? []
                : p.allDoctors
                  ? [{ agreement_id: agreementId as string, company_id: p.companyId, doctor_id: null }]
                  : p.doctorIds.map((d) => ({
                      agreement_id: agreementId as string,
                      company_id: p.companyId as string,
                      doctor_id: d,
                    })),
            );
            if (rows.length > 0) {
              const { error } = await supabase.from("agreement_registration_parties").insert(rows);
              if (error) throw error;
            }
          }
        }

        onSaved();
        return true;

      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar o acordo");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [buildPayload, ensure, id, onSaved, replicaHospitalIds, hospitalId, multiParty, parties, partiesLoaded],
  );


  // Acordo rejeitado sendo corrigido: os salvamentos intermediários preservam o
  // status atual — só o "concluir" dispara o reenvio (RPC) para o novo ciclo.
  const isResubmission = record?.status === "rejeitado";
  const draftStatus = isResubmission ? "rejeitado" : "rascunho";

  const goNext = async () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    const ok = await persist(draftStatus);
    if (!ok) return;
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  const finish = async () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    if (isResubmission) {
      const saved = await persist("rejeitado");
      if (!saved) return;
      const { error } = await supabase.rpc("resubmit_agreement_after_rejection", {
        p_agreement_id: record!.id,
      });
      if (error) {
        toast.error("Falha ao reenviar o acordo", { description: error.message });
        return;
      }
      onSaved();
      toast.success("Acordo corrigido e reenviado para validação do supervisor");
      onOpenChange(false);
      return;
    }
    const ok = await persist("aguardando_supervisor");
    if (!ok) return;
    toast.success("Acordo enviado para validação do supervisor");
    onOpenChange(false);
  };

  const toggleIn = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const isLast = step === STEPS.length - 1;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="3xl"
      title={record ? `Acordo ${record.code}` : "Novo acordo"}
      description={`Etapa ${step + 1} de ${STEPS.length} — ${STEPS[step]}${hospital ? ` · ${hospital.name}` : ""}`}
      footer={
        <>
          <AgreementExportButtons
            size="default"
            getModel={buildExportModel}
            disabled={!canExport || saving}
            disabledHint="Preencha a clínica e o início da vigência para exportar"
          />
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Fechar
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={saving || step === 0}
          >
            Voltar
          </Button>
          {isLast ? (
            <Button type="button" onClick={() => void finish()} disabled={saving}>
              {saving
                ? "Salvando..."
                : isResubmission
                  ? "Corrigir e reenviar ao supervisor"
                  : "Concluir e enviar ao supervisor"}
            </Button>

          ) : (
            <Button type="button" onClick={() => void goNext()} disabled={saving}>
              {saving ? "Salvando..." : "Salvar e avançar"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">

        {/* Trilha de etapas */}
        <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Etapas do acordo">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                i === step
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
              aria-pressed={i === step}
            >
              {i + 1}. {label}
            </button>
          ))}
        </nav>

        {/* Canvas do formulário: fundo suave para os cards de campos ganharem contraste */}
        <section className="rounded-xl border border-border bg-muted/40 p-3 sm:p-4">

        {/* Etapa 1 */}
        {step === 0 && (
          <div className="space-y-4">

            {/* Tipo de comunicado + referência ao acordo anterior */}
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="space-y-1.5">
                <Label>Tipo de comunicado</Label>
                <SegmentedControl
                  ariaLabel="Tipo de comunicado"
                  value={registrationType}
                  onValueChange={(v) => setRegistrationType(v as AgreementRegistrationType)}
                  options={[
                    { value: "novo_acordo", label: AGREEMENT_TYPE_LABEL.novo_acordo },
                    { value: "aditivo", label: AGREEMENT_TYPE_LABEL.aditivo },
                    { value: "retirada", label: AGREEMENT_TYPE_LABEL.retirada },
                  ]}
                />
              </div>
              {registrationType !== "novo_acordo" && (
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label>Acordo de referência cadastrado no sistema</Label>
                    <Popover open={relatedOpen} onOpenChange={setRelatedOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal"
                        >
                          {relatedAgreementId
                            ? (relatedOptions.find((o) => o.id === relatedAgreementId)?.code ??
                              "Acordo selecionado")
                            : "Buscar acordo anterior (opcional)"}
                          <ChevronsUpDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}>
                          <CommandInput placeholder="Buscar por código ou clínica" />
                          <CommandList>
                            <CommandEmpty>Nenhum acordo cadastrado encontrado</CommandEmpty>
                            <CommandGroup>
                              {relatedOptions.map((o) => {
                                const cName =
                                  companies.find((c) => c.id === o.company_id)?.name ?? "";
                                return (
                                  <CommandItem
                                    key={o.id}
                                    value={`${o.code} ${cName}`}
                                    onSelect={() => {
                                      setRelatedAgreementId(o.id === relatedAgreementId ? null : o.id);
                                      setRelatedOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        o.id === relatedAgreementId ? "opacity-100" : "opacity-0",
                                      )}
                                    />
                                    <span className="flex-1">{o.code}</span>
                                    <span className="text-xs text-muted-foreground">{cName}</span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acd-ref">Referência em texto livre (CIREL, ofício, e-mail)</Label>
                    <Textarea
                      id="acd-ref"
                      rows={2}
                      value={referenceNote}
                      onChange={(e) => setReferenceNote(e.target.value)}
                      placeholder="Ex.: CIREL 123/2024 — acordo firmado antes do sistema"
                    />
                    {/* Nem todo acordo antigo existe no sistema: texto livre é a saída válida */}
                    <p className="text-xs text-muted-foreground">
                      Informe ao menos uma das duas referências.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">

            <div className="space-y-1.5">

              <Label>Clínica / grupo médico</Label>
              <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    disabled={registriesLoading}
                  >
                    {company ? company.name : registriesLoading ? "Carregando cadastro..." : "Buscar empresa no cadastro"}
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}
                  >
                    <CommandInput placeholder="Buscar por nome ou CNPJ" />
                    <CommandList>
                      <CommandEmpty>
                        <div className="p-3 text-left text-sm space-y-2">
                          <p className="font-medium">Empresa não encontrada no cadastro</p>
                          <p className="text-muted-foreground">
                            Não é permitido texto livre. Cadastre a empresa (entra como pendente de
                            revisão do admin) e volte para selecioná-la.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => window.open("/cadastros?tab=empresas", "_blank")}
                          >
                            Abrir cadastro de empresas
                          </Button>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {companies.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.document ?? ""}`}
                            onSelect={() => {
                              setCompanyId(c.id);
                              setDoctorExceptions([]);
                              setCompanyOpen(false);
                            }}
                          >
                            <Check
                              className={cn("mr-2 h-4 w-4", c.id === companyId ? "opacity-100" : "opacity-0")}
                            />
                            <span className="flex-1">{c.name}</span>
                            {!c.active && <Badge variant="secondary" className="ml-2">Inativa</Badge>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="acd-cnpj">CNPJ</Label>
                <Input
                  id="acd-cnpj"
                  value={company?.document ? formatCNPJ(company.document) : ""}
                  readOnly
                  disabled
                  className="w-52 bg-muted/50"
                  placeholder="Preenchido pela empresa"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acd-from">Início da vigência</Label>
                <Input
                  id="acd-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acd-to">Fim da vigência</Label>
                <Input
                  id="acd-to"
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className="w-44"
                />
              </div>
            </div>

            {/* Replicação regional: acordo fechado num hospital pode valer para os demais */}
            <div className="space-y-1.5">
              <Label>Replicar para outros hospitais da regional</Label>
              <Popover open={hospitalsOpen} onOpenChange={setHospitalsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    disabled={registriesLoading}
                  >
                    {replicaHospitalIds.length > 0
                      ? `${replicaHospitalIds.length} hospital(is) adicional(is)`
                      : registriesLoading
                        ? "Carregando hospitais..."
                        : "Somente o hospital de origem"}
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}>
                    <CommandInput placeholder="Buscar hospital" />
                    <CommandList>
                      <CommandEmpty>Nenhum hospital encontrado</CommandEmpty>
                      <CommandGroup>
                        {hospitalOptions
                          .filter((h) => h.id !== hospitalId)
                          .map((h) => {
                            const locked = lockedHospitalIds.includes(h.id);
                            return (
                              <CommandItem
                                key={h.id}
                                value={h.name}
                                disabled={locked}
                                onSelect={() => {
                                  if (locked) return;
                                  toggleIn(replicaHospitalIds, h.id, setReplicaHospitalIds);
                                }}
                              >
                                <Checkbox
                                  checked={replicaHospitalIds.includes(h.id)}
                                  className="mr-2"
                                  tabIndex={-1}
                                />
                                <span className="flex-1">{h.name}</span>
                                {locked && (
                                  <Badge variant="secondary" className="ml-2">
                                    Já avaliado
                                  </Badge>
                                )}
                              </CommandItem>
                            );
                          })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="outline" className="gap-1">
                  {hospital?.name ?? "Hospital atual"} · origem
                </Badge>
                {replicaHospitalIds.map((hid) => {
                  const h = hospitalOptions.find((o) => o.id === hid);
                  const locked = lockedHospitalIds.includes(hid);
                  return (
                    <Badge key={hid} variant="secondary" className="gap-1 pl-2 pr-1">
                      {h?.name ?? hid}
                      {!locked && (
                        <button
                          type="button"
                          aria-label={`Remover ${h?.name ?? "hospital"}`}
                          onClick={() => toggleIn(replicaHospitalIds, hid, setReplicaHospitalIds)}
                          className="rounded p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Cada hospital adicional entra como “aguardando diretor” e gera sua própria cópia da regra
                após a aprovação.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Responsável pelo preenchimento: usuário logado (gravado em <code>filled_by</code>).
            </p>
            </div>

            {/* Acordo de equipe: várias PJs, cada uma com seus médicos */}
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <BoolField
                label="Este acordo envolve mais de uma PJ"
                value={multiParty}
                onChange={(v) => {
                  setMultiParty(v);
                  if (v && parties.length === 0)
                    setParties([
                      {
                        key: crypto.randomUUID(),
                        companyId: companyId,
                        allDoctors: true,
                        doctorIds: [],
                      },
                    ]);
                }}
              />
              {multiParty && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A clínica acima segue como PJ principal do acordo. Liste aqui todas as PJs
                    envolvidas e, em cada uma, se vale para todos os médicos ou apenas para alguns.
                  </p>
                  {parties.map((p, idx) => (
                    <PartyRow
                      key={p.key}
                      index={idx}
                      party={p}
                      companies={companies}
                      hospitalId={hospitalId}
                      onChange={(next) =>
                        setParties((list) => list.map((x) => (x.key === p.key ? next : x)))
                      }
                      onRemove={() => setParties((list) => list.filter((x) => x.key !== p.key))}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setParties((list) => [
                        ...list,
                        { key: crypto.randomUUID(), companyId: null, allDoctors: true, doctorIds: [] },
                      ])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Adicionar PJ
                  </Button>
                </div>
              )}
            </div>

            {/* Tabelas de códigos/valores recebidas pelo Contratos */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <AgreementAttachmentsPanel agreementId={id} />
            </div>
          </div>

        )}


        {/* Etapa 2 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Aplica-se a todos os convênios"
                value={allConvenios}
                onChange={setAllConvenios}
              />
              {!allConvenios && (
                <MultiPicker
                  emptyLabel="Nenhum convênio ativo nesta unidade"
                  options={convenios.map((c) => ({ id: c.slug, label: c.name }))}
                  selected={convenioExceptions}
                  onToggle={(v) => toggleIn(convenioExceptions, v, setConvenioExceptions)}
                  onClear={() => setConvenioExceptions([])}
                />
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Aplica-se a todos os médicos da clínica"
                value={allDoctors}
                onChange={setAllDoctors}
              />
              {!allDoctors && (
                <MultiPicker
                  emptyLabel={
                    doctorsLoading
                      ? "Carregando médicos da clínica..."
                      : "Nenhum médico vinculado a esta clínica (doctor_companies)"
                  }
                  options={linkedDoctors.map((d) => ({
                    id: d.id,
                    label: `${d.full_name}${d.crm ? ` — CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : ""}`,
                  }))}
                  selected={doctorExceptions}
                  onToggle={(v) => toggleIn(doctorExceptions, v, setDoctorExceptions)}
                  onClear={() => setDoctorExceptions([])}
                />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <BoolField
                  label="Inclusão de auxiliar"
                  value={includesAuxiliary}
                  onChange={setIncludesAuxiliary}
                />
              </div>
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <BoolField
                  label="Inclusão de via de acesso"
                  value={includesAccessRoute}
                  onChange={setIncludesAccessRoute}
                />
              </div>
            </div>
          </div>
        )}


        {/* Etapa 3 — Cálculo de Pagamento (condicional ao tipo de pagamento) */}
        {step === 2 && (
          <div className="space-y-4">
            {paymentModelIds.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                Selecione o tipo de pagamento na etapa “Identificação” para configurar o cálculo.
              </div>
            )}

            {showFixedValueBlock && (
              <section className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Valor fixo</h3>
                  <p className="text-xs text-muted-foreground">
                    Contrato de gestão/coordenação: valor combinado, sem cálculo por produção.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="acd-fx-valor">Valor do repasse (R$)</Label>
                    <Input
                      id="acd-fx-valor"
                      inputMode="decimal"
                      value={fixedValue.amount}
                      onChange={(e) => setFixedValue((f) => ({ ...f, amount: e.target.value }))}
                      className="text-right tabular-nums"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acd-fx-parc">Número de repasses</Label>
                    <Input
                      id="acd-fx-parc"
                      inputMode="numeric"
                      value={fixedValue.installments}
                      onChange={(e) =>
                        setFixedValue((f) => ({ ...f, installments: e.target.value }))
                      }
                      className="text-right tabular-nums"
                      placeholder="Deixe vazio se por prazo indeterminado"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Periodicidade</Label>
                    <Select
                      value={fixedValue.periodicity}
                      onValueChange={(v) => setFixedValue((f) => ({ ...f, periodicity: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FIXED_PERIODICITY_LABEL).map(([v, label]) => (
                          <SelectItem key={v} value={v}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            )}

            {showProductionBlock && (
              <section className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Cálculo de Pagamento</h3>
                  <p className="text-xs text-muted-foreground">
                    Mesmo motor da tela de Regras. O que for preenchido aqui chega pronto para o
                    Analista de Cadastro de Regras, sem redigitação.
                  </p>
                </div>
                <RuleCalculationsEditor
                  value={calcItems.length ? calcItems : [makeEmptyCalc()]}
                  onChange={setCalcItems}
                  refTables={refTables}
                  specialCaseTypes={specialCaseTypes}
                  paymentTypes={paymentTypesList.filter(
                    (p: { origin?: string }) => p.origin !== "payment_model",
                  )}
                  enabled={true}
                />
              </section>
            )}

            {showGlosaBlock && (
              <section className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
                <BoolField
                  label="Aplicar desconto de glosa?"
                  value={hasGlosa}
                  onChange={setHasGlosa}
                />
                {hasGlosa && (
                  <div className="space-y-1.5">
                    <Label htmlFor="acd-glosa">Condições de glosa</Label>
                    <Textarea
                      id="acd-glosa"
                      rows={3}
                      value={glosaConditions}
                      onChange={(e) => setGlosaConditions(e.target.value)}
                      placeholder="Em que hipóteses a glosa é repassada à clínica"
                    />
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* Etapa 4 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Diferenciação por urgência/emergência"
                value={urgencyDiff}
                onChange={setUrgencyDiff}
              />
              {urgencyDiff && (
                <div className="space-y-1.5">
                  <Label htmlFor="acd-urg">Acréscimo de urgência (%)</Label>
                  <Input
                    id="acd-urg"
                    inputMode="decimal"
                    value={urgencyPct}
                    onChange={(e) => setUrgencyPct(e.target.value)}
                    className="w-28 text-right tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Acréscimo fim de semana/feriado"
                value={weekendAdd}
                onChange={setWeekendAdd}
              />
              {weekendAdd && (
                <div className="space-y-1.5">
                  <Label htmlFor="acd-fds">Acréscimo fim de semana/feriado (%)</Label>
                  <Input
                    id="acd-fds"
                    inputMode="decimal"
                    value={weekendPct}
                    onChange={(e) => setWeekendPct(e.target.value)}
                    className="w-28 text-right tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField label="Há valores fixos" value={hasFixedValues} onChange={setHasFixedValues} />
              {hasFixedValues && (
                <BoolField
                  label="Valor fixo com diferenciação por urgência"
                  value={fixedUrgencyDiff}
                  onChange={setFixedUrgencyDiff}
                />
              )}
            </div>

            <div className="space-y-1.5 rounded-lg border border-border bg-card p-4 shadow-sm">

              <Label htmlFor="acd-exc">Exclusões / exceções</Label>
              <Textarea
                id="acd-exc"
                rows={4}
                value={exclusionsNotes}
                onChange={(e) => setExclusionsNotes(e.target.value)}
                placeholder="Procedimentos, códigos ou situações fora do acordo"
              />
            </div>
          </div>
        )}

        {/* Etapa 5 */}
        {step === 4 && (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            {extraItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nenhum item extra. Use o botão abaixo para adicionar pares rótulo/valor.
              </div>
            )}
            {extraItems.map((item, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <Label htmlFor={`acd-extra-l-${idx}`}>Rótulo</Label>
                  <Input
                    id={`acd-extra-l-${idx}`}
                    value={item.label}
                    onChange={(e) =>
                      setExtraItems((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, label: e.target.value } : it)),
                      )
                    }
                    placeholder="Ex.: Taxa de sala"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`acd-extra-v-${idx}`}>Valor</Label>
                  <Input
                    id={`acd-extra-v-${idx}`}
                    value={item.value}
                    onChange={(e) =>
                      setExtraItems((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it)),
                      )
                    }
                    className="w-40"
                    placeholder="Ex.: R$ 500,00"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setExtraItems((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Remover item extra"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExtraItems((prev) => [...prev, { label: "", value: "" }])}
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar item
            </Button>
          </div>
        )}

        {/* Etapa 6 */}
        {step === 5 && (
          <div className="space-y-1.5 rounded-lg border border-border bg-card p-4 shadow-sm">

            <Label htmlFor="acd-notes">Observações livres</Label>
            <Textarea
              id="acd-notes"
              rows={8}
              value={freeNotes}
              onChange={(e) => setFreeNotes(e.target.value)}
              placeholder="Qualquer condição acordada que não coube nos campos acima"
            />
            <p className="text-xs text-muted-foreground">
              Ao concluir, o registro passa para <strong>Aguardando supervisor</strong> e deixa de ser
              rascunho.
            </p>
          </div>
        )}

        </section>

        {stepError && <p className="text-xs text-destructive">{stepError}</p>}
      </div>
    </FormDialog>
  );
}

// Seletor múltiplo simples com busca — usado em convênios e médicos.
function MultiPicker({
  options,
  selected,
  onToggle,
  onClear,
  emptyLabel,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = norm(q);
    return n ? options.filter((o) => norm(o.label).includes(n)) : options;
  }, [options, q]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          className="flex-1 min-w-[200px]"
        />
        <Badge variant="secondary">{selected.length} selecionado(s)</Badge>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ScrollArea className="h-52 rounded-lg border border-border">
          <div className="p-2 space-y-1">
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60 cursor-pointer"
              >
                <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
                <span>{o.label}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">Nada encontrado para "{q}"</p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// Campo booleano com rótulos "Não | Sim" sempre visíveis.
// Switch puro obrigava o usuário a inferir o estado pela posição/cor.
function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <SegmentedControl
        ariaLabel={label}
        value={value ? "sim" : "nao"}
        onValueChange={(v) => onChange(v === "sim")}
        options={[
          { value: "nao", label: "Não" },
          { value: "sim", label: "Sim" },
        ]}
      />
    </div>
  );
}

// Linha de PJ do acordo de equipe: empresa + "todos os médicos" ou lista específica.
// Carrega os médicos apenas da PJ escolhida (doctor_companies) para não varrer o cadastro.
function PartyRow({
  index,
  party,
  companies,
  hospitalId,
  onChange,
  onRemove,
}: {
  index: number;
  party: PartyDraft;
  companies: CompanyOption[];
  hospitalId: string | null;
  onChange: (next: PartyDraft) => void;
  onRemove: () => void;
}) {
  const [companyOpen, setCompanyOpen] = useState(false);
  const [doctorsOpen, setDoctorsOpen] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const company = companies.find((c) => c.id === party.companyId) ?? null;

  useEffect(() => {
    if (!hospitalId || !party.companyId) {
      setDoctors([]);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("doctor_companies")
          .select("doctor_id")
          .eq("hospital_id", hospitalId)
          .eq("company_id", party.companyId);
        if (error) throw error;
        const ids = Array.from(new Set((data ?? []).map((r: { doctor_id: string }) => r.doctor_id)));
        if (cancel) return;
        if (ids.length === 0) {
          setDoctors([]);
          return;
        }
        const { data: docs, error: docsError } = await supabase
          .from("doctors")
          .select("id,full_name,crm,crm_uf")
          .in("id", ids)
          .order("full_name");
        if (docsError) throw docsError;
        if (!cancel) setDoctors((docs ?? []) as DoctorOption[]);
      } catch {
        if (!cancel) {
          toast.error("Falha ao carregar médicos da PJ");
          setDoctors([]);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [hospitalId, party.companyId]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">PJ {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remover PJ">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between bg-background font-normal">
            {company ? company.name : "Buscar PJ no cadastro"}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}>
            <CommandInput placeholder="Buscar por nome ou CNPJ" />
            <CommandList>
              <CommandEmpty>Empresa não encontrada no cadastro</CommandEmpty>
              <CommandGroup>
                {companies.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.name} ${c.document ?? ""}`}
                    onSelect={() => {
                      onChange({ ...party, companyId: c.id, doctorIds: [] });
                      setCompanyOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", c.id === party.companyId ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{c.name}</span>
                    {!c.active && <Badge variant="secondary" className="ml-2">Inativa</Badge>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <BoolField
        label="Todos os médicos dessa PJ"
        value={party.allDoctors}
        onChange={(v) => onChange({ ...party, allDoctors: v, doctorIds: v ? [] : party.doctorIds })}
      />

      {!party.allDoctors && (
        <div className="space-y-1.5">
          <Popover open={doctorsOpen} onOpenChange={setDoctorsOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" role="combobox" className="w-full justify-between bg-background font-normal">
                {party.doctorIds.length > 0
                  ? `${party.doctorIds.length} médico(s) selecionado(s)`
                  : loading
                    ? "Carregando médicos da PJ..."
                    : "Selecionar médicos"}
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}>
                <CommandInput placeholder="Buscar médico" />
                <CommandList>
                  <CommandEmpty>
                    {loading ? "Carregando..." : "Nenhum médico vinculado a esta PJ"}
                  </CommandEmpty>
                  <CommandGroup>
                    {doctors.map((d) => {
                      const checked = party.doctorIds.includes(d.id);
                      return (
                        <CommandItem
                          key={d.id}
                          value={`${d.full_name} ${d.crm ?? ""}`}
                          onSelect={() =>
                            onChange({
                              ...party,
                              doctorIds: checked
                                ? party.doctorIds.filter((x) => x !== d.id)
                                : [...party.doctorIds, d.id],
                            })
                          }
                        >
                          <Checkbox checked={checked} className="mr-2" tabIndex={-1} />
                          <span className="flex-1">{d.full_name}</span>
                          {d.crm && (
                            <span className="text-xs text-muted-foreground">
                              CRM {d.crm}
                              {d.crm_uf ? `/${d.crm_uf}` : ""}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <div className="flex flex-wrap gap-1.5">
            {party.doctorIds.map((did) => {
              const d = doctors.find((x) => x.id === did);
              return (
                <Badge key={did} variant="secondary" className="gap-1 pl-2 pr-1">
                  {d?.full_name ?? did}
                  <button
                    type="button"
                    aria-label={`Remover ${d?.full_name ?? "médico"}`}
                    onClick={() =>
                      onChange({ ...party, doctorIds: party.doctorIds.filter((x) => x !== did) })
                    }
                    className="rounded p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
