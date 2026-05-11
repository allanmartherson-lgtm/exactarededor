import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { FormDialog } from "@/components/FormDialog";
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
import { Plus, Sparkles, Trash2, Upload, FileText, Filter, ChevronDown, ChevronRight, Search, Pencil, AlertTriangle, Wand2, X, BadgeDollarSign, FileDown, CheckCheck, Copy } from "lucide-react";
import * as XLSX from "xlsx";
import { DoctorsEditor } from "@/components/MultiSelectChips";
import { DoctorCombobox, type DoctorOption } from "@/components/DoctorCombobox";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { recordAudit, buildDiff } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import {
  RuleCalculationsEditor,
  makeEmptyCalc,
  calcFromDb,
  calcToDbPayload,
  calcItemErrors,
  type CalcItem,
} from "@/components/rules/RuleCalculationsEditor";

const PAYMENT_TERM_LABELS: Record<string, string> = {
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
  active: boolean;
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
  payment_term: string; applies_payment_types: PaymentType[];
  sectors: string[]; specialties: string[];
  valid_from: string | null; valid_until: string | null;
  doctors: { name: string; crm?: string }[];
};

const inferCalculationType = (ruleType: RuleType): RuleCalculationType => {
  switch (ruleType) {
    case "pacote":              return "pacote";
    case "tabela_diferenciada": return "tabela_diferenciada";
    case "bonus":               return "bonus";
    case "complemento":         return "complemento";
    case "informativo":         return "informativo";
  }
};

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

const REQUIRED_NEW_FIELDS: { key: string; label: string; isMissing: (r: RuleRow) => boolean }[] = [
  { key: "payment_term", label: "Prazo de pagamento", isMissing: (r) => !r.payment_term || r.payment_term === "qualquer" ? false : false },
  { key: "applies_payment_types", label: "Tipos de pagamento aplicáveis", isMissing: (r) => !r.applies_payment_types || r.applies_payment_types.length === 0 },
  { key: "sectors", label: "Setores (multi)", isMissing: (r) => !Array.isArray(r.sectors) || r.sectors.length === 0 },
];
const isIncomplete = (r: RuleRow) => REQUIRED_NEW_FIELDS.some((f) => f.isMissing(r));
const missingFields = (r: RuleRow) => REQUIRED_NEW_FIELDS.filter((f) => f.isMissing(r)).map((f) => f.label);

const Rules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [refTables, setRefTables] = useState<{ id: string; name: string; purpose?: string }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; document: string | null }[]>([]);
  const [globalThresholds, setGlobalThresholds] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [globalConfigOpen, setGlobalConfigOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

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
  const [fNature, setFNature] = useState<"calculavel" | "informativo">("informativo");
  const [fCalculationType, setFCalculationType] = useState<RuleCalculationType>("informativo");
  const [fExceptionTableIds, setFExceptionTableIds] = useState<string[]>([]);
  const [codesInput, setCodesInput] = useState<string>("");
  const [paymentTerm, setPaymentTerm] = useState<string>("qualquer");
  const [appliesTypes, setAppliesTypes] = useState<PaymentType[]>([]);
  const [fSectors, setFSectors] = useState<string[]>([]);
  const [fSpecialties, setFSpecialties] = useState<string[]>([]);
  const [fAgreementMatchMode, setFAgreementMatchMode] = useState<"whitelist" | "blacklist">("whitelist");
  const [fAgreementAliases, setFAgreementAliases] = useState<string[]>([]);
  const [fAgreementInput, setFAgreementInput] = useState<string>("");
  const [fValidFrom, setFValidFrom] = useState<string>("");
  const [fValidUntil, setFValidUntil] = useState<string>("");
  const [fDoctors, setFDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [fGroupLinks, setFGroupLinks] = useState<{ company_id: string; doctors: { name: string; crm?: string }[] }[]>([]);
  const [companyDoctorsMap, setCompanyDoctorsMap] = useState<Record<string, { name: string; crm?: string }[]>>({});
  const [loadingCompanyDoctorsIds, setLoadingCompanyDoctorsIds] = useState<Set<string>>(new Set());
  const [fCalculations, setFCalculations] = useState<CalcItem[]>([makeEmptyCalc()]);
  const [fAlertThresholdType, setFAlertThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fAlertThresholdValue, setFAlertThresholdValue] = useState<string>("");
  const [fAlertInherit, setFAlertInherit] = useState(true);
  const [fBlockThresholdType, setFBlockThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fBlockThresholdValue, setFBlockThresholdValue] = useState<string>("");
  const [fBlockInherit, setFBlockInherit] = useState(true);
  
  const [fGlobalAlertThresholdType, setFGlobalAlertThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalAlertThresholdValue, setFGlobalAlertThresholdValue] = useState<string>("1.0");
  const [fGlobalBlockThresholdType, setFGlobalBlockThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalBlockThresholdValue, setFGlobalBlockThresholdValue] = useState<string>("5.0");
  const [calcSyncErrors, setCalcSyncErrors] = useState<any[]>([]);
  const [calcSyncRuleId, setCalcSyncRuleId] = useState<string | null>(null);
  const [calcSyncAttempt, setCalcSyncAttempt] = useState(0);
  const [calcSyncRetrying, setCalcSyncRetrying] = useState(false);

  const [accordionValue, setAccordionValue] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["identificacao"];
    try {
      const raw = window.localStorage.getItem("rules.form.accordion.v1");
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : ["identificacao"];
    } catch { return ["identificacao"]; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("rules.form.accordion.v1", JSON.stringify(accordionValue)); } catch {}
  }, [accordionValue]);

  const parsedCodes = useMemo(
    () => codesInput.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean),
    [codesInput]
  );

  const sectionErrors = useMemo(() => {
    const e: Record<string, number> = { identificacao: 0, aplicacao: 0, calculo: 0, codigos: 0 };
    if (!fName.trim()) e.identificacao++;
    if (!fRuleText.trim()) e.identificacao++;
    if (fValidFrom && fValidUntil && fValidFrom > fValidUntil) e.identificacao++;
    if (scope === "especifica") {
      if (!fTargetIdentifier && !fTargetName) e.aplicacao++;
      if (targetType === "empresa" && fTargetIdentifier && !isValidCNPJ(fTargetIdentifier)) e.aplicacao++;
    }
    if (scope === "grupo") {
      const seenCo = new Set<string>();
      let dupCo = false;
      for (const link of fGroupLinks) {
        if (!link.company_id) { e.aplicacao++; continue; }
        if (seenCo.has(link.company_id)) dupCo = true;
        seenCo.add(link.company_id);
      }
      if (dupCo) e.aplicacao++;
      if (fGroupLinks.length === 0) e.aplicacao++;
    }
    if (fNature === "calculavel") {
      const calcErrorsCount = fCalculations.reduce((acc, c) => acc + calcItemErrors(c), 0);
      e.calculo += calcErrorsCount;
    }
    return e;
  }, [fName, fRuleText, fValidFrom, fValidUntil, scope, fTargetIdentifier, fTargetName, targetType, fGroupLinks, fNature, fCalculations]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPaymentTerm, setBulkPaymentTerm] = useState<string>("");
  const [bulkAppliesTypes, setBulkAppliesTypes] = useState<PaymentType[]>([]);
  const [bulkRefTableId, setBulkRefTableId] = useState<string>("");

  const [filterScope, setFilterScope] = useState<"todos" | RuleScope>("todos");
  const [filterSector, setFilterSector] = useState<"todos" | RuleSector>("todos");
  const [filterType, setFilterType] = useState<"todos" | RuleType>("todos");
  const [filterTarget, setFilterTarget] = useState("");
  const [filterCompany, setFilterCompany] = useState<CompanyOption | null>(null);
  const [filterDoctor, setFilterDoctor] = useState<DoctorOption | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = () => supabase.from("rules").select("*").order("created_at", { ascending: false }).then(({ data }) => setRules(data ?? []));
  const loadGlobalThresholds = () => supabase.from("system_configurations").select("value").eq("key", "divergence_thresholds").maybeSingle().then(({ data }) => {
    if (data?.value) {
      const v = data.value as any;
      setGlobalThresholds(v);
      setFGlobalAlertThresholdType(v.limiar_alerta_tipo || "percentual");
      setFGlobalAlertThresholdValue(String(v.limiar_alerta_valor ?? 1.0));
      setFGlobalBlockThresholdType(v.limiar_bloqueio_tipo || "percentual");
      setFGlobalBlockThresholdValue(String(v.limiar_bloqueio_valor ?? 5.0));
    }
  });

  const saveGlobalThresholds = async () => {
    const alertV = num(fGlobalAlertThresholdValue) ?? 1.0;
    const blockV = num(fGlobalBlockThresholdValue) ?? 5.0;
    if (fGlobalAlertThresholdType === fGlobalBlockThresholdType && blockV <= alertV) {
      return toast({ title: "Limiar de bloqueio inválido", description: "O valor de bloqueio deve ser maior que o de alerta.", variant: "destructive" });
    }
    const value = {
      limiar_alerta_tipo: fGlobalAlertThresholdType,
      limiar_alerta_valor: alertV,
      limiar_bloqueio_tipo: fGlobalBlockThresholdType,
      limiar_bloqueio_valor: blockV
    };
    const { error } = await supabase.from("system_configurations").upsert({
      key: "divergence_thresholds",
      value,
      description: "Limiares globais padrão de divergência para análise de pagamento"
    }, { onConflict: "key" });
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: "Configurações salvas" });
    setGlobalConfigOpen(false);
    loadGlobalThresholds();
  };
  const loadRefs = () => supabase.from("reference_tables").select("id,name,purpose").order("name").then(({ data }) => setRefTables((data ?? []) as any));
  const loadCompanies = async () => {
    const PAGE = 1000;
    let all: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("companies").select("id,name,document").order("name").range(from, from + PAGE - 1);
      if (error) break;
      const batch = data ?? [];
      all = all.concat(batch);
      if (batch.length < PAGE) break;
    }
    setCompanies(all as any);
  };
  useEffect(() => { document.title = "Regras | MedPay"; load(); loadGlobalThresholds(); loadRefs(); loadCompanies(); }, []);

  const exportRuleToPDF = (r: RuleRow) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica");
    doc.setFillColor(245, 245, 245);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setFontSize(20);
    doc.setTextColor(40, 40, 40);
    doc.text("MedPay - Detalhamento de Regra", 14, 25);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`ID: ${r.id}`, 14, 34);
    doc.text(`Exportado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - 14, 34, { align: 'right' });
    let currentY = 55;
    doc.setFontSize(16);
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.text(r.name || "Sem nome", 14, currentY);
    currentY += 10;
    const basicInfo = [
      ["Campo", "Valor"],
      ["Gravidade", (r.severity || "info").toUpperCase()],
      ["Tipo de Regra", RULE_TYPE_LABELS[r.rule_type as RuleType] ?? r.rule_type ?? "Informativo"],
      ["Escopo", RULE_SCOPE_LABELS[r.scope as RuleScope] ?? r.scope ?? "Master"],
      ["Setor / Item", Array.isArray(r.sectors) && r.sectors.length > 0 
        ? r.sectors.map((s: any) => RULE_SECTOR_LABELS[s as RuleSector] ?? s).join(" · ")
        : (RULE_SECTOR_LABELS[r.sector as RuleSector] ?? r.sector ?? "Todos")],
      ["Vigência", `${r.valid_from ? new Date(r.valid_from).toLocaleDateString('pt-BR') : "Início"} → ${r.valid_until ? new Date(r.valid_until).toLocaleDateString('pt-BR') : "Fim"}`],
      ["Status", r.active === false ? "Inativa" : "Ativa"]
    ];
    autoTable(doc, {
      startY: currentY,
      head: [basicInfo[0]],
      body: basicInfo.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } }
    });
    doc.save(`Regra_${(r.name || "Export").replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    toast({ title: "PDF Gerado" });
  };

  const exportAllToPDF = () => {
    if (filtered.length === 0) return toast({ title: "Aviso", description: "Nenhuma regra para exportar." });
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(18);
    doc.text("Relatório Geral de Regras de Negócio", 14, 20);
    doc.setFontSize(10);
    doc.text(`Total de regras: ${filtered.length}`, 14, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - 14, 28, { align: 'right' });
    const tableData = filtered.map(r => [
        r.name,
        RULE_SCOPE_LABELS[r.scope as RuleScope] ?? r.scope,
        (r.severity || "info").toUpperCase(),
        r.active !== false ? "Sim" : "Não"
    ]);
    autoTable(doc, {
      startY: 35,
      head: [["Nome da Regra", "Escopo", "Gravidade", "Ativa"]],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [44, 62, 80] },
      styles: { fontSize: 8 }
    });
    doc.save("Relatorio_Geral_Regras.pdf");
    toast({ title: "Relatório Gerado" });
  };

  useEffect(() => {
    if (scope !== "grupo") return;
    const missing = fGroupLinks
      .map((l) => l.company_id)
      .filter((id) => id && !(id in companyDoctorsMap) && !loadingCompanyDoctorsIds.has(id));
    if (missing.length === 0) return;
    const ids = Array.from(new Set(missing));
    setLoadingCompanyDoctorsIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    Promise.all([
      supabase
        .from("payment_items")
        .select("company_id, doctor_name, doctor_document")
        .in("company_id", ids)
        .not("doctor_name", "is", null)
        .limit(5000),
      supabase
        .from("doctor_companies")
        .select("company_id, doctors(full_name, crm, crm_uf, active)")
        .in("company_id", ids),
    ]).then(([itemsRes, masterRes]) => {
        const byCo: Record<string, Map<string, { name: string; crm?: string }>> = {};
        ids.forEach((id) => { byCo[id] = new Map(); });
        for (const r of (masterRes.data ?? []) as any[]) {
          const cid = String(r.company_id ?? "");
          const d = r.doctors;
          if (!cid || !d || !d.full_name || !byCo[cid]) continue;
          if (d.active === false) continue;
          const key = d.full_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          byCo[cid].set(key, { name: d.full_name, crm: d.crm ? `${d.crm}/${d.crm_uf}` : undefined });
        }
        for (const r of (itemsRes.data ?? []) as any[]) {
          const cid = String(r.company_id ?? "");
          const name = String(r.doctor_name ?? "").trim();
          if (!cid || !name || !byCo[cid]) continue;
          const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (!byCo[cid].has(key)) byCo[cid].set(key, { name, crm: r.doctor_document ?? undefined });
        }
        setCompanyDoctorsMap((prev) => {
          const next = { ...prev };
          ids.forEach((id) => {
            next[id] = Array.from(byCo[id].values()).sort((a, b) => a.name.localeCompare(b.name));
          });
          return next;
        });
        setLoadingCompanyDoctorsIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      });
  }, [scope, fGroupLinks, companyDoctorsMap, loadingCompanyDoctorsIds]);

  const resetForm = () => {
    setEditingId(null);
    setFActive(true);
    setFName(""); setFDescription(""); setFRuleText("");
    setFSeverity("aviso"); setFSector("outro");
    setScope("master"); setTargetType("medico");
    setFTargetIdentifier(""); setFTargetName("");
    setRuleType("informativo"); setRefTableId(""); setFExceptionTableIds([]); setCodesInput("");
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
    setFAgreementMatchMode("whitelist"); setFAgreementAliases([]); setFAgreementInput("");
    setFGroupCompanyIds([]); setFGroupDoctors([]); setFGroupMode("empresa"); setFGroupLinks([]);
    setFHasConditions(false);
    setFTimeMode("qualquer"); setFWeekdays([]); setFIncludesHolidays(false);
    setFTimeStart(""); setFTimeEnd(""); setFElectiveMode("qualquer");
    setFCalculations([makeEmptyCalc()]);
    setFAlertThresholdType("percentual"); setFAlertThresholdValue(""); setFAlertInherit(true);
    setFBlockThresholdType("percentual"); setFBlockThresholdValue(""); setFBlockInherit(true);
    setCalcSyncErrors([]);
    setCalcSyncRuleId(null);
    setCalcSyncAttempt(0);
    setCalcSyncRetrying(false);
  };

  const openEdit = async (r: RuleRow, isDuplicate = false) => {
    setEditingId(isDuplicate ? null : r.id);
    setFName(isDuplicate ? `Cópia de ${r.name ?? ""}` : (r.name ?? ""));
    setFActive(isDuplicate ? true : (r.active !== false));
    setFDescription(r.description ?? ""); setFRuleText(r.rule_text ?? "");
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
    setFExceptionTableIds(Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []);
    setCodesInput(Array.isArray(r.procedure_codes) ? r.procedure_codes.join(", ") : "");
    setPaymentTerm((r.payment_term as string) ?? "qualquer");
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
    const legacySubtype: "fechado" | "com_extras" =
      r.package_subtype === "com_extras" ? "com_extras"
      : r.package_subtype === "fechado" ? "fechado"
      : (r.calculation_type === "pacote_com_extras" ? "com_extras" : "fechado");
    setFPackageSubtype(legacySubtype);
    setFExclusionReason(r.exclusion_reason ?? "");
    setFAllowsAuthorizedException(!!r.allows_authorized_exception);
    setFSectors(Array.isArray(r.sectors) ? r.sectors : (r.sector ? [r.sector] : []));
    setFSpecialties(Array.isArray(r.specialties) ? r.specialties : []);
    {
      const aliases = Array.isArray(r.agreement_aliases) ? [...r.agreement_aliases] : [];
      if (r.agreement_name && r.agreement_name.trim() && !aliases.some((a) => a.trim().toLowerCase() === r.agreement_name.trim().toLowerCase())) {
        aliases.unshift(r.agreement_name.trim());
      }
      setFAgreementAliases(aliases);
      setFAgreementInput("");
      setFAgreementMatchMode((r.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist") as "whitelist" | "blacklist");
    }
    setFValidFrom(r.valid_from ?? "");
    setFValidUntil(r.valid_until ?? "");
    setFDoctors(Array.isArray(r.doctors) ? r.doctors : []);
    const gci = Array.isArray(r.group_company_ids) ? r.group_company_ids : [];
    const gdo = Array.isArray(r.group_doctors) ? r.group_doctors : [];
    const glinks = Array.isArray((r as any).group_company_links) ? (r as any).group_company_links : [];
    setFGroupCompanyIds(gci);
    setFGroupDoctors(gdo);
    setFGroupMode(gci.length > 0 ? "empresa" : gdo.length > 0 ? "medico" : "empresa");
    if (glinks.length > 0) {
      setFGroupLinks(glinks.map((l: any) => ({ company_id: l.company_id, doctors: Array.isArray(l.doctors) ? l.doctors : [] })));
    } else if (gci.length > 0) {
      setFGroupLinks(gci.map((id: string) => ({ company_id: id, doctors: gci.length === 1 ? gdo : [] })));
    } else {
      setFGroupLinks([]);
    }
    const tMode = (r.time_mode as TimeMode) ?? "qualquer";
    const wdays = Array.isArray(r.weekdays) ? r.weekdays.map((n: any) => Number(n)) : [];
    const tStart = r.time_start ? String(r.time_start).slice(0, 5) : "";
    const tEnd = r.time_end ? String(r.time_end).slice(0, 5) : "";
    const eMode = (r.elective_mode as ElectiveMode) ?? "qualquer";
    setFTimeMode(tMode);
    setFWeekdays(wdays);
    setFIncludesHolidays(!!r.includes_holidays);
    setFTimeStart(tStart);
    setFTimeEnd(tEnd);
    setFElectiveMode(eMode);
    setFHasConditions(
      tMode !== "qualquer" || wdays.length > 0 || !!r.includes_holidays || !!tStart || !!tEnd || eMode !== "qualquer"
    );
    const { data: calcRows } = await supabase
      .from("rule_calculations")
      .select("*")
      .eq("rule_id", r.id)
      .order("sort_order", { ascending: true });
    if (calcRows && calcRows.length > 0) {
      setFCalculations(calcRows.map(calcFromDb));
    } else {
      setFCalculations([calcFromDb({
        ...r,
        time_mode: tMode, weekdays: wdays, time_start: tStart, time_end: tEnd,
        includes_holidays: r.includes_holidays, elective_mode: eMode,
      })]);
    }
    setFAlertThresholdType(r.limiar_alerta_tipo || "percentual");
    setFAlertThresholdValue(r.limiar_alerta_valor != null ? String(r.limiar_alerta_valor) : "");
    setFAlertInherit(r.limiar_alerta_valor == null);
    setFBlockThresholdType(r.limiar_bloqueio_tipo || "percentual");
    setFBlockThresholdValue(r.limiar_bloqueio_valor != null ? String(r.limiar_bloqueio_valor) : "");
    setFBlockInherit(r.limiar_bloqueio_valor == null);
    setAccordionValue((prev) => Array.from(new Set([...(prev ?? []), "identificacao"])));
    setOpen(true);
  };
  const openDuplicate = (r: RuleRow) => {
    openEdit(r, true);
    toast({ title: "Copiando regra" });
  };

  const submitRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
    const sectionsWithErr = Object.entries(sectionErrors).filter(([, n]) => n > 0).map(([k]) => k);
    if (sectionsWithErr.length > 0) {
      setAccordionValue((prev) => Array.from(new Set([...prev, ...sectionsWithErr])));
      toast({ title: "Revise os campos destacados", variant: "destructive" });
      return;
    }
    const isEspecifica = scope === "especifica";
    const head = fCalculations[0] ?? makeEmptyCalc();
    const effectiveCalc: RuleCalculationType = fNature === "informativo" ? "informativo" : head.calculation_type;
    const effectiveRuleType: RuleType = deriveRuleType(effectiveCalc);
    const isPacote = effectiveCalc === "pacote" || effectiveCalc === "pacote_fechado" || effectiveCalc === "pacote_com_extras" || effectiveCalc === "pacote_por_atendimento";
    const isPacoteComExtras = isPacote && head.package_subtype === "com_extras";
    const isTabela = effectiveCalc === "tabela_diferenciada";
    const payload: any = {
      active: fActive,
      name: fName, description: fDescription || null, rule_text: fRuleText,
      severity: fSeverity, scope, sector: fSector,
      target_type: isEspecifica ? targetType : null,
      target_identifier: isEspecifica ? (fTargetIdentifier || null) : null,
      target_name: isEspecifica ? (fTargetName || null) : null,
      rule_type: effectiveRuleType,
      calculation_type: effectiveCalc,
      convenio_percentage: effectiveCalc === "percentual_sobre_convenio" ? num(head.convenio_percentage) : null,
      fixed_amount: effectiveCalc === "valor_fixo" ? num(head.fixed_amount) : null,
      extras_codes: isPacoteComExtras ? head.extras_codes.split(/[,;\s]+/).map((c: string) => c.trim()).filter(Boolean) : null,
      package_amount: isPacote ? num(head.package_amount) : null,
      package_main_code: isPacote ? (head.package_main_code.trim() || null) : null,
      package_included_codes: isPacote ? head.package_included_codes.split(/[,;\s]+/).map((c: string) => c.trim()).filter(Boolean) : null,
      package_visits_count: isPacoteComExtras ? head.package_visits_count : false,
      package_opinions_count: isPacoteComExtras ? head.package_opinions_count : false,
      package_auxiliaries_included: isPacoteComExtras ? head.package_auxiliaries_included : false,
      package_subtype: isPacote ? head.package_subtype : null,
      exclusion_reason: effectiveCalc === "exclusao" ? (fExclusionReason || null) : null,
      allows_authorized_exception: effectiveCalc === "exclusao" ? fAllowsAuthorizedException : false,
      bonus_amount: effectiveCalc === "bonus" ? num(head.bonus_amount) : null,
      bonus_pct: effectiveCalc === "bonus" ? num(head.bonus_pct) : null,
      target_amount: effectiveCalc === "complemento" ? num(head.target_amount) : null,
      multiplier: isTabela ? num(head.multiplier) : null,
      deflator_pct: isTabela ? num(head.deflator_pct) : null,
      reference_table_id: isTabela ? (head.reference_table_id || null) : null,
      exception_table_ids: fExceptionTableIds,
      allowed_access_routes: head.allowed_access_routes.length > 0 ? head.allowed_access_routes : null,
      include_auxiliaries: isTabela ? head.include_auxiliaries : false,
      auxiliary_pct: isTabela ? num(head.auxiliary_pct) : null,
      aux_first_pct: (isTabela && head.include_auxiliaries) ? (num(head.aux_first_pct) ?? 30) : null,
      aux_second_pct: (isTabela && head.include_auxiliaries) ? (num(head.aux_second_pct) ?? 20) : null,
      instrumentador_pct: (isTabela && head.include_auxiliaries) ? (num(head.instrumentador_pct) ?? 10) : null,
      repasse_pct: isTabela ? num(head.repasse_pct) : null,
      apply_access_route: isTabela ? head.apply_access_route : false,
      procedure_codes: parsedCodes.length ? parsedCodes : null,
      payment_term: paymentTerm,
      applies_payment_types: appliesTypes.length ? appliesTypes : null,
      sectors: fSectors,
      specialties: fSpecialties,
      agreement_name: null,
      agreement_aliases: fAgreementAliases.map((a) => a.trim()).filter(Boolean),
      agreement_match_mode: fAgreementMatchMode,
      valid_from: fValidFrom || null,
      valid_until: fValidUntil || null,
      doctors: fDoctors,
      group_company_links: scope === "grupo" ? fGroupLinks.filter((l) => !!l.company_id) : [],
      group_company_ids: scope === "grupo" ? fGroupLinks.map((l) => l.company_id).filter(Boolean) : [],
      group_doctors: scope === "grupo" ? fGroupDoctors : [],
      time_mode: head.has_conditions ? head.time_mode : "qualquer",
      weekdays: head.has_conditions && head.time_mode === "personalizado" ? head.weekdays : [],
      includes_holidays: head.has_conditions ? head.includes_holidays : false,
      time_start: head.has_conditions ? (head.time_start || null) : null,
      time_end: head.has_conditions ? (head.time_end || null) : null,
      elective_mode: head.has_conditions ? head.elective_mode : "qualquer",
      has_conditions: head.has_conditions,
      limiar_alerta_tipo: fAlertInherit ? null : fAlertThresholdType,
      limiar_alerta_valor: fAlertInherit ? null : num(fAlertThresholdValue),
      limiar_bloqueio_tipo: fBlockInherit ? null : fBlockThresholdType,
      limiar_bloqueio_valor: fBlockInherit ? null : num(fBlockThresholdValue),
    };
    if (isEspecifica && targetType === "empresa") {
      const cnpj = payload.target_identifier;
      if (!cnpj || !isValidCNPJ(cnpj)) return toast({ title: "CNPJ inválido", variant: "destructive" });
      payload.target_identifier = formatCNPJ(cnpj);
    }
    const linkedCompany = (isEspecifica && targetType === "empresa")
      ? companies.find((c) => c.name === payload.target_name || (c.document && payload.target_identifier && onlyDigits(c.document) === onlyDigits(payload.target_identifier))) ?? null
      : null;
    payload.target_company_id = (isEspecifica && targetType === "empresa") ? (linkedCompany?.id ?? null) : null;
    const auditCompany = (isEspecifica && targetType === "empresa") ? {
      id: linkedCompany?.id ?? null,
      name: payload.target_name ?? linkedCompany?.name ?? null,
      document: payload.target_identifier ?? linkedCompany?.document ?? null,
    } : null;

    let savedRuleId: string | null = null;
    if (editingId) {
      const before = rules.find((r) => r.id === editingId) ?? null;
      const { error } = await supabase.from("rules").update(payload).eq("id", editingId);
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
      savedRuleId = editingId;
      await recordAudit({ entityType: "rule", entityId: editingId, action: "update", actorId: user!.id, company: auditCompany, diff: buildDiff(before as any, payload) });
      toast({ title: "Regra atualizada" });
    } else {
      payload.created_by = user!.id;
      const { data: created, error } = await supabase.from("rules").insert(payload).select("id").single();
      if (error || !created) return toast({ title: "Erro", description: error?.message ?? "Falha", variant: "destructive" });
      savedRuleId = created.id;
      await recordAudit({ entityType: "rule", entityId: created.id, action: "create", actorId: user!.id, company: auditCompany, diff: buildDiff(null, payload) });
      toast({ title: "Regra criada" });
    }
    setCalcSyncErrors([]);
    setCalcSyncRuleId(savedRuleId);
    setCalcSyncAttempt(1);
    const syncErrors = await runCalcSync(savedRuleId, fNature, fCalculations, 1);
    if (syncErrors.length > 0) {
      setCalcSyncErrors(syncErrors);
      toast({ title: "Falha na sincronização", variant: "destructive" });
      load(); return;
    }
    setOpen(false); resetForm(); load();
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); } finally { setSaving(false); }
  };

  const runCalcSync = async (ruleId: string, nature: typeof fNature, calcs: CalcItem[], attempt: number): Promise<any[]> => {
    const errors: any[] = [];
    if (nature === "calculavel") {
      const { error: delErr } = await supabase.from("rule_calculations").delete().eq("rule_id", ruleId);
      if (delErr) errors.push({ step: "delete-calculavel", message: delErr.message });
      else {
        const rows = calcs.map((c, i) => calcToDbPayload(c, ruleId, i));
        if (rows.length > 0) {
          const { error: insErr } = await supabase.from("rule_calculations").insert(rows as any);
          if (insErr) errors.push({ step: "insert-calculavel", message: insErr.message });
        }
      }
    } else {
      const { error: delErr } = await supabase.from("rule_calculations").delete().eq("rule_id", ruleId);
      if (delErr) errors.push({ step: "delete-informativo", message: delErr.message });
    }
    return errors;
  };

  const retryCalcSync = async () => {
    if (!calcSyncRuleId || calcSyncRetrying) return;
    setCalcSyncRetrying(true);
    const nextAttempt = calcSyncAttempt + 1;
    setCalcSyncAttempt(nextAttempt);
    const errors = await runCalcSync(calcSyncRuleId, fNature, fCalculations, nextAttempt);
    setCalcSyncErrors(errors);
    if (errors.length === 0) { toast({ title: "Sincronizado" }); setOpen(false); resetForm(); load(); }
    setCalcSyncRetrying(false);
  };

  const importWithAi = async () => {
    if (!importText.trim() && !importFile) return toast({ title: "Adicione texto ou arquivo", variant: "destructive" });
    setImporting(true);
    try {
      const body: any = {};
      if (importText.trim()) body.text = importText;
      if (importFile) {
        const buf = await importFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        body.text = wb.SheetNames.map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
      }
      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) return toast({ title: "Erro", description: error?.message ?? "Falha", variant: "destructive" });
      setDrafts(data.rules.map((r: any) => ({
        active: true, name: r.name ?? "", description: r.description ?? "", rule_text: r.rule_text ?? "",
        severity: r.severity ?? "aviso", scope: r.scope ?? "master", sector: r.sector ?? "outro",
        target_type: r.target_type ?? null, target_identifier: r.target_identifier ?? null, target_name: r.target_name ?? null,
        rule_type: r.rule_type ?? "informativo", calculation_type: r.calculation_type ?? "informativo",
        convenio_percentage: r.convenio_percentage ?? null, fixed_amount: r.fixed_amount ?? null,
        extras_codes: Array.isArray(r.extras_codes) ? r.extras_codes : [],
        package_amount: r.package_amount ?? null, bonus_amount: r.bonus_amount ?? null, bonus_pct: r.bonus_pct ?? null,
        target_amount: r.target_amount ?? null, multiplier: r.multiplier ?? null, deflator_pct: r.deflator_pct ?? null,
        reference_table_id: null, procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
        payment_term: r.payment_term ?? "qualquer", applies_payment_types: Array.isArray(r.applies_payment_types) ? r.applies_payment_types : [],
        sectors: Array.isArray(r.sectors) ? r.sectors : [], specialties: Array.isArray(r.specialties) ? r.specialties : [],
        valid_from: r.valid_from ?? null, valid_until: r.valid_until ?? null, doctors: Array.isArray(r.doctors) ? r.doctors : [],
      })));
      setImportOpen(false); setReviewOpen(true);
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); } finally { setImporting(false); }
  };

  const updateDraft = (i: number, patch: Partial<DraftRule>) => setDrafts((ds) => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  const saveDrafts = async () => {
    const sel = drafts.filter((d) => d.active);
    if (sel.length === 0) return;
    const toInsert = sel.map((d) => ({
      active: d.active, name: d.name, description: d.description || null, rule_text: d.rule_text,
      severity: d.severity, scope: d.scope, sector: d.sector,
      target_type: d.scope === "especifica" ? d.target_type : null,
      target_identifier: d.scope === "especifica" ? (d.target_type === "empresa" && d.target_identifier ? formatCNPJ(d.target_identifier) : d.target_identifier) : null,
      target_name: d.scope === "especifica" ? d.target_name : null,
      rule_type: d.rule_type, calculation_type: d.calculation_type,
      convenio_percentage: d.convenio_percentage, fixed_amount: d.fixed_amount,
      extras_codes: d.extras_codes.length ? d.extras_codes : null,
      package_amount: d.package_amount, bonus_amount: d.bonus_amount, bonus_pct: d.bonus_pct,
      target_amount: d.target_amount, multiplier: d.multiplier, deflator_pct: d.deflator_pct,
      reference_table_id: d.reference_table_id || null, procedure_codes: d.procedure_codes.length ? d.procedure_codes : null,
      payment_term: d.payment_term, applies_payment_types: d.applies_payment_types.length ? d.applies_payment_types : null,
      sectors: d.sectors, specialties: d.specialties, valid_from: d.valid_from, valid_until: d.valid_until,
      doctors: d.doctors, created_by: user!.id,
    }));
    await supabase.from("rules").insert(toInsert);
    setReviewOpen(false); setDrafts([]); load();
    toast({ title: "Regras salvas" });
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir?")) return;
    await supabase.from("rules").delete().eq("id", id);
    load();
  };

  return (
    <>
      <PageHeader title="Regras de Pagamento" icon={BadgeDollarSign} description="A IA usa essas regras para analisar cada pagamento."
        actions={<>
          <Button variant="outline" onClick={exportAllToPDF}><FileDown className="h-4 w-4 mr-2" /> Exportar Relatório</Button>
          <Button onClick={() => { resetForm(); setOpen(true); }}><Plus className="h-4 w-4 mr-2" /> Nova regra</Button>
        </>}
      />
      <div className="p-8 space-y-4">
        {selected.size > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <p className="text-sm font-medium">{selected.size} selecionada{selected.size > 1 ? "s" : ""}</p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(filtered.map(r => r.id)))}>Selecionar visíveis</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
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
            <Button variant="ghost" size="sm" onClick={() => setFilterCompany(null)} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          )}
          <DoctorCombobox
            value={filterDoctor}
            onChange={setFilterDoctor}
            placeholder="Filtrar por médico (CRM)…"
            className="min-w-[240px] h-9"
          />
          {filterDoctor && (
            <Button variant="ghost" size="sm" onClick={() => setFilterDoctor(null)} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

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
                    {g.rules.map((r) => (
                      <div key={r.id} className="px-6 py-4 flex items-start gap-3">
                        <Checkbox className="mt-1" checked={selected.has(r.id)} onCheckedChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-semibold text-foreground">{r.name}</span>
                          </div>
                          <p className="text-sm">{r.rule_text}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openDuplicate(r)} title="Duplicar"><Copy className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => exportRuleToPDF(r)} title="Exportar PDF"><FileDown className="h-4 w-4 text-blue-600" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(r.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
      <FormDialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}
        title={editingId ? "Editar regra" : "Nova regra"}
        maxWidth="6xl"
        footer={<div className="w-full flex items-center justify-end gap-3"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" form="rule-form">{editingId ? "Atualizar" : "Criar"}</Button></div>}
      >
        <form id="rule-form" onSubmit={submitRule} className="space-y-4">
          <Accordion type="multiple" value={accordionValue} onValueChange={setAccordionValue} className="space-y-2">
            <AccordionItem value="identificacao" className="rounded-md border border-border bg-card px-3">
              <AccordionTrigger className="text-sm font-semibold">Identificação</AccordionTrigger>
              <AccordionContent className="space-y-4 p-1 pt-1">
                <div className="space-y-1.5"><Label>Nome *</Label><Input required value={fName} onChange={(e) => setFName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Texto da regra *</Label><Textarea required rows={3} value={fRuleText} onChange={(e) => setFRuleText(e.target.value)} /></div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="aplicacao" className="rounded-md border border-border bg-card px-3">
              <AccordionTrigger className="text-sm font-semibold">Aplicação</AccordionTrigger>
              <AccordionContent className="space-y-4 p-1 pt-1">
                <div className="space-y-1.5"><Label>Escopo</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="calculo" className="rounded-md border border-border bg-card px-3">
              <AccordionTrigger className="text-sm font-semibold">Cálculos</AccordionTrigger>
              <AccordionContent className="space-y-4 p-1 pt-1">
                <RuleCalculationsEditor value={fCalculations} onChange={setFCalculations} refTables={refTables} enabled={fNature === "calculavel"} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </form>
      </FormDialog>
    </>
  );
};

export default Rules;
