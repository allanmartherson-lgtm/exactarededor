import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  TONE_CLASSES,
  type RuleSeverity, type RuleScope, type RuleSector, type RuleTargetType, type RuleType,
  RULE_SCOPE_LABELS, RULE_SECTOR_LABELS, RULE_TARGET_TYPE_LABELS,
  RULE_TYPE_LABELS,
  formatCurrency, PAYMENT_TYPE_LABELS, type PaymentType,
} from "@/lib/status";
import {
  RULE_CALCULATION_TYPE_LABELS, RULE_CALCULATION_TYPE_DESCRIPTIONS,
  type RuleCalculationType,
} from "@/lib/status";
import { Plus, Sparkles, Trash2, Upload, FileText, Filter, ChevronDown, ChevronRight, Search, Pencil, AlertTriangle, Wand2, X, BadgeDollarSign } from "lucide-react";
import * as XLSX from "xlsx";
import { MultiSelectChips, DoctorsEditor } from "@/components/MultiSelectChips";
import { COMMON_SPECIALTIES } from "@/lib/specialties";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { recordAudit, buildDiff } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";

const sevTone: Record<RuleSeverity, keyof typeof TONE_CLASSES> = { info: "info", aviso: "warning", bloqueio: "destructive" };

type PaymentTerm = "qualquer" | "prioridade" | "habitual";
const PAYMENT_TERM_LABELS: Record<PaymentTerm, string> = {
  qualquer: "Qualquer prazo", prioridade: "Empresa Prioridade", habitual: "Prazo Habitual",
};
const PAYMENT_TYPE_KEYS: PaymentType[] = ["producao", "remessa", "valor_fixo", "plantao"];

type TimeMode = "qualquer" | "comercial" | "fora_comercial" | "fim_de_semana" | "feriado" | "personalizado";
const TIME_MODE_LABELS: Record<TimeMode, string> = {
  qualquer: "Qualquer dia/horário (livre)",
  comercial: "Horário comercial (seg–sex 07–19h)",
  fora_comercial: "Fora do horário comercial",
  fim_de_semana: "Fim de semana (sáb/dom)",
  feriado: "Apenas feriados",
  personalizado: "Personalizado (escolher dias/horas)",
};
type ElectiveMode = "qualquer" | "eletiva" | "urgencia";
const ELECTIVE_MODE_LABELS: Record<ElectiveMode, string> = {
  qualquer: "Qualquer (eletiva ou urgência)",
  eletiva: "Apenas eletivas",
  urgencia: "Apenas urgência/emergência",
};
const WEEKDAY_LABELS: { v: number; label: string }[] = [
  { v: 0, label: "Dom" }, { v: 1, label: "Seg" }, { v: 2, label: "Ter" },
  { v: 3, label: "Qua" }, { v: 4, label: "Qui" }, { v: 5, label: "Sex" }, { v: 6, label: "Sáb" },
];

type RuleRow = any;
type DraftRule = {
  enabled: boolean;
  name: string; description: string; rule_text: string;
  severity: RuleSeverity; scope: RuleScope; sector: RuleSector;
  target_type: RuleTargetType | null; target_identifier: string | null; target_name: string | null;
  rule_type: RuleType;
  calculation_type: RuleCalculationType;
  convenio_percentage: number | null;
  fixed_amount: number | null;
  extras_codes: string[];
  package_amount: number | null; bonus_amount: number | null; bonus_pct: number | null;
  target_amount: number | null; multiplier: number | null; deflator_pct: number | null;
  reference_table_id: string | null; procedure_codes: string[];
  payment_term: PaymentTerm; applies_payment_types: PaymentType[];
  sectors: string[]; specialties: string[];
  valid_from: string | null; valid_until: string | null;
  doctors: { name: string; crm?: string }[];
};

/**
 * Mapeia rule_type legado → calculation_type (motor novo).
 * Mesma lógica da migração SQL — usado quando a IA importa regras no formato antigo.
 */
const inferCalculationType = (ruleType: RuleType): RuleCalculationType => {
  switch (ruleType) {
    case "pacote":              return "pacote";
    case "tabela_diferenciada": return "tabela_diferenciada";
    case "bonus":               return "bonus";
    case "complemento":         return "complemento";
    case "informativo":         return "informativo";
  }
};

/** Deriva o `rule_type` (legado) a partir do `calculation_type` (novo motor). */
const deriveRuleType = (calc: RuleCalculationType): RuleType => {
  switch (calc) {
    case "pacote":
    case "pacote_fechado":
    case "pacote_com_extras":
    case "pacote_por_atendimento": return "pacote";
    case "tabela_diferenciada":    return "tabela_diferenciada";
    case "bonus":                  return "bonus";
    case "complemento":            return "complemento";
    default:                       return "informativo";
  }
};

/** Métodos exibidos quando a Natureza = Calculável. */
const CALCULABLE_METHODS: RuleCalculationType[] = [
  "percentual_sobre_convenio",
  "regra_vias",
  "pacote",
  "valor_fixo",
  "tabela_diferenciada",
  "bonus",
  "complemento",
  "exclusao",
];

const num = (v: any): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};

// Campos "novos" que toda regra deve ter preenchidos. Quando adicionar um novo campo,
// inclua aqui para o sistema cobrar atualização nas regras antigas.
const REQUIRED_NEW_FIELDS: { key: string; label: string; isMissing: (r: RuleRow) => boolean }[] = [
  { key: "payment_term", label: "Prazo de pagamento", isMissing: (r) => !r.payment_term || r.payment_term === "qualquer" ? false : false }, // tem default 'qualquer', considere preenchido
  { key: "applies_payment_types", label: "Tipos de pagamento aplicáveis", isMissing: (r) => !r.applies_payment_types || r.applies_payment_types.length === 0 },
  { key: "sectors", label: "Setores (multi)", isMissing: (r) => !Array.isArray(r.sectors) || r.sectors.length === 0 },
];
// regra fica "incompleta" se faltar QUALQUER campo novo de fato exigido
const isIncomplete = (r: RuleRow) => REQUIRED_NEW_FIELDS.some((f) => f.isMissing(r));
const missingFields = (r: RuleRow) => REQUIRED_NEW_FIELDS.filter((f) => f.isMissing(r)).map((f) => f.label);

const Rules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [refTables, setRefTables] = useState<{ id: string; name: string }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; document: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // form state (compartilhado entre Novo/Editar)
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fRuleText, setFRuleText] = useState("");
  const [fSeverity, setFSeverity] = useState<RuleSeverity>("aviso");
  const [fSector, setFSector] = useState<RuleSector>("outro");
  const [scope, setScope] = useState<RuleScope>("master");
  const [targetType, setTargetType] = useState<RuleTargetType>("medico");
  const [fTargetIdentifier, setFTargetIdentifier] = useState("");
  const [fTargetName, setFTargetName] = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("informativo");
  // Nova abordagem: Natureza da regra (Calculável vs Informativa/bloqueio)
  const [fNature, setFNature] = useState<"calculavel" | "informativo">("informativo");
  // === Novo motor (Fase 4) ===
  const [fCalculationType, setFCalculationType] = useState<RuleCalculationType>("informativo");
  const [fConvenioPct, setFConvenioPct] = useState<string>("");
  const [fFixedAmount, setFFixedAmount] = useState<string>("");
  const [fExtrasCodes, setFExtrasCodes] = useState<string>("");
  const [refTableId, setRefTableId] = useState<string>("");
  const [codesInput, setCodesInput] = useState<string>("");
  const [paymentTerm, setPaymentTerm] = useState<PaymentTerm>("qualquer");
  const [appliesTypes, setAppliesTypes] = useState<PaymentType[]>([]);
  const [fPackageAmount, setFPackageAmount] = useState<string>("");
  const [fBonusAmount, setFBonusAmount] = useState<string>("");
  const [fBonusPct, setFBonusPct] = useState<string>("");
  const [fTargetAmount, setFTargetAmount] = useState<string>("");
  const [fMultiplier, setFMultiplier] = useState<string>("");
  const [fDeflatorPct, setFDeflatorPct] = useState<string>("");
  const [fIncludeAux, setFIncludeAux] = useState(false);
  const [fAuxPct, setFAuxPct] = useState<string>("");
  const [fAuxFirstPct, setFAuxFirstPct] = useState<string>("30");
  const [fAuxSecondPct, setFAuxSecondPct] = useState<string>("20");
  const [fInstrumentadorPct, setFInstrumentadorPct] = useState<string>("10");
  const [fRepassePct, setFRepassePct] = useState<string>("");
  const [fApplyAccessRoute, setFApplyAccessRoute] = useState(false);
  // === Configuração de pacote (subtipos) ===
  const [fPackageMainCode, setFPackageMainCode] = useState<string>("");
  const [fPackageIncludedCodes, setFPackageIncludedCodes] = useState<string>("");
  const [fPackageVisitsCount, setFPackageVisitsCount] = useState(false);
  const [fPackageOpinionsCount, setFPackageOpinionsCount] = useState(false);
  const [fPackageAuxIncluded, setFPackageAuxIncluded] = useState(true);
  const [fPackageSubtype, setFPackageSubtype] = useState<"fechado" | "com_extras">("fechado");
  // === Configuração de exclusão / não pagar ===
  const [fExclusionReason, setFExclusionReason] = useState<string>("");
  const [fAllowsAuthorizedException, setFAllowsAuthorizedException] = useState(false);
  // novos campos: setores multi, especialidades, vigência, médicos
  const [fSectors, setFSectors] = useState<string[]>([]);
  const [fSpecialties, setFSpecialties] = useState<string[]>([]);
  const [fValidFrom, setFValidFrom] = useState<string>("");
  const [fValidUntil, setFValidUntil] = useState<string>("");
  const [fDoctors, setFDoctors] = useState<{ name: string; crm?: string }[]>([]);
  // Escopo "grupo" (inline na regra)
  const [fGroupCompanyIds, setFGroupCompanyIds] = useState<string[]>([]);
  const [fGroupDoctors, setFGroupDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [fGroupMode, setFGroupMode] = useState<"empresa" | "medico">("empresa");
  // Novo modelo: vínculos por empresa em linhas (cada linha = empresa + médicos opcionais).
  const [fGroupLinks, setFGroupLinks] = useState<{ company_id: string; doctors: { name: string; crm?: string }[] }[]>([]);
  // Sugestões de médicos por empresa (mapa company_id → médicos encontrados em payment_items).
  const [companyDoctorsMap, setCompanyDoctorsMap] = useState<Record<string, { name: string; crm?: string }[]>>({});
  const [loadingCompanyDoctorsIds, setLoadingCompanyDoctorsIds] = useState<Set<string>>(new Set());
  // (legado) Sugestões de médicos para o modo "empresa" agregado.
  const [companyDoctors, setCompanyDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [loadingCompanyDoctors, setLoadingCompanyDoctors] = useState(false);
  // janela temporal
  const [fTimeMode, setFTimeMode] = useState<TimeMode>("qualquer");
  const [fWeekdays, setFWeekdays] = useState<number[]>([]);
  const [fIncludesHolidays, setFIncludesHolidays] = useState(false);
  const [fTimeStart, setFTimeStart] = useState<string>("");
  const [fTimeEnd, setFTimeEnd] = useState<string>("");
  const [fElectiveMode, setFElectiveMode] = useState<ElectiveMode>("qualquer");

  // Persistência das seções abertas do accordion (lembra entre aberturas do modal)
  const ACCORDION_STORAGE_KEY = "rules.form.accordion.v1";
  const [accordionValue, setAccordionValue] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["identificacao"];
    try {
      const raw = window.localStorage.getItem(ACCORDION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : ["identificacao"];
    } catch { return ["identificacao"]; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify(accordionValue)); } catch {}
  }, [accordionValue]);

  const parsedCodes = useMemo(
    () => codesInput.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean),
    [codesInput]
  );

  // Erros por seção do formulário (feedback visual + auto-abrir seção com erro)
  const sectionErrors = useMemo(() => {
    const e: Record<string, number> = { identificacao: 0, aplicacao: 0, condicoes: 0, calculo: 0, codigos: 0 };
    if (!fName.trim()) e.identificacao++;
    if (!fRuleText.trim()) e.identificacao++;
    if (fValidFrom && fValidUntil && fValidFrom > fValidUntil) e.identificacao++;
    if (scope === "especifica") {
      if (!fTargetIdentifier && !fTargetName) e.aplicacao++;
      if (targetType === "empresa" && fTargetIdentifier && !isValidCNPJ(fTargetIdentifier)) e.aplicacao++;
    }
    if (scope === "grupo") {
      if (fGroupMode === "empresa" && fGroupCompanyIds.length === 0) e.aplicacao++;
      if (fGroupMode === "medico" && fGroupDoctors.length === 0) e.aplicacao++;
      // Coerência: médicos selecionados manualmente devem pertencer à(s) empresa(s).
      if (fGroupMode === "empresa" && fGroupDoctors.length > 0 && companyDoctors.length > 0) {
        const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const allowed = new Set(companyDoctors.map((d) => norm(d.name)));
        const invalid = fGroupDoctors.some((d) => !allowed.has(norm(d.name)));
        if (invalid) e.aplicacao++;
      }
    }
    if (fTimeStart && fTimeEnd && fTimeStart === fTimeEnd) e.condicoes++;
    if (fNature === "calculavel") {
      if (fCalculationType === "percentual_sobre_convenio" && !fConvenioPct) e.calculo++;
      if (fCalculationType === "valor_fixo" && !fFixedAmount) e.calculo++;
    }
    return e;
  }, [
    fName, fRuleText, fValidFrom, fValidUntil, scope, fTargetIdentifier, fTargetName,
    targetType, fGroupMode, fGroupCompanyIds, fGroupDoctors, fTimeStart, fTimeEnd,
    fNature, fCalculationType, fConvenioPct, fFixedAmount,
  ]);

  // bulk update
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPaymentTerm, setBulkPaymentTerm] = useState<PaymentTerm | "">("");
  const [bulkAppliesTypes, setBulkAppliesTypes] = useState<PaymentType[]>([]);
  const [bulkRefTableId, setBulkRefTableId] = useState<string>("");

  // filters
  const [filterScope, setFilterScope] = useState<"todos" | RuleScope>("todos");
  const [filterSector, setFilterSector] = useState<"todos" | RuleSector>("todos");
  const [filterType, setFilterType] = useState<"todos" | RuleType>("todos");
  const [filterTarget, setFilterTarget] = useState("");
  const [filterCompany, setFilterCompany] = useState<CompanyOption | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = () => supabase.from("rules").select("*").order("created_at", { ascending: false }).then(({ data }) => setRules(data ?? []));
  const loadRefs = () => supabase.from("reference_tables").select("id,name").order("name").then(({ data }) => setRefTables((data ?? []) as any));
  const loadCompanies = () => supabase.from("companies").select("id,name,document").order("name").then(({ data }) => setCompanies((data ?? []) as any));
  useEffect(() => { document.title = "Regras | MedPay"; load(); loadRefs(); loadCompanies(); }, []);

  // Carrega médicos relacionados às empresas selecionadas (a partir de payment_items).
  useEffect(() => {
    if (scope !== "grupo" || fGroupMode !== "empresa" || fGroupCompanyIds.length === 0) {
      setCompanyDoctors([]);
      return;
    }
    let cancelled = false;
    setLoadingCompanyDoctors(true);
    supabase
      .from("payment_items")
      .select("doctor_name, doctor_document")
      .in("company_id", fGroupCompanyIds)
      .not("doctor_name", "is", null)
      .limit(2000)
      .then(({ data }) => {
        if (cancelled) return;
        const seen = new Map<string, { name: string; crm?: string }>();
        for (const r of (data ?? []) as any[]) {
          const name = String(r.doctor_name ?? "").trim();
          if (!name) continue;
          const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (!seen.has(key)) seen.set(key, { name, crm: r.doctor_document ?? undefined });
        }
        setCompanyDoctors(Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .then(() => { if (!cancelled) setLoadingCompanyDoctors(false); });
    return () => { cancelled = true; };
  }, [scope, fGroupMode, fGroupCompanyIds]);


  const resetForm = () => {
    setEditingId(null);
    setFName(""); setFDescription(""); setFRuleText("");
    setFSeverity("aviso"); setFSector("outro");
    setScope("master"); setTargetType("medico");
    setFTargetIdentifier(""); setFTargetName("");
    setRuleType("informativo"); setRefTableId(""); setCodesInput("");
    setFCalculationType("informativo"); setFConvenioPct(""); setFFixedAmount(""); setFExtrasCodes("");
    setFNature("informativo");
    setPaymentTerm("qualquer"); setAppliesTypes([]);
    setFPackageAmount(""); setFBonusAmount(""); setFBonusPct(""); setFTargetAmount("");
    setFMultiplier(""); setFDeflatorPct(""); setFIncludeAux(false); setFAuxPct("");
    setFAuxFirstPct("30"); setFAuxSecondPct("20"); setFInstrumentadorPct("10");
    setFRepassePct(""); setFApplyAccessRoute(false);
    setFPackageMainCode(""); setFPackageIncludedCodes("");
    setFPackageVisitsCount(false); setFPackageOpinionsCount(false); setFPackageAuxIncluded(true);
    setFPackageSubtype("fechado");
    setFExclusionReason("");
    setFAllowsAuthorizedException(false);
    setFSectors([]); setFSpecialties([]); setFValidFrom(""); setFValidUntil(""); setFDoctors([]);
    setFGroupCompanyIds([]); setFGroupDoctors([]); setFGroupMode("empresa");
    setFTimeMode("qualquer"); setFWeekdays([]); setFIncludesHolidays(false);
    setFTimeStart(""); setFTimeEnd(""); setFElectiveMode("qualquer");
  };

  const openEdit = (r: RuleRow) => {
    setEditingId(r.id);
    setFName(r.name ?? ""); setFDescription(r.description ?? ""); setFRuleText(r.rule_text ?? "");
    setFSeverity(r.severity ?? "aviso"); setFSector(r.sector ?? "outro");
    setScope(r.scope ?? "master"); setTargetType((r.target_type as RuleTargetType) ?? "medico");
    setFTargetIdentifier(r.target_identifier ?? ""); setFTargetName(r.target_name ?? "");
    setRuleType((r.rule_type as RuleType) ?? "informativo");
    const calc = (r.calculation_type as RuleCalculationType) ?? inferCalculationType((r.rule_type as RuleType) ?? "informativo");
    setFCalculationType(calc);
    setFNature(calc === "informativo" ? "informativo" : "calculavel");
    setFConvenioPct(r.convenio_percentage != null ? String(r.convenio_percentage) : "");
    setFFixedAmount(r.fixed_amount != null ? String(r.fixed_amount) : "");
    setFExtrasCodes(Array.isArray(r.extras_codes) ? r.extras_codes.join(", ") : "");
    setRefTableId(r.reference_table_id ?? "");
    setCodesInput(Array.isArray(r.procedure_codes) ? r.procedure_codes.join(", ") : "");
    setPaymentTerm((r.payment_term as PaymentTerm) ?? "qualquer");
    setAppliesTypes(Array.isArray(r.applies_payment_types) ? r.applies_payment_types : []);
    setFPackageAmount(r.package_amount != null ? String(r.package_amount) : "");
    setFBonusAmount(r.bonus_amount != null ? String(r.bonus_amount) : "");
    setFBonusPct(r.bonus_pct != null ? String(r.bonus_pct) : "");
    setFTargetAmount(r.target_amount != null ? String(r.target_amount) : "");
    setFMultiplier(r.multiplier != null ? String(r.multiplier) : "");
    setFDeflatorPct(r.deflator_pct != null ? String(r.deflator_pct) : "");
    setFIncludeAux(!!r.include_auxiliaries);
    setFAuxPct(r.auxiliary_pct != null ? String(r.auxiliary_pct) : "");
    setFAuxFirstPct(r.aux_first_pct != null ? String(r.aux_first_pct) : "30");
    setFAuxSecondPct(r.aux_second_pct != null ? String(r.aux_second_pct) : "20");
    setFInstrumentadorPct(r.instrumentador_pct != null ? String(r.instrumentador_pct) : "10");
    setFRepassePct(r.repasse_pct != null ? String(r.repasse_pct) : "");
    setFApplyAccessRoute(!!r.apply_access_route);
    setFPackageMainCode(r.package_main_code ?? "");
    setFPackageIncludedCodes(Array.isArray(r.package_included_codes) ? r.package_included_codes.join(", ") : "");
    setFPackageVisitsCount(!!r.package_visits_count);
    setFPackageOpinionsCount(!!r.package_opinions_count);
    setFPackageAuxIncluded(r.package_auxiliaries_included !== false);
    // Subtipo do pacote: usa coluna dedicada e cai para mapeamento legado.
    const legacySubtype: "fechado" | "com_extras" =
      r.package_subtype === "com_extras" ? "com_extras"
      : r.package_subtype === "fechado" ? "fechado"
      : (r.calculation_type === "pacote_com_extras" ? "com_extras" : "fechado");
    setFPackageSubtype(legacySubtype);
    setFExclusionReason(r.exclusion_reason ?? "");
    setFAllowsAuthorizedException(!!r.allows_authorized_exception);
    setFSectors(Array.isArray(r.sectors) ? r.sectors : (r.sector ? [r.sector] : []));
    setFSpecialties(Array.isArray(r.specialties) ? r.specialties : []);
    setFValidFrom(r.valid_from ?? "");
    setFValidUntil(r.valid_until ?? "");
    setFDoctors(Array.isArray(r.doctors) ? r.doctors : []);
    const gci = Array.isArray(r.group_company_ids) ? r.group_company_ids : [];
    const gdo = Array.isArray(r.group_doctors) ? r.group_doctors : [];
    setFGroupCompanyIds(gci);
    setFGroupDoctors(gdo);
    // Modo é hierárquico: se tem empresa → modo empresa (com ou sem médicos);
    // só vai para modo médico se NÃO tem empresa e tem médicos.
    setFGroupMode(gci.length > 0 ? "empresa" : gdo.length > 0 ? "medico" : "empresa");
    setFTimeMode((r.time_mode as TimeMode) ?? "qualquer");
    setFWeekdays(Array.isArray(r.weekdays) ? r.weekdays.map((n: any) => Number(n)) : []);
    setFIncludesHolidays(!!r.includes_holidays);
    setFTimeStart(r.time_start ? String(r.time_start).slice(0, 5) : "");
    setFTimeEnd(r.time_end ? String(r.time_end).slice(0, 5) : "");
    setFElectiveMode((r.elective_mode as ElectiveMode) ?? "qualquer");
    setOpen(true);
  };

  const submitRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Abre automaticamente seções com erro para feedback imediato
    const sectionsWithErr = Object.entries(sectionErrors).filter(([, n]) => n > 0).map(([k]) => k);
    if (sectionsWithErr.length > 0) {
      setAccordionValue((prev) => Array.from(new Set([...prev, ...sectionsWithErr])));
      toast({ title: "Revise os campos destacados", description: `${sectionsWithErr.length} seção(ões) com pendência.`, variant: "destructive" });
      return;
    }
    const isEspecifica = scope === "especifica";
    // Quando Natureza = informativa/bloqueio, força calculation_type = informativo
    // e zera todos os parâmetros financeiros.
    const effectiveCalc: RuleCalculationType = fNature === "informativo" ? "informativo" : fCalculationType;
    const effectiveRuleType: RuleType = deriveRuleType(effectiveCalc);
    const isPacote =
      effectiveCalc === "pacote" ||
      effectiveCalc === "pacote_fechado" ||
      effectiveCalc === "pacote_com_extras" ||
      effectiveCalc === "pacote_por_atendimento";
    const isPacoteComExtras = isPacote && fPackageSubtype === "com_extras";
    const payload: any = {
      name: fName, description: fDescription || null, rule_text: fRuleText,
      severity: fSeverity, scope, sector: fSector,
      target_type: isEspecifica ? targetType : null,
      target_identifier: isEspecifica ? (fTargetIdentifier || null) : null,
      target_name: isEspecifica ? (fTargetName || null) : null,
      rule_type: effectiveRuleType,
      calculation_type: effectiveCalc,
      convenio_percentage: effectiveCalc === "percentual_sobre_convenio" ? num(fConvenioPct) : null,
      fixed_amount: effectiveCalc === "valor_fixo" ? num(fFixedAmount) : null,
      extras_codes: isPacoteComExtras
        ? fExtrasCodes.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean)
        : null,
      package_amount: isPacote ? num(fPackageAmount) : null,
      package_main_code: isPacote ? (fPackageMainCode.trim() || null) : null,
      package_included_codes: isPacote
        ? (fPackageIncludedCodes.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean) || null)
        : null,
      // Em pacote fechado, as flags ficam desabilitadas (false).
      package_visits_count: isPacoteComExtras ? fPackageVisitsCount : false,
      package_opinions_count: isPacoteComExtras ? fPackageOpinionsCount : false,
      package_auxiliaries_included: isPacoteComExtras ? fPackageAuxIncluded : false,
      package_subtype: isPacote ? fPackageSubtype : null,
      exclusion_reason: effectiveCalc === "exclusao" ? (fExclusionReason || null) : null,
      allows_authorized_exception: effectiveCalc === "exclusao" ? fAllowsAuthorizedException : false,
      bonus_amount: effectiveCalc === "bonus" ? num(fBonusAmount) : null,
      bonus_pct: effectiveCalc === "bonus" ? num(fBonusPct) : null,
      target_amount: effectiveCalc === "complemento" ? num(fTargetAmount) : null,
      multiplier: effectiveCalc === "tabela_diferenciada" ? num(fMultiplier) : null,
      deflator_pct: effectiveCalc === "tabela_diferenciada" ? num(fDeflatorPct) : null,
      reference_table_id: effectiveCalc === "tabela_diferenciada" ? (refTableId || null) : null,
      include_auxiliaries: effectiveCalc === "tabela_diferenciada" ? fIncludeAux : false,
      auxiliary_pct: effectiveCalc === "tabela_diferenciada" ? num(fAuxPct) : null,
      aux_first_pct: (effectiveCalc === "tabela_diferenciada" && fIncludeAux) ? (num(fAuxFirstPct) ?? 30) : null,
      aux_second_pct: (effectiveCalc === "tabela_diferenciada" && fIncludeAux) ? (num(fAuxSecondPct) ?? 20) : null,
      instrumentador_pct: (effectiveCalc === "tabela_diferenciada" && fIncludeAux) ? (num(fInstrumentadorPct) ?? 10) : null,
      repasse_pct: effectiveCalc === "tabela_diferenciada" ? num(fRepassePct) : null,
      apply_access_route: effectiveCalc === "tabela_diferenciada" ? fApplyAccessRoute : false,
      procedure_codes: parsedCodes.length ? parsedCodes : null,
      payment_term: paymentTerm,
      applies_payment_types: appliesTypes.length ? appliesTypes : null,
      sectors: fSectors,
      specialties: fSpecialties,
      valid_from: fValidFrom || null,
      valid_until: fValidUntil || null,
      doctors: fDoctors,
      // Modo empresa: salva empresas e (opcional) médicos refinando-as.
      // Modo médico: salva apenas médicos, sem empresa.
      group_company_ids: scope === "grupo" && fGroupMode === "empresa" ? fGroupCompanyIds : [],
      group_doctors: scope === "grupo" ? fGroupDoctors : [],
      time_mode: fTimeMode,
      weekdays: fTimeMode === "personalizado" ? fWeekdays : [],
      includes_holidays: fIncludesHolidays,
      time_start: fTimeStart || null,
      time_end: fTimeEnd || null,
      elective_mode: fElectiveMode,
    };
    if (isEspecifica && !payload.target_identifier && !payload.target_name) {
      return toast({ title: "Informe CPF/CNPJ ou nome do alvo", variant: "destructive" });
    }
    if (isEspecifica && targetType === "empresa") {
      const cnpj = payload.target_identifier;
      if (!cnpj || !isValidCNPJ(cnpj)) {
        return toast({
          title: "CNPJ inválido",
          description: "Para regras aplicadas a uma empresa o CNPJ é obrigatório e deve ser válido.",
          variant: "destructive",
        });
      }
      // normaliza para formato com máscara antes de salvar
      payload.target_identifier = formatCNPJ(cnpj);
    }
    // Resolve a empresa vinculada (quando aplicável) para o registro de auditoria.
    const linkedCompany = (isEspecifica && targetType === "empresa")
      ? companies.find((c) => c.name === payload.target_name || (c.document && payload.target_identifier && onlyDigits(c.document) === onlyDigits(payload.target_identifier))) ?? null
      : null;
    // Preenche o vínculo direto (FK) com a empresa cadastrada quando houver match exato de CNPJ.
    payload.target_company_id = (isEspecifica && targetType === "empresa") ? (linkedCompany?.id ?? null) : null;
    const auditCompany = (isEspecifica && targetType === "empresa") ? {
      id: linkedCompany?.id ?? null,
      name: payload.target_name ?? linkedCompany?.name ?? null,
      document: payload.target_identifier ?? linkedCompany?.document ?? null,
    } : null;

    if (editingId) {
      const before = rules.find((r) => r.id === editingId) ?? null;
      const { error } = await supabase.from("rules").update(payload).eq("id", editingId);
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
      await recordAudit({
        entityType: "rule", entityId: editingId, action: "update",
        actorId: user!.id, company: auditCompany,
        diff: buildDiff(before as any, payload),
      });
      toast({ title: "Regra atualizada" });
    } else {
      payload.created_by = user!.id;
      const { data: created, error } = await supabase.from("rules").insert(payload).select("id").single();
      if (error || !created) return toast({ title: "Erro", description: error?.message ?? "Falha ao criar", variant: "destructive" });
      await recordAudit({
        entityType: "rule", entityId: created.id, action: "create",
        actorId: user!.id, company: auditCompany,
        diff: buildDiff(null, payload),
      });
      toast({ title: "Regra criada" });
    }
    setOpen(false); resetForm(); load();
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject; r.readAsDataURL(file);
  });

  const importWithAi = async () => {
    if (!importText.trim() && !importFile) return toast({ title: "Adicione texto ou um arquivo", variant: "destructive" });
    setImporting(true);
    try {
      const body: any = {};
      if (importText.trim()) body.text = importText;
      if (importFile) {
        const ext = importFile.name.toLowerCase().split(".").pop() ?? "";
        const isSpreadsheet = ["xlsx", "xls", "csv"].includes(ext);
        const isText = ["txt", "md", "eml"].includes(ext);
        if (isSpreadsheet) {
          const buf = await importFile.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const sheets = wb.SheetNames.map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
          body.text = (body.text ? body.text + "\n\n" : "") + sheets;
        } else if (isText) {
          body.text = (body.text ? body.text + "\n\n" : "") + (await importFile.text());
        } else {
          body.file = { name: importFile.name, mimeType: importFile.type || "application/octet-stream", dataBase64: await fileToBase64(importFile) };
        }
      }
      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) return toast({ title: "Erro", description: error?.message ?? data?.error ?? "Falha", variant: "destructive" });
      const ds: DraftRule[] = data.rules.map((r: any) => ({
        enabled: true,
        name: r.name ?? "", description: r.description ?? "", rule_text: r.rule_text ?? "",
        severity: r.severity ?? "aviso", scope: r.scope ?? "master", sector: r.sector ?? "outro",
        target_type: r.target_type ?? null, target_identifier: r.target_identifier ?? null, target_name: r.target_name ?? null,
        rule_type: r.rule_type ?? "informativo",
        calculation_type: (r.calculation_type as RuleCalculationType) ?? inferCalculationType((r.rule_type as RuleType) ?? "informativo"),
        convenio_percentage: r.convenio_percentage ?? null,
        fixed_amount: r.fixed_amount ?? r.bonus_amount ?? r.target_amount ?? null,
        extras_codes: Array.isArray(r.extras_codes) ? r.extras_codes : [],
        package_amount: r.package_amount ?? null, bonus_amount: r.bonus_amount ?? null, bonus_pct: r.bonus_pct ?? null,
        target_amount: r.target_amount ?? null, multiplier: r.multiplier ?? null, deflator_pct: r.deflator_pct ?? null,
        reference_table_id: null, procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
        payment_term: (r.payment_term ?? "qualquer") as PaymentTerm,
        applies_payment_types: Array.isArray(r.applies_payment_types) ? r.applies_payment_types : [],
        sectors: Array.isArray(r.sectors) ? r.sectors : (r.sector ? [r.sector] : []),
        specialties: Array.isArray(r.specialties) ? r.specialties : [],
        valid_from: r.valid_from ?? null,
        valid_until: r.valid_until ?? null,
        doctors: Array.isArray(r.doctors) ? r.doctors : [],
      }));
      setDrafts(ds); setImportOpen(false); setReviewOpen(true); setImportText(""); setImportFile(null);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally { setImporting(false); }
  };

  const updateDraft = (i: number, patch: Partial<DraftRule>) => setDrafts((ds) => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  const saveDrafts = async () => {
    const sel = drafts.filter((d) => d.enabled);
    if (sel.length === 0) return toast({ title: "Nenhuma regra selecionada", variant: "destructive" });
    // Bloqueia drafts de empresa sem CNPJ válido — mesma regra do form manual.
    const invalid = sel.filter((d) => d.scope === "especifica" && d.target_type === "empresa" && !isValidCNPJ(d.target_identifier ?? ""));
    if (invalid.length) {
      return toast({
        title: `CNPJ inválido em ${invalid.length} regra(s)`,
        description: "Corrija o CNPJ das regras de empresa antes de salvar (14 dígitos, com dígitos verificadores válidos).",
        variant: "destructive",
      });
    }
    const toInsert = sel.map((d) => ({
      name: d.name, description: d.description || null, rule_text: d.rule_text,
      severity: d.severity, scope: d.scope, sector: d.sector,
      target_type: d.scope === "especifica" ? d.target_type : null,
      target_identifier: d.scope === "especifica"
        ? (d.target_type === "empresa" && d.target_identifier ? formatCNPJ(d.target_identifier) : d.target_identifier)
        : null,
      target_name: d.scope === "especifica" ? d.target_name : null,
      rule_type: d.rule_type,
      calculation_type: d.calculation_type,
      convenio_percentage: d.calculation_type === "percentual_sobre_convenio" ? d.convenio_percentage : null,
      fixed_amount: d.calculation_type === "valor_fixo" ? d.fixed_amount : null,
      extras_codes: d.calculation_type === "pacote_com_extras" ? (d.extras_codes.length ? d.extras_codes : null) : null,
      package_amount: d.rule_type === "pacote" ? d.package_amount : null,
      bonus_amount: d.rule_type === "bonus" ? d.bonus_amount : null,
      bonus_pct: d.rule_type === "bonus" ? d.bonus_pct : null,
      target_amount: d.rule_type === "complemento" ? d.target_amount : null,
      multiplier: d.rule_type === "tabela_diferenciada" ? d.multiplier : null,
      deflator_pct: d.rule_type === "tabela_diferenciada" ? d.deflator_pct : null,
      reference_table_id: d.reference_table_id || null,
      procedure_codes: d.procedure_codes.length ? d.procedure_codes : null,
      payment_term: d.payment_term,
      applies_payment_types: d.applies_payment_types.length ? d.applies_payment_types : null,
      sectors: d.sectors,
      specialties: d.specialties,
      valid_from: d.valid_from,
      valid_until: d.valid_until,
      doctors: d.doctors,
      created_by: user!.id,
      target_company_id: (d.scope === "especifica" && d.target_type === "empresa")
        ? (companies.find((c) => c.document && d.target_identifier && onlyDigits(c.document) === onlyDigits(d.target_identifier))?.id ?? null)
        : null,
    }));
    const { data: insertedRows, error } = await supabase.from("rules").insert(toInsert).select("id");
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    // Registra auditoria por regra criada
    await Promise.all((insertedRows ?? []).map((row, idx) => {
      const d = sel[idx];
      const company = (d?.scope === "especifica" && d?.target_type === "empresa") ? {
        id: companies.find((c) => c.name === d.target_name || (c.document && d.target_identifier && onlyDigits(c.document) === onlyDigits(d.target_identifier)))?.id ?? null,
        name: d.target_name ?? null,
        document: d.target_identifier ?? null,
      } : null;
      return recordAudit({
        entityType: "rule", entityId: row.id, action: "create",
        actorId: user!.id, company,
        diff: buildDiff(null, toInsert[idx] as any),
      });
    }));
    setReviewOpen(false); setDrafts([]); load();
    toast({ title: `${toInsert.length} regra(s) salva(s)` });
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta regra?")) return;
    await supabase.from("rules").delete().eq("id", id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    load();
  };

  // filtered + grouped
  const filtered = useMemo(() => {
    const filterCompanyId = filterCompany?.id ?? null;
    const companyDigits = filterCompany?.document ? onlyDigits(filterCompany.document) : null;
    return rules.filter((r) => {
      if (filterScope !== "todos" && r.scope !== filterScope) return false;
      const sectorOk = filterSector === "todos" ||
        (Array.isArray(r.sectors) && r.sectors.length > 0 ? r.sectors.includes(filterSector) : r.sector === filterSector);
      if (!sectorOk) return false;
      if (filterType !== "todos" && r.rule_type !== filterType) return false;
      if (onlyIncomplete && !isIncomplete(r)) return false;
      if (filterTarget.trim() && !`${r.target_name ?? ""} ${r.target_identifier ?? ""}`.toLowerCase().includes(filterTarget.toLowerCase())) return false;
      if (filterCompanyId) {
        const linked = r.target_company_id === filterCompanyId;
        // fallback para regras antigas ainda não vinculadas: compara CNPJ por dígitos
        const matchByCnpj = !linked && companyDigits && r.target_identifier && onlyDigits(r.target_identifier) === companyDigits;
        if (!linked && !matchByCnpj) return false;
      }
      return true;
    });
  }, [rules, filterScope, filterSector, filterType, filterTarget, filterCompany, onlyIncomplete]);

  const incompleteCount = useMemo(() => rules.filter(isIncomplete).length, [rules]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; type: "master" | "medico" | "empresa"; rules: RuleRow[] }>();
    for (const r of filtered) {
      let key: string, label: string, type: "master" | "medico" | "empresa";
      if (r.scope === "master") { key = "__master"; label = "Regras Master (geral)"; type = "master"; }
      else {
        const ident = (r.target_identifier ?? r.target_name ?? "sem alvo").toLowerCase();
        key = `${r.target_type}:${ident}`;
        label = r.target_name ?? r.target_identifier ?? "Sem alvo";
        type = (r.target_type === "empresa" ? "empresa" : "medico");
      }
      if (!map.has(key)) map.set(key, { key, label, type, rules: [] });
      map.get(key)!.rules.push(r);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.type === "master") return -1;
      if (b.type === "master") return 1;
      return a.label.localeCompare(b.label);
    });
  }, [filtered]);

  const renderCalcBadge = (r: RuleRow) => {
    if (r.rule_type === "pacote" && r.package_amount != null) return <span className="text-xs font-medium">{formatCurrency(r.package_amount)} (pacote)</span>;
    if (r.rule_type === "tabela_diferenciada") {
      const ref = refTables.find((t) => t.id === r.reference_table_id);
      const parts = [ref?.name ?? "tabela", r.multiplier ? `× ${r.multiplier}` : null, r.deflator_pct ? `− ${r.deflator_pct}%` : null].filter(Boolean);
      return <span className="text-xs font-medium">{parts.join(" ")}</span>;
    }
    if (r.rule_type === "bonus") return <span className="text-xs font-medium">{r.bonus_amount != null ? `+${formatCurrency(r.bonus_amount)}` : r.bonus_pct != null ? `+${r.bonus_pct}%` : "bônus"}</span>;
    if (r.rule_type === "complemento" && r.target_amount != null) return <span className="text-xs font-medium">complementa até {formatCurrency(r.target_amount)}</span>;
    return null;
  };

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAllVisible = () => setSelected(new Set(filtered.map((r) => r.id)));
  const selectAllIncomplete = () => setSelected(new Set(rules.filter(isIncomplete).map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const applyBulkUpdate = async () => {
    if (selected.size === 0) return;
    const patch: any = {};
    if (bulkPaymentTerm) patch.payment_term = bulkPaymentTerm;
    if (bulkAppliesTypes.length > 0) patch.applies_payment_types = bulkAppliesTypes;
    if (bulkRefTableId === "__none") patch.reference_table_id = null;
    else if (bulkRefTableId) patch.reference_table_id = bulkRefTableId;
    if (Object.keys(patch).length === 0) return toast({ title: "Selecione ao menos um campo para atualizar", variant: "destructive" });
    const ids = Array.from(selected);
    const { error } = await supabase.from("rules").update(patch).in("id", ids);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: `${ids.length} regra(s) atualizadas` });
    setBulkOpen(false); setBulkPaymentTerm(""); setBulkAppliesTypes([]); setBulkRefTableId("");
    clearSelection(); load();
  };

  return (
    <>
      <PageHeader title="Regras de Pagamento" icon={BadgeDollarSign} description="A IA usa essas regras para analisar cada pagamento."
        actions={<>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" /> Importar com IA</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Importar regras com IA</DialogTitle></DialogHeader>
              <Tabs defaultValue="file" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="file"><Upload className="h-4 w-4 mr-2" />Arquivo</TabsTrigger>
                  <TabsTrigger value="text"><FileText className="h-4 w-4 mr-2" />Texto</TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="space-y-3">
                  <p className="text-sm text-muted-foreground">PDF, Word, Excel, CSV, TXT, .eml ou imagem. A IA extrai e mostra para revisão antes de salvar.</p>
                  <Input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.eml,image/*"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
                  {importFile && <p className="text-xs text-muted-foreground">Selecionado: {importFile.name} ({(importFile.size / 1024).toFixed(0)} KB)</p>}
                  <Button onClick={importWithAi} disabled={importing || !importFile} className="w-full">
                    {importing ? "Processando..." : "Extrair e revisar"}
                  </Button>
                </TabsContent>
                <TabsContent value="text" className="space-y-3">
                  <p className="text-sm text-muted-foreground">Cole o texto/manual ou conteúdo de e-mail.</p>
                  <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Ex: Pacote gastroplastia R$ 8.000 para Clínica X..." />
                  <Button onClick={importWithAi} disabled={importing || !importText.trim()} className="w-full">
                    {importing ? "Processando..." : "Extrair e revisar"}
                  </Button>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild><Button onClick={() => resetForm()}><Plus className="h-4 w-4 mr-2" /> Nova regra</Button></DialogTrigger>
            <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto sm:p-6 p-4">
              <DialogHeader>
                <DialogTitle>{editingId ? "Editar regra" : "Nova regra"}</DialogTitle>
                {editingId && <DialogDescription>Atualize os campos e salve.</DialogDescription>}
              </DialogHeader>
              <form onSubmit={submitRule} className="space-y-4">
                {/* Resumo dinâmico */}
                {(() => {
                  const onde =
                    scope === "master" ? "Todos os itens (master)"
                    : scope === "especifica" ? `Específica · ${RULE_TARGET_TYPE_LABELS[targetType]}${fTargetName ? ` "${fTargetName}"` : ""}`
                    : scope === "grupo"
                      ? (fGroupMode === "empresa"
                          ? (fGroupCompanyIds.length === 0
                              ? "Grupo · selecione empresa(s)"
                              : fGroupDoctors.length === 0
                                ? `Aplica para ${fGroupCompanyIds.length} empresa(s) — todos os médicos`
                                : `Aplica para ${fGroupDoctors.length} médico(s) específico(s) em ${fGroupCompanyIds.length} empresa(s)`)
                          : (fGroupDoctors.length === 0
                              ? "Grupo · selecione médico(s)"
                              : `Aplica para ${fGroupDoctors.map((d) => d.name).join(", ")}`))
                      : RULE_SCOPE_LABELS[scope];
                  const calc = fNature === "informativo"
                    ? "Informativa / bloqueio (não calcula)"
                    : `${RULE_CALCULATION_TYPE_LABELS[fCalculationType]}${fCalculationType === "percentual_sobre_convenio" && fConvenioPct ? ` (${fConvenioPct}%)` : ""}${fCalculationType === "valor_fixo" && fFixedAmount ? ` (R$ ${fFixedAmount})` : ""}`;
                  const cond: string[] = [];
                  if (fTimeMode !== "qualquer") cond.push(TIME_MODE_LABELS[fTimeMode]);
                  if (fElectiveMode !== "qualquer") cond.push(ELECTIVE_MODE_LABELS[fElectiveMode]);
                  if (fTimeStart || fTimeEnd) cond.push(`${fTimeStart || "—"}–${fTimeEnd || "—"}`);
                  if (fIncludesHolidays) cond.push("inclui feriados");
                  return (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
                      <div><span className="font-semibold">Onde aplica:</span> {onde}</div>
                      <div><span className="font-semibold">Como calcula:</span> {calc}</div>
                      <div><span className="font-semibold">Condições:</span> {cond.length ? cond.join(" · ") : "qualquer dia/horário/tipo"}</div>
                    </div>
                  );
                })()}

                <Accordion type="multiple" value={accordionValue} onValueChange={setAccordionValue} className="space-y-2">

                  {/* Identificação */}
                  <AccordionItem value="identificacao" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.identificacao > 0 && "text-destructive")}>
                      <span className="flex items-center">Identificação da regra
                        {sectionErrors.identificacao > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{sectionErrors.identificacao}</span>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-1">
                      <div className="space-y-1.5"><Label>Nome *</Label>
                        <Input required maxLength={100} value={fName} onChange={(e) => setFName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5"><Label>Descrição</Label>
                        <Input maxLength={300} value={fDescription} onChange={(e) => setFDescription(e.target.value)} />
                      </div>
                      <div className="space-y-1.5"><Label>Texto da regra *</Label>
                        <Textarea required rows={3} maxLength={2000} value={fRuleText} onChange={(e) => setFRuleText(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5"><Label>Escopo</Label>
                          <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label>Severidade</Label>
                          <Select value={fSeverity} onValueChange={(v) => setFSeverity(v as RuleSeverity)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="aviso">Aviso</SelectItem><SelectItem value="bloqueio">Bloqueio</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1.5"><Label>Setor / Item Pagamento (multi)</Label>
                        <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-10">
                          {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map((k) => {
                            const checked = fSectors.includes(k);
                            return (
                              <Button key={k} type="button" size="sm" variant={checked ? "default" : "outline"}
                                onClick={() => setFSectors((p) => checked ? p.filter((x) => x !== k) : [...p, k])}>
                                {RULE_SECTOR_LABELS[k]}
                              </Button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">Vazio = aplica a todos os setores.</p>
                      </div>
                      <div className="space-y-1.5"><Label>Especialidade(s)</Label>
                        <MultiSelectChips values={fSpecialties} onChange={setFSpecialties} options={COMMON_SPECIALTIES} placeholder="Selecionar especialidades…" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5"><Label>Vigência — início</Label>
                          <Input type="date" value={fValidFrom} onChange={(e) => setFValidFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1.5"><Label>Vigência — fim</Label>
                          <Input type="date" value={fValidUntil} onChange={(e) => setFValidUntil(e.target.value)} />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Aplicação da regra */}
                  <AccordionItem value="aplicacao" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.aplicacao > 0 && "text-destructive")}>
                      <span className="flex items-center">Aplicação da regra
                        {sectionErrors.aplicacao > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{sectionErrors.aplicacao}</span>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-1">
                      {scope === "especifica" && (
                        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                          <div className="space-y-1.5"><Label>Aplicar a</Label>
                            <Select value={targetType} onValueChange={(v) => setTargetType(v as RuleTargetType)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{Object.entries(RULE_TARGET_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          {targetType === "empresa" ? (
                            <div className="space-y-2">
                              <div className="space-y-1.5">
                                <Label>Empresa cadastrada</Label>
                                <CompanyCombobox
                                  value={fTargetName ? { id: "__sel__", name: fTargetName, document: fTargetIdentifier ? onlyDigits(fTargetIdentifier) : null } : null}
                                  onChange={(c) => {
                                    setFTargetName(c?.name ?? "");
                                    setFTargetIdentifier(c?.document ? formatCNPJ(c.document) : "");
                                  }}
                                  placeholder="Selecionar empresa…"
                                  className="w-full"
                                />
                                <p className="text-xs text-muted-foreground">Puxa nome e CNPJ direto do cadastro de empresas.</p>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5"><Label>CNPJ</Label>
                                  <Input
                                    value={fTargetIdentifier}
                                    onChange={(e) => setFTargetIdentifier(formatCNPJ(e.target.value))}
                                    placeholder="00.000.000/0000-00"
                                    inputMode="numeric"
                                    maxLength={18}
                                    aria-invalid={!!fTargetIdentifier && !isValidCNPJ(fTargetIdentifier)}
                                    className={cn(
                                      fTargetIdentifier && !isValidCNPJ(fTargetIdentifier) && "border-destructive focus-visible:ring-destructive"
                                    )}
                                  />
                                  {fTargetIdentifier && !isValidCNPJ(fTargetIdentifier) && (
                                    <p className="text-xs text-destructive">CNPJ inválido — confira os 14 dígitos.</p>
                                  )}
                                </div>
                                <div className="space-y-1.5"><Label>Nome</Label>
                                  <Input value={fTargetName} onChange={(e) => setFTargetName(e.target.value)} maxLength={150} />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1.5"><Label>CPF</Label>
                                <Input value={fTargetIdentifier} onChange={(e) => setFTargetIdentifier(e.target.value)} maxLength={30} />
                              </div>
                              <div className="space-y-1.5"><Label>Nome</Label>
                                <Input value={fTargetName} onChange={(e) => setFTargetName(e.target.value)} maxLength={150} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {scope === "grupo" && (() => {
                        const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                        const allowedSet = new Set(companyDoctors.map((d) => norm(d.name)));
                        const invalidDoctors = fGroupMode === "empresa" && fGroupCompanyIds.length > 0 && companyDoctors.length > 0
                          ? fGroupDoctors.filter((d) => !allowedSet.has(norm(d.name)))
                          : [];
                        const isAllCompany = fGroupMode === "empresa" && fGroupCompanyIds.length > 0 && fGroupDoctors.length === 0;
                        const isSpecificDoctors = (fGroupMode === "empresa" && fGroupDoctors.length > 0) || fGroupMode === "medico";
                        return (
                          <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3 animate-fade-in">
                            <div>
                              <Label className="text-sm font-semibold">Aplicação por empresa ou médico</Label>
                              <p className="text-xs text-muted-foreground">
                                Selecione uma empresa para aplicar a todos os médicos ou refine escolhendo médicos específicos. Também é possível criar regra diretamente por médico.
                              </p>
                            </div>
                            <RadioGroup
                              value={fGroupMode}
                              onValueChange={(v) => {
                                const next = v as "empresa" | "medico";
                                setFGroupMode(next);
                                if (next === "medico") {
                                  // Médico-only: zera empresas e sugestões
                                  setFGroupCompanyIds([]);
                                  setCompanyDoctors([]);
                                }
                              }}
                              className="grid gap-1.5"
                            >
                              {[
                                { v: "empresa", l: "Por empresa (opcionalmente refinar por médico)" },
                                { v: "medico", l: "Por médico (sem vincular empresa)" },
                              ].map((o) => (
                                <label key={o.v} htmlFor={`gmode-${o.v}`} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <RadioGroupItem id={`gmode-${o.v}`} value={o.v} />
                                  {o.l}
                                </label>
                              ))}
                            </RadioGroup>

                            {fGroupMode === "empresa" && (
                              <div className="space-y-3 animate-fade-in">
                                <div className="space-y-1.5">
                                  <Label>Empresas vinculadas *</Label>
                                  <CompanyCombobox
                                    value={null}
                                    onChange={(c) => {
                                      if (!c) return;
                                      setFGroupCompanyIds((prev) => prev.includes(c.id) ? prev : [...prev, c.id]);
                                    }}
                                    placeholder="Adicionar empresa…"
                                    className="w-full"
                                  />
                                  {fGroupCompanyIds.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                      {fGroupCompanyIds.map((id) => {
                                        const c = companies.find((x) => x.id === id);
                                        return (
                                          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                                            {c?.name ?? id.slice(0, 8)}
                                            <button type="button" className="text-muted-foreground hover:text-foreground"
                                              onClick={() => setFGroupCompanyIds((prev) => prev.filter((x) => x !== id))}>×</button>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {fGroupCompanyIds.length > 0 && (
                                  <div className="space-y-1.5 animate-fade-in">
                                    <Label>Médicos da(s) empresa(s) — opcional</Label>
                                    <p className="text-xs text-muted-foreground">
                                      {loadingCompanyDoctors
                                        ? "Carregando médicos…"
                                        : companyDoctors.length === 0
                                          ? "Nenhum médico encontrado nos atendimentos da(s) empresa(s). Deixe em branco para aplicar a todos."
                                          : "Selecione um ou mais médicos para refinar. Deixe em branco para aplicar a toda a empresa."}
                                    </p>
                                    {companyDoctors.length > 0 && (
                                      <div className="flex flex-wrap gap-1 pt-1">
                                        {companyDoctors.map((d, i) => {
                                          const checked = fGroupDoctors.some((x) => norm(x.name) === norm(d.name));
                                          return (
                                            <Button key={`${d.name}-${i}`} type="button" size="sm"
                                              variant={checked ? "default" : "outline"}
                                              onClick={() => {
                                                setFGroupDoctors((prev) => checked
                                                  ? prev.filter((x) => norm(x.name) !== norm(d.name))
                                                  : [...prev, d]);
                                              }}>
                                              {d.name}{d.crm ? ` · ${d.crm}` : ""}
                                            </Button>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {fGroupDoctors.length > 0 && (
                                      <div className="flex items-center justify-between pt-1">
                                        <span className="text-xs text-muted-foreground">{fGroupDoctors.length} médico(s) selecionado(s).</span>
                                        <Button type="button" size="sm" variant="ghost" onClick={() => setFGroupDoctors([])}>Limpar seleção</Button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {fGroupMode === "medico" && (
                              <div className="space-y-1.5 animate-fade-in">
                                <Label>Médicos vinculados *</Label>
                                <DoctorsEditor value={fGroupDoctors} onChange={setFGroupDoctors} />
                              </div>
                            )}

                            {(isAllCompany || isSpecificDoctors) && (
                              <div className={cn(
                                "rounded-md border px-2.5 py-1.5 text-xs animate-fade-in",
                                isAllCompany
                                  ? "border-info/40 bg-info-soft text-info-foreground"
                                  : "border-primary/40 bg-primary/5"
                              )}>
                                {isAllCompany
                                  ? "Aplicando para toda(s) a(s) empresa(s) selecionada(s) — todos os médicos."
                                  : "Aplicando para médicos específicos."}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {scope === "master" && (
                        <p className="text-xs text-muted-foreground">Regra master — aplica a todos os itens. Altere o escopo na Identificação para vincular a empresa, médico ou grupo.</p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5"><Label>Prazo de pagamento</Label>
                          <Select value={paymentTerm} onValueChange={(v) => setPaymentTerm(v as PaymentTerm)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{Object.entries(PAYMENT_TERM_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label>Tipos de pagamento aplicáveis</Label>
                          <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-10">
                            {PAYMENT_TYPE_KEYS.map((k) => {
                              const checked = appliesTypes.includes(k);
                              return (
                                <Button key={k} type="button" size="sm" variant={checked ? "default" : "outline"}
                                  onClick={() => setAppliesTypes((prev) => checked ? prev.filter((x) => x !== k) : [...prev, k])}>
                                  {PAYMENT_TYPE_LABELS[k]}
                                </Button>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground">Vazio = aplica a todos.</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Condições de aplicação */}
                  <AccordionItem value="condicoes" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.condicoes > 0 && "text-destructive")}>
                      <span className="flex items-center">Condições de aplicação
                        {sectionErrors.condicoes > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{sectionErrors.condicoes}</span>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Dias / período</Label>
                          <Select value={fTimeMode} onValueChange={(v) => setFTimeMode(v as TimeMode)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TIME_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Tipo de atendimento</Label>
                          <Select value={fElectiveMode} onValueChange={(v) => setFElectiveMode(v as ElectiveMode)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(ELECTIVE_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {fTimeMode === "personalizado" && (
                        <div className="space-y-1.5">
                          <Label>Dias da semana</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {WEEKDAY_LABELS.map((d) => {
                              const checked = fWeekdays.includes(d.v);
                              return (
                                <Button key={d.v} type="button" size="sm" variant={checked ? "default" : "outline"}
                                  onClick={() => setFWeekdays((p) => checked ? p.filter((x) => x !== d.v) : [...p, d.v])}>
                                  {d.label}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <div className="space-y-1.5">
                          <Label>Hora início (opcional)</Label>
                          <Input type="time" value={fTimeStart} onChange={(e) => setFTimeStart(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Hora fim (opcional)</Label>
                          <Input type="time" value={fTimeEnd} onChange={(e) => setFTimeEnd(e.target.value)} />
                        </div>
                        <label className="flex items-center gap-2 text-sm pb-2">
                          <Checkbox checked={fIncludesHolidays} onCheckedChange={(v) => setFIncludesHolidays(!!v)} />
                          Inclui feriados
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Se ultrapassar a meia-noite (ex.: 19:00 → 07:00), o sistema interpreta como janela noturna.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Cálculo da regra */}
                  <AccordionItem value="calculo" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.calculo > 0 && "text-destructive")}>
                      <span className="flex items-center">Cálculo da regra
                        {sectionErrors.calculo > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{sectionErrors.calculo}</span>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <Label>Natureza da regra *</Label>
                        <Select
                          value={fNature}
                          onValueChange={(v) => {
                            const nat = v as "calculavel" | "informativo";
                            setFNature(nat);
                            if (nat === "informativo") {
                              setFCalculationType("informativo");
                              setRuleType("informativo");
                              setRefTableId("");
                            } else if (fCalculationType === "informativo") {
                              setFCalculationType("percentual_sobre_convenio");
                              setRuleType(deriveRuleType("percentual_sobre_convenio"));
                            }
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="calculavel">Calculável</SelectItem>
                            <SelectItem value="informativo">Informativa / bloqueio</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {fNature === "informativo"
                            ? "Regra apenas alerta/bloqueia o validador — não calcula valor esperado."
                            : "Regra calcula um valor esperado pelo motor determinístico."}
                        </p>
                      </div>

                      {fNature === "calculavel" && (
                      <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
                        <Label>Método de cálculo *</Label>
                        <Select
                          value={fCalculationType}
                          onValueChange={(v) => {
                            const c = v as RuleCalculationType;
                            setFCalculationType(c);
                            setRuleType(deriveRuleType(c));
                            if (c !== "tabela_diferenciada") setRefTableId("");
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CALCULABLE_METHODS.map((k) => (
                              <SelectItem key={k} value={k}>{RULE_CALCULATION_TYPE_LABELS[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{RULE_CALCULATION_TYPE_DESCRIPTIONS[fCalculationType]}</p>
                        {fCalculationType === "percentual_sobre_convenio" && (
                          <div className="space-y-1 mt-2">
                            <Label className="text-xs">Percentual sobre o convênio (%)</Label>
                            <Input type="number" step="0.01" placeholder="Ex.: 100, 88, 70"
                              value={fConvenioPct} onChange={(e) => setFConvenioPct(e.target.value)} />
                          </div>
                        )}
                        {fCalculationType === "valor_fixo" && (
                          <div className="space-y-1 mt-2">
                            <Label className="text-xs">Valor fixo (R$)</Label>
                            <Input type="number" step="0.01" value={fFixedAmount} onChange={(e) => setFFixedAmount(e.target.value)} />
                          </div>
                        )}
                        {fCalculationType === "bonus" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                            <div className="space-y-1"><Label className="text-xs">Bônus fixo (R$)</Label>
                              <Input type="number" step="0.01" value={fBonusAmount} onChange={(e) => setFBonusAmount(e.target.value)} />
                            </div>
                            <div className="space-y-1"><Label className="text-xs">Bônus (%)</Label>
                              <Input type="number" step="0.01" value={fBonusPct} onChange={(e) => setFBonusPct(e.target.value)} />
                            </div>
                          </div>
                        )}
                        {fCalculationType === "complemento" && (
                          <div className="space-y-1 mt-2">
                            <Label className="text-xs">Valor alvo (R$) *</Label>
                            <Input type="number" step="0.01" value={fTargetAmount} onChange={(e) => setFTargetAmount(e.target.value)} />
                          </div>
                        )}
                        {(fCalculationType === "pacote" ||
                          fCalculationType === "pacote_fechado" ||
                          fCalculationType === "pacote_com_extras" ||
                          fCalculationType === "pacote_por_atendimento") && (
                          <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-[13.5px] font-semibold">Configuração do pacote</h3>
                              <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
                                {fPackageSubtype === "fechado" ? "fechado" : "com extras"}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Tipo de pacote *</Label>
                              <Select
                                value={fPackageSubtype}
                                onValueChange={(v) => {
                                  const sub = v as "fechado" | "com_extras";
                                  setFPackageSubtype(sub);
                                  if (sub === "fechado") {
                                    setFPackageVisitsCount(false);
                                    setFPackageOpinionsCount(false);
                                    setFPackageAuxIncluded(false);
                                    setFExtrasCodes("");
                                  } else {
                                    setFPackageAuxIncluded(true);
                                  }
                                }}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="fechado">Fechado</SelectItem>
                                  <SelectItem value="com_extras">Com extras</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Valor do pacote (R$) *</Label>
                                <Input type="number" step="0.01" value={fPackageAmount} onChange={(e) => setFPackageAmount(e.target.value)} />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Código principal do pacote</Label>
                                <Input placeholder="Ex.: 31005497" value={fPackageMainCode} onChange={(e) => setFPackageMainCode(e.target.value)} />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Códigos incluídos no pacote (embutidos, esperado R$ 0)</Label>
                              <Input placeholder="Ex.: 31002, 31003, 31004"
                                value={fPackageIncludedCodes} onChange={(e) => setFPackageIncludedCodes(e.target.value)} />
                            </div>
                            {fPackageSubtype === "com_extras" && (
                              <div className="space-y-1.5">
                                <Label className="text-xs">Códigos extras permitidos (pagos à parte conforme regra definida)</Label>
                                <Input placeholder="Ex.: 31005470" value={fExtrasCodes} onChange={(e) => setFExtrasCodes(e.target.value)} />
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <label className={cn("flex items-start gap-2", fPackageSubtype === "fechado" ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
                                <Checkbox checked={fPackageVisitsCount} disabled={fPackageSubtype === "fechado"}
                                  onCheckedChange={(c) => setFPackageVisitsCount(!!c)} />
                                <span className="text-xs">Visitas somam ao pacote</span>
                              </label>
                              <label className={cn("flex items-start gap-2", fPackageSubtype === "fechado" ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
                                <Checkbox checked={fPackageOpinionsCount} disabled={fPackageSubtype === "fechado"}
                                  onCheckedChange={(c) => setFPackageOpinionsCount(!!c)} />
                                <span className="text-xs">Pareceres somam ao pacote</span>
                              </label>
                              <label className={cn("flex items-start gap-2", fPackageSubtype === "fechado" ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
                                <Checkbox checked={fPackageAuxIncluded} disabled={fPackageSubtype === "fechado"}
                                  onCheckedChange={(c) => setFPackageAuxIncluded(!!c)} />
                                <span className="text-xs">Auxiliares incluídos no pacote</span>
                              </label>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              O motor agrupa os itens pelo mesmo número de atendimento e aplica o pacote uma única vez (no item principal).
                              {fPackageSubtype === "fechado"
                                ? " Itens fora do código principal e fora da lista de incluídos geram alerta/reprovação."
                                : " Visitas, pareceres e auxiliares são contabilizados conforme as flags acima; códigos extras permitidos são reprocessados pela regra aplicável a cada um."}
                            </p>
                          </div>
                        )}
                        {fCalculationType === "exclusao" && (
                          <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-[13.5px] font-semibold">Configuração da exclusão</h3>
                              <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
                                {fAllowsAuthorizedException ? "admite exceção" : "bloqueio rígido"}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Motivo da exclusão *</Label>
                              <Select value={fExclusionReason || "__none"} onValueChange={(v) => setFExclusionReason(v === "__none" ? "" : v)}>
                                <SelectTrigger><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="convenio_particular">Convênio particular</SelectItem>
                                  <SelectItem value="codigo_nao_remuneravel">Código não remunerável</SelectItem>
                                  <SelectItem value="codigo_sem_acordo">Código sem dobra/acordo</SelectItem>
                                  <SelectItem value="fora_escopo">Procedimento fora do escopo</SelectItem>
                                  <SelectItem value="duplicidade">Duplicidade</SelectItem>
                                  <SelectItem value="ja_no_pacote">Já incluído em pacote</SelectItem>
                                  <SelectItem value="outro">Outro</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <label className="flex items-start gap-2 cursor-pointer">
                              <Checkbox
                                checked={fAllowsAuthorizedException}
                                onCheckedChange={(c) => setFAllowsAuthorizedException(!!c)}
                              />
                              <span className="text-xs">
                                Permite exceção autorizada
                                <span className="block text-[11px] text-muted-foreground">
                                  Quando marcado, o analista pode liberar o item informando autorizador, justificativa e (opcionalmente) anexo.
                                  Nesses casos o motor busca uma regra calculável específica; se não houver, marca como alerta para validação manual.
                                </span>
                              </span>
                            </label>
                            <p className="text-[11px] text-muted-foreground">
                              Padrão: valor esperado = R$ 0 e item bloqueado.
                              {fAllowsAuthorizedException
                                ? " Exceções autorizadas ficam registradas em auditoria."
                                : " Sem exceção possível — qualquer valor pago é divergência."}
                            </p>
                          </div>
                        )}
                      </div>
                      )}

                      {fNature === "calculavel" && fCalculationType === "tabela_diferenciada" && (
                        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
                          <Label>Tabela de referência *</Label>
                          <Select value={refTableId || "__none"} onValueChange={(v) => setRefTableId(v === "__none" ? "" : v)}>
                            <SelectTrigger><SelectValue placeholder={refTables.length ? "Selecionar tabela" : "Cadastre uma tabela"} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">Sem vínculo</SelectItem>
                              {refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">A tabela fornece apenas a base de valores; os parâmetros financeiros pertencem à regra.</p>
                        </div>
                      )}

                      {fNature === "calculavel" && fCalculationType === "tabela_diferenciada" && refTableId && (
                        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-[13.5px] font-semibold">Parâmetros de cálculo da tabela</h3>
                            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">obrigatório</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            A tabela vinculada acima fornece apenas a base de valores. Os parâmetros abaixo pertencem a esta regra e são aplicados pelo motor de cálculo.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5"><Label>Multiplicador</Label>
                              <Input type="number" step="0.01" placeholder="Ex: 1.5" value={fMultiplier} onChange={(e) => setFMultiplier(e.target.value)} />
                            </div>
                            <div className="space-y-1.5"><Label>Deflator (%)</Label>
                              <Input type="number" step="0.01" placeholder="Ex: 5" value={fDeflatorPct} onChange={(e) => setFDeflatorPct(e.target.value)} />
                            </div>
                            <div className="space-y-1.5"><Label>% de repasse</Label>
                              <Input type="number" step="0.01" placeholder="Ex: 70" value={fRepassePct} onChange={(e) => setFRepassePct(e.target.value)} />
                            </div>
                          </div>
                          <div className="flex items-start gap-2 pt-1">
                            <Checkbox id="apply_access_route" checked={fApplyAccessRoute} onCheckedChange={(c) => setFApplyAccessRoute(!!c)} />
                            <div className="flex-1">
                              <Label htmlFor="apply_access_route" className="cursor-pointer">Aplicar regra de via de acesso</Label>
                              <p className="text-xs text-muted-foreground">Aplica fator por via (única=1, mesma=0,5, diferente=0,7) sobre o valor base.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <Checkbox id="include_aux" checked={fIncludeAux} onCheckedChange={(c) => setFIncludeAux(!!c)} />
                            <div className="flex-1">
                              <Label htmlFor="include_aux" className="cursor-pointer">Considerar auxiliares</Label>
                              <p className="text-xs text-muted-foreground">Soma <code>valor_base × nº_aux × %_aux</code> (CBHPM informa o nº de auxiliares por código).</p>
                            </div>
                          </div>
                          {fIncludeAux && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <Label>1º auxiliar (%)</Label>
                                <Input type="number" step="0.01" placeholder="30" value={fAuxFirstPct} onChange={(e) => setFAuxFirstPct(e.target.value)} />
                              </div>
                              <div className="space-y-1.5">
                                <Label>2º auxiliar em diante (%)</Label>
                                <Input type="number" step="0.01" placeholder="20" value={fAuxSecondPct} onChange={(e) => setFAuxSecondPct(e.target.value)} />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Instrumentador (%)</Label>
                                <Input type="number" step="0.01" placeholder="10" value={fInstrumentadorPct} onChange={(e) => setFInstrumentadorPct(e.target.value)} />
                              </div>
                              <p className="text-xs text-muted-foreground sm:col-span-3">
                                O motor aplica o percentual conforme a função do médico no item (Primeiro Auxiliar, Segundo Auxiliar+, Instrumentador).
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {fNature === "calculavel" && fCalculationType === "tabela_diferenciada" && !refTableId && (
                        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                          <p className="text-xs text-muted-foreground">
                            Vincule uma <strong>Tabela de referência</strong> acima para definir os <strong>parâmetros de cálculo</strong> desta regra.
                          </p>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Códigos específicos */}
                  <AccordionItem value="codigos" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className="text-sm font-semibold">Códigos específicos</AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-1">
                      <div className="space-y-1.5"><Label>Códigos de procedimento (opcional)</Label>
                        <Input placeholder="Ex: 31005497, 31005470; 31002390"
                          value={codesInput} onChange={(e) => setCodesInput(e.target.value)} />
                        <p className="text-xs text-muted-foreground">
                          Separe por vírgula <code>,</code>, ponto e vírgula <code>;</code> ou espaço.
                        </p>
                        {parsedCodes.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {parsedCodes.map((c, i) => (
                              <span key={`${c}-${i}`} className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono">{c}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Button type="submit" className="w-full">{editingId ? "Salvar alterações" : "Criar"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </>}
      />

      <div className="p-8 space-y-4">
        {/* Banner de regras incompletas */}
        {incompleteCount > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium">{incompleteCount} regra{incompleteCount > 1 ? "s estão" : " está"} desatualizada{incompleteCount > 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground">Faltam campos novos (ex.: tipos de pagamento aplicáveis). Atualize individualmente ou em massa.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setOnlyIncomplete(true); selectAllIncomplete(); }}>
                Selecionar todas
              </Button>
              <Button size="sm" onClick={() => { selectAllIncomplete(); setBulkOpen(true); }}>
                <Wand2 className="h-4 w-4 mr-2" /> Atualizar em massa
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Barra de seleção em massa */}
        {selected.size > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <p className="text-sm font-medium">{selected.size} selecionada{selected.size > 1 ? "s" : ""}</p>
              <Button size="sm" variant="ghost" onClick={selectAllVisible}>Selecionar visíveis</Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>Limpar</Button>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => setBulkOpen(true)}><Wand2 className="h-4 w-4 mr-2" /> Atualizar em massa</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterScope} onValueChange={(v) => setFilterScope(v as any)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os escopos</SelectItem>
              {Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSector} onValueChange={(v) => setFilterSector(v as any)}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos (setor / item pgto)</SelectItem>
              {Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)} placeholder="Buscar empresa/médico" className="pl-8 w-[220px]" />
          </div>
          <CompanyCombobox
            value={filterCompany}
            onChange={setFilterCompany}
            placeholder="Filtrar por empresa (CNPJ)…"
            className="min-w-[240px] h-9"
          />
          {filterCompany && (
            <Button variant="ghost" size="sm" onClick={() => setFilterCompany(null)}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpar empresa
            </Button>
          )}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={onlyIncomplete} onCheckedChange={(c) => setOnlyIncomplete(!!c)} />
            <span>Só desatualizadas</span>
          </label>
          <p className="text-xs text-muted-foreground ml-auto">{filtered.length} de {rules.length}</p>
        </div>

        {groups.length === 0 ? (
          <Card className="shadow-card"><CardContent className="px-6 py-12"><p className="text-center text-sm text-muted-foreground">Nenhuma regra encontrada.</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const isCol = collapsed[g.key] === true;
              return (
                <Card key={g.key} className="shadow-card overflow-hidden">
                  <button onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCol }))}
                    className="w-full px-6 py-3 flex items-center gap-3 bg-muted/40 hover:bg-muted/60 text-left border-b border-border">
                    {isCol ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="text-sm">{g.type === "master" ? "📘" : g.type === "empresa" ? "🏥" : "👤"}</span>
                    <p className="font-medium text-sm flex-1">{g.label}</p>
                    <span className="text-xs text-muted-foreground">{g.rules.length} regra{g.rules.length > 1 ? "s" : ""}</span>
                  </button>
                  {!isCol && (
                    <div className="divide-y divide-border">
                      {g.rules.map((r) => {
                        const incomplete = isIncomplete(r);
                        const missing = missingFields(r);
                        return (
                          <div key={r.id} className="px-6 py-4 flex items-start gap-3">
                            <Checkbox className="mt-1" checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <p className="font-medium text-sm">{r.name}</p>
                                <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE_CLASSES[sevTone[r.severity as RuleSeverity]]}`}>{r.severity}</span>
                                <span className="text-xs rounded-full border border-border bg-background px-2 py-0.5">{RULE_TYPE_LABELS[r.rule_type as RuleType] ?? r.rule_type}</span>
                                {Array.isArray(r.sectors) && r.sectors.length > 0 ? (
                                  <span className="text-xs rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
                                    {(r.sectors as RuleSector[]).map((s) => RULE_SECTOR_LABELS[s] ?? s).join(" · ")}
                                  </span>
                                ) : (
                                  <span className="text-xs rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">{RULE_SECTOR_LABELS[r.sector as RuleSector] ?? r.sector}</span>
                                )}
                                {Array.isArray(r.specialties) && r.specialties.length > 0 && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">🩺 {r.specialties.join(" · ")}</span>
                                )}
                                {(r.valid_from || r.valid_until) && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">
                                    Vigência: {r.valid_from ?? "—"} → {r.valid_until ?? "—"}
                                  </span>
                                )}
                                {Array.isArray(r.doctors) && r.doctors.length > 0 && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">👤 {r.doctors.length} médico{r.doctors.length > 1 ? "s" : ""}</span>
                                )}
                                {renderCalcBadge(r)}
                                {r.payment_term && r.payment_term !== "qualquer" && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">{PAYMENT_TERM_LABELS[r.payment_term as PaymentTerm]}</span>
                                )}
                                {r.applies_payment_types && r.applies_payment_types.length > 0 && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">
                                    {(r.applies_payment_types as PaymentType[]).map((t) => PAYMENT_TYPE_LABELS[t]).join(" · ")}
                                  </span>
                                )}
                                {r.reference_table_id && r.rule_type !== "tabela_diferenciada" && (() => {
                                  const ref = refTables.find((t) => t.id === r.reference_table_id);
                                  return ref ? <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">📋 {ref.name}</span> : null;
                                })()}
                                {r.procedure_codes && r.procedure_codes.length > 0 && (
                                  <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono">{r.procedure_codes.join(", ")}</span>
                                )}
                                {incomplete && (
                                  <span className="text-xs rounded-full border border-warning/50 bg-warning/10 text-warning-foreground px-2 py-0.5 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Faltam: {missing.join(", ")}
                                  </span>
                                )}
                              </div>
                              {r.description && <p className="text-xs text-muted-foreground mb-1">{r.description}</p>}
                              <p className="text-sm">{r.rule_text}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => remove(r.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk update dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar {selected.size} regra{selected.size > 1 ? "s" : ""} em massa</DialogTitle>
            <DialogDescription>Apenas os campos preenchidos abaixo serão atualizados nas regras selecionadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Prazo de pagamento</Label>
              <Select value={bulkPaymentTerm || "__keep"} onValueChange={(v) => setBulkPaymentTerm(v === "__keep" ? "" : v as PaymentTerm)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Manter</SelectItem>
                  {Object.entries(PAYMENT_TERM_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipos de pagamento aplicáveis</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-10">
                {PAYMENT_TYPE_KEYS.map((k) => {
                  const checked = bulkAppliesTypes.includes(k);
                  return (
                    <Button key={k} type="button" size="sm" variant={checked ? "default" : "outline"}
                      onClick={() => setBulkAppliesTypes((p) => checked ? p.filter((x) => x !== k) : [...p, k])}>
                      {PAYMENT_TYPE_LABELS[k]}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Vazio = não altera.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Tabela de referência</Label>
              <Select value={bulkRefTableId || "__keep"} onValueChange={(v) => setBulkRefTableId(v === "__keep" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Manter</SelectItem>
                  <SelectItem value="__none">Remover vínculo</SelectItem>
                  {refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkUpdate}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tela de revisão pós-importação */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar regras extraídas pela IA</DialogTitle>
            <DialogDescription>Confira, edite e selecione quais salvar. {drafts.filter(d => d.enabled).length} de {drafts.length} marcadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {drafts.map((d, i) => (
              <Card key={i} className={`p-4 ${d.enabled ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-3 mb-3">
                  <Checkbox checked={d.enabled} onCheckedChange={(v) => updateDraft(i, { enabled: !!v })} className="mt-1" />
                  <Input value={d.name} onChange={(e) => updateDraft(i, { name: e.target.value })} placeholder="Nome" className="font-medium" />
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                    <Select value={d.rule_type} onValueChange={(v) => updateDraft(i, { rule_type: v as RuleType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Tipo de cálculo (motor)</Label>
                    <Select value={d.calculation_type} onValueChange={(v) => updateDraft(i, { calculation_type: v as RuleCalculationType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(RULE_CALCULATION_TYPE_LABELS) as RuleCalculationType[]).map((k) => (
                          <SelectItem key={k} value={k}>{RULE_CALCULATION_TYPE_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Severidade</Label>
                    <Select value={d.severity} onValueChange={(v) => updateDraft(i, { severity: v as RuleSeverity })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="aviso">Aviso</SelectItem><SelectItem value="bloqueio">Bloqueio</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Setor / Item Pagamento</Label>
                    <Select value={d.sector} onValueChange={(v) => updateDraft(i, { sector: v as RuleSector })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1"><Label className="text-xs">Escopo</Label>
                    <Select value={d.scope} onValueChange={(v) => updateDraft(i, { scope: v as RuleScope })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {d.scope === "especifica" && <>
                    <div className="space-y-1"><Label className="text-xs">Tipo de alvo</Label>
                      <Select value={d.target_type ?? "medico"} onValueChange={(v) => updateDraft(i, { target_type: v as RuleTargetType })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(RULE_TARGET_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Nome do alvo</Label>
                      {d.target_type === "empresa" ? (
                        <CompanyCombobox
                          value={
                            d.target_name || d.target_identifier
                              ? { id: "", name: d.target_name ?? "", document: d.target_identifier ?? null }
                              : null
                          }
                          onChange={(c) =>
                            updateDraft(i, {
                              target_name: c?.name ?? "",
                              target_identifier: c?.document ? formatCNPJ(c.document) : "",
                            })
                          }
                          placeholder="Buscar empresa cadastrada…"
                          className="w-full"
                        />
                      ) : (
                        <Input value={d.target_name ?? ""} onChange={(e) => updateDraft(i, { target_name: e.target.value })} />
                      )}
                    </div>
                    <div className="space-y-1 col-span-3"><Label className="text-xs">CPF/CNPJ</Label>
                      <Input
                        value={d.target_identifier ?? ""}
                        onChange={(e) => updateDraft(i, { target_identifier: e.target.value })}
                        placeholder={d.target_type === "empresa" ? "Preenchido ao selecionar a empresa" : ""}
                      />
                    </div>
                  </>}
                </div>

                {d.rule_type === "pacote" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Valor do pacote (R$)</Label>
                    <Input type="number" step="0.01" value={d.package_amount ?? ""} onChange={(e) => updateDraft(i, { package_amount: num(e.target.value) })} />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1"><Label className="text-xs">Tabela vinculada (opcional)</Label>
                    <Select value={d.reference_table_id ?? "__none"} onValueChange={(v) => updateDraft(i, { reference_table_id: v === "__none" ? null : v })}>
                      <SelectTrigger><SelectValue placeholder={refTables.length ? "Sem vínculo" : "Cadastre uma tabela"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sem vínculo</SelectItem>
                        {refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Prazo de pagamento</Label>
                    <Select value={d.payment_term} onValueChange={(v) => updateDraft(i, { payment_term: v as PaymentTerm })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(PAYMENT_TERM_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Tipos de pagamento</Label>
                    <div className="flex flex-wrap gap-1 rounded-md border border-input bg-background p-1.5 min-h-9">
                      {PAYMENT_TYPE_KEYS.map((k) => {
                        const checked = d.applies_payment_types.includes(k);
                        return (
                          <Button key={k} type="button" size="sm" variant={checked ? "default" : "outline"} className="h-7 px-2 text-xs"
                            onClick={() => updateDraft(i, { applies_payment_types: checked ? d.applies_payment_types.filter((x) => x !== k) : [...d.applies_payment_types, k] })}>
                            {PAYMENT_TYPE_LABELS[k]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {d.rule_type === "tabela_diferenciada" && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1"><Label className="text-xs">Multiplicador</Label>
                      <Input type="number" step="0.01" value={d.multiplier ?? ""} onChange={(e) => updateDraft(i, { multiplier: num(e.target.value) })} />
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Deflator (%)</Label>
                      <Input type="number" step="0.01" value={d.deflator_pct ?? ""} onChange={(e) => updateDraft(i, { deflator_pct: num(e.target.value) })} />
                    </div>
                  </div>
                )}
                {d.rule_type === "bonus" && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1"><Label className="text-xs">Bônus fixo (R$)</Label>
                      <Input type="number" step="0.01" value={d.bonus_amount ?? ""} onChange={(e) => updateDraft(i, { bonus_amount: num(e.target.value) })} />
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Bônus (%)</Label>
                      <Input type="number" step="0.01" value={d.bonus_pct ?? ""} onChange={(e) => updateDraft(i, { bonus_pct: num(e.target.value) })} />
                    </div>
                  </div>
                )}
                {d.rule_type === "complemento" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Valor alvo (R$)</Label>
                    <Input type="number" step="0.01" value={d.target_amount ?? ""} onChange={(e) => updateDraft(i, { target_amount: num(e.target.value) })} />
                  </div>
                )}
                {d.calculation_type === "percentual_sobre_convenio" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">% sobre convênio (motor)</Label>
                    <Input type="number" step="0.01" placeholder="Ex.: 100, 88, 70"
                      value={d.convenio_percentage ?? ""} onChange={(e) => updateDraft(i, { convenio_percentage: num(e.target.value) })} />
                  </div>
                )}
                {d.calculation_type === "valor_fixo" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Valor fixo (R$) (motor)</Label>
                    <Input type="number" step="0.01"
                      value={d.fixed_amount ?? ""} onChange={(e) => updateDraft(i, { fixed_amount: num(e.target.value) })} />
                  </div>
                )}
                {d.calculation_type === "pacote_com_extras" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Códigos extras (motor)</Label>
                    <Input value={d.extras_codes.join(", ")}
                      onChange={(e) => updateDraft(i, { extras_codes: e.target.value.split(/[,;\s]+/).filter(Boolean) })}
                      placeholder="Códigos pagos à parte (100% do convênio)" />
                  </div>
                )}

                <div className="space-y-1 mb-3"><Label className="text-xs">Códigos de procedimento</Label>
                  <Input value={d.procedure_codes.join(", ")} onChange={(e) => updateDraft(i, { procedure_codes: e.target.value.split(/[,;\s]+/).filter(Boolean) })} placeholder="Ex: 31005497, 31005470" />
                </div>
                <div className="space-y-1 mb-2"><Label className="text-xs">Descrição</Label>
                  <Input value={d.description} onChange={(e) => updateDraft(i, { description: e.target.value })} />
                </div>
                <div className="space-y-1"><Label className="text-xs">Texto da regra</Label>
                  <Textarea rows={2} value={d.rule_text} onChange={(e) => updateDraft(i, { rule_text: e.target.value })} />
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancelar</Button>
            <Button onClick={saveDrafts}>Salvar {drafts.filter(d => d.enabled).length} regra(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Rules;
