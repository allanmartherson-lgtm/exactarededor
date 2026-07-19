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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RuleListRow } from "@/components/RuleListRow";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { recomputeDoctorSpecificExclusions } from "@/lib/recomputeDoctorSpecificExclusions";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { useSpecialties } from "@/hooks/useSpecialties";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
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
import { Plus, Sparkles, Trash2, Upload, FileText, Filter, ChevronDown, ChevronRight, Search, Pencil, AlertTriangle, Wand2, BadgeDollarSign, FileDown, CheckCheck, Copy, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx";
import { DoctorsEditor, MultiSelectChips } from "@/components/MultiSelectChips";
import { DoctorCombobox } from "@/components/DoctorCombobox";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { recordAudit, buildDiff } from "@/lib/audit";
import { RuleHistoryTab } from "@/components/rules/RuleHistoryTab";
import { RuleSnapshotsTab } from "@/components/rules/RuleSnapshotsTab";
import { RuleFormStepper } from "@/components/rules/RuleFormStepper";
import { History, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompanyCombobox } from "@/components/CompanyCombobox";
import { confirmDialog } from "@/lib/confirm";
import {
  RuleCalculationsEditor,
  makeEmptyCalc,
  calcFromDb,
  calcToDbPayload,
  calcItemErrors,
  calcCrossItemErrorMessages,
  type CalcItem,
} from "@/components/rules/RuleCalculationsEditor";
import { RulesHealthPanel } from "@/components/rules/RulesHealthPanel";
import { PisoDefasagemCard } from "@/components/rules/PisoDefasagemCard";
import { RuleConflictModal, type Problem as ConflictProblem, type Correction as ConflictCorrection } from "@/components/rules/RuleConflictModal";
import { CloneRuleToHospitalDialog } from "@/components/rules/CloneRuleToHospitalDialog";
import { DateInput } from "@/components/ui/date-input";

const sevTone: Record<RuleSeverity, keyof typeof TONE_CLASSES> = { info: "info", aviso: "warning", bloqueio: "destructive" };

async function getEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const err = error as { name?: string; message?: string; context?: Response } | null;
  const response = err?.context;
  if (response && typeof response.clone === "function") {
    const status = response.status;
    try {
      const payload = await response.clone().json() as { error?: string; detail?: string; message?: string; hint?: string };
      const msg = payload.detail || payload.error || payload.message || payload.hint;
      if (msg) return status ? `[HTTP ${status}] ${msg}` : msg;
    } catch {
      // não era JSON — tenta texto puro
    }
    try {
      const text = (await response.clone().text())?.trim();
      if (text) return status ? `[HTTP ${status}] ${text.slice(0, 500)}` : text.slice(0, 500);
    } catch {
      // ignora
    }
    if (status) return `Edge Function retornou HTTP ${status} sem corpo`;
  }
  // Erros sem response (CORS, rede, função não publicada, etc.)
  const name = err?.name ? `${err.name}: ` : "";
  return `${name}${err?.message || "Falha ao validar regra"}`;
}

function OndeSummaryBanner({ ondeShort, ondeFull, calc, canCollapse }: { ondeShort: string; ondeFull: string; calc: string; canCollapse: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const showFull = !canCollapse || expanded;
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-start">
        <span className="flex-1 min-w-0">
          <span className="font-semibold">Onde:</span>{" "}
          {showFull ? ondeFull : ondeShort}
          {canCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline font-medium align-middle"
            >
              {expanded ? (<><ChevronDown className="h-3 w-3" /> recolher</>) : (<><ChevronRight className="h-3 w-3" /> ver detalhes</>)}
            </button>
          )}
        </span>
        <span className="shrink-0"><span className="font-semibold">Cálculo:</span> {calc}</span>
      </div>
    </div>
  );
}





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
  target_doctor_id?: string | null; target_company_id?: string | null;
  calculation_type: RuleCalculationType;
  convenio_percentage: number | null;
  fixed_amount: number | null;
  extras_codes: string[];
  package_amount: number | null; bonus_amount: number | null; bonus_pct: number | null;
  target_amount: number | null; multiplier: number | null; deflator_pct: number | null;
  reference_table_id: string | null; procedure_codes: string[];
  sectors: string[]; specialties: string[];
  valid_from: string | null; valid_until: string | null;
  /** Cálculos prontos para inserção (vindos da IA). Cada item é uma linha
   *  de rule_calculations sem rule_id/sort_order — preenchidos no save. */
  calculations?: Record<string, unknown>[];
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

const Rules = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const { user } = useAuth();
  const { hospital } = useHospital();
  const activeHospitalId = hospital?.id ?? null;
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [refTables, setRefTables] = useState<{ id: string; name: string; purpose?: string }[]>([]);
  const [specialCaseTypes, setSpecialCaseTypes] = useState<{ code: string; label: string }[]>([]);
  const [fSpecialCaseFilter, setFSpecialCaseFilter] = useState<string[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; document: string | null }[]>([]);
  const [globalThresholds, setGlobalThresholds] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingHospitalId, setEditingHospitalId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [globalConfigOpen, setGlobalConfigOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // Diálogo pós-edição de regra: pergunta se dispara reanálise dos lotes
  // impactados. IA é opt-in (checkbox desmarcado por padrão).
  const [reanalysisPrompt, setReanalysisPrompt] = useState<{
    ruleName: string | null;
    groupsCount: number;
    paymentIds: string[];
    companyNames: string[];
    aiCount: number | null;
    runAi: boolean;
  } | null>(null);

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
  // Tipo de pagamento opcional — quando setado, a regra só se aplica a bases
  // com o mesmo payment_type_id (resolve Parecer × Visita com mesmo TUSS).
  const [fPaymentTypeId, setFPaymentTypeId] = useState<string | null>(null);
  const { list: paymentTypesList } = usePaymentTypes({ onlyActive: true });
  const { specialties: specialtiesList } = useSpecialties();
  
  const [scope, setScope] = useState<RuleScope>("master");
  const [targetType, setTargetType] = useState<RuleTargetType>("medico");
  const [fTargetIdentifier, setFTargetIdentifier] = useState("");
  const [fTargetName, setFTargetName] = useState("");
  // ID do médico/empresa cadastrada, preenchido APENAS via combobox.
  // Persistido em rules.target_doctor_id/target_company_id para que o motor
  // case por ID (estável) em vez de nome (frágil). Sem ID = match cai para
  // CRM/CNPJ e, em último caso, nome exato — nunca heurística.
  const [fTargetDoctorId, setFTargetDoctorId] = useState<string | null>(null);
  const [fTargetCompanyId, setFTargetCompanyId] = useState<string | null>(null);

  
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
  // Mínimo garantido (piso de produção). Escopo: medico_empresa (por par) ou empresa (por PJ).
  const [fMinGarantidoAtivo, setFMinGarantidoAtivo] = useState(false);
  const [fMinGarantidoValor, setFMinGarantidoValor] = useState<string>("");
  const [fMinGarantidoEscopo, setFMinGarantidoEscopo] = useState<"medico_empresa" | "empresa">("medico_empresa");
  // Escopo "grupo" (inline na regra)
  const [fGroupCompanyIds, setFGroupCompanyIds] = useState<string[]>([]);
  const [fGroupDoctors, setFGroupDoctors] = useState<{ name: string; crm?: string }[]>([]);
  const [fGroupMode, setFGroupMode] = useState<"empresa" | "medico">("empresa");
  // Novo modelo: vínculos por empresa em linhas (cada linha = empresa + médicos opcionais).
  const [fGroupLinks, setFGroupLinks] = useState<{
    company_id: string;
    doctors: { id?: string | null; name: string; crm?: string }[];
    excluded_doctors?: { id?: string | null; name: string; crm?: string }[];
    auto_include_new_doctors?: boolean;
  }[]>([]);
  // Médicos novos da PJ não confirmados/excluídos da regra em edição.
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [pendingDoctors, setPendingDoctors] = useState<Array<{
    company_id: string; company_name: string; doctor_id: string; doctor_name: string; doctor_crm: string | null;
  }>>([]);

  // UI local: empresas colapsadas (por company_id) e filtro de busca.
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set());
  const [companyLinksFilter, setCompanyLinksFilter] = useState("");
  const [companyLinksStatusFilter, setCompanyLinksStatusFilter] = useState<"todos" | "com_excluidos" | "allowlist" | "sem_medicos" | "incompleto">("todos");
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
  // Bloqueia fallback para a regra geral master quando a regra venceu mas nenhum cálculo bateu.
  // Default true para regras específicas/grupo; false para master.
  const [fPreventExternalFallback, setFPreventExternalFallback] = useState(false);
  const [fCalculationMode, setFCalculationMode] = useState<"exclusive" | "cascade">("exclusive");

  
  
  // Global Thresholds Form
  const [fGlobalAlertThresholdType, setFGlobalAlertThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalAlertThresholdValue, setFGlobalAlertThresholdValue] = useState<string>("1.0");
  const [fGlobalBlockThresholdType, setFGlobalBlockThresholdType] = useState<"percentual" | "absoluto">("percentual");
  const [fGlobalBlockThresholdValue, setFGlobalBlockThresholdValue] = useState<string>("5.0");
  // Sub-Onda 2D / Rodada 3 — modal de conflitos (validate-rule-save)
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictProblems, setConflictProblems] = useState<ConflictProblem[]>([]);
  // Snapshot do payload em validação para o handler "aplicar e salvar"
  const [pendingRuleData, setPendingRuleData] = useState<Record<string, unknown> | null>(null);
  const [pendingCalcs, setPendingCalcs] = useState<Record<string, unknown>[]>([]);
  const [pendingIsUpdate, setPendingIsUpdate] = useState(false);
  // Clone-to-hospital dialog
  const [cloneTarget, setCloneTarget] = useState<RuleRow | null>(null);
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
      calcCrossItemErrorMessages(fCalculations).forEach((messages) => {
        e.calculo += messages.length;
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
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [pendingByRule, setPendingByRule] = useState<Record<string, number>>({});
  const load = async () => {
    let q = supabase.from("rules").select("*").order("created_at", { ascending: false });
    if (activeHospitalId) q = q.eq("hospital_id", activeHospitalId);
    const { data } = await q;
    setRules(data ?? []);
    // Carrega contagem de médicos novos pendentes por regra (auto-include + aviso).
    const { data: pend } = await (supabase as any)
      .from("rules_pending_doctors_summary")
      .select("rule_id,pending_count");
    const map: Record<string, number> = {};
    (pend ?? []).forEach((r: any) => { if (r?.rule_id) map[r.rule_id] = Number(r.pending_count) || 0; });
    setPendingByRule(map);
  };

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
  const loadSpecialCaseTypes = () =>
    supabase
      .from("special_case_types")
      .select("code,label")
      .eq("active", true)
      .order("label")
      .then(({ data }) => setSpecialCaseTypes((data ?? []) as any));
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
  useEffect(() => { document.title = "Regras | Exacta"; loadGlobalThresholds(); loadRefs(); loadCompanies(); loadSpecialCaseTypes(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeHospitalId]);

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
    doc.text("Exacta - Detalhamento de Regra", 14, 25);
    
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
    supabase
      .from("doctor_companies")
      .select("company_id, end_date, doctors(full_name, crm, crm_uf, active)")
      .in("company_id", ids)
      .is("end_date", null)
      .then((masterRes) => {

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
    setEditingHospitalId(null);
    setFActive(true);
    setFName(""); setFDescription(""); setFRuleText("");
    setFSeverity("aviso");
    setFPaymentTypeId(null);
    setScope("master"); setTargetType("medico");
    setFTargetIdentifier(""); setFTargetName(""); setFTargetDoctorId(null); setFTargetCompanyId(null);
    setRefTableId(""); setFExceptionTableIds([]); setFSpecialCaseFilter([]);
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
    setFMinGarantidoAtivo(false); setFMinGarantidoValor(""); setFMinGarantidoEscopo("medico_empresa");
    
    setFGroupCompanyIds([]); setFGroupDoctors([]); setFGroupMode("empresa"); setFGroupLinks([]);
    setCollapsedCompanies(new Set()); setCompanyLinksFilter("");
    setFHasConditions(false);
    setFTimeMode("qualquer"); setFWeekdays([]); setFIncludesHolidays(false);
    setFTimeStart(""); setFTimeEnd(""); setFElectiveMode("qualquer");
    setFCalculations([makeEmptyCalc()]);
    setFAlertThresholdType("percentual"); setFAlertThresholdValue(""); setFAlertInherit(true);
    setFBlockThresholdType("percentual"); setFBlockThresholdValue(""); setFBlockInherit(true);
    setFPreventExternalFallback(false);
    setFCalculationMode("exclusive");

  };

  const openEdit = async (r: RuleRow, isDuplicate = false) => {
    setEditingId(isDuplicate ? null : r.id);
    setEditingRuleId(isDuplicate ? null : r.id);
    setEditingHospitalId(isDuplicate ? null : ((r as any).hospital_id ?? null));
    // Busca médicos novos pendentes desta regra (só quando editando, não duplicando).
    if (!isDuplicate && r.id) {
      (supabase as any).rpc("rule_pending_doctors", { p_rule_id: r.id }).then(({ data }: any) => {
        setPendingDoctors(Array.isArray(data) ? data : []);
      });
    } else {
      setPendingDoctors([]);
    }

    
    setFName(isDuplicate ? `Cópia de ${r.name ?? ""}` : (r.name ?? ""));
    setFActive(isDuplicate ? true : (r.active !== false));
    setFDescription(r.description ?? ""); setFRuleText(r.rule_text ?? "");
    setFSeverity(r.severity ?? "aviso");
    setFPaymentTypeId(null);
    setScope(r.scope ?? "master"); setTargetType((r.target_type as RuleTargetType) ?? "medico");
    setFTargetIdentifier(r.target_identifier ?? ""); setFTargetName(r.target_name ?? "");
    setFTargetDoctorId((r as any).target_doctor_id ?? null);
    setFTargetCompanyId((r as any).target_company_id ?? null);

    const calc = (r.calculation_type as RuleCalculationType) ?? "informativo";
    setFCalculationType(calc);
    // fNature será derivado após carregar calcRows (abaixo).
    setFConvenioPct(r.convenio_percentage != null ? String(r.convenio_percentage) : "");
    setFFixedAmount(r.fixed_amount != null ? String(r.fixed_amount) : "");
    setFExtrasCodes(Array.isArray(r.extras_codes) ? r.extras_codes.join(", ") : "");
    setRefTableId(r.reference_table_id ?? "");
    setFExceptionTableIds(Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []);
    setFSpecialCaseFilter([]);
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
    setFMinGarantidoAtivo(!!(r as any).minimo_garantido_ativo);
    setFMinGarantidoValor((r as any).minimo_garantido_valor != null ? String((r as any).minimo_garantido_valor) : "");
    setFMinGarantidoEscopo(((r as any).minimo_garantido_escopo === "empresa" ? "empresa" : "medico_empresa"));
    setFDoctors([]);
    const glinks = Array.isArray((r as any).group_company_links) ? (r as any).group_company_links : [];
    setFGroupCompanyIds([]);
    setFGroupDoctors(Array.isArray((r as any).group_doctors) ? (r as any).group_doctors : []);
    setFGroupMode("empresa");
    setFGroupLinks(glinks.map((l: any) => ({
      company_id: l.company_id,
      doctors: Array.isArray(l.doctors) ? l.doctors : [],
      excluded_doctors: Array.isArray(l.excluded_doctors) ? l.excluded_doctors : [],
      auto_include_new_doctors: l.auto_include_new_doctors !== false,
    })));

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
    setFPreventExternalFallback(!!(r as any).prevent_external_fallback);
    setFCalculationMode(((r as any).calculation_mode === "cascade") ? "cascade" : "exclusive");



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
    if (!ruleData.hospital_id) {
      throw new Error("Unidade vinculada é obrigatória para salvar regra.");
    }
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

    // BLINDAGEM camada 3: guard contra perda silenciosa de cálculos.
    // Se a edição vai reduzir a quantidade de cálculos, exigir confirmação explícita.
    let allowCalcReduction = false;
    if (meta.wasEditing && prevCalcs && prevCalcs.length > 0 && calcs.length < prevCalcs.length) {
      const diff = prevCalcs.length - calcs.length;
      const ok = await confirmDialog({
        title: "Remover cálculos da regra?",
        description: `Esta edição vai remover ${diff} cálculo(s) (de ${prevCalcs.length} para ${calcs.length}). A versão atual será preservada como snapshot para restauração. Confirma?`,
        confirmText: "Sim, remover",
        cancelText: "Cancelar",
        tone: "danger",
      });
      if (!ok) {
        throw new Error("Operação cancelada pelo usuário.");
      }
      allowCalcReduction = true;
    }

    const { data, error } = await supabase.rpc("apply_rule_save_with_corrections", {
      _rule_data: ruleData as any,
      _calculations: calcs as any,
      _corrections: corrections as any,
      _allow_calc_reduction: allowCalcReduction,
    } as any);
    if (error) {
      throw new Error(error.message);
    }
    const result = data as { rule_id?: string; is_update?: boolean; corrections_applied?: number } | null;
    const savedId = (result?.rule_id as string | undefined) ?? (ruleData.id as string | undefined) ?? null;
    // Persiste campos que a RPC `apply_rule_save_with_corrections` ainda não
    // mapeia explicitamente (a RPC só lista um subset de colunas no UPDATE/INSERT).
    if (savedId) {
      const rulePatch: Record<string, unknown> = {};
      if (typeof (ruleData as any).prevent_external_fallback === "boolean") {
        rulePatch.prevent_external_fallback = (ruleData as any).prevent_external_fallback;
      }
      if (typeof (ruleData as any).minimo_garantido_ativo === "boolean") {
        rulePatch.minimo_garantido_ativo = (ruleData as any).minimo_garantido_ativo;
        rulePatch.minimo_garantido_valor = (ruleData as any).minimo_garantido_valor ?? null;
        rulePatch.minimo_garantido_escopo = (ruleData as any).minimo_garantido_escopo ?? null;
        rulePatch.minimo_garantido_periodicidade = (ruleData as any).minimo_garantido_periodicidade ?? null;
        rulePatch.minimo_garantido_base = (ruleData as any).minimo_garantido_base ?? null;
      }
      if (Object.keys(rulePatch).length > 0) {
      const { error: flagErr } = await supabase
        .from("rules")
        .update(rulePatch as any)
        .eq("id", savedId);
      if (flagErr) {
        console.warn("[Rules] Falha ao persistir campos complementares da regra:", flagErr.message);
        throw new Error(`Regra salva, mas falhou ao persistir campos complementares: ${flagErr.message}`);
      }
      }
    }
    // Correção B (2026-07-19): invalida snapshot de contexto do motor para
    // este hospital. Sem isso, jobs em andamento reusam o snapshot cached
    // (TTL 1h) e ignoram a edição da regra até o TTL expirar — foi o que
    // causava o bug do "prevent_external_fallback" só valer após 2 reanálises.
    try {
      const hid = (ruleData as any).hospital_id as string | undefined;
      if (hid) {
        await supabase.rpc("invalidate_rule_context", { _hospital_id: hid });
      }
    } catch (e) {
      console.warn("[Rules] invalidate_rule_context falhou (não bloqueia save):", (e as any)?.message ?? e);
    }
    // special_case_filter no nível da regra foi descontinuado — o filtro
    // agora vive em cada cálculo (rule_calculations.special_case_filter).
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

      // Persiste fixed_amount_by_role (ainda não mapeado pela RPC). Match por sort_order.
      const calcsByOrder = new Map<number, any>();
      (calcs ?? []).forEach((c: any) => {
        const so = typeof c?.sort_order === "number" ? c.sort_order : null;
        if (so != null) calcsByOrder.set(so, c);
      });
      for (const sc of (savedCalcs as any[]) ?? []) {
        const src = calcsByOrder.get(sc.sort_order);
        if (!src) continue;
        const has = Object.prototype.hasOwnProperty.call(src, "fixed_amount_by_role");
        if (!has) continue;
        const next = src.fixed_amount_by_role ?? null;
        const prev = sc.fixed_amount_by_role ?? null;
        if (JSON.stringify(next) === JSON.stringify(prev)) continue;
        const { error: fxErr } = await supabase
          .from("rule_calculations")
          .update({ fixed_amount_by_role: next })
          .eq("id", sc.id);
        if (fxErr) console.warn("[Rules] Falha ao persistir fixed_amount_by_role:", fxErr.message);
        else (sc as any).fixed_amount_by_role = next;
      }

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
    // Recompute doctor-specific exclusions FORA da transação (trigger síncrono
    // foi desabilitado para evitar timeout — ver recomputeDoctorSpecificExclusions).
    await recomputeDoctorSpecificExclusions();
    load();
    setConflictOpen(false);
    setConflictProblems([]);
    setPendingRuleData(null);
    setPendingCalcs([]);

    // Após salvar: oferecer reanálise dos lotes em aberto impactados
    // (somente quando a regra tem empresa-alvo definida — escopo bounded).
    // Master/médico/global não disparam aqui para evitar lote massivo
    // não solicitado; o painel da empresa detecta a stale ao abrir.
    if (savedId && (ruleData as any).target_company_id) {
      void promptReanalysisForRule(savedId, (ruleData as any).target_company_id as string, (ruleData as any).name as string | null);
    }
  };

  /** Pergunta ao analista se quer disparar a reanálise dos lotes em aberto da empresa-alvo. */
  const promptReanalysisForRule = async (
    ruleId: string,
    companyId: string,
    ruleName: string | null,
  ) => {
    const OPEN_STATUSES = ["rascunho", "em_analise_ia", "revisao_analista", "aguardando_aprovacao", "pedido_nf_enviado", "revisao_pos_aprovacao"];
    const { data: pcg } = await (supabase as any)
      .from("payment_company_groups")
      .select("payment_id, company_name, status, payment:payments!inner(id)")
      .eq("company_id", companyId)
      .in("status", OPEN_STATUSES);
    const groups = ((pcg as any[]) ?? []).filter((g) => g?.payment?.id);
    if (groups.length === 0) return;

    const paymentIds = Array.from(new Set(groups.map((g) => g.payment_id))).filter(Boolean) as string[];
    const companyNames = Array.from(new Set(groups.map((g) => g.company_name))).filter(Boolean) as string[];

    // Estimativa de custo: itens que ainda precisam passar pela IA nos lotes impactados.
    let aiCount: number | null = null;
    try {
      let q = supabase
        .from("payment_items")
        .select("id", { count: "exact", head: true })
        .in("payment_id", paymentIds)
        .eq("ai_status", "needs_ai_review" as any);
      if (companyNames.length > 0) q = q.in("company_name", companyNames);
      const res = await q;
      aiCount = res.count ?? 0;
    } catch (e) {
      console.warn("[Rules] falha ao estimar custo IA", e);
    }

    setReanalysisPrompt({
      ruleName,
      groupsCount: groups.length,
      paymentIds,
      companyNames,
      aiCount,
      runAi: false,
    });
  };

  /** Confirma o disparo da reanálise (chamado pelo diálogo). */
  const confirmReanalysisPrompt = async () => {
    const prompt = reanalysisPrompt;
    if (!prompt) return;
    const { paymentIds, companyNames, runAi } = prompt;
    setReanalysisPrompt(null);
    let dispatched = 0;
    let failed = 0;
    await Promise.all(paymentIds.map(async (pid) => {
      try {
        const { error } = await supabase.functions.invoke("dispatch-payment-analysis", {
          body: {
            payment_id: pid,
            only_companies: companyNames,
            force_fresh_rules: true,
            ...(runAi ? { run_ai: true } : {}),
          },
        });
        if (error) throw error;
        dispatched++;
      } catch (e) {
        console.warn("[Rules] dispatch falhou para", pid, e);
        failed++;
      }
    }));
    if (failed === 0) {
      toast({ title: "Reanálise disparada", description: `${dispatched} lote(s) em processamento.` });
    } else {
      toast({
        title: "Reanálise parcialmente disparada",
        description: `${dispatched} ok · ${failed} falha(s).`,
        variant: "destructive",
      });
    }
  };

  /** Handler do modal: aplica correções escolhidas + grava via RPC. */
  const handleConflictApply = async (corrections: ConflictCorrection[]) => {
    if (!pendingRuleData) throw new Error("Estado de save perdido — reabra o formulário.");
    // Usa a presença de `id` no payload como fonte de verdade para wasEditing
    const wasEditing = !!(pendingRuleData.id);
    const auditCompany = (pendingRuleData.target_type === "empresa" && pendingRuleData.target_identifier)
      ? { id: (pendingRuleData.target_company_id as string | null) ?? null,
          name: (pendingRuleData.target_name as string | null) ?? null,
          document: (pendingRuleData.target_identifier as string | null) ?? null }
      : null;
    await applyRuleSaveRpc(pendingRuleData, pendingCalcs, corrections, {
      wasEditing, auditCompany,
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
      // IDs estáveis do cadastro — preferenciais no motor (vide targetsDoctor/targetsCompany).
      target_doctor_id: (isEspecifica && targetType === "medico") ? fTargetDoctorId : null,
      target_company_id: (isEspecifica && targetType === "empresa") ? fTargetCompanyId : null,

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
      special_case_filter: null,
      valid_from: fValidFrom || null,
      valid_until: fValidUntil || null,
      minimo_garantido_ativo: fMinGarantidoAtivo,
      minimo_garantido_valor: fMinGarantidoAtivo ? (num(fMinGarantidoValor) ?? null) : null,
      minimo_garantido_escopo: fMinGarantidoAtivo ? fMinGarantidoEscopo : null,
      minimo_garantido_periodicidade: fMinGarantidoAtivo ? "competencia" : null,
      minimo_garantido_base: fMinGarantidoAtivo ? "liquido" : null,
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
      prevent_external_fallback: fPreventExternalFallback,
      calculation_mode: fCalculationMode,

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
    // Quando editando, preferimos o hospital_id da regra existente (vínculo
    // imutável). Só caímos para o activeHospitalId em criação.
    const resolvedHospitalId = editingId ? (editingHospitalId ?? activeHospitalId) : activeHospitalId;
    if (!resolvedHospitalId) {
      toast({ title: "Selecione um hospital", description: "Não é possível salvar regras sem um hospital ativo.", variant: "destructive" });
      return;
    }
    const ruleData: Record<string, unknown> = {
      ...payload,
      hospital_id: resolvedHospitalId,
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
          calculation_mode: fCalculationMode,
          hospital_id: resolvedHospitalId,

        },
      },
    );
    if (valErr) {
      toast({ title: "Erro na validação", description: await getEdgeFunctionErrorMessage(valErr), variant: "destructive" });
      return;
    }
    const allProblems = (validation?.problems ?? []) as Array<ConflictProblem | { type: string; doctor_label?: string; rule_names?: string[]; message?: string }>;
    // doctor_multi_rule é aviso de cadastro — não bloqueia, exibe toast persistente.
    const doctorWarnings = allProblems.filter((p) => p.type === "doctor_multi_rule") as Array<{ doctor_label?: string; rule_names?: string[]; message?: string }>;
    const problems = allProblems.filter((p) => p.type !== "doctor_multi_rule") as ConflictProblem[];
    if (doctorWarnings.length > 0) {
      for (const w of doctorWarnings) {
        toast({
          title: `Médico em múltiplas regras: ${w.doctor_label ?? ""}`,
          description: w.message ?? `Vinculado a: ${(w.rule_names ?? []).join(" | ")}`,
          variant: "destructive",
        });
      }
    }

    // 2) Sem problemas bloqueantes → save direto via RPC
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
      toast({ title: "Erro", description: await getEdgeFunctionErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject; r.readAsDataURL(file);
  });

  /** Mapeia uma `calculation` retornada pela IA em uma linha pronta para o
   *  RPC `apply_rule_save_with_corrections._calculations` (sem rule_id/sort_order). */
  const aiCalcToDbRow = (c: any): Record<string, unknown> => {
    const num = (v: any) => (v == null || v === "" ? null : Number(String(v).replace(",", ".")));
    const arr = (v: any) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
    const ptCode: string | null = c?.payment_type_code ?? null;
    const ptId = ptCode ? (paymentTypesList.find((p: any) => p.code === ptCode)?.id ?? null) : null;
    const ct = String(c?.calculation_type ?? "informativo");
    return {
      label: c?.label ?? null,
      calculation_type: ct,
      fixed_amount: ct === "valor_fixo" ? num(c?.fixed_amount) : null,
      package_amount: ct === "pacote" ? num(c?.package_amount) : null,
      bonus_amount: ct === "bonus" ? num(c?.bonus_amount) : null,
      bonus_pct: ct === "bonus" ? num(c?.bonus_pct) : null,
      target_amount: ct === "complemento" ? num(c?.target_amount) : null,
      multiplier: ct === "tabela_diferenciada" ? num(c?.multiplier) : null,
      deflator_pct: ct === "tabela_diferenciada" ? num(c?.deflator_pct) : null,
      convenio_percentage: ct === "percentual_sobre_convenio" ? num(c?.convenio_percentage) : null,
      procedure_codes: arr(c?.procedure_codes).length ? arr(c?.procedure_codes) : null,
      code_match_mode: arr(c?.procedure_codes).length ? "whitelist" : "any",
      specialties: arr(c?.specialties),
      sectors: arr(c?.sectors),
      doctor_roles: arr(c?.doctor_roles).length ? arr(c?.doctor_roles) : null,
      item_type_id: ptId,
      has_conditions: arr(c?.specialties).length > 0 || arr(c?.sectors).length > 0,
      is_catch_all: false,
    };
  };

  const importWithAi = async () => {
    if (!importText.trim() && !importFile) return toast({ title: "Adicione texto ou um arquivo", variant: "destructive" });
    setImporting(true);
    try {
      const body: any = {
        inputKind: "auto",
        context: {
          paymentTypes: paymentTypesList.map((p: any) => ({ id: p.id, code: p.code, label: p.label })),
          specialties: specialtiesList,
        },
      };
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
          body.inputKind = "table"; // planilha → forçar modo tabela
        } else if (isText) {
          body.text = (body.text ? body.text + "\n\n" : "") + (await importFile.text());
        } else {
          body.file = { name: importFile.name, mimeType: importFile.type || "application/octet-stream", dataBase64: await fileToBase64(importFile) };
        }
      }
      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) return toast({ title: "Erro", description: error ? await getEdgeFunctionErrorMessage(error) : (data?.error ?? "Falha"), variant: "destructive" });
      const ds: DraftRule[] = data.rules.map((r: any) => {
        const calcs: any[] = Array.isArray(r.calculations) ? r.calculations : [];
        // Tipo de cálculo no nível regra: prioriza primeiro cálculo (compatibilidade UI antiga)
        const firstCalc = calcs[0] ?? {};
        const topCalcType: RuleCalculationType = (firstCalc.calculation_type as RuleCalculationType) ?? (r.calculation_type as RuleCalculationType) ?? "informativo";
        return {
          active: true,
          name: r.name ?? "",
          description: r.description ?? "",
          rule_text: r.rule_text ?? "",
          severity: r.severity ?? "aviso",
          scope: r.scope ?? "master",
          target_type: r.target_type ?? null,
          target_identifier: r.target_identifier ?? null,
          target_name: r.target_name ?? null,
          calculation_type: topCalcType,
          convenio_percentage: firstCalc.convenio_percentage ?? r.convenio_percentage ?? null,
          fixed_amount: firstCalc.fixed_amount ?? r.fixed_amount ?? null,
          extras_codes: Array.isArray(r.extras_codes) ? r.extras_codes : [],
          package_amount: firstCalc.package_amount ?? r.package_amount ?? null,
          bonus_amount: firstCalc.bonus_amount ?? r.bonus_amount ?? null,
          bonus_pct: firstCalc.bonus_pct ?? r.bonus_pct ?? null,
          target_amount: firstCalc.target_amount ?? r.target_amount ?? null,
          multiplier: firstCalc.multiplier ?? r.multiplier ?? null,
          deflator_pct: firstCalc.deflator_pct ?? r.deflator_pct ?? null,
          reference_table_id: null,
          procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
          sectors: Array.isArray(r.sectors) ? r.sectors : (r.sector ? [r.sector] : []),
          specialties: Array.isArray(r.specialties) ? r.specialties : [],
          valid_from: r.valid_from ?? null,
          valid_until: r.valid_until ?? null,
          calculations: calcs.length > 0 ? calcs.map(aiCalcToDbRow) : undefined,
        };
      });
      setDrafts(ds); setImportOpen(false); setReviewOpen(true); setImportText(""); setImportFile(null);
      const totalCalcs = ds.reduce((s, d) => s + (d.calculations?.length ?? 0), 0);
      if (totalCalcs > 0) {
        toast({ title: `${ds.length} regra(s) extraída(s) com ${totalCalcs} cálculo(s)`, description: data.detected_kind === "table" ? "Detectada tabela tarifária — consolidado em regra com múltiplos cálculos." : undefined });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: await getEdgeFunctionErrorMessage(e), variant: "destructive" });
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
        hospital_id: activeHospitalId,
        description: d.description || null,
        target_type: d.scope === "especifica" ? d.target_type : null,
        target_identifier: d.scope === "especifica"
          ? (d.target_type === "empresa" && d.target_identifier ? formatCNPJ(d.target_identifier) : d.target_identifier)
          : null,
        target_name: d.scope === "especifica" ? d.target_name : null,
        // Preferência: ID escolhido no combobox. Fallback: lookup por CNPJ.
        target_company_id: (d.scope === "especifica" && d.target_type === "empresa")
          ? ((d as any).target_company_id
              ?? companies.find((c) => c.document && d.target_identifier && onlyDigits(c.document) === onlyDigits(d.target_identifier))?.id
              ?? null)
          : null,
        target_doctor_id: (d.scope === "especifica" && d.target_type === "medico")
          ? ((d as any).target_doctor_id ?? null)
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
            hospital_id: activeHospitalId,
          },
        },
      );
      if (valErr) {
        skipped.push({ name: d.name || "(sem nome)", reasons: [await getEdgeFunctionErrorMessage(valErr)] });
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

      // 2) Save via RPC — inclui cálculos vindos da IA (consolidados em 1 regra).
      const draftCalcs = (d.calculations ?? []).map((c, idx) => ({ ...c, sort_order: idx }));
      const { data, error } = await supabase.rpc("apply_rule_save_with_corrections", {
        _rule_data: ruleData as any,
        _calculations: draftCalcs as any,
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

    if (savedCount > 0) await recomputeDoctorSpecificExclusions();
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
    // Captura hospital_id antes do delete para invalidar cache do motor.
    const ruleBeingRemoved = rules.find((r) => r.id === id) as any;
    const hidToInvalidate: string | null =
      (ruleBeingRemoved?.hospital_id as string | undefined) ?? activeHospitalId ?? null;
    await supabase.from("rules").delete().eq("id", id);
    // Correção B (2026-07-19): mesma justificativa do save — sem isso, jobs
    // ainda enxergam a regra removida via snapshot cached por até 1h.
    if (hidToInvalidate) {
      try {
        await supabase.rpc("invalidate_rule_context", { _hospital_id: hidToInvalidate });
      } catch (e) {
        console.warn("[Rules] invalidate_rule_context (delete) falhou:", (e as any)?.message ?? e);
      }
    }
    await recomputeDoctorSpecificExclusions();
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    load();
  };

  // filtered + grouped
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = useMemo(() => {
    const term = filterTarget.trim();
    const tokens = term ? norm(term).split(/\s+/).filter(Boolean) : [];
    // Index para resolver company_id → nome/CNPJ rapidamente (regras de grupo).
    const companyById = new Map<string, { name?: string; cnpj?: string }>();
    for (const c of companies as any[]) {
      if (c?.id) companyById.set(c.id, { name: c.name, cnpj: c.cnpj });
    }
    return rules.filter((r) => {
      if (filterScope !== "todos" && r.scope !== filterScope) return false;
      if (!showInactive && r.active === false) return false;
      if (onlyIncomplete && !isIncomplete(r)) return false;
      if (tokens.length) {
        const parts: (string | null | undefined)[] = [
          r.name, r.description, r.rule_text,
          r.target_name, r.target_identifier,
        ];

        // Regras de grupo: incluir empresas e médicos vinculados no haystack.
        if (r.scope === "grupo") {
          const links = Array.isArray(r.group_company_links) ? r.group_company_links : [];
          for (const l of links) {
            const co = l?.company_id ? companyById.get(l.company_id) : null;
            parts.push(co?.name, co?.cnpj, l?.company_name);
            const docs = Array.isArray(l?.doctors) ? l.doctors : [];
            for (const d of docs) parts.push(d?.name, d?.crm);
            const exDocs = Array.isArray(l?.excluded_doctors) ? l.excluded_doctors : [];
            for (const d of exDocs) parts.push(d?.name, d?.crm);
          }
          const coIds = Array.isArray(r.group_company_ids) ? r.group_company_ids : [];
          for (const id of coIds) {
            const co = companyById.get(id);
            parts.push(co?.name, co?.cnpj);
          }
          const gDocs = Array.isArray(r.group_doctors) ? r.group_doctors : [];
          for (const d of gDocs) parts.push(d?.name, d?.crm);
        }

        // Empresa específica: garantir que o nome da empresa do cadastro entre,
        // mesmo quando target_name foi salvo só com CNPJ ou abreviado.
        if (r.scope === "especifica" && r.target_type === "empresa" && r.target_company_id) {
          const co = companyById.get(r.target_company_id);
          parts.push(co?.name, co?.cnpj);
        }

        const haystack = norm(parts.filter(Boolean).join(" "));
        if (!tokens.every((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [rules, filterScope, filterTarget, onlyIncomplete, showInactive, companies]);

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
      <PageHeader title={embedded ? "" : "Regras de Pagamento"} icon={embedded ? undefined : BadgeDollarSign} description={embedded ? "" : "A IA usa essas regras para analisar cada pagamento."}
        actions={<>
          {/* Menu "Mais ações" — agrupa CTAs secundárias para reduzir ruído visual */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MoreHorizontal className="h-4 w-4 mr-2" /> Mais ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Importação</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2" /> Importar com IA
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadTemplate}>
                <FileDown className="h-4 w-4 mr-2" /> Baixar modelo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Configuração</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setGlobalConfigOpen(true)}>
                <Wand2 className="h-4 w-4 mr-2" /> Configurações Gerais
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Exportação</DropdownMenuLabel>
              <DropdownMenuItem onSelect={exportAllToPDF}>
                <FileDown className="h-4 w-4 mr-2" /> Exportar relatório
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Diálogos controlados pelas entradas do menu acima */}
          <Dialog open={globalConfigOpen} onOpenChange={setGlobalConfigOpen}>
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
                  <Label className="text-warning-text font-bold uppercase text-xs">Alerta Padrão (Amarelo)</Label>
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
            maxWidth="7xl"
          >
            <Tabs defaultValue="form" className="w-full">
              {editingId && (
                <>
                  <TabsList className="grid w-full grid-cols-3 mb-3">
                    <TabsTrigger value="form">Formulário</TabsTrigger>
                    <TabsTrigger value="history">
                      <History className="h-4 w-4 mr-1.5" /> Histórico
                    </TabsTrigger>
                    <TabsTrigger value="snapshots">
                      <Camera className="h-4 w-4 mr-1.5" /> Snapshots
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="history" className="mt-0">
                    <RuleHistoryTab ruleId={editingId} />
                  </TabsContent>
                  <TabsContent value="snapshots" className="mt-0">
                    <RuleSnapshotsTab ruleId={editingId} onRestored={() => { setOpen(false); load(); }} />
                  </TabsContent>
                </>
              )}
              <TabsContent value="form" className="mt-0">
                {editingRuleId && pendingDoctors.length > 0 && (
                  <div className="mb-3 rounded-md border border-warning/40 bg-warning/5 p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {pendingDoctors.length} médico{pendingDoctors.length > 1 ? "s" : ""} novo{pendingDoctors.length > 1 ? "s" : ""} pendente{pendingDoctors.length > 1 ? "s" : ""} de revisão
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Estes médicos entraram em empresas vinculadas à regra depois da última edição. Eles já estão sendo cobertos automaticamente — confirme a inclusão ou exclua da regra. (As alterações são salvas ao clicar em Salvar regra.)
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pendingDoctors.map((d) => (
                        <div key={`${d.company_id}-${d.doctor_id}`} className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs">
                          <span className="font-medium">{d.doctor_name}</span>
                          {d.doctor_crm && <span className="text-muted-foreground">· {d.doctor_crm}</span>}
                          <span className="text-muted-foreground">· {d.company_name}</span>
                          <Button
                            type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs text-success hover:text-success"
                            onClick={() => {
                              setFGroupLinks((prev) => prev.map((l) => l.company_id === d.company_id
                                ? { ...l, doctors: [...l.doctors, { id: d.doctor_id, name: d.doctor_name, crm: d.doctor_crm ?? undefined }] }
                                : l));
                              setPendingDoctors((p) => p.filter((x) => !(x.company_id === d.company_id && x.doctor_id === d.doctor_id)));
                            }}
                            title="Confirmar inclusão na regra"
                          >
                            ✓ Incluir
                          </Button>
                          <Button
                            type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setFGroupLinks((prev) => prev.map((l) => l.company_id === d.company_id
                                ? { ...l, excluded_doctors: [...(l.excluded_doctors ?? []), { id: d.doctor_id, name: d.doctor_name, crm: d.doctor_crm ?? undefined }] }
                                : l));
                              setPendingDoctors((p) => p.filter((x) => !(x.company_id === d.company_id && x.doctor_id === d.doctor_id)));
                            }}
                            title="Excluir desta regra"
                          >
                            ✕ Excluir
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <form id="rule-form" onSubmit={submitRule} className="rule-form-context">

                  <RuleFormStepper
                    isEditing={!!editingId}
                    saving={saving}
                    onCancel={() => setOpen(false)}
                    onSubmit={() => {
                      const form = document.getElementById("rule-form") as HTMLFormElement | null;
                      form?.requestSubmit();
                    }}
                    summaryBanner={(() => {
                      let ondeShort = "";
                      let ondeFull = "";
                      let groupParts: string[] = [];
                      if (scope === "master") {
                        ondeShort = "Todos os itens (master)";
                        ondeFull = ondeShort;
                      } else if (scope === "especifica") {
                        ondeShort = `Específica · ${RULE_TARGET_TYPE_LABELS[targetType]}${fTargetName ? ` "${fTargetName}"` : ""}`;
                        ondeFull = ondeShort;
                      } else if (scope === "grupo") {
                        const parts: string[] = [];
                        for (const link of fGroupLinks) {
                          if (!link.company_id) continue;
                          const co = companies.find((c) => c.id === link.company_id);
                          const nm = co?.name ?? link.company_id.slice(0, 8);
                          parts.push(`${nm} — ${link.doctors.length === 0 ? "todos os médicos" : `${link.doctors.length} médico(s)`}`);
                        }
                        if (fGroupDoctors.length > 0) parts.push(`Médicos específicos: ${fGroupDoctors.map((d) => d.name).join(", ")}`);
                        groupParts = parts;
                        const companyCount = fGroupLinks.filter((l) => l.company_id).length;
                        ondeShort = parts.length
                          ? `Aplica para ${companyCount} empresa${companyCount === 1 ? "" : "s"}${fGroupDoctors.length > 0 ? ` + ${fGroupDoctors.length} médico(s) específico(s)` : ""}`
                          : "Grupo · adicione empresa(s) ou médico(s) específico(s)";
                        ondeFull = parts.length ? `Aplica para ${parts.join("; ")}` : ondeShort;
                      } else {
                        ondeShort = RULE_SCOPE_LABELS[scope];
                        ondeFull = ondeShort;
                      }
                      const calc = fNature === "informativo"
                        ? "Informativa / bloqueio (não calcula)"
                        : fCalculations.length > 1
                          ? `${fCalculations.length} cálculos`
                          : `${RULE_CALCULATION_TYPE_LABELS[fCalculations[0]?.calculation_type ?? "informativo"]}`;
                      const canCollapse = scope === "grupo" && groupParts.length > 2;
                      return (
                        <OndeSummaryBanner
                          ondeShort={ondeShort}
                          ondeFull={ondeFull}
                          calc={calc}
                          canCollapse={canCollapse}
                        />
                      );
                    })()}
                    syncErrorBanner={null}
                    steps={[
                      {
                        key: "identificacao",
                        label: "Identificação",
                        description: "Nome, escopo e vigência",
                        errorCount: sectionErrors.identificacao,
                        content: (
                          <div className="space-y-4">
                            {/* Status ativo */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                              <Checkbox id="rule-active" checked={fActive} onCheckedChange={(v) => setFActive(!!v)} />
                              <Label htmlFor="rule-active" className="cursor-pointer" style={{ fontWeight: 600, fontSize: 13, color: "hsl(var(--foreground))" }}>
                                Regra Ativa
                              </Label>
                              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>(inativa = motor ignora)</span>
                            </div>

                            {/* Identificação principal */}
                            <div className="field-section">
                              <div className="field-section-title">Identificação</div>
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                                <div className="space-y-1.5">
                                  <Label>Nome *</Label>
                                  <Input required maxLength={100} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ex: Repasse Infectologia" />
                                </div>
                                <div className="space-y-1.5">
                                  <Label>Escopo</Label>
                                  <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => (
                                        <SelectItem key={k} value={k}>
                                          <div>
                                            <div className="font-medium">{v}</div>
                                            <div className="text-xs text-muted-foreground">
                                              {{ master: "Catch-all — aplica quando nenhuma outra regra casar", grupo: "Grupo de PJs ou médicos", especifica: "Um único médico ou empresa" }[k]}
                                            </div>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <Label>Severidade</Label>
                                  <Select value={fSeverity} onValueChange={(v) => setFSeverity(v as RuleSeverity)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="info">Info — apenas informativo</SelectItem>
                                      <SelectItem value="aviso">Aviso — alerta amarelo</SelectItem>
                                      <SelectItem value="bloqueio">Bloqueio — erro vermelho</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5 col-span-2">
                                  <Label>Tipo de pagamento</Label>
                                  <div className="rounded-md border border-dashed border-border bg-muted/30 p-2.5">
                                    <p className="text-xs text-muted-foreground">
                                      Agora configurado dentro de cada <strong>cálculo</strong> (etapa <em>Cálculo → filtro "Tipo de pagamento"</em>).
                                      Permite ter, na mesma regra, um cálculo para <strong>Parecer</strong> e outro para <strong>Visita</strong> com o mesmo TUSS,
                                      sem precisar duplicar a regra inteira.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>


                            {/* Vigência */}
                            <div className="field-section">
                              <div className="field-section-title">Vigência</div>
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,220px) minmax(0,220px)", gap: 12 }}>
                                <div className="space-y-1.5">
                                  <Label>Início</Label>
                                  <DateInput value={fValidFrom} onChange={setFValidFrom} />
                                </div>
                                <div className="space-y-1.5">
                                  <Label>Fim</Label>
                                  <DateInput value={fValidUntil} onChange={setFValidUntil} />
                                </div>
                              </div>
                            </div>

                            {/* Mínimo garantido (piso de produção) */}
                            <div className="field-section">
                              <div className="field-section-title flex items-center justify-between">
                                <span>Mínimo garantido</span>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    id="rule-min-garantido"
                                    checked={fMinGarantidoAtivo}
                                    onCheckedChange={(v) => setFMinGarantidoAtivo(!!v)}
                                  />
                                  <Label htmlFor="rule-min-garantido" className="text-xs font-normal cursor-pointer">
                                    Aplicar piso de produção
                                  </Label>
                                </div>
                              </div>
                              {fMinGarantidoAtivo && (
                                <div className="space-y-3">
                                  <div className="space-y-1.5">
                                    <Label className="text-xs">Como aplicar o piso *</Label>
                                    <div className="flex flex-col gap-2 text-sm">
                                      <label className="flex items-start gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name="min-garantido-escopo"
                                          checked={fMinGarantidoEscopo === "medico_empresa"}
                                          onChange={() => setFMinGarantidoEscopo("medico_empresa")}
                                          className="mt-1"
                                        />
                                        <span>
                                          <strong>Por médico + PJ</strong> — cada médico em cada PJ tem o próprio piso.
                                          Ex.: piso de R$ 25.000 por médico.
                                        </span>
                                      </label>
                                      <label className="flex items-start gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name="min-garantido-escopo"
                                          checked={fMinGarantidoEscopo === "empresa"}
                                          onChange={() => setFMinGarantidoEscopo("empresa")}
                                          className="mt-1"
                                        />
                                        <span>
                                          <strong>Por PJ</strong> — soma a produção de todos os médicos da PJ e compara
                                          com o piso. Ex.: cada empresa deve receber R$ 25.000 no total.
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,220px) 1fr", gap: 12, alignItems: "end" }}>
                                    <div className="space-y-1.5">
                                      <Label>Valor mínimo mensal (R$) *</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={fMinGarantidoValor}
                                        onChange={(e) => setFMinGarantidoValor(e.target.value)}
                                        placeholder="Ex: 25000,00"
                                      />
                                    </div>
                                    <div className="text-xs text-muted-foreground rounded-md border border-dashed p-2.5">
                                      Avaliado <strong>por competência (mês)</strong>, sobre <strong>produção bruta</strong>.
                                      Se a produção ficar abaixo do piso, o sistema lança um <strong>item de complemento</strong> automaticamente —
                                      vale tanto para pagamento normal quanto para pool.
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Descrição e texto */}
                            <div className="field-section">
                              <div className="field-section-title">Detalhamento</div>
                              <div className="space-y-1.5">
                                <Label>Descrição</Label>
                                <Input maxLength={300} value={fDescription} onChange={(e) => setFDescription(e.target.value)} placeholder="Resumo breve (opcional)" />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Texto operacional *</Label>
                                <Textarea required rows={3} maxLength={2000} value={fRuleText} onChange={(e) => setFRuleText(e.target.value)} placeholder="Descreva a lógica da regra em linguagem natural…" />
                              </div>
                            </div>
                          </div>
                        ),
                      },
                      {
                        key: "aplicacao",
                        label: "Alvo",
                        description: scope === "master" ? "Aplica a todos" : scope === "grupo" ? `${fGroupLinks.length} empresa(s)` : "Empresa ou médico",
                        errorCount: sectionErrors.aplicacao,
                        content: (
                          <div className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
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
                                        value={fTargetName ? { id: fTargetCompanyId ?? "__sel__", name: fTargetName, document: fTargetIdentifier ? onlyDigits(fTargetIdentifier) : null } : null}
                                        onChange={(c) => {
                                          setFTargetName(c?.name ?? "");
                                          setFTargetIdentifier(c?.document ? formatCNPJ(c.document) : "");
                                          setFTargetCompanyId(c?.id && c.id !== "__sel__" ? c.id : null);
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
                                          readOnly
                                          placeholder="Preenchido pelo cadastro"
                                          className="bg-muted/40 cursor-not-allowed"
                                        />
                                        <p className="text-[10px] text-muted-foreground">Vem do cadastro. Para alterar, escolha outra empresa acima.</p>
                                      </div>
                                      <div className="space-y-1.5"><Label>Nome</Label>
                                        <Input value={fTargetName} readOnly className="bg-muted/40 cursor-not-allowed" />
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="space-y-1.5">
                                      <Label>Médico cadastrado</Label>
                                      <DoctorCombobox
                                        value={fTargetName ? { id: fTargetDoctorId ?? "__sel__", name: fTargetName, crm: fTargetIdentifier || null, crm_uf: null } : null}
                                        onChange={(d) => {
                                          setFTargetName(d?.name ?? "");
                                          setFTargetIdentifier(d?.crm ?? "");
                                          setFTargetDoctorId(d?.id && d.id !== "__sel__" ? d.id : null);
                                        }}

                                        placeholder="Buscar médico…"
                                        className="w-full"
                                      />
                                      <p className="text-xs text-muted-foreground">Puxa nome e CRM direto do cadastro de médicos.</p>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div className="space-y-1.5"><Label>CRM (ou Identificador)</Label>
                                        <Input value={fTargetIdentifier} readOnly className="bg-muted/40 cursor-not-allowed" />
                                        <p className="text-[10px] text-muted-foreground">Vem do cadastro. Para alterar, escolha outro médico acima.</p>
                                      </div>
                                      <div className="space-y-1.5"><Label>Nome</Label>
                                        <Input value={fTargetName} readOnly className="bg-muted/40 cursor-not-allowed" />
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
                                          onClick={() => setFGroupLinks((prev) => [{ company_id: "", doctors: [], excluded_doctors: [], auto_include_new_doctors: true, _isNew: true } as any, ...prev])}
                                        >
                                          <Plus className="h-4 w-4 mr-1" /> Adicionar empresa
                                        </Button>
                                      </div>
                                    </div>

                                    {fGroupLinks.length === 0 && (
                                      <p className="text-xs text-muted-foreground italic">Nenhuma empresa vinculada. Clique em "Adicionar empresa" ou use médicos específicos abaixo.</p>
                                    )}

                                    {fGroupLinks.length > 0 && (() => {
                                      const qFilter = norm(companyLinksFilter);
                                      const matchesStatus = (link: typeof fGroupLinks[number]) => {
                                        const autoIncL = (link as any).auto_include_new_doctors !== false;
                                        const excluded = ((link as any).excluded_doctors ?? []) as { name: string }[];
                                        const allowed = link.company_id ? (companyDoctorsMap[link.company_id] ?? []) : [];
                                        if (companyLinksStatusFilter === "todos") return true;
                                        if (companyLinksStatusFilter === "com_excluidos") return excluded.length > 0;
                                        if (companyLinksStatusFilter === "allowlist") return !autoIncL;
                                        if (companyLinksStatusFilter === "sem_medicos") return allowed.length === 0;
                                        if (companyLinksStatusFilter === "incompleto") return !link.company_id;
                                        return true;
                                      };
                                      const visibleCount = fGroupLinks.filter((l) => {
                                        if (!matchesStatus(l)) return false;
                                        if (!qFilter) return true;
                                        const co = l.company_id ? companies.find((c) => c.id === l.company_id) : null;
                                        const name = co?.name || (l as any).company_name || "";
                                        return norm(name).includes(qFilter);
                                      }).length;
                                      const allCollapsed = fGroupLinks.every((l) => !l.company_id || collapsedCompanies.has(l.company_id));
                                      return (
                                        <div className="flex flex-wrap items-center gap-2 pt-1">
                                          <span className="text-xs font-normal text-muted-foreground shrink-0">
                                            {visibleCount === fGroupLinks.length
                                              ? `${fGroupLinks.length} ${fGroupLinks.length === 1 ? "empresa" : "empresas"}`
                                              : `${visibleCount} de ${fGroupLinks.length} ${fGroupLinks.length === 1 ? "empresa" : "empresas"}`}
                                          </span>
                                          <div className="relative flex-1 min-w-[180px] max-w-xs">
                                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                            <Input
                                              value={companyLinksFilter}
                                              list="rules-company-links-suggestions"
                                              onChange={(e) => setCompanyLinksFilter(e.target.value)}
                                              placeholder="Buscar empresa ou médico…"
                                              className="h-8 pl-7 pr-7 text-xs font-normal"
                                              style={{ borderWidth: "0.5px" }}
                                            />
                                            {companyLinksFilter && (
                                              <button
                                                type="button"
                                                onClick={() => setCompanyLinksFilter("")}
                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                                                aria-label="Limpar busca"
                                              >×</button>
                                            )}
                                            <datalist id="rules-company-links-suggestions">
                                              {fGroupLinks.map((l, i) => {
                                                const co = l.company_id ? companies.find((c) => c.id === l.company_id) : null;
                                                const name = co?.name || (l as any).company_name || "";
                                                return name ? <option key={`${i}-${name}`} value={name} /> : null;
                                              })}
                                            </datalist>
                                          </div>
                                          <Select value={companyLinksStatusFilter} onValueChange={(v) => setCompanyLinksStatusFilter(v as any)}>
                                            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs" style={{ borderWidth: "0.5px" }}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="todos">Todos os status</SelectItem>
                                              <SelectItem value="com_excluidos">Com médicos excluídos</SelectItem>
                                              <SelectItem value="allowlist">Auto-incluir desligado</SelectItem>
                                              <SelectItem value="sem_medicos">Sem médicos vinculados</SelectItem>
                                              <SelectItem value="incompleto">Linha incompleta</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          <Button
                                            type="button" size="sm" variant="ghost" className="h-8 text-xs ml-auto"
                                            onClick={() => {
                                              if (allCollapsed) {
                                                setCollapsedCompanies(new Set());
                                              } else {
                                                setCollapsedCompanies(new Set(fGroupLinks.map((l) => l.company_id).filter(Boolean) as string[]));
                                              }
                                            }}
                                          >
                                            {allCollapsed ? "Expandir todas" : "Colapsar todas"}
                                          </Button>
                                        </div>
                                      );
                                    })()}

                                    <div className="space-y-2">
                                      {(() => {
                                        const qFilter = norm(companyLinksFilter);
                                        const matchesStatus = (link: typeof fGroupLinks[number]) => {
                                          const autoIncL = (link as any).auto_include_new_doctors !== false;
                                          const excluded = ((link as any).excluded_doctors ?? []) as { name: string }[];
                                          const allowed = link.company_id ? (companyDoctorsMap[link.company_id] ?? []) : [];
                                          if (companyLinksStatusFilter === "todos") return true;
                                          if (companyLinksStatusFilter === "com_excluidos") return excluded.length > 0;
                                          if (companyLinksStatusFilter === "allowlist") return !autoIncL;
                                          if (companyLinksStatusFilter === "sem_medicos") return allowed.length === 0;
                                          if (companyLinksStatusFilter === "incompleto") return !link.company_id;
                                          return true;
                                        };
                                        const visible = fGroupLinks
                                          .map((l, i) => ({ link: l, idx: i }))
                                          .filter(({ link }) => {
                                            if ((link as any)._isNew) return true;
                                            if (!matchesStatus(link)) return false;
                                            if (!qFilter) return true;
                                            const co = link.company_id ? companies.find((c) => c.id === link.company_id) : null;
                                            const name = co?.name || (link as any).company_name || "";
                                            return norm(name).includes(qFilter);
                                          });
                                        if ((qFilter || companyLinksStatusFilter !== "todos") && visible.length === 0) {
                                          return (
                                            <p className="text-xs text-muted-foreground italic px-1">
                                              Nenhuma empresa corresponde aos filtros aplicados.
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
                                        const invalidPicked: { name: string; crm?: string }[] = [];
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
                                        const autoInc = (link as any).auto_include_new_doctors !== false;
                                        const excludedList = ((link as any).excluded_doctors ?? []) as { name: string; crm?: string }[];
                                        const enabledNames = new Set(link.doctors.map((d) => norm(d.name)));
                                        const excludedNames = new Set(excludedList.map((d) => norm(d.name)));
                                        const isDoctorEnabled = (d: { name: string }) => {
                                          const k = norm(d.name);
                                          if (enabledNames.has(k)) return true;
                                          if (excludedNames.has(k)) return false;
                                          return autoInc;
                                        };
                                        const enabledCount = allowedDocs.filter(isDoctorEnabled).length;
                                        const disabledCount = allowedDocs.length - enabledCount;
                                        const doctorsSummary = allowedDocs.length === 0
                                          ? (autoInc ? "Todos os médicos" : "Nenhum médico")
                                          : `${enabledCount}/${allowedDocs.length} habilitados${disabledCount > 0 ? ` · ${disabledCount} fora` : ""}${autoInc ? " · auto-incluir novos" : ""}`;
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
                                                         updateLink({ company_id: c.id, doctors: [], excluded_doctors: [], auto_include_new_doctors: true, company_name: c.name, company_document: c.document ?? null, _isNew: false } as any);
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
                                                  <div className="space-y-2 animate-fade-in">
                                                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2">
                                                      <div className="min-w-0">
                                                        <Label className="text-xs font-medium">Auto-incluir novos médicos da PJ</Label>
                                                        <p className="text-[11px] text-muted-foreground">
                                                          {autoInc
                                                            ? "Qualquer médico vinculado a esta PJ entra na regra automaticamente — exceto os desabilitados abaixo."
                                                            : "Modo allowlist: somente os médicos marcados abaixo entram. Novos vínculos ficam de fora até habilitação manual."}
                                                        </p>
                                                      </div>
                                                      <Switch
                                                        checked={autoInc}
                                                        onCheckedChange={(checked) => {
                                                          if (checked) {
                                                            // OFF → ON: limpa whitelist e excluded (todos habilitados, exceto se já tinha excluídos explícitos)
                                                            // Mantém excluídos para preservar intenção do usuário.
                                                            updateLink({ auto_include_new_doctors: true, doctors: [] } as any);
                                                          } else {
                                                            // ON → OFF: promove habilitados atuais para whitelist explícita.
                                                            const explicit = allowedDocs.filter(isDoctorEnabled);
                                                            updateLink({ auto_include_new_doctors: false, doctors: explicit, excluded_doctors: [] } as any);
                                                          }
                                                        }}
                                                      />
                                                    </div>

                                                    <div className="flex items-center justify-between">
                                                      <Label className="text-xs">Médicos vinculados à PJ</Label>
                                                      {allowedDocs.length > 0 && (
                                                        <div className="flex items-center gap-1">
                                                          <Button
                                                            type="button" size="sm" variant="ghost"
                                                            className="h-7 text-[11px]"
                                                            onClick={() => {
                                                              if (autoInc) {
                                                                updateLink({ doctors: [], excluded_doctors: [] } as any);
                                                              } else {
                                                                updateLink({ doctors: allowedDocs, excluded_doctors: [] } as any);
                                                              }
                                                            }}
                                                          >
                                                            Habilitar todos
                                                          </Button>
                                                          <Button
                                                            type="button" size="sm" variant="ghost"
                                                            className="h-7 text-[11px]"
                                                            onClick={() => {
                                                              if (autoInc) {
                                                                updateLink({ doctors: [], excluded_doctors: allowedDocs } as any);
                                                              } else {
                                                                updateLink({ doctors: [], excluded_doctors: [] } as any);
                                                              }
                                                            }}
                                                          >
                                                            Desabilitar todos
                                                          </Button>
                                                        </div>
                                                      )}
                                                    </div>

                                                    {loadingDocs ? (
                                                      <p className="text-xs text-muted-foreground italic">Carregando médicos…</p>
                                                    ) : allowedDocs.length === 0 ? (
                                                      <p className="text-xs text-muted-foreground italic">
                                                        Nenhum médico vinculado a esta PJ no cadastro. {autoInc ? "Qualquer médico que vier a ser vinculado entrará automaticamente." : "Cadastre vínculos médico↔PJ ou ligue o auto-incluir."}
                                                      </p>
                                                    ) : (
                                                      <div className="rounded-md border border-border bg-background/40 divide-y divide-border max-h-72 overflow-y-auto">
                                                        {allowedDocs.map((d, di) => {
                                                          const enabled = isDoctorEnabled(d);
                                                          return (
                                                            <label
                                                              key={`${d.name}-${di}`}
                                                              className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted/40 cursor-pointer"
                                                            >
                                                              <div className="min-w-0 flex-1">
                                                                <span className={cn("truncate", !enabled && "text-muted-foreground line-through")}>{d.name}</span>
                                                                {d.crm && (
                                                                  <span className="ml-1 text-[10px] text-muted-foreground cell-mono">· {d.crm}</span>
                                                                )}
                                                              </div>
                                                              <Switch
                                                                checked={enabled}
                                                                onCheckedChange={(checked) => {
                                                                  const k = norm(d.name);
                                                                  const nextEnabled = link.doctors.filter((x) => norm(x.name) !== k);
                                                                  const nextExcluded = excludedList.filter((x) => norm(x.name) !== k);
                                                                  if (checked) {
                                                                    if (autoInc) {
                                                                      updateLink({ excluded_doctors: nextExcluded } as any);
                                                                    } else {
                                                                      updateLink({ doctors: [...nextEnabled, d], excluded_doctors: nextExcluded } as any);
                                                                    }
                                                                  } else {
                                                                    if (autoInc) {
                                                                      updateLink({ doctors: nextEnabled, excluded_doctors: [...nextExcluded, d] } as any);
                                                                    } else {
                                                                      updateLink({ doctors: nextEnabled, excluded_doctors: nextExcluded } as any);
                                                                    }
                                                                  }
                                                                }}
                                                              />
                                                            </label>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                    <p className="text-[11px] text-muted-foreground">
                                                      Desabilitar aqui só afeta esta regra. Se o médico não estiver habilitado em nenhuma outra regra, ele cai no fallback (regra master/geral).
                                                    </p>
                                                  </div>
                                                )}

                                                <div className="text-xs text-muted-foreground border-t border-border pt-1.5 truncate" title={`${co?.name ?? "—"} | ${doctorsSummary}`}>
                                                  <span className="font-medium">{co?.name ?? "—"}</span>
                                                  {" | "}
                                                  {doctorsSummary}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                        });
                                      })()}
                                    </div>
                                  </div>

                                  <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                                    <div>
                                      <Label className="text-sm font-semibold">Médicos específicos (regra exclusiva para eles)</Label>
                                      <p className="text-xs text-muted-foreground">Use quando o acordo segue o médico, não a PJ. Os médicos listados aqui recebem ESTA regra em qualquer empresa pela qual estejam faturando — e ficam automaticamente <strong>expurgados</strong> de outras regras que cubram a PJ inteira deles. Casa por nome+CRM em qualquer empresa do item. Pode ser combinado com os vínculos por empresa acima (OR).</p>
                                    </div>
                                    <DoctorsEditor value={fGroupDoctors} onChange={setFGroupDoctors} />
                                  </div>
                                </div>
                              );
                            })()}

                            {scope === "master" && (
                              <p className="text-xs text-muted-foreground">Regra master — aplica a todos os itens que passarem pelos filtros acima. Setores, códigos, convênios, especialidades, tipos de pagamento e horários agora são configurados <strong>dentro de cada item de Cálculo</strong>.</p>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "calculo",
                        label: "Cálculo",
                        description: fNature === "informativo" ? "Informativa" : `${fCalculations.length} método(s)`,
                        errorCount: sectionErrors.calculo,
                        content: (
                          <div className="space-y-4 max-w-full overflow-hidden p-1 pt-1">
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
                                  specialCaseTypes={specialCaseTypes}
                                  paymentTypes={paymentTypesList.filter((p: any) => p.origin !== "payment_model")}
                                  enabled={true}
                                  renderCalcExtras={(calc, idx) => {
                                    if (calc.calculation_type !== "exclusao") return null;
                                    // Config é única por regra: ancora no PRIMEIRO cálculo de exclusão
                                    // para manter consistência com o estado (fExclusionReason / fAllowsAuthorizedException).
                                    const firstExclusaoIdx = fCalculations.findIndex((x) => x.calculation_type === "exclusao");
                                    if (idx !== firstExclusaoIdx) return null;
                                    return (
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
                                    );
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "avancado",
                        label: "Avançado",
                        description: "Limiares e exceções",
                        errorCount: 0,
                        content: (
                          <div className="space-y-6 max-w-full overflow-hidden p-1 pt-1">
                            {/* Fallback para regra geral */}
                            <div className="rounded-md border border-border bg-card p-3 space-y-2">
                              <label className="flex items-start gap-2 cursor-pointer">
                                <Checkbox
                                  checked={fPreventExternalFallback}
                                  onCheckedChange={(v) => setFPreventExternalFallback(!!v)}
                                />
                                <div className="space-y-1">
                                  <div className="text-sm font-semibold leading-tight">
                                    Não permitir fallback para a regra geral
                                  </div>
                                  <p className="text-xs text-muted-foreground leading-snug">
                                    Quando ligado, se esta regra vence a seleção mas nenhum cálculo bate,
                                    o item vai para <strong>sem regra</strong> com alerta — em vez de cair
                                    silenciosamente na regra geral master. Recomendado para regras específicas
                                    (com setor/convênio/empresa/médico). Combine com um cálculo marcado como
                                    <strong> piso (catch-all)</strong> para criar uma "última barreira"
                                    interna da regra.
                                  </p>
                                </div>
                              </label>
                            </div>

                            <div>
                              <div className="flex items-center text-sm font-semibold mb-3">
                                Limiares de divergência
                                {(fAlertInherit && fBlockInherit) ? (
                                  <span className="ml-2 text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">HERDANDO GLOBAL</span>
                                ) : (
                                  <span className="ml-2 text-[10px] font-normal text-info bg-info-soft px-1.5 py-0.5 rounded border border-info/20">PERSONALIZADO</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mb-3">
                                Define quando uma diferença de valor deve ser tratada como Alerta ou Bloqueio Crítico.
                              </p>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="rounded-md border border-warning/30 bg-warning-soft/10 p-3 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-warning-text font-bold">ALERTA (AMARELO)</Label>
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
                            </div>

                            <div>
                              <div className="flex items-center text-sm font-semibold mb-2">
                                Tabelas de exceção vinculadas
                                {fExceptionTableIds.length > 0 && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">({fExceptionTableIds.length})</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mb-3">
                                Vincule tabelas do tipo <strong>Códigos sem acordo</strong> ou <strong>Exclusão</strong> que invalidam esta regra.
                                Quando o item bater nesta regra e o código estiver em uma tabela vinculada, o motor pula o cálculo e aceita o valor pago pelo convênio.
                                Tabelas só têm efeito quando vinculadas — não há varredura global.
                              </p>
                              {(() => {
                                const eligible = refTables.filter((t) => t.purpose === "sem_acordo" || t.purpose === "exclusao");
                                if (eligible.length === 0) {
                                  return <p className="text-xs text-muted-foreground italic">Nenhuma tabela com propósito "Códigos sem acordo" ou "Exclusão" cadastrada.</p>;
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
                            </div>

                            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                              <p className="text-xs text-muted-foreground">
                                <strong>Caso especial</strong> (oncológico, pediátrico, etc.) agora é configurado dentro de cada <strong>cálculo</strong> da regra
                                (etapa <em>Cálculo → filtro "Caso especial"</em>). Assim você pode ter um cálculo padrão e outro que só ativa quando o item
                                tem caso especial aprovado, sem precisar duplicar a regra inteira.
                              </p>
                            </div>
                          </div>
                        ),
                      },
                    ]}
                  />
                </form>
              </TabsContent>
            </Tabs>
          </FormDialog>

        </>
      }
    />
      <div className="p-8 space-y-4">
        <RulesHealthPanel onSelectRule={(id) => { const r = rules.find((x) => x.id === id); if (r) { openEdit(r); setOpen(true); } }} />
        <PisoDefasagemCard onSelectRule={(id) => { const r = rules.find((x) => x.id === id); if (r) { openEdit(r); setOpen(true); } }} />
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
            <Input value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)} placeholder="Buscar nome da regra, empresa, médico, CRM/CNPJ…" className="pl-8 w-[320px]" />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={onlyIncomplete} onCheckedChange={(c) => setOnlyIncomplete(!!c)} />
            <span>Só desatualizadas</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={showInactive} onCheckedChange={(c) => setShowInactive(!!c)} />
            <span>Mostrar inativas</span>
          </label>
          <p className="text-xs text-muted-foreground ml-auto">
            {filtered.length} de {rules.length}
            {!showInactive && rules.some(r => r.active === false) ? ` (${rules.filter(r => r.active === false).length} inativa${rules.filter(r => r.active === false).length > 1 ? "s" : ""} oculta${rules.filter(r => r.active === false).length > 1 ? "s" : ""})` : ""}
          </p>
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
                                code={r.code}
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
                                pendingDoctorsCount={pendingByRule[r.id] ?? 0}
                                onToggleSelect={() => toggleSelect(r.id)}
                                onEdit={() => openEdit(r)}
                                onDuplicate={() => openDuplicate(r)}
                                onCloneToHospital={() => setCloneTarget(r)}
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
            {drafts.filter(d => d.active).length > 1 && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const selected = drafts.filter(d => d.active);
                    if (selected.length < 2) return;
                    const merged: DraftRule = {
                      ...selected[0],
                      name: selected[0].name || "Regra consolidada",
                      calculations: selected.flatMap((d, idx) => (d.calculations ?? [{
                        label: d.name || `Cálculo ${idx + 1}`,
                        calculation_type: d.calculation_type,
                        fixed_amount: d.fixed_amount,
                        package_amount: d.package_amount,
                        bonus_amount: d.bonus_amount,
                        bonus_pct: d.bonus_pct,
                        target_amount: d.target_amount,
                        multiplier: d.multiplier,
                        deflator_pct: d.deflator_pct,
                        convenio_percentage: d.convenio_percentage,
                        procedure_codes: d.procedure_codes.length ? d.procedure_codes : null,
                        code_match_mode: d.procedure_codes.length ? "whitelist" : "any",
                        specialties: d.specialties,
                        sectors: d.sectors,
                        has_conditions: d.specialties.length > 0 || d.sectors.length > 0,
                        is_catch_all: false,
                      }])),
                    };
                    const inactive = drafts.filter(d => !d.active);
                    setDrafts([merged, ...inactive]);
                    toast({ title: `${selected.length} regras mescladas em 1 com ${merged.calculations?.length ?? 0} cálculos` });
                  }}
                >
                  Mesclar selecionadas em 1 regra ({drafts.filter(d => d.active).length})
                </Button>
              </div>
            )}
          </DialogHeader>
          <div className="space-y-4">
            {drafts.map((d, i) => (
              <Card key={i} className={`p-4 ${d.active ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-3 mb-3">
                  <Checkbox checked={d.active} onCheckedChange={(v) => updateDraft(i, { active: !!v })} className="mt-1" />
                  <Input value={d.name} onChange={(e) => updateDraft(i, { name: e.target.value })} placeholder="Nome" className="font-medium" />
                  {(d.calculations?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="shrink-0 mt-1.5">
                      {d.calculations!.length} cálculo(s)
                    </Badge>
                  )}
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
                              ? { id: (d as any).target_company_id ?? "", name: d.target_name ?? "", document: d.target_identifier ?? null }
                              : null
                          }
                          onChange={(c) =>
                            updateDraft(i, {
                              target_name: c?.name ?? "",
                              target_identifier: c?.document ? formatCNPJ(c.document) : "",
                              target_company_id: c?.id || null,
                            } as any)
                          }
                          placeholder="Buscar empresa cadastrada…"
                          className="w-full"
                        />
                      ) : (
                        <DoctorCombobox
                          value={
                            d.target_name || d.target_identifier
                              ? { id: (d as any).target_doctor_id ?? "", name: d.target_name ?? "", crm: d.target_identifier ?? null, crm_uf: null }
                              : null
                          }
                          onChange={(doc) =>
                            updateDraft(i, {
                              target_name: doc?.name ?? "",
                              target_identifier: doc?.crm ?? "",
                              target_doctor_id: doc?.id || null,
                            } as any)
                          }
                          placeholder="Buscar médico cadastrado…"
                          className="w-full"
                        />
                      )}

                    </div>
                    <div className="space-y-1 col-span-3"><Label className="text-xs">CPF/CNPJ/CRM</Label>
                      <Input
                        value={d.target_identifier ?? ""}
                        readOnly
                        placeholder="Preenchido pelo cadastro"
                        className="bg-muted/40 cursor-not-allowed"
                      />
                    </div>
                  </>}
                </div>


                <div className="rounded-md border border-dashed border-warning/50 bg-warning/5 p-2 mb-3 text-xs text-warning-text">
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
        onCancel={() => {
          // Restaura editingId caso tenha sido perdido (edição de regra existente)
          if (pendingRuleData?.id && !editingId) {
            setEditingId(pendingRuleData.id as string);
          }
          setConflictOpen(false);
          setConflictProblems([]);
          setPendingRuleData(null);
          setPendingCalcs([]);
        }}
        onApplyAndSave={handleConflictApply}
      />

      <CloneRuleToHospitalDialog
        open={!!cloneTarget}
        ruleId={cloneTarget?.id ?? null}
        ruleName={cloneTarget?.name ?? null}
        ruleHospitalId={cloneTarget?.hospital_id ?? null}
        onClose={() => setCloneTarget(null)}
        onCloned={() => { load(); }}
      />

      <Dialog
        open={!!reanalysisPrompt}
        onOpenChange={(o) => { if (!o) setReanalysisPrompt(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reanalisar lotes impactados?</DialogTitle>
            <DialogDescription>
              {reanalysisPrompt?.groupsCount ?? 0} lote(s) em aberto contêm a empresa-alvo desta regra
              {reanalysisPrompt?.ruleName ? ` (${reanalysisPrompt.ruleName})` : ""}.
              Disparar reanálise agora para refletir a nova configuração?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs">
              Como a regra foi alterada, o cache foi invalidado e todos esses{" "}
              <strong>{reanalysisPrompt?.aiCount ?? 0}</strong> item(ns) passarão pela IA
              {" "}se você marcar a opção abaixo.
            </div>
            <label className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40">
              <Checkbox
                checked={!!reanalysisPrompt?.runAi}
                onCheckedChange={(c) =>
                  setReanalysisPrompt((p) => (p ? { ...p, runAi: c === true } : p))
                }
                className="mt-0.5"
              />
              <span className="text-xs">
                <strong>Incluir justificativas IA</strong>
                <span className="block text-muted-foreground">
                  Quando desmarcado, roda apenas o motor de regras (sem consumo de créditos de IA).
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReanalysisPrompt(null)}>Cancelar</Button>
            <Button onClick={() => { void confirmReanalysisPrompt(); }}>
              Confirmar reanálise ({reanalysisPrompt?.groupsCount ?? 0} lote(s))
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Rules;
