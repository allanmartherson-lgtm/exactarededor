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
import { Badge } from "@/components/ui/badge";
import { RuleListRow } from "@/components/RuleListRow";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateBR, formatDateTimeBR } from "@/lib/dateUtils";
import { toast } from "@/hooks/use-toast";
import {
  TONE_CLASSES,
  type RuleSeverity, type RuleScope, type RuleSector, type RuleTargetType,
  RULE_SCOPE_LABELS, RULE_SECTOR_LABELS, RULE_TARGET_TYPE_LABELS,
  formatCurrency,
} from "@/lib/status";
import {
  RULE_CALCULATION_TYPE_LABELS, RULE_CALCULATION_TYPE_DESCRIPTIONS,
  type RuleCalculationType,
} from "@/lib/status";
import { Plus, Sparkles, Trash2, Upload, FileText, Filter, ChevronDown, ChevronRight, Search, Pencil, AlertTriangle, Wand2, X, BadgeDollarSign, FileDown, CheckCheck, Copy } from "lucide-react";
import * as XLSX from "xlsx";
import { DoctorsEditor, MultiSelectChips } from "@/components/MultiSelectChips";
import { DoctorCombobox } from "@/components/DoctorCombobox";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { recordAudit, buildDiff } from "@/lib/audit";
import { RuleHistoryTab } from "@/components/rules/RuleHistoryTab";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompanyCombobox } from "@/components/CompanyCombobox";
import {
  RuleCalculationsEditor,
  makeEmptyCalc,
  calcFromDb,
  calcToDbPayload,
  calcItemErrors,
  type CalcItem,
} from "@/components/rules/RuleCalculationsEditor";
import { RulesHealthPanel } from "@/components/rules/RulesHealthPanel";
import { RuleConflictModal, type Problem as ConflictProblem, type Correction as ConflictCorrection } from "@/components/rules/RuleConflictModal";

const sevTone: Record<RuleSeverity, keyof typeof TONE_CLASSES> = { info: "info", aviso: "warning", bloqueio: "destructive" };



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

// Filtros restritivos (códigos, setores, especialidades, convênios, vias)
// vivem exclusivamente em rule_calculations desde a migração 2026-05-12.
// As colunas equivalentes em public.rules foram removidas.

type DraftRule = {
  active: boolean;
  name: string; description: string; rule_text: string;
  severity: RuleSeverity; scope: RuleScope;
  target_type: RuleTargetType | null; target_identifier: string | null; target_name: string | null;
  calculation_type: RuleCalculationType;
  convenio_percentage: number | null;
  fixed_amount: number | null;
  extras_codes: string[];
  package_amount: number | null; bonus_amount: number | null; bonus_pct: number | null;
  target_amount: number | null; multiplier: number | null; deflator_pct: number | null;
  reference_table_id: string | null; procedure_codes: string[];
  sectors: string[]; specialties: string[];
  valid_from: string | null; valid_until: string | null;
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

// Campos "novos" exigidos no nível Regra. Restritivos (setores/especialidades/códigos/
// convênios/vias) vivem por Cálculo agora — nada aqui.
const REQUIRED_NEW_FIELDS: { key: string; label: string; isMissing: (r: RuleRow) => boolean }[] = [];
// regra fica "incompleta" se faltar QUALQUER campo novo de fato exigido
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

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["nome", "descricao", "texto_da_regra", "severidade", "escopo", "setor", "tipo_alvo", "identificador_alvo", "natureza", "tipo_calculo", "valor_fixo", "percentual_convenio", "codigos_procedimento"],
      ["Regra Exemplo", "Descrição da regra", "Pagar valor fixo de R$ 100", "aviso", "master", "outro", "medico", "", "calculavel", "valor_fixo", "100", "", "10101012; 10101039"],
    ]);
    ws["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Regras");
    XLSX.writeFile(wb, "modelo-regras.xlsx");
  };

  // form state (compartilhado entre Novo/Editar)
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fRuleText, setFRuleText] = useState("");
  const [fSeverity, setFSeverity] = useState<RuleSeverity>("aviso");
  
  const [scope, setScope] = useState<RuleScope>("master");
  const [targetType, setTargetType] = useState<RuleTargetType>("medico");
  const [fTargetIdentifier, setFTargetIdentifier] = useState("");
  const [fTargetName, setFTargetName] = useState("");
  
  // Nova abordagem: Natureza da regra (Calculável vs Informativa/bloqueio)
  const [fNature, setFNature] = useState<"calculavel" | "informativo">("informativo");
  // === Novo motor (Fase 4) ===
  const [fCalculationType, setFCalculationType] = useState<RuleCalculationType>("informativo");
  const [fConvenioPct, setFConvenioPct] = useState<string>("");
  const [fFixedAmount, setFFixedAmount] = useState<string>("");
  const [fExtrasCodes, setFExtrasCodes] = useState<string>("");
  const [refTableId, setRefTableId] = useState<string>("");
  // Tabelas de exceção vinculadas (purpose IN sem_acordo, exclusao) — bloqueiam o cálculo da regra.
  const [fExceptionTableIds, setFExceptionTableIds] = useState<string[]>([]);
  // codesInput / fSectors / fSpecialties / fAgreement* removidos do nível Regra.
  // Todos os filtros restritivos vivem agora dentro de cada item de Cálculo.
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
  // Setores, especialidades, convênios e vias migraram para cada Cálculo.
  const [fValidFrom, setFValidFrom] = useState<string>("");
  const [fValidUntil, setFValidUntil] = useState<string>("");
  const [fDoctors, setFDoctors] = useState<{ name: string; crm?: string }[]>([]);
  // Escopo "grupo" (inline na regra)
  const [fGroupCompanyIds, setFGroupCompanyIds] = useState<string[]>([]);
  const [fGroupDoctors, setFGroupDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [fGroupMode, setFGroupMode] = useState<"empresa" | "medico">("empresa");
  // Novo modelo: vínculos por empresa em linhas (cada linha = empresa + médicos opcionais).
  const [fGroupLinks, setFGroupLinks] = useState<{ company_id: string; doctors: { name: string; crm?: string }[] }[]>([]);
  // UI local: empresas colapsadas (por company_id) e filtro de busca.
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set());
  const [companyLinksFilter, setCompanyLinksFilter] = useState("");
  // Sugestões de médicos por empresa (mapa company_id → médicos encontrados em payment_items).
  const [companyDoctorsMap, setCompanyDoctorsMap] = useState<Record<string, { name: string; crm?: string }[]>>({});
  const [loadingCompanyDoctorsIds, setLoadingCompanyDoctorsIds] = useState<Set<string>>(new Set());
  // (legado) Sugestões de médicos para o modo "empresa" agregado.
  const [companyDoctors, setCompanyDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [loadingCompanyDoctors, setLoadingCompanyDoctors] = useState(false);
  // janela temporal — LEGADO (espelhado a partir do PRIMEIRO item de fCalculations
  // para manter o motor antigo funcionando até a Etapa B). Não há mais UI própria.
  const [fHasConditions, setFHasConditions] = useState(false);
  const [fTimeMode, setFTimeMode] = useState<TimeMode>("qualquer");
  const [fWeekdays, setFWeekdays] = useState<number[]>([]);
  const [fIncludesHolidays, setFIncludesHolidays] = useState(false);
  const [fTimeStart, setFTimeStart] = useState<string>("");
  const [fTimeEnd, setFTimeEnd] = useState<string>("");
  const [fElectiveMode, setFElectiveMode] = useState<ElectiveMode>("qualquer");
  // === Lista de itens de cálculo (1:N com a regra) ===
  const [fCalculations, setFCalculations] = useState<CalcItem[]>([makeEmptyCalc()]);
  // Thresholds
  const [fAlertThresholdType, setFAlertThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fAlertThresholdValue, setFAlertThresholdValue] = useState<string>("");
  const [fAlertInherit, setFAlertInherit] = useState(true);
  const [fBlockThresholdType, setFBlockThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fBlockThresholdValue, setFBlockThresholdValue] = useState<string>("");
  const [fBlockInherit, setFBlockInherit] = useState(true);
  
  // Global Thresholds Form
  const [fGlobalAlertThresholdType, setFGlobalAlertThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalAlertThresholdValue, setFGlobalAlertThresholdValue] = useState<string>("1.0");
  const [fGlobalBlockThresholdType, setFGlobalBlockThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalBlockThresholdValue, setFGlobalBlockThresholdValue] = useState<string>("5.0");
  type CalcSyncError = {
    step: "delete-calculavel" | "insert-calculavel" | "delete-informativo";
    message: string;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
    rowsAttempted?: number;
  };
  const [calcSyncErrors, setCalcSyncErrors] = useState<CalcSyncError[]>([]);
  const [calcSyncRuleId, setCalcSyncRuleId] = useState<string | null>(null);
  const [calcSyncAttempt, setCalcSyncAttempt] = useState(0);
  const [calcSyncRetrying, setCalcSyncRetrying] = useState(false);

  // Sub-Onda 2D / Rodada 3 — modal de conflitos (validate-rule-save)
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictProblems, setConflictProblems] = useState<ConflictProblem[]>([]);
  // Snapshot do payload em validação para o handler "aplicar e salvar"
  const [pendingRuleData, setPendingRuleData] = useState<Record<string, unknown> | null>(null);
  const [pendingCalcs, setPendingCalcs] = useState<Record<string, unknown>[]>([]);
  const [pendingIsUpdate, setPendingIsUpdate] = useState(false);
  const STEP_LABELS: Record<CalcSyncError["step"], string> = {
    "delete-calculavel": "Remover cálculos antigos (regra calculável)",
    "insert-calculavel": "Inserir novos cálculos",
    "delete-informativo": "Limpar cálculos (regra informativa)",
  };

  // Accordion: por padrão todas as seções começam FECHADAS ao abrir o modal —
  // facilita a navegação/busca. O usuário expande conforme precisa.
  const [accordionValue, setAccordionValue] = useState<string[]>([]);

  // parsedCodes removido — códigos restritivos vivem em cada Cálculo.

  // Erros por seção do formulário (feedback visual + auto-abrir seção com erro)
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
      if (fGroupLinks.length === 0 && fGroupDoctors.length === 0) e.aplicacao++;
    }
    // Erros por item de cálculo (somente quando a regra é Calculável)
    if (fNature === "calculavel") {
      if (fCalculations.length === 0) e.calculo++;
      const calcErrorsCount = fCalculations.reduce((acc, c) => acc + calcItemErrors(c), 0);
      e.calculo += calcErrorsCount;
      // Validação cruzada: 2+ cálculos tabela_diferenciada na MESMA tabela onde
      // algum cálculo não-primeiro tem code_match_mode='any' e sem códigos →
      // engole tudo e nunca cai nas regras posteriores. Restritivo deve estar
      // no próprio cálculo (não na regra geral).
      const tabByRef = new Map<string, number[]>();
      fCalculations.forEach((c, idx) => {
        if (c.calculation_type === "tabela_diferenciada" && c.reference_table_id) {
          const arr = tabByRef.get(c.reference_table_id) ?? [];
          arr.push(idx);
          tabByRef.set(c.reference_table_id, arr);
        }
      });
      tabByRef.forEach((idxs) => {
        if (idxs.length < 2) return;
        for (let i = 1; i < idxs.length; i++) {
          const c = fCalculations[idxs[i]];
          if (c.code_match_mode === "any" && (c.procedure_codes?.length ?? 0) === 0) {
            e.calculo++;
          }
        }
      });
    }
    return e;
  }, [
    fName, fRuleText, fValidFrom, fValidUntil, scope, fTargetIdentifier, fTargetName,
    targetType, fGroupLinks, fGroupDoctors, companyDoctorsMap,
    fNature, fCalculations,
  ]);

  // seleção em lote (atualmente sem ações em massa disponíveis após cleanup)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // filters
  const [filterScope, setFilterScope] = useState<"todos" | RuleScope>("todos");
  // filterSector removido — restritivos por Cálculo, não por Regra
  
  const [filterTarget, setFilterTarget] = useState("");
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
    
    // Configurações básicas
    doc.setFont("helvetica");
    
    // Cabeçalho
    doc.setFillColor(245, 245, 245);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setFontSize(20);
    doc.setTextColor(40, 40, 40);
    doc.text("MedPay - Detalhamento de Regra", 14, 25);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`ID: ${r.id}`, 14, 34);
    doc.text(`Exportado em: ${formatDateTimeBR(new Date().toISOString())}`, pageWidth - 14, 34, { align: 'right' });
    
    let currentY = 55;
    
    // Título da Regra
    doc.setFontSize(16);
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.text(r.name || "Sem nome", 14, currentY);
    currentY += 10;
    
    // Informações Básicas (Tabela)
    const basicInfo = [
      ["Campo", "Valor"],
      ["Convênio", r.agreement_name || "Todos"],
      ["Gravidade", (r.severity || "info").toUpperCase()],
      ["Escopo", RULE_SCOPE_LABELS[r.scope as RuleScope] ?? r.scope ?? "Master"],
      ["Vigência", `${r.valid_from ? formatDateBR(r.valid_from) : "Início"} → ${r.valid_until ? formatDateBR(r.valid_until) : "Fim"}`],
      ["Status", (() => {
        const isDateInactive = (r.valid_until && new Date(r.valid_until) < new Date());
        if (r.active === false) return "Inativa (Manual)";
        if (isDateInactive) return "Inativa (Expirada)";
        return "Ativa";
      })()]
    ];

    // Restritivos (setores, especialidades, convênios) vivem por Cálculo — não exibir aqui.

    if (r.time_mode && r.time_mode !== 'qualquer') {
        const mode = r.time_mode === 'comercial' ? 'Horário Comercial' : r.time_mode === 'plantao' ? 'Horário Plantão' : 'Personalizado';
        let val = mode;
        if (r.time_start && r.time_end) val += ` (${r.time_start} - ${r.time_end})`;
        basicInfo.push(["Janela Temporal", val]);
        
        if (r.weekdays && r.weekdays.length > 0) {
            const days = r.weekdays.map((d: number) => WEEKDAY_LABELS.find(l => l.v === d)?.label).join(", ");
            basicInfo.push(["Dias da Semana", days]);
        }
    }

    if (r.elective_mode && r.elective_mode !== 'qualquer') {
        basicInfo.push(["Tipo de Atendimento", ELECTIVE_MODE_LABELS[r.elective_mode as ElectiveMode] ?? r.elective_mode]);
    }

    autoTable(doc, {
      startY: currentY,
      head: [basicInfo[0]],
      body: basicInfo.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } }
    });
    
    currentY = (doc as any).lastAutoTable.finalY + 15;
    
    // Descrição e Texto
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(41, 128, 185);
    doc.text("Descrição da Regra", 14, currentY);
    currentY += 6;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const splitDesc = doc.splitTextToSize(r.description || "Nenhuma descrição fornecida.", pageWidth - 28);
    doc.text(splitDesc, 14, currentY);
    currentY += (splitDesc.length * 5) + 10;
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(41, 128, 185);
    doc.text("Texto Operacional / Lógica", 14, currentY);
    currentY += 6;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const splitText = doc.splitTextToSize(r.rule_text || "Sem texto operacional definido.", pageWidth - 28);
    doc.text(splitText, 14, currentY);
    currentY += (splitText.length * 5) + 15;

    // Configurações de Pagamento e Cálculo
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(41, 128, 185);
    doc.text("Configurações de Pagamento", 14, currentY);
    currentY += 5;

    const payInfo = [
      ["Configuração", "Valor"],
      ["Natureza", r.calculation_type === 'informativo' ? "Informativa" : "Calculável"],
      ["Tipo de Cálculo", RULE_CALCULATION_TYPE_LABELS[r.calculation_type as RuleCalculationType] ?? r.calculation_type ?? "N/A"]
    ];

    if (r.fixed_amount) payInfo.push(["Valor Fixo", formatCurrency(r.fixed_amount)]);
    if (r.convenio_percentage) payInfo.push(["% sobre Convênio", `${r.convenio_percentage}%`]);
    if (r.package_amount) payInfo.push(["Valor do Pacote", formatCurrency(r.package_amount)]);
    if (r.multiplier) payInfo.push(["Multiplicador", `× ${r.multiplier}`]);
    if (r.deflator_pct) payInfo.push(["Deflator (%)", `− ${r.deflator_pct}%`]);
    if (r.bonus_amount) payInfo.push(["Bônus Fixo", formatCurrency(r.bonus_amount)]);
    if (r.bonus_pct) payInfo.push(["Bônus (%)", `${r.bonus_pct}%`]);
    if (r.target_amount) payInfo.push(["Valor Alvo", formatCurrency(r.target_amount)]);
    if (Array.isArray(r.extras_codes) && r.extras_codes.length > 0) payInfo.push(["Códigos Extras", r.extras_codes.join(", ")]);
    
    if (r.include_auxiliaries) {
        let auxVal = "Sim";
        const parts = [];
        if (r.auxiliary_pct) parts.push(`Global: ${r.auxiliary_pct}%`);
        if (r.aux_first_pct) parts.push(`1º Aux: ${r.aux_first_pct}%`);
        if (r.aux_second_pct) parts.push(`2º Aux: ${r.aux_second_pct}%`);
        if (parts.length > 0) auxVal += ` (${parts.join(", ")})`;
        payInfo.push(["Inclui Auxiliares", auxVal]);
    }
    if (r.instrumentador_pct) payInfo.push(["Instrumentador", `${r.instrumentador_pct}%`]);

    if (r.calculation_type === 'pacote') {
        if (r.package_main_code) payInfo.push(["Código Principal (Pacote)", r.package_main_code]);
        if (Array.isArray(r.package_included_codes) && r.package_included_codes.length > 0) {
            payInfo.push(["Códigos Incluídos", r.package_included_codes.join(", ")]);
        }
    }

    if (r.calculation_type === 'exclusao' && r.exclusion_reason) {
        payInfo.push(["Motivo de Exclusão", r.exclusion_reason]);
        payInfo.push(["Permite Exceção Autorizada", r.allows_authorized_exception ? "Sim" : "Não"]);
    }

    autoTable(doc, {
      startY: currentY,
      head: [payInfo[0]],
      body: payInfo.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [52, 73, 94] },
      styles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // Vinculação / Alvos
    if (r.scope === 'especifica' || r.scope === 'grupo') {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(41, 128, 185);
        doc.text("Alvos e Vinculações", 14, currentY);
        currentY += 5;

        const targetInfo = [["Tipo de Alvo", "Identificação / Nome"]];
        if (r.scope === 'especifica') {
            const targetLabel = r.target_type === 'medico' ? 'Médico Específico' : 'Empresa Específica';
            const targetVal = `${r.target_identifier || ""} ${r.target_name || ""}`.trim() || "Não identificado";
            targetInfo.push([targetLabel, targetVal]);
        } else if (r.scope === 'grupo') {
            const links = Array.isArray(r.group_company_links) ? r.group_company_links : [];
            const coIds = Array.isArray(r.group_company_ids) ? r.group_company_ids : [];
            const gDocs = Array.isArray(r.group_doctors) ? r.group_doctors : [];
            
            if (links.length > 0) {
                links.forEach((l: any, idx: number) => {
                    const co = companies.find(c => c.id === l.company_id);
                    const coName = co ? co.name : (l.company_id || "Empresa");
                    const docs = Array.isArray(l.doctors) && l.doctors.length > 0 
                        ? l.doctors.map((d: any) => d.name).join(", ") 
                        : "Todos os médicos";
                    targetInfo.push([`Vínculo ${idx + 1}`, `${coName} | Médicos: ${docs}`]);
                });
            } else if (coIds.length > 0) {
                coIds.forEach((id: string, idx: number) => {
                    const co = companies.find(c => c.id === id);
                    const docs = gDocs.length > 0 ? gDocs.map((d: any) => d.name).join(", ") : "Todos";
                    targetInfo.push([`Empresa ${idx + 1}`, `${co ? co.name : id} | Médicos: ${docs}`]);
                });
            } else {
                targetInfo.push(["Grupo", "Nenhuma vinculação configurada"]);
            }
        }

        autoTable(doc, {
            startY: currentY,
            head: [targetInfo[0]],
            body: targetInfo.slice(1),
            theme: 'plain',
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } }
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
    }

    // Tabelas Vinculadas (códigos restritivos vivem por Cálculo)
    const hasRefTable = !!r.reference_table_id;
    const hasExceptions = Array.isArray(r.exception_table_ids) && r.exception_table_ids.length > 0;

    if (hasRefTable || hasExceptions) {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(41, 128, 185);
        doc.text("Tabelas Vinculadas", 14, currentY);
        currentY += 5;

        const tableLinks = [["Tipo de Vínculo", "Identificação / Nome"]];

        if (hasRefTable) {
            const ref = refTables.find((t: any) => t.id === r.reference_table_id);
            tableLinks.push(["Tabela de Referência", ref?.name || r.reference_table_id || "Não identificada"]);
        }

        if (hasExceptions) {
            r.exception_table_ids.forEach((id: string) => {
                const ref = refTables.find((t: any) => t.id === id);
                tableLinks.push(["Tabela de Exceção / Vínculo", ref?.name || id]);
            });
        }

        autoTable(doc, {
            startY: currentY,
            head: [tableLinks[0]],
            body: tableLinks.slice(1),
            theme: 'grid',
            styles: { fontSize: 9 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
        });
        currentY = (doc as any).lastAutoTable.finalY + 15;
    }

    // Médicos vinculados
    if (Array.isArray(r.doctors) && r.doctors.length > 0) {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(41, 128, 185);
        doc.text(`Médicos Vinculados (${r.doctors.length})`, 14, currentY);
        currentY += 5;

        const docInfo = [["Nome do Médico", "CRM"]];
        r.doctors.forEach((d: any) => docInfo.push([d.name, d.crm || "—"]));

        autoTable(doc, {
            startY: currentY,
            head: [docInfo[0]],
            body: docInfo.slice(1),
            theme: 'striped',
            styles: { fontSize: 8 },
            margin: { left: 14 }
        });
    }

    doc.save(`Regra_${(r.name || "Export").replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    toast({ title: "PDF Gerado", description: "O arquivo foi baixado com sucesso." });
  };

  const exportAllToPDF = () => {
    if (filtered.length === 0) return toast({ title: "Aviso", description: "Nenhuma regra para exportar." });
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(18);
    doc.text("Relatório Geral de Regras de Negócio", 14, 20);
    doc.setFontSize(10);
    doc.text(`Total de regras: ${filtered.length}`, 14, 28);
    doc.text(`Gerado em: ${formatDateTimeBR(new Date().toISOString())}`, pageWidth - 14, 28, { align: 'right' });
    
    const tableData = filtered.map(r => [
        r.name,
        r.agreement_name || "Todos",
        RULE_SCOPE_LABELS[r.scope as RuleScope] ?? r.scope,
        (r.severity || "info").toUpperCase(),
        r.active !== false ? "Sim" : "Não"
    ]);

    autoTable(doc, {
      startY: 35,
      head: [["Nome da Regra", "Convênio", "Escopo", "Gravidade", "Ativa"]],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [44, 62, 80] },
      styles: { fontSize: 8 }
    });

    doc.save("Relatorio_Geral_Regras.pdf");
    toast({ title: "Relatório Gerado", description: "O relatório geral foi baixado com sucesso." });
  };

  // Carrega médicos para cada empresa de link (cache no map).
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
        // Master table (preferencial)
        for (const r of (masterRes.data ?? []) as any[]) {
          const cid = String(r.company_id ?? "");
          const d = r.doctors;
          if (!cid || !d || !d.full_name || !byCo[cid]) continue;
          if (d.active === false) continue;
          const key = d.full_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          byCo[cid].set(key, { name: d.full_name, crm: d.crm ? `${d.crm}/${d.crm_uf}` : undefined });
        }
        // Payment items (fallback / complemento)
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



  const [fActive, setFActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const resetForm = () => {
    setEditingId(null);
    setFActive(true);
    setFName(""); setFDescription(""); setFRuleText("");
    setFSeverity("aviso");
    setScope("master"); setTargetType("medico");
    setFTargetIdentifier(""); setFTargetName("");
    setRefTableId(""); setFExceptionTableIds([]);
    setFCalculationType("informativo"); setFConvenioPct(""); setFFixedAmount(""); setFExtrasCodes("");
    setFNature("informativo");
    setFPackageAmount(""); setFBonusAmount(""); setFBonusPct(""); setFTargetAmount("");
    setFMultiplier(""); setFDeflatorPct(""); setFIncludeAux(false); setFAuxPct("");
    setFAuxFirstPct("30"); setFAuxSecondPct("20"); setFInstrumentadorPct("10");
    setFRepassePct(""); setFApplyAccessRoute(false);
    setFPackageMainCode(""); setFPackageIncludedCodes("");
    setFPackageVisitsCount(false); setFPackageOpinionsCount(false); setFPackageAuxIncluded(true);
    setFPackageSubtype("fechado");
    setFExclusionReason("");
    setFAllowsAuthorizedException(false);
    setFValidFrom(""); setFValidUntil(""); setFDoctors([]);
    
    setFGroupCompanyIds([]); setFGroupDoctors([]); setFGroupMode("empresa"); setFGroupLinks([]);
    setCollapsedCompanies(new Set()); setCompanyLinksFilter("");
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
    setFSeverity(r.severity ?? "aviso");
    setScope(r.scope ?? "master"); setTargetType((r.target_type as RuleTargetType) ?? "medico");
    setFTargetIdentifier(r.target_identifier ?? ""); setFTargetName(r.target_name ?? "");
    const calc = (r.calculation_type as RuleCalculationType) ?? "informativo";
    setFCalculationType(calc);
    // fNature será derivado após carregar calcRows (abaixo).
    setFConvenioPct(r.convenio_percentage != null ? String(r.convenio_percentage) : "");
    setFFixedAmount(r.fixed_amount != null ? String(r.fixed_amount) : "");
    setFExtrasCodes(Array.isArray(r.extras_codes) ? r.extras_codes.join(", ") : "");
    setRefTableId(r.reference_table_id ?? "");
    setFExceptionTableIds(Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []);
    // procedure_codes legados ignorados — agora vivem por Cálculo.
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
    // sectors/specialties/agreement_* legados ignorados — restritivos vivem por Cálculo.
    setFValidFrom(r.valid_from ?? "");
    setFValidUntil(r.valid_until ?? "");
    setFDoctors([]);
    const glinks = Array.isArray((r as any).group_company_links) ? (r as any).group_company_links : [];
    setFGroupCompanyIds([]);
    setFGroupDoctors(Array.isArray((r as any).group_doctors) ? (r as any).group_doctors : []);
    setFGroupMode("empresa");
    setFGroupLinks(glinks.map((l: any) => ({ company_id: l.company_id, doctors: Array.isArray(l.doctors) ? l.doctors : [] })));
    // Colapsa todas as empresas pré-existentes ao carregar uma regra.
    setCollapsedCompanies(new Set(glinks.map((l: any) => l.company_id).filter(Boolean)));
    setCompanyLinksFilter("");
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
    // Carrega itens de cálculo (1:N) — se não houver, monta um a partir dos
    // campos legados da própria regra para retrocompatibilidade.
    const { data: calcRows } = await supabase
      .from("rule_calculations")
      .select("*")
      .eq("rule_id", r.id)
      .order("sort_order", { ascending: true });
    if (calcRows && calcRows.length > 0) {
      setFCalculations(calcRows.map(calcFromDb));
      // Derivar natureza dos cálculos reais — se existem rule_calculations, é calculável.
      setFNature("calculavel");
    } else {
      // monta 1 item a partir da própria regra (retrocompatibilidade)
      setFCalculations([calcFromDb({
        ...r,
        // coerções para o helper
        time_mode: tMode, weekdays: wdays, time_start: tStart, time_end: tEnd,
        includes_holidays: r.includes_holidays, elective_mode: eMode,
      })]);
      // Fallback para regras legadas sem rule_calculations: usa campo legado.
      setFNature(calc === "informativo" ? "informativo" : "calculavel");
    }
    // Thresholds
    setFAlertThresholdType(r.limiar_alerta_tipo || "percentual");
    setFAlertThresholdValue(r.limiar_alerta_valor != null ? String(r.limiar_alerta_valor) : "");
    setFAlertInherit(r.limiar_alerta_valor == null);
    
    setFBlockThresholdType(r.limiar_bloqueio_tipo || "percentual");
    setFBlockThresholdValue(r.limiar_bloqueio_valor != null ? String(r.limiar_bloqueio_valor) : "");
    setFBlockInherit(r.limiar_bloqueio_valor == null);

    // Todas as seções iniciam fechadas ao abrir uma regra para edição.
    setAccordionValue([]);
    setOpen(true);
  };
  const openDuplicate = (r: RuleRow) => {
    openEdit(r, true);
    toast({ title: "Copiando regra", description: "Ajuste os campos e salve para criar a nova regra." });
  };

  /**
   * Sub-Onda 2D / Rodada 3 — chamada única à RPC `apply_rule_save_with_corrections`.
   * Substitui o caminho antigo (insert/update + runCalcSync). A RPC é
   * atômica: aplica correções, faz upsert da regra e re-sincroniza
   * rule_calculations em uma transação só. Auditoria adicional fica no
   * cliente para preservar o `buildDiff` rico (a RPC já loga via
   * `update_via_rpc`/`create_via_rpc`).
   */
  const applyRuleSaveRpc = async (
    ruleData: Record<string, unknown>,
    calcs: Record<string, unknown>[],
    corrections: ConflictCorrection[],
    meta: { wasEditing: boolean; auditCompany: { id: string | null; name: string | null; document: string | null } | null },
  ) => {
    const before = meta.wasEditing && ruleData.id
      ? rules.find((r) => r.id === ruleData.id) ?? null
      : null;
    // Captura estado anterior dos cálculos ANTES da RPC (que faz delete+insert).
    let prevCalcs: any[] | null = null;
    if (meta.wasEditing && ruleData.id) {
      const { data: pc } = await supabase
        .from("rule_calculations")
        .select("*")
        .eq("rule_id", ruleData.id as string)
        .order("sort_order");
      prevCalcs = pc ?? [];
    }
    const { data, error } = await supabase.rpc("apply_rule_save_with_corrections", {
      _rule_data: ruleData as any,
      _calculations: calcs as any,
      _corrections: corrections as any,
    });
    if (error) {
      throw new Error(error.message);
    }
    const result = data as { rule_id?: string; is_update?: boolean; corrections_applied?: number } | null;
    const savedId = (result?.rule_id as string | undefined) ?? (ruleData.id as string | undefined) ?? null;
    if (savedId) {
      await recordAudit({
        entityType: "rule", entityId: savedId, action: meta.wasEditing ? "update" : "create",
        actorId: user!.id, company: meta.auditCompany,
        diff: buildDiff(before as any, ruleData as any),
      });
      // Auditoria por cálculo — registra diff financeiro de cada rule_calculation.
      const FINANCIAL_FIELDS = [
        "label", "calculation_type", "convenio_percentage", "fixed_amount",
        "multiplier", "deflator_pct", "repasse_pct", "acrescimo_pct",
        "package_amount", "bonus_amount", "bonus_pct", "target_amount",
        "reference_table_id", "aux_first_pct", "aux_second_pct", "instrumentador_pct",
        "procedure_codes", "sectors", "doctor_roles", "agreement_aliases",
        "time_mode", "weekdays", "elective_mode", "sort_order",
      ];
      const pick = (src: any) =>
        Object.fromEntries(FINANCIAL_FIELDS.filter((f) => src && f in src).map((f) => [f, src[f]]));

      const { data: savedCalcs } = await supabase
        .from("rule_calculations")
        .select("*")
        .eq("rule_id", savedId)
        .order("sort_order");

      const prevByKey = new Map<string, any>();
      (prevCalcs ?? []).forEach((p: any, idx: number) => {
        prevByKey.set(p.id, p);
        prevByKey.set(`__idx_${idx}`, p);
      });

      for (let i = 0; i < (savedCalcs ?? []).length; i++) {
        const cur = (savedCalcs as any[])[i];
        const prev = prevByKey.get(cur.id) ?? prevByKey.get(`__idx_${i}`) ?? null;
        const calcDiff = buildDiff(prev ? pick(prev) : null, pick(cur));
        if (Object.keys(calcDiff).length === 0) continue;
        await recordAudit({
          entityType: "rule_calculation",
          entityId: cur.id,
          action: prev ? "update" : "create",
          actorId: user!.id,
          company: meta.auditCompany,
          diff: {
            __rule_id: { before: null, after: savedId },
            __calc_index: { before: null, after: i },
            __calc_label: { before: null, after: cur.label ?? cur.calculation_type },
            ...calcDiff,
          },
        });
      }
    }
    if ((result?.corrections_applied ?? 0) > 0) {
      toast({
        title: meta.wasEditing ? "Regra atualizada com correções" : "Regra criada com correções",
        description: `${result?.corrections_applied} regra(s) anterior(es) foram encerradas automaticamente.`,
      });
    } else {
      toast({ title: meta.wasEditing ? "Regra atualizada" : "Regra criada" });
    }
    setOpen(false);
    resetForm();
    load();
    setConflictOpen(false);
    setConflictProblems([]);
    setPendingRuleData(null);
    setPendingCalcs([]);
  };

  /** Handler do modal: aplica correções escolhidas + grava via RPC. */
  const handleConflictApply = async (corrections: ConflictCorrection[]) => {
    if (!pendingRuleData) throw new Error("Estado de save perdido — reabra o formulário.");
    const auditCompany = (pendingRuleData.target_type === "empresa" && pendingRuleData.target_identifier)
      ? { id: (pendingRuleData.target_company_id as string | null) ?? null,
          name: (pendingRuleData.target_name as string | null) ?? null,
          document: (pendingRuleData.target_identifier as string | null) ?? null }
      : null;
    await applyRuleSaveRpc(pendingRuleData, pendingCalcs, corrections, {
      wasEditing: pendingIsUpdate, auditCompany,
    });
  };

  const submitRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
    // Abre automaticamente seções com erro para feedback imediato
    const sectionsWithErr = Object.entries(sectionErrors).filter(([, n]) => n > 0).map(([k]) => k);
    if (sectionsWithErr.length > 0) {
      setAccordionValue((prev) => Array.from(new Set([...prev, ...sectionsWithErr])));
      toast({ title: "Revise os campos destacados", description: `${sectionsWithErr.length} seção(ões) com pendência.`, variant: "destructive" });
      return;
    }
    const isEspecifica = scope === "especifica";
    // Restritivos e parâmetros de cálculo vivem APENAS em rule_calculations.
    // O nível Regra guarda só identificação, escopo e limiares.
    const head = fCalculations[0] ?? makeEmptyCalc();
    const effectiveCalc: RuleCalculationType =
      fNature === "informativo" ? "informativo" : head.calculation_type;
    const payload: any = {
      active: fActive,
      name: fName, description: fDescription || null, rule_text: fRuleText,
      severity: fSeverity, scope,
      target_type: isEspecifica ? targetType : null,
      target_identifier: isEspecifica ? (fTargetIdentifier || null) : null,
      target_name: isEspecifica ? (fTargetName || null) : null,
      calculation_type: effectiveCalc,
      // ===== Campos de cálculo: TODOS nulos no nível Regra =====
      convenio_percentage: null,
      fixed_amount: null,
      extras_codes: null,
      package_amount: null,
      package_main_code: null,
      package_included_codes: null,
      package_visits_count: false,
      package_opinions_count: false,
      package_auxiliaries_included: false,
      package_subtype: null,
      bonus_amount: null,
      bonus_pct: null,
      target_amount: null,
      multiplier: null,
      deflator_pct: null,
      reference_table_id: null,
      include_auxiliaries: false,
      auxiliary_pct: null,
      aux_first_pct: null,
      aux_second_pct: null,
      instrumentador_pct: null,
      repasse_pct: null,
      apply_access_route: false,
      agreement_name: null,
      agreement_match_mode: "whitelist",
      // ===== Campos próprios da Regra =====
      exclusion_reason: effectiveCalc === "exclusao" ? (fExclusionReason || null) : null,
      allows_authorized_exception: effectiveCalc === "exclusao" ? fAllowsAuthorizedException : false,
      exception_table_ids: fExceptionTableIds,
      valid_from: fValidFrom || null,
      valid_until: fValidUntil || null,
      group_company_links: scope === "grupo" ? fGroupLinks.filter((l) => !!l.company_id) : [],
      group_doctors: scope === "grupo" ? fGroupDoctors : [],
      time_mode: "qualquer",
      weekdays: [],
      includes_holidays: false,
      time_start: null,
      time_end: null,
      elective_mode: "qualquer",
      has_conditions: false,
      limiar_alerta_tipo: fAlertInherit ? null : fAlertThresholdType,
      limiar_alerta_valor: fAlertInherit ? null : num(fAlertThresholdValue),
      limiar_bloqueio_tipo: fBlockInherit ? null : fBlockThresholdType,
      limiar_bloqueio_valor: fBlockInherit ? null : num(fBlockThresholdValue),
    };
    if (isEspecifica && !payload.target_identifier && !payload.target_name) {
      return toast({ title: "Informe CPF/CNPJ ou nome do alvo", variant: "destructive" });
    }
    
    // Validação de limiares
    if (!fAlertInherit && !fBlockInherit && fAlertThresholdType === fBlockThresholdType) {
      const alertV = num(fAlertThresholdValue) ?? 0;
      const blockV = num(fBlockThresholdValue) ?? 0;
      if (blockV <= alertV) {
        return toast({ title: "Limiar de bloqueio inválido", description: "O valor de bloqueio deve ser maior que o de alerta quando usam a mesma unidade.", variant: "destructive" });
      }
    }
    if (!fAlertInherit && !fBlockInherit && fAlertThresholdType !== fBlockThresholdType) {
      toast({ title: "Atenção", description: "Tipos de limiar diferentes (alerta vs bloqueio) podem gerar comportamento inesperado." });
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

    // === Sub-Onda 2D / Rodada 3 ===
    // O caminho antigo (insert/update direto + runCalcSync) foi removido.
    // Toda a persistência passa pela RPC `apply_rule_save_with_corrections`
    // (atomic: regra + cálculos + correções de regras anteriores).
    // Antes da RPC, chamamos a edge function `validate-rule-save` para
    // detectar conflitos. Se houver, abrimos o modal e o save real só
    // acontece quando o usuário clica "Aplicar correções e salvar".
    const ruleData: Record<string, unknown> = {
      ...payload,
      ...(editingId ? { id: editingId } : {}),
    };
    const calcsForRpc: Record<string, unknown>[] =
      fNature === "calculavel"
        ? fCalculations.map((c, i) => {
            const row = calcToDbPayload(c, "00000000-0000-0000-0000-000000000000", i);
            // RPC seta rule_id internamente; remove para evitar redundância.
            const { rule_id: _omit, ...rest } = row as { rule_id?: string };
            return rest;
          })
        : [];

    // 1) Validação preventiva via edge function
    const { data: validation, error: valErr } = await supabase.functions.invoke(
      "validate-rule-save",
      {
        body: {
          rule_id: editingId ?? null,
          scope,
          target_type: payload.target_type,
          target_identifier: payload.target_identifier,
          target_company_id: payload.target_company_id,
          group_doctors: payload.group_doctors,
          group_company_links: payload.group_company_links,
          valid_from: payload.valid_from,
          valid_until: payload.valid_until,
          calculations: calcsForRpc,
        },
      },
    );
    if (valErr) {
      toast({ title: "Erro na validação", description: valErr.message, variant: "destructive" });
      return;
    }
    const problems = (validation?.problems ?? []) as ConflictProblem[];

    // 2) Sem problemas → save direto via RPC
    if (problems.length === 0) {
      await applyRuleSaveRpc(ruleData, calcsForRpc, [], { wasEditing: !!editingId, auditCompany });
      return;
    }

    // 3) Com problemas → guarda payload e abre modal
    setPendingRuleData(ruleData);
    setPendingCalcs(calcsForRpc);
    setPendingIsUpdate(!!editingId);
    setConflictProblems(problems);
    setConflictOpen(true);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** Executa o delete + insert dos rule_calculations e devolve a lista de erros. */
  const runCalcSync = async (
    ruleId: string,
    nature: typeof fNature,
    calcs: CalcItem[],
    attempt: number,
  ): Promise<CalcSyncError[]> => {
    const errors: CalcSyncError[] = [];
    if (nature === "calculavel") {
      const { error: delErr } = await supabase
        .from("rule_calculations")
        .delete()
        .eq("rule_id", ruleId);
      if (delErr) {
        errors.push({
          step: "delete-calculavel",
          message: delErr.message,
          code: (delErr as any).code ?? null,
          details: (delErr as any).details ?? null,
          hint: (delErr as any).hint ?? null,
        });
      } else {
        const rows = calcs.map((c, i) => calcToDbPayload(c, ruleId, i));
        if (rows.length > 0) {
          const { error: insErr } = await supabase
            .from("rule_calculations")
            .insert(rows as any);
          if (insErr) {
            errors.push({
              step: "insert-calculavel",
              message: insErr.message,
              code: (insErr as any).code ?? null,
              details: (insErr as any).details ?? null,
              hint: (insErr as any).hint ?? null,
              rowsAttempted: rows.length,
            });
          } else if (attempt > 1) {
            toast({ title: `${rows.length} cálculo(s) sincronizado(s) (tentativa ${attempt})` });
          } else {
            toast({ title: `${rows.length} cálculo(s) sincronizado(s)` });
          }
        }
      }
    } else if (nature === "informativo") {
      const { error: delErr } = await supabase
        .from("rule_calculations")
        .delete()
        .eq("rule_id", ruleId);
      if (delErr) {
        errors.push({
          step: "delete-informativo",
          message: delErr.message,
          code: (delErr as any).code ?? null,
          details: (delErr as any).details ?? null,
          hint: (delErr as any).hint ?? null,
        });
      }
    }
    return errors;
  };

  /** Refaz a sincronização sem precisar reenviar o formulário. */
  const retryCalcSync = async () => {
    if (!calcSyncRuleId || calcSyncRetrying) return;
    const nextAttempt = calcSyncAttempt + 1;
    setCalcSyncRetrying(true);
    setCalcSyncAttempt(nextAttempt);
    try {
      const errors = await runCalcSync(calcSyncRuleId, fNature, fCalculations, nextAttempt);
      setCalcSyncErrors(errors);
      if (errors.length === 0) {
        toast({ title: "Cálculos sincronizados com sucesso" });
        setOpen(false);
        resetForm();
        load();
      } else {
        toast({
          title: `Tentativa ${nextAttempt}: ${errors.length} etapa(s) ainda falham`,
          variant: "destructive",
        });
      }
    } finally {
      setCalcSyncRetrying(false);
    }
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
        active: true,
        name: r.name ?? "", description: r.description ?? "", rule_text: r.rule_text ?? "",
        severity: r.severity ?? "aviso", scope: r.scope ?? "master",
        target_type: r.target_type ?? null, target_identifier: r.target_identifier ?? null, target_name: r.target_name ?? null,
        calculation_type: (r.calculation_type as RuleCalculationType) ?? "informativo",
        convenio_percentage: r.convenio_percentage ?? null,
        fixed_amount: r.fixed_amount ?? r.bonus_amount ?? r.target_amount ?? null,
        extras_codes: Array.isArray(r.extras_codes) ? r.extras_codes : [],
        package_amount: r.package_amount ?? null, bonus_amount: r.bonus_amount ?? null, bonus_pct: r.bonus_pct ?? null,
        target_amount: r.target_amount ?? null, multiplier: r.multiplier ?? null, deflator_pct: r.deflator_pct ?? null,
        reference_table_id: null, procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
        sectors: Array.isArray(r.sectors) ? r.sectors : (r.sector ? [r.sector] : []),
        specialties: Array.isArray(r.specialties) ? r.specialties : [],
        valid_from: r.valid_from ?? null,
        valid_until: r.valid_until ?? null,
      }));
      setDrafts(ds); setImportOpen(false); setReviewOpen(true); setImportText(""); setImportFile(null);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally { setImporting(false); }
  };

  const updateDraft = (i: number, patch: Partial<DraftRule>) => setDrafts((ds) => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  const saveDrafts = async () => {
    const sel = drafts.filter((d) => d.active);
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
    // Sub-Onda 2D / Rodada 3 — batch via RPC com validação por item.
    // UX: não abrir modal por item (ruim com 30 regras seguidas). Em vez
    // disso, validamos cada draft, pulamos os que tiverem conflitos e
    // mostramos relatório consolidado ao final.
    const skipped: { name: string; reasons: string[] }[] = [];
    let savedCount = 0;
    for (const d of sel) {
      const { procedure_codes: _pc, sectors: _s, specialties: _sp, ...rest } = d;
      const ruleData: Record<string, unknown> = {
        ...rest,
        description: d.description || null,
        target_type: d.scope === "especifica" ? d.target_type : null,
        target_identifier: d.scope === "especifica"
          ? (d.target_type === "empresa" && d.target_identifier ? formatCNPJ(d.target_identifier) : d.target_identifier)
          : null,
        target_name: d.scope === "especifica" ? d.target_name : null,
        target_company_id: (d.scope === "especifica" && d.target_type === "empresa")
          ? (companies.find((c) => c.document && d.target_identifier && onlyDigits(c.document) === onlyDigits(d.target_identifier))?.id ?? null)
          : null,
      };

      // 1) Validação preventiva (drafts não têm cálculos — array vazio)
      const { data: validation, error: valErr } = await supabase.functions.invoke(
        "validate-rule-save",
        {
          body: {
            rule_id: null,
            scope: d.scope,
            target_type: ruleData.target_type,
            target_identifier: ruleData.target_identifier,
            target_company_id: ruleData.target_company_id,
            group_doctors: null,
            group_company_links: null,
            valid_from: d.valid_from ?? null,
            valid_until: d.valid_until ?? null,
            calculations: [],
          },
        },
      );
      if (valErr) {
        skipped.push({ name: d.name || "(sem nome)", reasons: [valErr.message] });
        continue;
      }
      const probs = (validation?.problems ?? []) as ConflictProblem[];
      if (probs.length > 0) {
        skipped.push({
          name: d.name || "(sem nome)",
          reasons: probs.map((p) => {
            switch (p.type) {
              case "doctor_already_bound": return `médico CRM ${p.doctor_crm} já vinculado a "${p.existing_rule_name}"`;
              case "company_already_bound": return `empresa ${p.company_key} já vinculada a "${p.existing_rule_name}"`;
              case "validity_overlap": return `vigência sobreposta a "${p.existing_rule_name}"`;
              case "master_already_exists": return `já existe master vigente: "${p.existing_rule_name}"`;
              case "calc_overlap": return `sobreposição entre cálculos ${p.calc_a_label} e ${p.calc_b_label}`;
            }
          }),
        });
        continue;
      }

      // 2) Save via RPC (batch não aplica correções — pula em conflito)
      const { data, error } = await supabase.rpc("apply_rule_save_with_corrections", {
        _rule_data: ruleData as any,
        _calculations: [] as any,
        _corrections: [] as any,
      });
      if (error) {
        skipped.push({ name: d.name || "(sem nome)", reasons: [error.message] });
        continue;
      }
      const result = data as { rule_id?: string } | null;
      if (result?.rule_id) {
        const company = (d.scope === "especifica" && d.target_type === "empresa") ? {
          id: (ruleData.target_company_id as string | null) ?? null,
          name: d.target_name ?? null,
          document: d.target_identifier ?? null,
        } : null;
        await recordAudit({
          entityType: "rule", entityId: result.rule_id, action: "create",
          actorId: user!.id, company,
          diff: buildDiff(null, ruleData as any),
        });
      }
      savedCount += 1;
    }

    setReviewOpen(false); setDrafts([]); load();
    if (skipped.length === 0) {
      toast({ title: `${savedCount} regra(s) salva(s)` });
    } else {
      const detail = skipped.map((s) => `• ${s.name}: ${s.reasons.join("; ")}`).join("\n");
      toast({
        title: `${savedCount} salva(s), ${skipped.length} pulada(s) por conflito`,
        description: detail.length > 400 ? detail.slice(0, 400) + "…" : detail,
        variant: skipped.length > 0 ? "destructive" : "default",
      });
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta regra?")) return;
    await supabase.from("rules").delete().eq("id", id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    load();
  };

  // filtered + grouped
  const filtered = useMemo(() => {
    return rules.filter((r) => {
      if (filterScope !== "todos" && r.scope !== filterScope) return false;
      if (onlyIncomplete && !isIncomplete(r)) return false;
      if (filterTarget.trim() && !`${r.target_name ?? ""} ${r.target_identifier ?? ""}`.toLowerCase().includes(filterTarget.toLowerCase())) return false;
      return true;
    });
  }, [rules, filterScope, filterTarget, onlyIncomplete]);

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
    const ct = r.calculation_type as RuleCalculationType | undefined;
    if (ct === "pacote" && r.package_amount != null) return <span className="text-xs font-medium">{formatCurrency(r.package_amount)} (pacote)</span>;
    if (ct === "tabela_diferenciada") {
      const ref = refTables.find((t) => t.id === r.reference_table_id);
      const parts = [ref?.name ?? "tabela", r.multiplier ? `× ${r.multiplier}` : null, r.deflator_pct ? `− ${r.deflator_pct}%` : null].filter(Boolean);
      return <span className="text-xs font-medium">{parts.join(" ")}</span>;
    }
    if (ct === "bonus") return <span className="text-xs font-medium">{r.bonus_amount != null ? `+${formatCurrency(r.bonus_amount)}` : r.bonus_pct != null ? `+${r.bonus_pct}%` : "bônus"}</span>;
    if (ct === "complemento" && r.target_amount != null) return <span className="text-xs font-medium">complementa até {formatCurrency(r.target_amount)}</span>;
    if (ct === "valor_fixo" && r.fixed_amount != null) return <span className="text-xs font-medium">{formatCurrency(r.fixed_amount)} (fixo)</span>;
    return null;
  };

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAllVisible = () => setSelected(new Set(filtered.map((r) => r.id)));
  const selectAllIncomplete = () => setSelected(new Set(rules.filter(isIncomplete).map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  return (
    <>
      <PageHeader title="Regras de Pagamento" icon={BadgeDollarSign} description="A IA usa essas regras para analisar cada pagamento."
        actions={<>
          <Button variant="outline" onClick={exportAllToPDF}><FileDown className="h-4 w-4 mr-2" /> Exportar Relatório</Button>
          <Dialog open={globalConfigOpen} onOpenChange={setGlobalConfigOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Wand2 className="h-4 w-4 mr-2" /> Configurações Gerais
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Limiares padrão de divergência</DialogTitle>
                <DialogDescription>
                  Define os valores globais herdados por todas as regras que não possuem limiares personalizados.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                {/* Alerta */}
                <div className="space-y-3">
                  <Label className="text-warning-foreground font-bold uppercase text-xs">Alerta Padrão (Amarelo)</Label>
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px]">Tipo</Label>
                      <Select value={fGlobalAlertThresholdType} onValueChange={(v: any) => setFGlobalAlertThresholdType(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentual">Percentual (%)</SelectItem>
                          <SelectItem value="absoluto">Absoluto (R$)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px]">Valor</Label>
                      <Input value={fGlobalAlertThresholdValue} onChange={(e) => setFGlobalAlertThresholdValue(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Bloqueio */}
                <div className="space-y-3">
                  <Label className="text-destructive font-bold uppercase text-xs">Bloqueio Padrão (Vermelho)</Label>
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px]">Tipo</Label>
                      <Select value={fGlobalBlockThresholdType} onValueChange={(v: any) => setFGlobalBlockThresholdType(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentual">Percentual (%)</SelectItem>
                          <SelectItem value="absoluto">Absoluto (R$)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-[10px]">Valor</Label>
                      <Input value={fGlobalBlockThresholdValue} onChange={(e) => setFGlobalBlockThresholdValue(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGlobalConfigOpen(false)}>Cancelar</Button>
                <Button onClick={saveGlobalThresholds}>Salvar Configurações</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={downloadTemplate}>
                <FileDown className="h-4 w-4 mr-2" /> Modelo
              </Button>
              <DialogTrigger asChild>
                <Button variant="outline"><Sparkles className="h-4 w-4 mr-2" /> Importar com IA</Button>
              </DialogTrigger>
            </div>
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

          <Button onClick={() => { resetForm(); setOpen(true); }}><Plus className="h-4 w-4 mr-2" /> Nova regra</Button>
          <FormDialog
            open={open}
            onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}
            title={editingId ? "Editar regra" : "Nova regra"}
            description={editingId ? "Atualize os campos e salve." : undefined}
            maxWidth="6xl"
            footer={
              <div className="w-full flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" form="rule-form">
                  {editingId ? "Atualizar" : "Criar"}
                </Button>
              </div>
            }
          >
            {editingId ? (
              <Tabs defaultValue="form" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-3">
                  <TabsTrigger value="form">Formulário</TabsTrigger>
                  <TabsTrigger value="history">
                    <History className="h-4 w-4 mr-1.5" /> Histórico
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="history" className="mt-0">
                  <RuleHistoryTab ruleId={editingId} />
                </TabsContent>
                <TabsContent value="form" className="mt-0">
                  <form id="rule-form" onSubmit={submitRule} className="space-y-4">
                    {calcSyncErrors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 font-semibold text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                        Falha ao sincronizar cálculos ({calcSyncErrors.length} etapa{calcSyncErrors.length > 1 ? "s" : ""})
                        {calcSyncAttempt > 0 && (
                          <span className="text-muted-foreground font-normal">· tentativa {calcSyncAttempt}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={retryCalcSync}
                          disabled={calcSyncRetrying || !calcSyncRuleId}
                        >
                          {calcSyncRetrying
                            ? `Tentando… (${calcSyncAttempt})`
                            : `Tentar novamente (próxima: ${calcSyncAttempt + 1})`}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCalcSyncErrors([])} disabled={calcSyncRetrying}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-muted-foreground">
                      A regra foi salva, mas as etapas abaixo falharam. Use “Tentar novamente” para reexecutar o delete e o insert sem reenviar o formulário.
                    </div>
                    <ul className="space-y-2">
                      {calcSyncErrors.map((err, i) => (
                        <li key={i} className="rounded border border-destructive/30 bg-background p-2 space-y-1">
                          <div className="font-semibold">{STEP_LABELS[err.step]}</div>
                          <div className="font-mono break-all whitespace-pre-wrap text-destructive">{err.message}</div>
                          {err.code && <div><span className="font-semibold">Código:</span> <span className="font-mono">{err.code}</span></div>}
                          {err.details && <div><span className="font-semibold">Detalhes:</span> <span className="font-mono break-all whitespace-pre-wrap">{err.details}</span></div>}
                          {err.hint && <div><span className="font-semibold">Dica:</span> {err.hint}</div>}
                          {typeof err.rowsAttempted === "number" && (
                            <div><span className="font-semibold">Linhas tentadas:</span> {err.rowsAttempted}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Resumo dinâmico */}
                {(() => {
                  const onde =
                    scope === "master" ? "Todos os itens (master)"
                    : scope === "especifica" ? `Específica · ${RULE_TARGET_TYPE_LABELS[targetType]}${fTargetName ? ` "${fTargetName}"` : ""}`
                    : scope === "grupo"
                      ? (() => {
                          const parts: string[] = [];
                          for (const link of fGroupLinks) {
                            if (!link.company_id) continue;
                            const co = companies.find((c) => c.id === link.company_id);
                            const nm = co?.name ?? link.company_id.slice(0, 8);
                            parts.push(`${nm} — ${link.doctors.length === 0 ? "todos os médicos" : `${link.doctors.length} médico(s) específico(s)`}`);
                          }
                          if (fGroupDoctors.length > 0) parts.push(`Médicos avulsos: ${fGroupDoctors.map((d) => d.name).join(", ")}`);
                          return parts.length ? `Aplica para ${parts.join("; ")}` : "Grupo · adicione empresa(s) ou médico(s) avulso(s)";
                        })()
                      : RULE_SCOPE_LABELS[scope];
                  const calc = fNature === "informativo"
                    ? "Informativa / bloqueio (não calcula)"
                    : fCalculations.length > 1
                      ? `${fCalculations.length} cálculos (somados quando casarem)`
                      : `${RULE_CALCULATION_TYPE_LABELS[fCalculations[0]?.calculation_type ?? "informativo"]}`;
                  const cond: string[] = [];
                  const condItems = fCalculations.filter((c) => c.has_conditions);
                  if (fNature === "calculavel" && condItems.length > 0) {
                    cond.push(`${condItems.length} cálculo(s) com janela específica`);
                  } else {
                    cond.push("qualquer dia/horário/tipo");
                  }
                  return (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
                      <div><span className="font-semibold">Onde aplica:</span> {onde}</div>
                      <div><span className="font-semibold">Como calcula:</span> {calc}</div>
                      <div><span className="font-semibold">Condições:</span> {cond.join(" · ")}</div>
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
                    <AccordionContent className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox id="rule-active" checked={fActive} onCheckedChange={(v) => setFActive(!!v)} />
                        <Label htmlFor="rule-active" className="cursor-pointer font-semibold">Regra Ativa</Label>
                        <span className="text-xs text-muted-foreground">(Inativa = motor ignora esta regra)</span>
                      </div>
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
                      {/* Setor (multi) e Convênio (eixo determinístico) removidos do nível Regra.
                          Toda restrição (setor, convênio, código, especialidade, horário, via, função)
                          agora é configurada dentro de cada item de Cálculo, na seção
                          "Quando aplicar este cálculo". Isso permite múltiplos cálculos por regra
                          com escopos completamente diferentes. */}
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

                  {/* Accordion "Especialidades vinculadas" removido —
                      especialidade é apenas metadado de relatório/filtro e nunca afeta cálculo. */}

                  {/* Aplicação da regra */}
                  <AccordionItem value="aplicacao" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.aplicacao > 0 && "text-destructive")}>
                      <span className="flex items-center">Alvos e Filtros (Aplicação)
                        {sectionErrors.aplicacao > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{sectionErrors.aplicacao}</span>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
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
                            <div className="space-y-2">
                              <div className="space-y-1.5">
                                <Label>Médico cadastrado</Label>
                                <DoctorCombobox
                                  value={fTargetName ? { id: "__sel__", name: fTargetName, crm: fTargetIdentifier || null, crm_uf: null } : null}
                                  onChange={(d) => {
                                    setFTargetName(d?.name ?? "");
                                    setFTargetIdentifier(d?.crm ?? "");
                                  }}
                                  placeholder="Buscar médico…"
                                  className="w-full"
                                />
                                <p className="text-xs text-muted-foreground">Puxa nome e CRM direto do cadastro de médicos.</p>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5"><Label>CRM (ou Identificador)</Label>
                                  <Input value={fTargetIdentifier} onChange={(e) => setFTargetIdentifier(e.target.value)} maxLength={30} />
                                </div>
                                <div className="space-y-1.5"><Label>Nome</Label>
                                  <Input value={fTargetName} onChange={(e) => setFTargetName(e.target.value)} maxLength={150} />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {scope === "grupo" && (() => {
                        const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                        const usedIds = new Set(fGroupLinks.map((l) => l.company_id).filter(Boolean));
                        const dupIds = new Set<string>();
                        const seen = new Set<string>();
                        for (const l of fGroupLinks) {
                          if (!l.company_id) continue;
                          if (seen.has(l.company_id)) dupIds.add(l.company_id);
                          seen.add(l.company_id);
                        }
                        return (
                          <div className="space-y-4 animate-fade-in">
                            {/* Tabela de vínculos por empresa */}
                            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <Label className="text-sm font-semibold">Vínculos por empresa</Label>
                                  <p className="text-xs text-muted-foreground">Use quando o acordo é com a PJ. Cada linha = uma empresa. Deixe os médicos vazios para aplicar a toda a equipe da PJ, ou selecione médicos específicos dentro daquela PJ.</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {fGroupLinks.length > 1 && (
                                    <Button
                                      type="button" size="sm" variant="ghost"
                                      onClick={() => {
                                        setFGroupLinks(prev => [...prev].sort((a, b) => {
                                          const nameA = (a as any).company_name || companies.find(c => c.id === a.company_id)?.name || "";
                                          const nameB = (b as any).company_name || companies.find(c => c.id === b.company_id)?.name || "";
                                          return nameA.localeCompare(nameB);
                                        }));
                                      }}
                                      title="Ordenar por nome"
                                    >
                                      A-Z
                                    </Button>
                                  )}
                                  <Button
                                    type="button" size="sm" variant="outline"
                                    onClick={() => setFGroupLinks((prev) => [{ company_id: "", doctors: [], _isNew: true } as any, ...prev])}
                                  >
                                    <Plus className="h-4 w-4 mr-1" /> Adicionar empresa
                                  </Button>
                                </div>
                              </div>

                              {fGroupLinks.length === 0 && (
                                <p className="text-xs text-muted-foreground italic">Nenhuma empresa vinculada. Clique em “Adicionar empresa” ou use médicos avulsos abaixo.</p>
                              )}

                              {fGroupLinks.length > 0 && (
                                <div className="flex items-center gap-2 pt-1">
                                  <span className="text-xs font-normal text-muted-foreground shrink-0">
                                    {fGroupLinks.length} {fGroupLinks.length === 1 ? "empresa adicionada" : "empresas adicionadas"}
                                  </span>
                                  <div className="relative flex-1 max-w-xs ml-auto">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                      value={companyLinksFilter}
                                      onChange={(e) => setCompanyLinksFilter(e.target.value)}
                                      placeholder="Filtrar empresas adicionadas..."
                                      className="h-8 pl-7 text-xs font-normal"
                                      style={{ borderWidth: "0.5px" }}
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2">
                                {(() => {
                                  const qFilter = norm(companyLinksFilter);
                                  const visible = fGroupLinks
                                    .map((l, i) => ({ link: l, idx: i }))
                                    .filter(({ link }) => {
                                      if (!qFilter) return true;
                                      if ((link as any)._isNew) return true;
                                      const co = link.company_id ? companies.find((c) => c.id === link.company_id) : null;
                                      const name = co?.name || (link as any).company_name || "";
                                      return norm(name).includes(qFilter);
                                    });
                                  if (qFilter && visible.length === 0) {
                                    return (
                                      <p className="text-xs text-muted-foreground italic px-1">
                                        Nenhuma empresa encontrada para “{companyLinksFilter}”.
                                      </p>
                                    );
                                  }
                                  return visible.map(({ link, idx }) => {
                                  const co = link.company_id ? companies.find((c) => c.id === link.company_id) : null;
                                  const isDup = link.company_id && dupIds.has(link.company_id);
                                  const noCompany = !link.company_id;
                                  const allowedDocs = link.company_id ? (companyDoctorsMap[link.company_id] ?? []) : [];
                                  const loadingDocs = link.company_id ? loadingCompanyDoctorsIds.has(link.company_id) : false;
                                  const allowedSet = new Set(allowedDocs.map((d) => norm(d.name)));
                                  const invalidPicked: { name: string; crm?: string }[] = []; // validação removida — médicos manuais são aceitos
                                  const updateLink = (patch: Partial<typeof link>) => setFGroupLinks((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
                                  const isNew = !!(link as any)._isNew;
                                  const isCollapsed = !isNew && !!link.company_id && collapsedCompanies.has(link.company_id);
                                  const toggleCollapsed = () => {
                                    if (!link.company_id) return;
                                    setCollapsedCompanies((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(link.company_id)) next.delete(link.company_id);
                                      else next.add(link.company_id);
                                      return next;
                                    });
                                  };
                                  const displayName = co?.name || (link as any).company_name || "Empresa não selecionada";
                                  const displayDoc = co?.document || (link as any).company_document || "";
                                  const doctorsSummary = link.doctors.length === 0 ? "Todos os médicos" : `${link.doctors.length} ${link.doctors.length === 1 ? "médico" : "médicos"}`;
                                  return (
                                    <div key={idx} className={cn(
                                      "rounded-md bg-card animate-fade-in transition-all duration-300",
                                      isNew ? "ring-2 ring-primary/20 border-primary/50 shadow-sm border" : "border",
                                      (noCompany || isDup || invalidPicked.length > 0) ? "border-destructive/60" : "",
                                      !isCollapsed && link.company_id ? "border-l-2" : ""
                                    )}
                                    style={{
                                      borderWidth: noCompany || isDup || invalidPicked.length > 0 || isNew ? undefined : "0.5px",
                                      borderLeftWidth: !isCollapsed && link.company_id ? "2px" : undefined,
                                      borderLeftColor: !isCollapsed && link.company_id ? "#9A6B3A" : undefined,
                                    }}>
                                      {isCollapsed ? (
                                        <button
                                          type="button"
                                          onClick={toggleCollapsed}
                                          className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/40 transition-colors rounded-md min-w-0"
                                        >
                                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                          <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
                                            <span className="font-medium truncate">{displayName}</span>
                                            {displayDoc && (
                                              <span className="text-xs text-muted-foreground font-normal cell-mono shrink-0">· {displayDoc}</span>
                                            )}
                                            <span className="text-xs text-muted-foreground font-normal truncate">· {doctorsSummary}</span>
                                          </div>
                                          <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => { e.stopPropagation(); setFGroupLinks((prev) => prev.filter((_, i) => i !== idx)); }}
                                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setFGroupLinks((prev) => prev.filter((_, i) => i !== idx)); } }}
                                            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                                            aria-label="Remover empresa"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </span>
                                        </button>
                                      ) : (
                                        <div className="p-3 space-y-2">
                                          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-start min-w-0 overflow-hidden">
                                            {link.company_id && !isNew ? (
                                              <button
                                                type="button"
                                                onClick={toggleCollapsed}
                                                className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted text-muted-foreground mt-5 shrink-0"
                                                aria-label="Recolher empresa"
                                              >
                                                <ChevronDown className="h-4 w-4" />
                                              </button>
                                            ) : <span className="hidden sm:block w-7" />}
                                            <div className="space-y-1 min-w-0">
                                              <Label className="text-xs font-medium">Empresa/PJ</Label>
                                              <CompanyCombobox
                                                 value={co ? { id: co.id, name: co.name, document: co.document ?? null } : (link.company_id ? { id: link.company_id, name: (link as any).company_name ?? "Empresa selecionada", document: (link as any).company_document ?? null } : null)}
                                                 onChange={(c) => {
                                                   if (!c) return;
                                                   if (usedIds.has(c.id) && c.id !== link.company_id) {
                                                     toast({ title: "Empresa já vinculada", description: "Edite a linha existente.", variant: "destructive" });
                                                     return;
                                                   }
                                                   setCompanies((prev) => prev.some((x) => x.id === c.id) ? prev : [...prev, { id: c.id, name: c.name, document: c.document ?? null }]);
                                                   updateLink({ company_id: c.id, doctors: [], company_name: c.name, company_document: c.document ?? null, _isNew: false } as any);
                                                 }}
                                                placeholder="Selecionar empresa…"
                                                className="w-full"
                                                autoOpen={(link as any)._isNew}
                                              />
                                              {isDup && <p className="text-xs text-destructive">Empresa repetida em outra linha.</p>}
                                              {noCompany && <p className="text-xs text-destructive">Selecione uma empresa.</p>}
                                            </div>
                                            <div className="flex sm:flex-col gap-1 sm:items-end">
                                              <Button
                                                type="button" size="sm" variant="ghost"
                                                onClick={() => setFGroupLinks((prev) => prev.filter((_, i) => i !== idx))}
                                                aria-label="Remover linha"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </div>

                                          {link.company_id && (
                                            <div className="space-y-1.5 animate-fade-in">
                                              <div className="flex items-center justify-between">
                                                <Label className="text-xs">Médicos desta empresa — opcional</Label>
                                                <div className="flex gap-1">
                                                  <Button
                                                    type="button" size="sm" variant={link.doctors.length === 0 ? "default" : "outline"}
                                                    onClick={() => updateLink({ doctors: [] })}
                                                  >
                                                    Todos os médicos
                                                  </Button>
                                                </div>
                                              </div>
                                              <p className="text-xs text-muted-foreground">
                                                {loadingDocs
                                                  ? "Carregando médicos…"
                                                  : allowedDocs.length === 0
                                                    ? "Nenhum médico encontrado nos atendimentos — adicione manualmente abaixo, ou deixe vazio para aplicar a todos."
                                                    : "Clique nas sugestões ou adicione manualmente. Vazio = aplica a todos da empresa."}
                                              </p>
                                              {allowedDocs.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                  {allowedDocs.map((d, di) => {
                                                    const checked = link.doctors.some((x) => norm(x.name) === norm(d.name));
                                                    return (
                                                      <Button
                                                        key={`${d.name}-${di}`} type="button" size="sm"
                                                        variant={checked ? "default" : "outline"}
                                                        onClick={() => updateLink({
                                                          doctors: checked
                                                            ? link.doctors.filter((x) => norm(x.name) !== norm(d.name))
                                                            : [...link.doctors, d],
                                                        })}
                                                      >
                                                        {d.name}{d.crm ? ` · ${d.crm}` : ""}
                                                      </Button>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                              <DoctorsEditor
                                                value={link.doctors}
                                                onChange={(next) => updateLink({ doctors: next })}
                                              />
                                              {link.doctors.length > 0 && (
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                  <span>{link.doctors.length} médico(s) específico(s) selecionado(s).</span>
                                                  <Button type="button" size="sm" variant="ghost" onClick={() => updateLink({ doctors: [] })}>
                                                    Limpar
                                                  </Button>
                                                </div>
                                              )}
                                              {invalidPicked.length > 0 && (
                                                <div className="text-xs text-destructive">
                                                  {invalidPicked.length} médico(s) não pertence(m) a esta empresa.
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          <div className="text-xs text-muted-foreground border-t border-border pt-1.5 truncate" title={`${co?.name ?? "—"} | ${link.doctors.length === 0 ? "Todos os médicos" : link.doctors.map((d) => d.name).join(", ")}`}>
                                            <span className="font-medium">{co?.name ?? "—"}</span>
                                            {" | "}
                                            {link.doctors.length === 0
                                              ? "Todos os médicos"
                                              : link.doctors.map((d) => d.name).join(", ")}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                  });
                                })()}
                              </div>
                            </div>

                            {/* Médicos avulsos (sem PJ) */}
                            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                              <div>
                                <Label className="text-sm font-semibold">Médicos avulsos (sem empresa)</Label>
                                <p className="text-xs text-muted-foreground">Use quando o acordo segue o médico, independente da PJ que faturar (ex.: Dr. Narcélio recebe o acordo Coluna mesmo faturando por qualquer CNPJ). Casa por nome+CRM em qualquer empresa do item. Pode ser combinado com os vínculos por empresa acima — o motor aceita os dois caminhos (OR).</p>
                              </div>
                              <DoctorsEditor value={fGroupDoctors} onChange={setFGroupDoctors} />
                            </div>
                          </div>
                        );
                      })()}

                      {scope === "master" && (
                        <p className="text-xs text-muted-foreground">Regra master — aplica a todos os itens que passarem pelos filtros acima. Setores, códigos, convênios, especialidades, tipos de pagamento e horários agora são configurados <strong>dentro de cada item de Cálculo</strong>.</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Cálculos da regra (1:N) — substitui as antigas seções
                      "Condições" e "Cálculo da regra". As condições agora vivem
                      DENTRO de cada item de cálculo. */}
                  <AccordionItem value="calculo" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className={cn("text-sm font-semibold", sectionErrors.calculo > 0 && "text-destructive")}>
                      <span className="flex items-center">
                        Cálculos da regra
                        {fNature === "calculavel" && fCalculations.length > 1 && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({fCalculations.length} itens — somados quando casarem)
                          </span>
                        )}
                        {sectionErrors.calculo > 0 && (
                          <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                            {sectionErrors.calculo}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
                      <div className="space-y-1.5">
                        <Label>Natureza da regra *</Label>
                        <Select
                          value={fNature}
                          onValueChange={(v) => {
                            const nat = v as "calculavel" | "informativo";
                            setFNature(nat);
                            if (nat === "informativo") {
                              setFCalculationType("informativo");
                              setRefTableId("");
                            } else if (fCalculationType === "informativo") {
                              setFCalculationType("percentual_sobre_convenio");
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
                            : "Você pode adicionar mais de um item de cálculo (bônus, tabela diferenciada, etc.). Cada item pode ter sua própria janela de aplicação (período/dia/horário). Os valores dos itens cujas condições baterem são somados."}
                        </p>
                      </div>

                      {fNature === "calculavel" && (
                        <div className="space-y-4">
                          <RuleCalculationsEditor
                            value={fCalculations}
                            onChange={setFCalculations}
                            refTables={refTables}
                            enabled={true}
                          />
                          
                          {/* Hint antigo de "Códigos específicos" removido —
                              os códigos do bônus são definidos dentro do próprio item de cálculo
                              (seção "Quando aplicar este cálculo"). */}
                        </div>
                      )}

                      {/* Bloco específico da Exclusão (mantém-se vinculado à regra,
                          não ao item de cálculo, pois é uma decisão global) */}
                      {fNature === "calculavel" && fCalculations[0]?.calculation_type === "exclusao" && (
                        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                          <h3 className="text-[13.5px] font-semibold">Configuração da exclusão</h3>
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
                              </span>
                            </span>
                          </label>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Tabelas de exceção vinculadas */}
                  {/* Limiares de divergência */}
                  <AccordionItem value="limiares" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className="text-sm font-semibold">
                      Limiares de divergência
                      {(fAlertInherit && fBlockInherit) ? (
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">HERDANDO GLOBAL</span>
                      ) : (
                        <span className="ml-2 text-[10px] font-normal text-info bg-info-soft px-1.5 py-0.5 rounded border border-info/20">PERSONALIZADO</span>
                      )}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-1">
                      <p className="text-xs text-muted-foreground">
                        Define quando uma diferença de valor deve ser tratada como Alerta ou Bloqueio Crítico.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Alerta */}
                        <div className="rounded-md border border-warning/30 bg-warning-soft/10 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-warning-foreground font-bold">ALERTA (AMARELO)</Label>
                            <div className="flex items-center gap-1.5">
                              <Checkbox id="alert-inherit" checked={fAlertInherit} onCheckedChange={(v) => setFAlertInherit(!!v)} />
                              <Label htmlFor="alert-inherit" className="text-[10px] cursor-pointer">Usar valor global</Label>
                            </div>
                          </div>

                          {fAlertInherit ? (
                            <p className="text-xs text-muted-foreground italic">
                              Global atual: {globalThresholds?.limiar_alerta_valor ?? 1}{globalThresholds?.limiar_alerta_tipo === 'percentual' ? '%' : ' R$'}
                            </p>
                          ) : (
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <Label className="text-[10px]">Tipo</Label>
                                <Select value={fAlertThresholdType} onValueChange={(v: any) => setFAlertThresholdType(v)}>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="percentual">Percentual (%)</SelectItem>
                                    <SelectItem value="absoluto">Absoluto (R$)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex-1 space-y-1">
                                <Label className="text-[10px]">Valor</Label>
                                <Input 
                                  className="h-8 text-xs" 
                                  placeholder="0.00" 
                                  value={fAlertThresholdValue} 
                                  onChange={(e) => setFAlertThresholdValue(e.target.value)} 
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Bloqueio */}
                        <div className="rounded-md border border-destructive/30 bg-destructive-soft/10 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-destructive font-bold">BLOQUEIO (VERMELHO)</Label>
                            <div className="flex items-center gap-1.5">
                              <Checkbox id="block-inherit" checked={fBlockInherit} onCheckedChange={(v) => setFBlockInherit(!!v)} />
                              <Label htmlFor="block-inherit" className="text-[10px] cursor-pointer">Usar valor global</Label>
                            </div>
                          </div>

                          {fBlockInherit ? (
                            <p className="text-xs text-muted-foreground italic">
                              Global atual: {globalThresholds?.limiar_bloqueio_valor ?? 5}{globalThresholds?.limiar_bloqueio_tipo === 'percentual' ? '%' : ' R$'}
                            </p>
                          ) : (
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <Label className="text-[10px]">Tipo</Label>
                                <Select value={fBlockThresholdType} onValueChange={(v: any) => setFBlockThresholdType(v)}>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="percentual">Percentual (%)</SelectItem>
                                    <SelectItem value="absoluto">Absoluto (R$)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex-1 space-y-1">
                                <Label className="text-[10px]">Valor</Label>
                                <Input 
                                  className="h-8 text-xs" 
                                  placeholder="0.00" 
                                  value={fBlockThresholdValue} 
                                  onChange={(e) => setFBlockThresholdValue(e.target.value)} 
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="excecoes" className="rounded-md border border-border bg-card px-3">
                    <AccordionTrigger className="text-sm font-semibold">
                      Tabelas de exceção vinculadas
                      {fExceptionTableIds.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({fExceptionTableIds.length})</span>
                      )}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
                      <p className="text-xs text-muted-foreground">
                        Vincule tabelas do tipo <strong>Códigos sem acordo</strong> ou <strong>Exclusão</strong> que invalidam esta regra.
                        Quando o item bater nesta regra e o código estiver em uma tabela vinculada, o motor pula o cálculo e aceita o valor pago pelo convênio.
                        Tabelas só têm efeito quando vinculadas — não há varredura global.
                      </p>
                      {(() => {
                        const eligible = refTables.filter((t) => t.purpose === "sem_acordo" || t.purpose === "exclusao");
                        if (eligible.length === 0) {
                          return <p className="text-xs text-muted-foreground italic">Nenhuma tabela com propósito “Códigos sem acordo” ou “Exclusão” cadastrada.</p>;
                        }
                        return (
                          <div className="space-y-1.5">
                            {eligible.map((t) => {
                              const checked = fExceptionTableIds.includes(t.id);
                              const purposeLabel = t.purpose === "sem_acordo" ? "Sem acordo" : "Exclusão";
                              return (
                                <label key={t.id} className="flex items-start gap-2 rounded-md border border-border bg-background p-2 cursor-pointer hover:bg-muted/40">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => {
                                      setFExceptionTableIds((prev) =>
                                        v ? Array.from(new Set([...prev, t.id])) : prev.filter((id) => id !== t.id)
                                      );
                                    }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium leading-tight">{t.name}</p>
                                    <p className="text-xs text-muted-foreground">{purposeLabel}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Códigos específicos: removido — agora dentro de cada cálculo. */}
                </Accordion>

            </form>
          </FormDialog>
        </>
      }
    />
      <div className="p-8 space-y-4">
        <RulesHealthPanel onSelectRule={(id) => { const r = rules.find((x) => x.id === id); if (r) { openEdit(r); setOpen(true); } }} />
        {/* Banner de regras incompletas */}
        {incompleteCount > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium">{incompleteCount} regra{incompleteCount > 1 ? "s estão" : " está"} desatualizada{incompleteCount > 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground">Faltam campos novos. Edite individualmente para atualizar.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setOnlyIncomplete(true); selectAllIncomplete(); }}>
                Selecionar todas
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
          {/* Filtro por setor removido — restritivo agora vive por Cálculo */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)} placeholder="Buscar empresa/médico" className="pl-8 w-[220px]" />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={onlyIncomplete} onCheckedChange={(c) => setOnlyIncomplete(!!c)} />
            <span>Só desatualizadas</span>
          </label>
          <p className="text-xs text-muted-foreground ml-auto">{filtered.length} de {rules.length}</p>
        </div>

        {groups.length === 0 ? (
          <Card className="shadow-card"><CardContent className="px-6 py-12"><p className="text-center text-sm text-muted-foreground">Nenhuma regra encontrada.</p></CardContent></Card>
        ) : (
          <div className="space-y-6 w-full">
            {groups.map((g) => {
              const isCol = collapsed[g.key] === true;
              return (
                <div key={g.key} className="space-y-2">
                  {/* Group header — leve, padrão do sistema */}
                  <button onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCol }))}
                    className="w-full px-2 py-1.5 flex items-center gap-2.5 text-left rounded-md hover:bg-muted/40 transition-colors">
                    {isCol ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-base leading-none">{g.type === "master" ? "📘" : g.type === "empresa" ? "🏥" : "👤"}</span>
                    <p className="text-sm font-semibold text-foreground flex-1">{g.label}</p>
                    <span className="text-xs text-muted-foreground">
                      {g.rules.length} regra{g.rules.length > 1 ? "s" : ""}
                    </span>
                  </button>
                  {!isCol && (
                    <div className="space-y-2">
                      {g.rules.map((r) => {
                        const expired = !!(r.valid_until && new Date(r.valid_until) < new Date());
                        return (
                          <Card key={r.id} className="shadow-card">
                            <CardContent className="p-0">
                              <RuleListRow
                                name={r.name}
                                severity={r.severity}
                                active={r.active}
                                expired={expired}
                                validFrom={r.valid_from}
                                validUntil={r.valid_until}
                                thresholdAlert={{ value: r.limiar_alerta_valor, type: r.limiar_alerta_tipo }}
                                thresholdBlock={{ value: r.limiar_bloqueio_valor, type: r.limiar_bloqueio_tipo }}
                                incomplete={isIncomplete(r)}
                                missingFields={missingFields(r)}
                                description={r.description}
                                ruleText={r.rule_text}
                                calcBadge={renderCalcBadge(r)}
                                selected={selected.has(r.id)}
                                isLast
                                onToggleSelect={() => toggleSelect(r.id)}
                                onEdit={() => openEdit(r)}
                                onDuplicate={() => openDuplicate(r)}
                                onExportPdf={() => exportRuleToPDF(r)}
                                onDelete={() => remove(r.id)}
                              />
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* Tela de revisão pós-importação */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar regras extraídas pela IA</DialogTitle>
            <DialogDescription>Confira, edite e selecione quais salvar. {drafts.filter(d => d.active).length} de {drafts.length} marcadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {drafts.map((d, i) => (
              <Card key={i} className={`p-4 ${d.active ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-3 mb-3">
                  <Checkbox checked={d.active} onCheckedChange={(v) => updateDraft(i, { active: !!v })} className="mt-1" />
                  <Input value={d.name} onChange={(e) => updateDraft(i, { name: e.target.value })} placeholder="Nome" className="font-medium" />
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
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


                <div className="rounded-md border border-dashed border-warning/50 bg-warning/5 p-2 mb-3 text-xs text-warning-foreground">
                  ⚠ Tabela vinculada, multiplicador, deflator, bônus, valor fixo, % convênio, códigos extras e códigos de procedimento devem ser configurados <strong>no Cálculo</strong> após salvar a regra (botão Editar → aba Cálculos).
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
            <Button onClick={saveDrafts}>Salvar {drafts.filter(d => d.active).length} regra(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RuleConflictModal
        open={conflictOpen}
        problems={conflictProblems}
        onCancel={() => { setConflictOpen(false); setConflictProblems([]); setPendingRuleData(null); setPendingCalcs([]); }}
        onApplyAndSave={handleConflictApply}
      />
    </>
  );
};

export default Rules;
