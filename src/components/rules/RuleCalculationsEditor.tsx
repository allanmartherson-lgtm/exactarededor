import { Button } from "@/components/ui/button";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { RULE_SECTOR_LABELS } from "@/lib/status";
import { SectorMultiSelect } from "@/components/rules/SectorMultiSelect";
import { SpecialtyMultiSelect } from "@/components/rules/SpecialtyMultiSelect";
import { ConvenioMultiSelect } from "@/components/rules/ConvenioMultiSelect";

import { Input } from "@/components/ui/input";
import { CurrencyInputBR } from "@/components/ui/currency-input-br";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Trash2, ChevronDown, ChevronRight, Package, Copy, Sparkles } from "lucide-react";
import { ImportCalculationsDialog } from "./ImportCalculationsDialog";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  RULE_CALCULATION_TYPE_LABELS, RULE_CALCULATION_TYPE_DESCRIPTIONS,
  type RuleCalculationType,
} from "@/lib/status";

/* ============================================================
 * Tipos compartilhados — espelho 1:1 da tabela rule_calculations
 * ============================================================ */
export type TimeMode = "qualquer" | "comercial" | "fora_comercial" | "fim_de_semana" | "feriado" | "personalizado";
export type ElectiveMode = "qualquer" | "eletiva" | "urgencia";

/* Catálogo fixo de funções médicas — espelha classifyDoctorRole no motor. */
const ROLE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "cirurgiao", label: "Cirurgião Principal" },
  { key: "aux1", label: "1º Auxiliar" },
  { key: "aux2", label: "2º Auxiliar" },
  { key: "aux3", label: "3º Auxiliar" },
  { key: "instrumentador", label: "Instrumentador" },
];


export type PackageRoleDistribution = {
  role_key: string;
  label: string;
  dist_type: "pct" | "fixo";
  value: string;
};

export type CalcItem = {
  /** id na DB quando carregado do banco; novos itens não têm id. */
  id?: string;
  label?: string | null;

  // método
  calculation_type: RuleCalculationType;

  // parâmetros financeiros (todos opcionais — dependem do método)
  fixed_amount: string;
  /** Valor fixo por função médica (cirurgiao | primeiro_aux | demais_aux | instrumentador). Vazio = usa fixed_amount global. */
  fixed_amount_by_role: Record<string, string>;
  target_amount: string;
  multiplier: string;
  deflator_pct: string;
  bonus_amount: string;
  bonus_pct: string;
  reference_table_id: string;
  repasse_pct: string;
  /** Acréscimo aditivo (%) aplicado no final, antes do deflator. Só em tabela_diferenciada. */
  acrescimo_pct: string;
  convenio_percentage: string;
  auxiliary_pct: string;
  aux_first_pct: string;
  aux_second_pct: string;
  instrumentador_pct: string;
  include_auxiliaries: boolean;
  package_amount: string;
  package_subtype: "fechado" | "com_extras";
  package_main_code: string;
  package_included_codes: string; // entrada livre, parseada na hora de salvar
  package_auxiliaries_included: boolean;
  package_opinions_count: boolean;
  package_visits_count: boolean;
  extras_codes: string; // entrada livre
  package_roles_distribution: PackageRoleDistribution[];
  apply_access_route: boolean;
  /** Vias de acesso permitidas para este item de cálculo. */
  allowed_access_routes: string[];

  // condições (vinculadas a ESTE cálculo)
  has_conditions: boolean;
  time_mode: TimeMode;
  weekdays: number[];
  time_start: string;
  time_end: string;
  includes_holidays: boolean;
  elective_mode: ElectiveMode;
  sectors: string[];
  specialties: string[];
  /** Quando true, o motor filtra por specialties[]. Default false = especialidade fica só informativa. */
  match_by_specialty: boolean;
  force_totalized: boolean;
  /** Para bônus: define se aplica por linha, por atendimento ou por paciente+dia (fallback). */
  application_unit: "por_item" | "por_atendimento" | "por_paciente_dia";

  // ---- Adicionais temporais (aplicados após o cálculo base) ----
  adicional_fds_pct: string;
  adicional_feriado_pct: string;
  adicional_noturno_pct: string;
  /** % adicional para urgência/emergência (independe de dia/horário). */
  adicional_urgencia_pct: string;
  noturno_inicio: string;   // 'HH:MM'
  noturno_fim: string;      // 'HH:MM'

  // ---- Filtros restritivos por cálculo (refactor: tudo no cálculo) ----
  /** Códigos TUSS aos quais este cálculo se aplica. Vazio = qualquer código. */
  procedure_codes: string[];
  code_match_mode: "whitelist" | "blacklist" | "any";
  /** Convênios aceitos/bloqueados; herda da regra-pai se vazio (legado). */
  agreement_aliases: string[];
  agreement_match_mode: "whitelist" | "blacklist";
  /** Funções do médico aplicáveis. */
  doctor_roles: string[];
  /** Tipos de caso especial aplicáveis a este cálculo. Vazio = cálculo padrão. */
  special_case_filter: string[];
  /** Tipo de pagamento aplicável (Parecer, Visita, etc.). null = qualquer tipo. */
  item_type_id: string | null;

  /** Condições de contexto (somente para valor_fixo). */
  context_conditions: ContextConditionItem[];

  /**
   * Cálculo "piso" da regra: avaliado por último, ignora filtros de código
   * (whitelist/blacklist de procedure_codes e procedure_keywords). Demais
   * filtros continuam valendo. Máximo 1 por regra.
   */
  is_catch_all: boolean;

  /**
   * Só em `calculation_type === "exclusao"`: quando true, se um item disparar
   * a exclusão, TODOS os demais itens do mesmo (atendimento, data) também são
   * excluídos (pagamento zerado). Exceção: se pelo menos 1 item do atendimento
   * pertencer a médico listado na regra, o atendimento inteiro é poupado.
   */
  contagia_atendimento: boolean;

  // ---- Piso por procedimento (mínimo garantido) ----
  // Só faz sentido em percentual_sobre_convenio. Aplica MAX(convênio, piso).
  piso_habilitado: boolean;
  piso_escopo: "por_item" | "por_atendimento";
  piso_valor_padrao: string;
  piso_por_funcao: PisoRoleItem[];
};

/** Piso por função médica — chaves canônicas do motor (classifyDoctorRole). */
export type PisoRoleItem = {
  role: "cirurgiao" | "primeiro_aux" | "demais_aux" | "instrumentador" | "outro";
  label: string;
  valor: string;
};

const DEFAULT_PISO_ROLES: PisoRoleItem[] = [
  { role: "cirurgiao", label: "Cirurgião Principal", valor: "" },
  { role: "primeiro_aux", label: "1º Auxiliar", valor: "" },
  { role: "demais_aux", label: "Demais Auxiliares", valor: "" },
  { role: "instrumentador", label: "Instrumentador", valor: "" },
];

/** Condição de contexto editável (strings nos inputs, convertidas no salvar). */
export type ContextConditionItem = {
  trigger_codes: string[];
  match_mode: "any" | "all";
  value: string;
  complement_value: string;
};

/** Construtor de item vazio (default sensato). */
export function makeEmptyCalc(): CalcItem {
  return {
    calculation_type: "informativo",
    fixed_amount: "", fixed_amount_by_role: {}, target_amount: "", multiplier: "", deflator_pct: "",
    bonus_amount: "", bonus_pct: "", reference_table_id: "", repasse_pct: "", acrescimo_pct: "",
    convenio_percentage: "", auxiliary_pct: "",
    aux_first_pct: "30", aux_second_pct: "20", instrumentador_pct: "10",
    include_auxiliaries: false,
    package_amount: "", package_subtype: "fechado", package_main_code: "",
    package_included_codes: "", package_auxiliaries_included: true,
    package_opinions_count: false, package_visits_count: false,
    extras_codes: "", apply_access_route: false,
    package_roles_distribution: [
      { role_key: "cirurgiao", label: "Cirurgião Principal", dist_type: "pct" as const, value: "" },
      { role_key: "aux1", label: "1º Auxiliar", dist_type: "pct" as const, value: "" },
      { role_key: "aux2", label: "2º Auxiliar", dist_type: "pct" as const, value: "" },
    ],
    allowed_access_routes: [],
    has_conditions: false, time_mode: "qualquer", weekdays: [],
    time_start: "", time_end: "", includes_holidays: false, elective_mode: "qualquer",
    sectors: [], specialties: [], match_by_specialty: false,
    force_totalized: false,
    application_unit: "por_item",
    procedure_codes: [],
    code_match_mode: "any",
    agreement_aliases: [],
    agreement_match_mode: "whitelist",
    doctor_roles: [],
    special_case_filter: [],
    item_type_id: null,
    context_conditions: [],
    adicional_fds_pct: "",
    adicional_feriado_pct: "",
    adicional_noturno_pct: "",
    adicional_urgencia_pct: "",
    noturno_inicio: "",
    noturno_fim: "",
    is_catch_all: false,
    contagia_atendimento: false,
    piso_habilitado: false,
    piso_escopo: "por_item",
    piso_valor_padrao: "",
    piso_por_funcao: DEFAULT_PISO_ROLES.map((r) => ({ ...r })),
  };
}

const TIME_MODE_LABELS: Record<TimeMode, string> = {
  qualquer: "Qualquer dia/horário (livre)",
  comercial: "Horário comercial (seg–sex 07–19h)",
  fora_comercial: "Fora do horário comercial",
  fim_de_semana: "Fim de semana (sáb/dom)",
  feriado: "Apenas feriados",
  personalizado: "Personalizado (escolher dias/horas)",
};
const ELECTIVE_MODE_LABELS: Record<ElectiveMode, string> = {
  qualquer: "Qualquer (eletiva ou urgência)",
  eletiva: "Apenas eletivas",
  urgencia: "Apenas urgência/emergência",
};
const WEEKDAY_LABELS = [
  { v: 0, label: "Dom" }, { v: 1, label: "Seg" }, { v: 2, label: "Ter" },
  { v: 3, label: "Qua" }, { v: 4, label: "Qui" }, { v: 5, label: "Sex" }, { v: 6, label: "Sáb" },
];

const CALCULABLE_METHODS: RuleCalculationType[] = [
  "percentual_sobre_convenio", "regra_vias", "pacote",
  "valor_fixo", "tabela_diferenciada", "bonus", "complemento", "exclusao",
];

const sanitizeDecimalDraft = (value: string) => value.replace(/[^\d.,]/g, "").replace(",", ".");

const sanitizeTimeDraft = (value: string) => {
  const clean = value.replace(/[^\d:]/g, "").slice(0, 5);
  if (clean.includes(":")) {
    const [hh = "", mm = ""] = clean.split(":");
    return `${hh.slice(0, 2)}${clean.includes(":") ? ":" : ""}${mm.slice(0, 2)}`;
  }
  const digits = clean.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
};

const preventEnterSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.preventDefault();
};

type RefTable = { id: string; name: string; purpose?: string };

export type RuleCalculationsEditorProps = {
  value: CalcItem[];
  onChange: (next: CalcItem[]) => void;
  refTables: RefTable[];
  specialCaseTypes?: { code: string; label: string }[];
  paymentTypes?: { id: string; label: string }[];
  /** Quando "informativa/bloqueio", o editor fica oculto (regra não calcula). */
  enabled: boolean;
  /**
   * Slot opcional para renderizar configuração extra DENTRO do card do cálculo.
   * Recebe o item e o índice. Usado, por ex., para colar "Configuração da exclusão"
   * logo abaixo do cálculo do tipo `exclusao` que a originou.
   */
  renderCalcExtras?: (item: CalcItem, index: number) => React.ReactNode;
};

/**
 * Editor de uma LISTA de itens de cálculo (1:N). Cada item carrega seu próprio
 * bloco de "Aplica-se a algum período, dia ou horário específico?" porque a
 * janela temporal pertence ao cálculo, não à regra.
 */
export function RuleCalculationsEditor({ value, onChange, refTables, specialCaseTypes = [], paymentTypes = [], enabled, renderCalcExtras }: RuleCalculationsEditorProps) {
  const crossErrorsByIndex = useMemo(() => calcCrossItemErrorMessages(value), [value]);
  const [importOpen, setImportOpen] = useState(false);

  const update = (i: number, patch: Partial<CalcItem>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => {
    if (value.length === 1) {
      // mantém pelo menos um item; faz reset.
      onChange([makeEmptyCalc()]);
      return;
    }
    onChange(value.filter((_, idx) => idx !== i));
  };
  const add = () => onChange([...value, makeEmptyCalc()]);
  const duplicate = (i: number) => {
    const src = value[i];
    // clona sem id (para virar novo registro) e adiciona sufixo no rótulo
    const { id: _omit, ...rest } = src as any;
    const clone: CalcItem = {
      ...(JSON.parse(JSON.stringify(rest)) as CalcItem),
      label: src.label ? `${src.label} (cópia)` : "Cópia do cálculo",
    };
    const next = value.slice();
    next.splice(i + 1, 0, clone);
    onChange(next);
  };

  if (!enabled) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Regra informativa/bloqueio — não calcula valor esperado.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {value.map((c, i) => (
        <CalcCard
          key={c.id ?? `new-${i}`}
          index={i}
          total={value.length}
          item={c}
          refTables={refTables}
          specialCaseTypes={specialCaseTypes}
          paymentTypes={paymentTypes}
          extraErrorMessages={crossErrorsByIndex.get(i) ?? []}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
          onDuplicate={() => duplicate(i)}
          extras={renderCalcExtras?.(c, i)}
        />
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add} className="flex-1">
          <Plus className="h-4 w-4 mr-1" /> Adicionar cálculo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)} className="flex-1">
          <Sparkles className="h-4 w-4 mr-1" /> Importar cálculos com IA
        </Button>
      </div>
      {value.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Quando há mais de um cálculo, o motor avalia cada um independentemente
          e <strong>soma</strong> os valores dos cálculos cujas condições baterem.
        </p>
      )}
      <ImportCalculationsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        paymentTypes={paymentTypes}
        existingLabels={value.map((c) => c.label ?? "").filter(Boolean)}
        onImport={(news) => {
          // Append: pré-visualização já filtrou; mantemos os existentes e
          // adicionamos os novos no final para o analista revisar/ajustar.
          // Se o único cálculo atual ainda é o "vazio" default (informativo
          // sem qualquer dado), substituímos para não poluir a lista.
          const onlyEmpty = value.length === 1
            && value[0].calculation_type === "informativo"
            && !value[0].label
            && !value[0].fixed_amount
            && value[0].procedure_codes.length === 0
            && value[0].specialties.length === 0;
          onChange(onlyEmpty ? news : [...value, ...news]);
        }}
      />
    </div>
  );
}

/* ============================================================
 *  Bloco "Valor fixo" — apenas o campo de valor.
 *  O bloco de complementos vai logo após "Quando aplicar este cálculo".
 * ============================================================ */
function ValorFixoBlock({
  c, onChange,
}: { c: CalcItem; onChange: (patch: Partial<CalcItem>) => void }) {
  const [byRoleOpen, setByRoleOpen] = useState<boolean>(
    Object.keys(c.fixed_amount_by_role ?? {}).length > 0,
  );

  const updateRole = (key: string, value: string) => {
    const next = { ...(c.fixed_amount_by_role ?? {}) };
    if (value.trim() === "") delete next[key];
    else next[key] = value;
    onChange({ fixed_amount_by_role: next });
  };

  const toggleByRole = (open: boolean) => {
    if (!open && Object.keys(c.fixed_amount_by_role ?? {}).length > 0) {
      const ok = window.confirm("Remover todos os valores por função e voltar ao valor único?");
      if (!ok) return;
      onChange({ fixed_amount_by_role: {} });
    }
    setByRoleOpen(open);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Valor fixo padrão (R$)</Label>
        <CurrencyInputBR
          value={c.fixed_amount}
          onChange={(v) => onChange({ fixed_amount: v })}
          placeholder="Ex.: 611,88"
        />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Valor pago por código, independente do convênio. Use os campos por função abaixo
          quando o valor mudar conforme a função do médico (ex.: principal R$ 2.000 / 1º aux R$ 600).
        </p>
      </div>

      <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
        <Checkbox
          checked={byRoleOpen}
          onCheckedChange={(v) => toggleByRole(!!v)}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        <span className="text-xs">
          Definir valor diferente por função médica
          <span className="block text-[10px] text-muted-foreground">
            Quando preenchido, sobrescreve o valor padrão para a função correspondente.
          </span>
        </span>
      </label>

      {byRoleOpen && (
        <div className="rounded-md border border-border bg-muted/40 overflow-hidden">
          <div className="px-3 py-2 bg-muted/60 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Valor por função
            </span>
          </div>
          {ROLE_OPTIONS.map((opt) => {
            const key = opt.key === "aux1" ? "primeiro_aux"
              : opt.key === "aux2" ? "demais_aux"
              : opt.key === "aux3" ? "demais_aux"
              : opt.key;
            const current = c.fixed_amount_by_role?.[key] ?? "";
            return (
              <div key={opt.key}
                className="grid items-center gap-2 px-3 py-1.5 border-b border-border last:border-b-0"
                style={{ gridTemplateColumns: "1fr 140px" }}>
                <Label className="text-xs">{opt.label}</Label>
                <CurrencyInputBR
                  className="h-7 text-xs text-right font-mono"
                  placeholder="usa valor padrão"
                  value={current}
                  onChange={(v) => updateRole(key, v)}
                />
              </div>
            );
          })}
          <p className="px-3 py-2 text-[10px] text-muted-foreground italic">
            Funções vazias caem no valor padrão acima. 1º, 2º e 3º auxiliares compartilham
            a chave "primeiro_aux"/"demais_aux" do motor.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 *  Bloco "Complementos" — exibido após "Quando aplicar este cálculo"
 *  pois o código informado lá é a base à qual os complementos se ligam.
 * ============================================================ */
function ComplementosBlock({
  c, onChange,
}: { c: CalcItem; onChange: (patch: Partial<CalcItem>) => void }) {
  const [hasComplementos, setHasComplementos] = useState<boolean>(
    (c.context_conditions?.length ?? 0) > 0,
  );

  const toggleComplementos = (v: boolean) => {
    if (!v && c.context_conditions.length > 0) {
      const ok = window.confirm("Remover todos os complementos deste cálculo?");
      if (!ok) return;
      onChange({ context_conditions: [] });
    }
    setHasComplementos(v);
  };

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
        <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
          <Checkbox
            checked={hasComplementos}
            onCheckedChange={(v) => toggleComplementos(!!v)}
            style={{ marginTop: "2px", flexShrink: 0 }}
            className=""
          />
          <span>
            Este código possui complementos no mesmo atendimento?
            <span className="block text-xs text-muted-foreground">
              Marque quando outros procedimentos realizados no mesmo atendimento modificam o valor deste item. Exemplo: colonoscopia com polipectomia vale R$ 540 em vez de R$ 370.
            </span>
          </span>
        </label>

        {hasComplementos && (
          <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide">Complementos</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Quando os códigos abaixo estiverem no mesmo atendimento, o valor deste item e do complemento mudam conforme configurado.
              </p>
            </div>

            {c.context_conditions.map((cond, ci) => (
              <div key={ci} className="rounded border bg-background p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">Complemento #{ci + 1}</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px]">Modo:</Label>
                    <Select
                      value={cond.match_mode}
                      onValueChange={(v) => {
                        const next = [...c.context_conditions];
                        next[ci] = { ...cond, match_mode: v as "any" | "all" };
                        onChange({ context_conditions: next });
                      }}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">qualquer um</SelectItem>
                        <SelectItem value="all">todos</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button" size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-destructive"
                      onClick={() => {
                        const next = c.context_conditions.filter((_, k) => k !== ci);
                        onChange({ context_conditions: next });
                      }}
                      aria-label="Remover complemento"
                    >✕</Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">Código(s) TUSS do complemento</Label>
                  <div className="flex flex-wrap gap-1">
                    {cond.trigger_codes.map((code) => (
                      <span key={code} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                        {code}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            const next = [...c.context_conditions];
                            next[ci] = { ...cond, trigger_codes: cond.trigger_codes.filter((x) => x !== code) };
                            onChange({ context_conditions: next });
                          }}
                        >×</button>
                      </span>
                    ))}
                    <Input
                      className="h-7 w-32 text-xs"
                      placeholder="código + Enter"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          const raw = (e.currentTarget.value || "").trim();
                          if (!raw) return;
                          const codes = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
                          const next = [...c.context_conditions];
                          const merged = Array.from(new Set([...cond.trigger_codes, ...codes]));
                          next[ci] = { ...cond, trigger_codes: merged };
                          onChange({ context_conditions: next });
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Novo valor deste item quando o complemento estiver presente (R$)</Label>
                    <CurrencyInputBR
                      className="h-8 text-xs"
                      value={cond.value}
                      onChange={(v) => {
                        const next = [...c.context_conditions];
                        next[ci] = { ...cond, value: v };
                        onChange({ context_conditions: next });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Valor esperado do complemento (R$)</Label>
                    <CurrencyInputBR
                      className="h-8 text-xs"
                      value={cond.complement_value}
                      onChange={(v) => {
                        const next = [...c.context_conditions];
                        next[ci] = { ...cond, complement_value: v };
                        onChange({ context_conditions: next });
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground italic leading-snug">
                      Informe o valor que o código complementar deve receber. Geralmente zero, pois o valor é absorvido por este item.
                    </p>
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button" variant="outline" size="sm" className="text-xs h-7"
              onClick={() => {
                onChange({
                  context_conditions: [
                    ...c.context_conditions,
                    { trigger_codes: [], match_mode: "any", value: "0", complement_value: "0" },
                  ],
                });
              }}
            >+ Adicionar complemento</Button>

            <p className="text-[10px] text-muted-foreground italic leading-snug">
              Os complementos são verificados em ordem. O primeiro que bater define o valor. Se nenhum bater, o valor padrão acima é usado.
            </p>
          </div>
        )}
    </div>
  );
}


/* ============================================================
 *  PackageCodeChips — chip input para códigos TUSS no pacote
 * ============================================================ */
function PackageCodeChips({
  value,
  onChange,
  placeholder,
  single,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  single?: boolean;
}) {
  const codes = value.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
  const addCode = (raw: string) => {
    const newCodes = raw.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
    if (single) {
      onChange(newCodes[0] ?? "");
    } else {
      const merged = Array.from(new Set([...codes, ...newCodes]));
      onChange(merged.join(", "));
    }
  };
  const removeCode = (code: string) => {
    onChange(codes.filter((c) => c !== code).join(", "));
  };
  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-border rounded-md min-h-[38px] bg-background cursor-text"
      onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      {codes.map((code) => (
        <span key={code} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-mono"
          style={{ background: single ? "#e6f1fb" : "#e1f5ee", color: single ? "#185fa5" : "#0f6e56", border: `0.5px solid ${single ? "#b5d4f4" : "#9fe1cb"}` }}>
          {code}
          <button type="button" className="opacity-60 hover:opacity-100 leading-none" onClick={(e) => { e.stopPropagation(); removeCode(code); }}>×</button>
        </span>
      ))}
      {(!single || codes.length === 0) && (
        <input
          className="outline-none bg-transparent text-xs flex-1 min-w-[120px] placeholder:text-muted-foreground"
          placeholder={placeholder ?? "código + Enter"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v) { addCode(v); e.currentTarget.value = ""; }
            }
            if (e.key === "Backspace" && !e.currentTarget.value && codes.length > 0) {
              removeCode(codes[codes.length - 1]);
            }
          }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v) { addCode(v); e.target.value = ""; }
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 *  PackageRolesEditor — distribuição de valores por função
 * ============================================================ */
function PackageRolesEditor({
  roles,
  packageAmount,
  onChange,
}: {
  roles: PackageRoleDistribution[];
  packageAmount: string;
  onChange: (next: PackageRoleDistribution[]) => void;
}) {
  const parseBR = (s: string): number => {
    const v = String(s).trim().replace(/\s/g, "");
    if (v.includes(".") && v.includes(",")) {
      // Formato BR: 1.234,56 — ponto = milhar, vírgula = decimal
      return parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;
    }
    if (v.includes(",")) {
      // Só vírgula: trata como separador decimal
      return parseFloat(v.replace(",", ".")) || 0;
    }
    return parseFloat(v) || 0;
  };

  const total = parseBR(packageAmount);

  const calcValue = (role: PackageRoleDistribution): number => {
    const v = parseBR(role.value);
    return role.dist_type === "pct" ? (v / 100) * total : v;
  };

  const sum = roles.reduce((acc, r) => acc + calcValue(r), 0);
  const overBudget = total > 0 && sum > total + 0.01;
  const exact = total > 0 && Math.abs(sum - total) < 0.01;
  const pct = total > 0 ? Math.min(100, (sum / total) * 100) : 0;

  const updateRole = (i: number, patch: Partial<PackageRoleDistribution>) => {
    const next = roles.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  };

  const removeRole = (i: number) => {
    if (roles.length <= 1) return;
    onChange(roles.filter((_, idx) => idx !== i));
  };

  const addRole = () => {
    onChange([...roles, { role_key: `func${roles.length + 1}`, label: "", dist_type: "pct", value: "" }]);
  };

  return (
    <div className="rounded-md border border-border bg-muted/40 overflow-hidden">
      <div className="px-3 py-2 bg-muted/60 border-b border-border flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Distribuição por função</span>
        <span className="text-[10px] text-muted-foreground">% do total ou R$ fixo por função</span>
      </div>

      {/* Cabeçalho */}
      <div className="grid gap-2 px-3 py-1.5 border-b border-border bg-muted/30"
        style={{ gridTemplateColumns: "1fr 84px 100px 90px 28px" }}>
        {["Função", "Tipo", "Valor", "Calculado", ""].map((h, i) => (
          <span key={i} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ textAlign: i >= 2 ? "right" : "left" }}>{h}</span>
        ))}
      </div>

      {/* Linhas por função */}
      {roles.map((role, i) => {
        const computed = calcValue(role);
        const selectedRoleKey = ROLE_OPTIONS.find((o) => o.label === role.label)?.key ?? "__custom";
        return (
          <div key={i} className="grid gap-2 px-3 py-2 border-b border-border items-center"
            style={{ gridTemplateColumns: "1fr 84px 100px 90px 28px" }}>
            <Select
              value={selectedRoleKey}
              onValueChange={(v) => {
                const opt = ROLE_OPTIONS.find((o) => o.key === v);
                if (opt) updateRole(i, { label: opt.label, role_key: opt.key });
              }}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione a função" /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>
                ))}
                {selectedRoleKey === "__custom" && role.label && (
                  <SelectItem value="__custom" className="text-xs italic text-muted-foreground">
                    {role.label} (legado)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>


            {/* Toggle % / R$ */}
            <div className="flex border border-border rounded-md overflow-hidden h-7">
              <button type="button" className="flex-1 text-[11px] font-medium transition-colors"
                style={{
                  background: role.dist_type === "pct" ? "#e6f1fb" : "hsl(var(--background))",
                  color: role.dist_type === "pct" ? "#185fa5" : "hsl(var(--muted-foreground))",
                }}
                onClick={() => updateRole(i, { dist_type: "pct" })}>%</button>
              <button type="button" className="flex-1 text-[11px] font-medium transition-colors border-l border-border"
                style={{
                  background: role.dist_type === "fixo" ? "#e1f5ee" : "hsl(var(--background))",
                  color: role.dist_type === "fixo" ? "#0f6e56" : "hsl(var(--muted-foreground))",
                }}
                onClick={() => updateRole(i, { dist_type: "fixo" })}>R$</button>
            </div>
            <Input
              className="h-7 text-xs text-right font-mono"
              inputMode="decimal"
              placeholder="0,00"
              value={role.value}
              onChange={(e) => updateRole(i, { value: e.target.value })}
            />
            <div className="text-right text-[11px] font-mono" style={{ color: computed > 0 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
              R$ {computed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <button type="button" className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-sm"
              disabled={roles.length <= 1} onClick={() => removeRole(i)}>×</button>
          </div>
        );
      })}

      {/* Adicionar função */}
      <div className="px-3 py-2 border-b border-border">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground w-full justify-start" onClick={addRole}>
          <Plus className="h-3 w-3 mr-1" /> Adicionar função
        </Button>
      </div>

      {/* Barra de total */}
      <div className="px-3 py-2.5 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Total distribuído:</span>
        <span className="text-sm font-mono font-medium" style={{ color: overBudget ? "#a32d2d" : exact ? "#0f6e56" : "#854f0b" }}>
          R$ {sum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-mono text-foreground">
          R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <div className="flex-1 min-w-[80px] h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: overBudget ? "#a32d2d" : exact ? "#0f6e56" : "#854f0b" }} />
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: overBudget ? "#fcebeb" : exact ? "#e1f5ee" : "#faeeda",
            color: overBudget ? "#a32d2d" : exact ? "#0f6e56" : "#854f0b",
          }}>
          {overBudget
            ? "⚠ Ultrapassa o total"
            : exact
            ? "✓ Distribuído"
            : `R$ ${(total - sum).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sem função`}
        </span>
      </div>

      {overBudget && (
        <p className="px-3 pb-2 text-[11px] text-destructive">
          A soma das funções ultrapassa o valor total do pacote. Ajuste os valores antes de salvar.
        </p>
      )}
    </div>
  );
}

const FieldGroup = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    ...style,
  }}>
    {children}
  </div>
);

type FilterBtnProps = {
  id: string;
  label: string;
  active: boolean;
  openSection: string | null;
  onToggle: (key: string) => void;
  children: React.ReactNode;
};

function FilterBtn({ id, label, active, openSection, onToggle, children }: FilterBtnProps) {
  const isOpen = openSection === id;

  return (
    <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, overflow: "hidden" }}>
      <button type="button" onClick={() => onToggle(id)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 14px", background: active ? "hsl(var(--accent))" : "hsl(var(--card))",
        border: "none", cursor: "pointer", fontFamily: "inherit",
        borderBottom: isOpen ? "1px solid hsl(var(--border))" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>{label}</span>
          {active && <span style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>ativo</span>}
        </div>
        <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", display: "inline-block", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
      </button>
      {isOpen && (
        <div style={{ padding: "12px 14px", background: "hsl(var(--card))" }}>{children}</div>
      )}
    </div>
  );
}

/* ============================================================
 *  WhenApplySection — progressive disclosure dos filtros por cálculo
 * ============================================================ */
function WhenApplySection({
  c, onChange, isPacote, specialCaseTypes, paymentTypes,
}: { c: CalcItem; onChange: (p: Partial<CalcItem>) => void; isPacote: boolean; specialCaseTypes: { code: string; label: string }[]; paymentTypes: { id: string; label: string }[] }) {
  const hasCodesFilter = c.code_match_mode !== "any" && c.procedure_codes.length > 0;
  const hasConvenioFilter = c.agreement_aliases.length > 0;
  const hasFuncaoFilter = c.doctor_roles.length > 0;
  const hasSpecialCaseFilter = c.special_case_filter.length > 0;
  const hasPaymentTypeFilter = !!c.item_type_id;
  const hasTemporalSurcharge = !!(c.adicional_fds_pct || c.adicional_feriado_pct || c.adicional_noturno_pct || c.adicional_urgencia_pct || c.noturno_inicio || c.noturno_fim);
  const hasPeriodoFilter = (c.has_conditions && (
    c.time_mode !== "qualquer" || c.elective_mode !== "qualquer" || c.includes_holidays ||
    c.allowed_access_routes.length > 0 || c.sectors.length > 0 || c.specialties.length > 0
  )) || hasTemporalSurcharge;
  const hasNoturnoPct = Number(c.adicional_noturno_pct || 0) > 0;

  const [openSection, setOpenSection] = useState<string | null>(null);
  // Toggle UI-only: como interpretar códigos digitados/importados neste cálculo.
  // "exato" mantém comportamento legado (8 dígitos = código completo).
  // "grupo" armazena o valor com sufixo `*`, que o motor já reconhece como prefixo
  // (rulesEngine.ts calcItemMatches trata `4100*` como startsWith "4100").
  // Se qualquer chip existente já é prefixo, iniciamos em "grupo" para preservar contexto.
  const anyPrefix = (c.procedure_codes || []).some((x) => String(x).endsWith("*"));
  const [codeInputType, setCodeInputType] = useState<"exato" | "grupo">(anyPrefix ? "grupo" : "exato");

  const toggle = (key: string) => setOpenSection(prev => prev === key ? null : key);

  return (
    <div style={{ borderRadius: 8, border: "1px solid hsl(var(--border) / 0.6)", overflow: "hidden" }}>
      <div style={{ padding: "9px 14px", background: "hsl(var(--muted) / 0.4)", borderBottom: "1px solid hsl(var(--border))" }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))" }}>Quando aplicar este cálculo</span>
        <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Deixe todos fechados para aplicar a qualquer item. Expanda apenas o que precisar restringir.</p>
      </div>

      {/* Catch-all (piso da regra) — relaxa filtros de código */}
      <div style={{
        padding: "10px 14px",
        background: c.is_catch_all ? "hsl(var(--primary) / 0.06)" : "hsl(var(--card))",
        borderBottom: "1px solid hsl(var(--border) / 0.6)",
      }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <Checkbox
            checked={c.is_catch_all}
            onCheckedChange={(v) => onChange({ is_catch_all: !!v })}
          />
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Cálculo padrão da regra (catch-all)</span>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              Avaliado por último; cobre qualquer código que não tenha batido nos cálculos anteriores.
              Demais filtros (convênio, setor, função, via, horário) continuam valendo.
              <strong> Máximo 1 por regra.</strong>
            </span>
          </span>
        </label>
        {c.is_catch_all && (
          <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 6, marginLeft: 26 }}>
            ⚠️ Filtros de código TUSS e palavras-chave deste cálculo serão <strong>ignorados</strong> pelo motor.
          </p>
        )}
      </div>

      <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 6, background: "hsl(var(--card))" }}>

        {!isPacote && (
          <FilterBtn id="codigos" label="Códigos TUSS / CBHPM" active={hasCodesFilter} openSection={openSection} onToggle={toggle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <Label className="text-xs">Modo</Label>
              <Select value={c.code_match_mode} onValueChange={(v) => onChange({ code_match_mode: v as CalcItem["code_match_mode"] })}>
                <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whitelist">Apenas estes códigos/grupos</SelectItem>
                  <SelectItem value="blacklist">Todos exceto estes códigos/grupos</SelectItem>
                  <SelectItem value="any">Qualquer código</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {c.code_match_mode !== "any" && (
              <>
                {/* Toggle: interpretar entrada como código exato (8 dígitos) ou grupo/prefixo TUSS. */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Label className="text-xs" style={{ marginRight: "auto" }}>Interpretar entrada como</Label>
                  {([
                    { v: "exato", label: "Código exato", hint: "8 dígitos completos (ex: 41001010)" },
                    { v: "grupo", label: "Grupo (prefixo TUSS)", hint: "Casa qualquer código que comece com o prefixo (ex: 4100 = todas as tomografias)" },
                  ] as const).map((opt) => {
                    const sel = codeInputType === opt.v;
                    return (
                      <button key={opt.v} type="button" onClick={() => setCodeInputType(opt.v)} title={opt.hint}
                        style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500,
                          border: `1px solid ${sel ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                          background: sel ? "hsl(var(--accent))" : "hsl(var(--card))",
                          color: sel ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 6, marginTop: -2 }}>
                  {codeInputType === "grupo"
                    ? "Modo grupo: use 3 a 7 dígitos. O motor aplica a regra a qualquer TUSS que comece com esses dígitos."
                    : "Modo código: use 8 dígitos completos. A regra aplica só ao TUSS exato."}
                </p>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <Input placeholder={codeInputType === "grupo" ? "Digite um prefixo e pressione Enter (ex: 4100)" : "Digite um código e pressione Enter (ex: 31005497)"} className="h-8 text-xs flex-1"
                    inputMode="numeric" pattern="[0-9]*"
                    onInput={(e) => { const t = e.target as HTMLInputElement; const cleaned = t.value.replace(/\D+/g, ""); if (t.value !== cleaned) t.value = cleaned; }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const text = e.clipboardData.getData("text");
                      const raw = text.split(/[,;\s]+/).map(s => s.replace(/\D+/g, "")).filter(Boolean);
                      const vals = raw.filter(v => codeInputType === "grupo" ? (v.length >= 3 && v.length <= 7) : v.length === 8)
                        .map(v => codeInputType === "grupo" ? `${v}*` : v);
                      if (vals.length === 0) return;
                      const merged = Array.from(new Set([...c.procedure_codes, ...vals]));
                      if (merged.length !== c.procedure_codes.length) onChange({ procedure_codes: merged });
                      (e.target as HTMLInputElement).value = "";
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const t = e.target as HTMLInputElement;
                        const raw = t.value.split(/[,;\s]+/).map(s => s.replace(/\D+/g, "")).filter(Boolean);
                        const vals = raw.filter(v => codeInputType === "grupo" ? (v.length >= 3 && v.length <= 7) : v.length === 8)
                          .map(v => codeInputType === "grupo" ? `${v}*` : v);
                        if (vals.length === 0) { toast.error(codeInputType === "grupo" ? "Prefixo inválido (3 a 7 dígitos)" : "Código inválido (8 dígitos)"); return; }
                        const merged = Array.from(new Set([...c.procedure_codes, ...vals]));
                        if (merged.length !== c.procedure_codes.length) onChange({ procedure_codes: merged });
                        t.value = "";
                      }
                    }} />
                  <input type="file" accept=".xlsx,.xls,.csv" id={`import-codes-${c.id ?? c.label}`} className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    try { const XLSX = await import("xlsx"); const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: "array" }); const found = new Set<string>(); for (const sn of wb.SheetNames) { const sh = wb.Sheets[sn]; const rows = XLSX.utils.sheet_to_json<any>(sh, { header: 1, raw: false, defval: "" }); for (const row of rows as any[][]) { for (const cell of row) { const s = String(cell ?? "").trim(); const m = s.match(/\b\d{8}\b/g); if (m) m.forEach(x => found.add(x)); } } }
                    if (found.size === 0) { toast.error("Nenhum código TUSS encontrado"); } else { const merged = Array.from(new Set([...c.procedure_codes, ...found])); onChange({ procedure_codes: merged }); toast.success(`${found.size} códigos importados`); }
                    } catch (err) { toast.error("Erro: " + (err as Error).message); } finally { (e.target as HTMLInputElement).value = ""; }
                  }} />
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs whitespace-nowrap" onClick={() => document.getElementById(`import-codes-${c.id ?? c.label}`)?.click()} title="Importa códigos exatos (8 dígitos) de planilha">📎 Importar</Button>
                </div>
                {c.procedure_codes.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {c.procedure_codes.map(code => {
                      const isPrefix = String(code).endsWith("*");
                      const display = isPrefix ? String(code).slice(0, -1) : code;
                      return (
                        <button key={code} type="button" onClick={() => onChange({ procedure_codes: c.procedure_codes.filter(x => x !== code) })}
                          title={isPrefix ? `Grupo: todos os TUSS começando com ${display}` : `Código exato ${display}`}
                          style={{ fontSize: 10, borderRadius: 20,
                            border: `1px solid ${isPrefix ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                            background: isPrefix ? "hsl(var(--accent))" : "hsl(var(--background))",
                            color: isPrefix ? "hsl(var(--primary))" : "inherit",
                            padding: "2px 8px", cursor: "pointer", fontFamily: "monospace", fontWeight: isPrefix ? 700 : 400 }}>
                          {isPrefix ? `grupo ${display}•` : display} ✕
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </FilterBtn>
        )}

        <FilterBtn id="convenio" label="Convênio" active={hasConvenioFilter} openSection={openSection} onToggle={toggle}>
          <ConvenioMultiSelect
            values={c.agreement_aliases}
            onChange={(next) => onChange({ agreement_aliases: next })}
            matchMode={c.agreement_match_mode}
            onMatchModeChange={(v) => onChange({ agreement_match_mode: v })}
          />
        </FilterBtn>


        <FilterBtn id="funcao" label="Função do médico" active={hasFuncaoFilter} openSection={openSection} onToggle={toggle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[{ v: "cirurgiao", label: "Cirurgião principal" }, { v: "primeiro_aux", label: "1º auxiliar" }, { v: "demais_aux", label: "Demais auxiliares" }, { v: "instrumentador", label: "Instrumentador" }].map(opt => {
              const sel = c.doctor_roles.includes(opt.v);
              return (
                <button key={opt.v} type="button" onClick={() => onChange({ doctor_roles: sel ? c.doctor_roles.filter(x => x !== opt.v) : [...c.doctor_roles, opt.v] })}
                  style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500, border: `1px solid ${sel ? "hsl(var(--primary))" : "hsl(var(--border))"}`, background: sel ? "hsl(var(--accent))" : "hsl(var(--card))", color: sel ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 6 }}>Vazio = qualquer função.</p>
        </FilterBtn>

        <FilterBtn id="caso-especial" label="Caso especial" active={hasSpecialCaseFilter} openSection={openSection} onToggle={toggle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[{ code: "*", label: "Qualquer caso especial aprovado" }, ...specialCaseTypes].map((t) => {
              const sel = c.special_case_filter.includes(t.code);
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => onChange({ special_case_filter: sel ? c.special_case_filter.filter((x) => x !== t.code) : Array.from(new Set([...c.special_case_filter, t.code])) })}
                  style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500, border: `1px solid ${sel ? "hsl(var(--primary))" : "hsl(var(--border))"}`, background: sel ? "hsl(var(--accent))" : "hsl(var(--card))", color: sel ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", cursor: "pointer" }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 6 }}>Vazio = cálculo padrão. Preenchido = só itens com caso especial aprovado correspondente.</p>
        </FilterBtn>


        <FilterBtn id="tipo-pagamento" label="Tipo de pagamento" active={hasPaymentTypeFilter} openSection={openSection} onToggle={toggle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: !c.item_type_id ? "hsl(var(--accent))" : "transparent" }}>
              <input
                type="radio"
                name={`payment-type-${c.id ?? "new"}`}
                checked={!c.item_type_id}
                onChange={() => onChange({ item_type_id: null })}
                style={{ margin: 0, flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, lineHeight: 1.35, marginLeft: 2 }}>Qualquer tipo (cálculo universal)</span>
            </label>

            {paymentTypes.length === 0 ? (
              <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontStyle: "italic", marginTop: 2 }}>
                Nenhum tipo cadastrado em Cadastros → Tipos de pagamento.
              </p>
            ) : (
              paymentTypes.map((pt) => {
                const checked = c.item_type_id === pt.id;
                return (
                  <label key={pt.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: checked ? "hsl(var(--accent))" : "transparent" }}>
                    <input
                      type="radio"
                      name={`payment-type-${c.id ?? "new"}`}
                      checked={checked}
                      onChange={() => onChange({ item_type_id: pt.id })}
                      style={{ margin: 0, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35, marginLeft: 2 }}>{pt.label}</span>
                  </label>

                );
              })
            )}
            <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
              Use para diferenciar cálculos com mesmo TUSS por tipo de pagamento (ex.: Parecer × Visita). Vazio = vale para qualquer tipo.
            </p>
          </div>
        </FilterBtn>


        <FilterBtn id="periodo" label="Período, horário, tipo de atendimento, adicionais, setor e especialidade" active={hasPeriodoFilter} openSection={openSection} onToggle={toggle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Dias / período</Label>
                <Select value={c.time_mode} onValueChange={(v) => onChange({ time_mode: v as TimeMode, has_conditions: v !== "qualquer" || c.elective_mode !== "qualquer" || c.allowed_access_routes.length > 0 })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIME_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Tipo de atendimento</Label>
                <Select value={c.elective_mode} onValueChange={(v) => onChange({ elective_mode: v as ElectiveMode, has_conditions: c.time_mode !== "qualquer" || v !== "qualquer" || c.allowed_access_routes.length > 0 })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ELECTIVE_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {c.time_mode === "personalizado" && (
              <div>
                <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Dias da semana</Label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {WEEKDAY_LABELS.map(d => {
                    const checked = c.weekdays.includes(d.v);
                    return <button key={d.v} type="button" onClick={() => onChange({ weekdays: checked ? c.weekdays.filter(x => x !== d.v) : [...c.weekdays, d.v] })}
                      style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, border: `1px solid ${checked ? "hsl(var(--primary))" : "hsl(var(--border))"}`, background: checked ? "hsl(var(--accent))" : "hsl(var(--card))", color: checked ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                      {d.label}
                    </button>;
                  })}
                </div>
              </div>
            )}
            {(c.time_mode === "personalizado" || c.time_mode === "comercial") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Horário inicial</Label><Input type="time" value={c.time_start} onChange={e => onChange({ time_start: e.target.value })} /></div>
                <div><Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Horário final</Label><Input type="time" value={c.time_end} onChange={e => onChange({ time_end: e.target.value })} /></div>
              </div>
            )}
            <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
              <Checkbox checked={c.includes_holidays} onCheckedChange={v => onChange({ includes_holidays: !!v, has_conditions: c.time_mode !== "qualquer" || c.elective_mode !== "qualquer" || !!v || c.allowed_access_routes.length > 0 })} />
              <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Incluir feriados</span>
            </label>

            {/* ============ Adicionais temporais (independentes do filtro de horário) ============ */}
            <div style={{ marginTop: 4, padding: 10, border: "1px dashed hsl(var(--border))", borderRadius: 6, background: "hsl(var(--muted) / 0.3)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Adicionais sobre o valor calculado</div>
              <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
                Acrescenta % ao valor calculado quando o atendimento ocorrer nessas condições. <strong>Aplica-se apenas o maior</strong> dos adicionais elegíveis (ex: urgência em feriado = só o maior dos dois). Deixe vazio = sem adicional.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Fim de semana (%)</Label>
                  <Input type="text" inputMode="decimal" placeholder="ex: 30" value={c.adicional_fds_pct}
                    onKeyDown={preventEnterSubmit}
                    onChange={e => onChange({ adicional_fds_pct: sanitizeDecimalDraft(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Feriado nacional (%)</Label>
                  <Input type="text" inputMode="decimal" placeholder="ex: 30" value={c.adicional_feriado_pct}
                    onKeyDown={preventEnterSubmit}
                    onChange={e => onChange({ adicional_feriado_pct: sanitizeDecimalDraft(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Noturno (%)</Label>
                  <Input type="text" inputMode="decimal" placeholder="ex: 30" value={c.adicional_noturno_pct}
                    onKeyDown={preventEnterSubmit}
                    onChange={e => onChange({ adicional_noturno_pct: sanitizeDecimalDraft(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs" style={{ marginBottom: 4, display: "block" }} title="Urgência ou emergência — qualquer dia/horário">Urgência/Emerg. (%)</Label>
                  <Input type="text" inputMode="decimal" placeholder="ex: 30" value={c.adicional_urgencia_pct}
                    onKeyDown={preventEnterSubmit}
                    onChange={e => onChange({ adicional_urgencia_pct: sanitizeDecimalDraft(e.target.value) })} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, opacity: hasNoturnoPct ? 1 : 0.65 }}>
                  <div>
                    <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Início janela noturna</Label>
                    <Input type="text" inputMode="numeric" placeholder="19:00" value={c.noturno_inicio}
                      disabled={!hasNoturnoPct}
                      onKeyDown={preventEnterSubmit}
                      onChange={e => onChange({ noturno_inicio: sanitizeTimeDraft(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ marginBottom: 4, display: "block" }}>Fim janela noturna</Label>
                    <Input type="text" inputMode="numeric" placeholder="07:00" value={c.noturno_fim}
                      disabled={!hasNoturnoPct}
                      onKeyDown={preventEnterSubmit}
                      onChange={e => onChange({ noturno_fim: sanitizeTimeDraft(e.target.value) })} />
                  </div>
                  <p style={{ gridColumn: "1 / -1", fontSize: 10, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                    Pode cruzar meia-noite (ex: 19:00 → 07:00). Requer que a base tenha hora do atendimento.
                  </p>
                </div>
            </div>

            {/* Vias de acesso permitidas — configuradas no bloco "Aplicar regra de via de acesso" acima. */}
            <div>
              <Label className="text-xs" style={{ marginBottom: 6, display: "block" }}>Setores aplicáveis</Label>
              <SectorMultiSelect
                values={c.sectors}
                onChange={(next) => onChange({
                  sectors: next,
                  has_conditions: next.length > 0 || c.allowed_access_routes.length > 0 || c.time_mode !== "qualquer" || c.elective_mode !== "qualquer" || c.includes_holidays,
                })}
              />
              <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>Vazio = qualquer setor. Use os setores oficiais do Tasy (código).</p>
            </div>

            {/* Filtro por especialidade — opt-in explícito (default off) */}
            <div>
              <Label className="text-xs" style={{ marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Checkbox
                  checked={c.match_by_specialty}
                  onCheckedChange={(v) => onChange({
                    match_by_specialty: !!v,
                    has_conditions: !!v || c.has_conditions,
                  })}
                />
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>Filtrar este cálculo por especialidade médica</span>
              </Label>

              {c.match_by_specialty ? (
                <>
                  <SpecialtyMultiSelect
                    values={c.specialties}
                    onChange={(next) => onChange({
                      specialties: next,
                      has_conditions: true,
                    })}
                  />
                  <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                    O motor só aplicará este cálculo quando a especialidade do item estiver na lista. Vazio = nenhuma especialidade casa (cálculo descartado).
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                  Desligado: especialidade fica só como informação no relatório (comportamento padrão). Ligue para usar tabelas tipo "consulta por especialidade".
                </p>
              )}
            </div>
          </div>
        </FilterBtn>

      </div>
    </div>
  );
}

/* ============================================================
 *  Card de UM cálculo (método + parâmetros + condições)
 * ============================================================ */
function CalcCard({
  index, total, item, refTables, specialCaseTypes, paymentTypes, extraErrorMessages, onChange, onRemove, onDuplicate, extras,
}: {
  index: number; total: number; item: CalcItem; refTables: RefTable[];
  specialCaseTypes: { code: string; label: string }[];
  paymentTypes: { id: string; label: string }[];
  extraErrorMessages: string[];
  onChange: (patch: Partial<CalcItem>) => void; onRemove: () => void; onDuplicate: () => void;
  extras?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const c = item;
  const isPacote = c.calculation_type === "pacote"
    || c.calculation_type === "pacote_fechado"
    || c.calculation_type === "pacote_com_extras"
    || c.calculation_type === "pacote_por_atendimento";
  const isPacoteComExtras = isPacote && c.package_subtype === "com_extras";
  const errorMessages = [...calcItemErrorMessages(c), ...extraErrorMessages];
  const hasErrors = errorMessages.length > 0;

  // Auto-abre o card quando há erro, para o usuário enxergar imediatamente
  // qual campo está faltando — sem precisar clicar em cada cálculo.
  useEffect(() => {
    if (hasErrors) setOpen(true);
  }, [hasErrors]);

  // Auto-scroll para o PRIMEIRO card com erro ao montar — evita que o usuário
  // veja "1 campo com erro" no rodapé sem saber qual cálculo está fora da viewport.
  useEffect(() => {
    if (!hasErrors || index !== 0) {
      // Só rola se ESTE card é o primeiro com erro entre os cards anteriores.
      // (heurística leve: o card com index mais baixo que tiver erro vence)
    }
    if (hasErrors && cardRef.current) {
      const t = setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
      return () => clearTimeout(t);
    }
  }, []); // só no mount

  return (
    <div ref={cardRef} data-calc-error={hasErrors ? "true" : undefined} style={{
      borderRadius: 10,
      border: hasErrors ? "1px solid hsl(var(--destructive))" : "1px solid hsl(var(--border))",
      background: "hsl(var(--card))",
      boxShadow: hasErrors
        ? "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px hsl(var(--destructive) / 0.5)"
        : "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px hsl(var(--border) / 0.4)",
      overflow: "hidden",
    }}>
      {/* Header laranja Rede D'Or — força ícones/label em branco para contraste
          AA sobre o accent (#FF8200). Sem esse override os botões ghost herdam
          muted-foreground e somem no fundo laranja. */}
      <div
        className="calc-header-orange"
        style={{ background: "hsl(var(--accent))", borderBottom: "1px solid hsl(var(--border))", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}
      >
        <style>{`
          .calc-header-orange button { color: #ffffff !important; transition: background-color 120ms ease, box-shadow 120ms ease, outline-color 120ms ease; outline: 1px solid transparent; }
          .calc-header-orange button:hover { background-color: rgb(255 255 255 / 0.18) !important; color: #ffffff !important; outline: 1px solid rgb(255 255 255 / 0.55); box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 0 0 1px rgb(255 255 255 / 0.25) inset; }
          .calc-header-orange button.text-destructive { color: #ffffff !important; }
          .calc-header-orange button.text-destructive:hover { background-color: rgb(255 255 255 / 0.22) !important; outline: 1px solid rgb(255 255 255 / 0.7); box-shadow: 0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgb(255 255 255 / 0.3) inset; }
          .calc-header-orange button svg { filter: drop-shadow(0 1px 1px rgba(0,0,0,0.18)); }
          .calc-header-orange .calc-type-chip { background-color: rgb(255 255 255 / 0.20); color: #ffffff; padding: 2px 8px; border-radius: 999px; font-weight: 600; border: 1px solid rgb(255 255 255 / 0.25); transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
          .calc-header-orange .calc-type-chip:hover { background-color: rgb(255 255 255 / 0.28); border-color: rgb(255 255 255 / 0.55); box-shadow: 0 1px 3px rgba(0,0,0,0.18); }
        `}</style>

        <Button type="button" variant="ghost" size="sm" className="h-7 px-1" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <span style={{ color: "#ffffff", fontSize: 11 }} className="uppercase tracking-wider font-bold">
          Cálculo #{index + 1}
        </span>
        <Input
          placeholder="Nome da linha (obrigatório, ex.: Excedente — Toracostomia)"
          value={c.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-7 text-xs flex-1"
          aria-required
        />
        {hasErrors && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10.5px] font-semibold text-destructive border border-destructive/30"
            title={errorMessages.join("\n")}
          >
            ! {errorMessages.length} {errorMessages.length === 1 ? "erro" : "erros"}
          </span>
        )}
        <span className="ml-auto text-[10.5px] calc-type-chip">
          {RULE_CALCULATION_TYPE_LABELS[c.calculation_type]}
        </span>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-7 px-2"
          onClick={onDuplicate}
          title="Duplicar este cálculo"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          type="button" variant="ghost" size="sm"
          className={cn("h-7 px-2 text-destructive", total === 1 && "opacity-60")}
          onClick={onRemove}
          title={total === 1 ? "Limpar este cálculo" : "Remover cálculo"}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Bloco de ERROS — sempre visível, mesmo com o card recolhido */}
      {hasErrors && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
            ! Campo(s) obrigatório(s) faltando neste cálculo
          </div>
          <ul className="text-[11px] text-destructive/90 list-disc list-inside space-y-0.5">
            {errorMessages.map((m, i) => (<li key={i}>{m}</li>))}
          </ul>
        </div>
      )}

      {(() => {
        const warnings = calcItemWarnings(c);
        if (warnings.length === 0) return null;
        return (
          <div className="rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              ⚠ Valor fora do padrão
            </div>
            {warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-amber-800 dark:text-amber-200">{w}</p>
            ))}
            <p className="text-[10px] text-amber-700/80 dark:text-amber-300/70 italic">
              Confira se não houve erro de digitação. É possível salvar mesmo assim.
            </p>
          </div>
        );
      })()}

      {open && (
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* === MÉTODO + PARÂMETROS === */}
          <FieldGroup>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))", letterSpacing: "0.02em" }}>Método de cálculo *</Label>
              <Select
                value={c.calculation_type}
                onValueChange={(v) => onChange({ calculation_type: v as RuleCalculationType, reference_table_id: v === "tabela_diferenciada" ? c.reference_table_id : "" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALCULABLE_METHODS.map((k) => (
                    <SelectItem key={k} value={k}>{RULE_CALCULATION_TYPE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{RULE_CALCULATION_TYPE_DESCRIPTIONS[c.calculation_type]}</p>
            </div>

          {c.calculation_type === "percentual_sobre_convenio" && (
            <div className="space-y-1">
              <Label className="text-xs">Percentual sobre o convênio (%)</Label>
              <Input type="number" step="0.01" placeholder="Ex.: 100, 88, 70"
                value={c.convenio_percentage} onChange={(e) => onChange({ convenio_percentage: e.target.value })} />
              <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginTop: "8px", cursor: "pointer" }}>
                <Checkbox
                  style={{ flexShrink: 0 }}
                  checked={c.force_totalized}
                  onCheckedChange={(v) => onChange({ force_totalized: !!v })}
                />
                <span style={{ fontSize: "12px", fontWeight: 500, lineHeight: "1.4" }}>Considerar valor do convênio como já totalizado (ignora quantidade)</span>
              </label>

              {/* Piso por procedimento — mínimo garantido */}
              <div
                className="mt-3 rounded-md border p-3 space-y-3"
                style={{
                  background: c.piso_habilitado ? "hsl(var(--primary) / 0.04)" : "hsl(var(--muted) / 0.3)",
                  borderColor: c.piso_habilitado ? "hsl(var(--primary) / 0.35)" : "hsl(var(--border))",
                }}
              >
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <Checkbox
                    style={{ flexShrink: 0, marginTop: 2 }}
                    checked={c.piso_habilitado}
                    onCheckedChange={(v) => onChange({ piso_habilitado: !!v })}
                  />
                  <span style={{ fontSize: 12, lineHeight: 1.4 }}>
                    <strong>Piso por procedimento</strong> (mínimo garantido).
                    Aplica <code>MAX(percentual × convênio, piso da função)</code>. Se o convênio pagar
                    mais que o piso, o convênio vence; se pagar menos, o piso vence.
                  </span>
                </label>

                {c.piso_habilitado && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Escopo do piso</Label>
                        <Select
                          value={c.piso_escopo}
                          onValueChange={(v) => onChange({ piso_escopo: v as "por_item" | "por_atendimento" })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="por_item">Por item (cada linha tem seu piso)</SelectItem>
                            <SelectItem value="por_atendimento">Por atendimento (soma das linhas)</SelectItem>
                          </SelectContent>
                        </Select>
                        {c.piso_escopo === "por_atendimento" && (
                          <p className="text-[11px] text-amber-600">
                            ⚠ Escopo "por atendimento" ainda cai em "por item" no motor. Suporte completo
                            será liberado em ajuste posterior.
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Piso padrão (R$)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="ex.: 1100,00"
                          value={c.piso_valor_padrao}
                          onChange={(e) => onChange({ piso_valor_padrao: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Fallback quando a função do item não estiver na tabela abaixo.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Piso por função (opcional)</Label>
                      <div className="rounded-md border divide-y">
                        {c.piso_por_funcao.map((row, idx) => (
                          <div
                            key={row.role}
                            className="flex items-center gap-2 px-2 py-1.5"
                          >
                            <span className="text-xs flex-1">{row.label}</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              placeholder="R$"
                              className="max-w-[140px]"
                              value={row.valor}
                              onChange={(e) => {
                                const next = c.piso_por_funcao.slice();
                                next[idx] = { ...row, valor: e.target.value };
                                onChange({ piso_por_funcao: next });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Deixe em branco para usar o piso padrão. Funções fora dessa lista sempre usam o padrão.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {c.calculation_type === "valor_fixo" && (
            <ValorFixoBlock c={c} onChange={onChange} />
          )}
          {c.calculation_type === "bonus" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Bônus fixo (R$)</Label>
                  <CurrencyInputBR value={c.bonus_amount} onChange={(v) => onChange({ bonus_amount: v })} />
                </div>
                <div className="space-y-1"><Label className="text-xs">Bônus (%)</Label>
                  <Input type="number" step="0.01" value={c.bonus_pct} onChange={(e) => onChange({ bonus_pct: e.target.value })} />
                </div>
              </div>
              {!c.bonus_amount && !c.bonus_pct && (
                <p className="text-xs text-destructive">
                  ⚠ Preencha pelo menos um: bônus fixo (R$) ou bônus (%). Sem isso o cálculo é descartado pelo motor.
                </p>
              )}
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-xs font-semibold uppercase tracking-wide">Unidade de aplicação</Label>
                <RadioGroup
                  value={c.application_unit}
                  onValueChange={(v) => onChange({ application_unit: v as CalcItem["application_unit"] })}
                  className="space-y-1"
                >
                  <div className="flex items-start gap-2.5">
                    <RadioGroupItem value="por_item" id={`au-item-${c.label ?? "x"}`} className="mt-0.5" />
                    <Label htmlFor={`au-item-${c.label ?? "x"}`} className="text-xs font-normal leading-tight">
                      <strong>Por item / código</strong> — aplica 1× em cada linha que casar (padrão).
                    </Label>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <RadioGroupItem value="por_atendimento" id={`au-att-${c.label ?? "x"}`} className="mt-0.5" />
                    <Label htmlFor={`au-att-${c.label ?? "x"}`} className="text-xs font-normal leading-tight">
                      <strong>Por atendimento (paciente)</strong> — aplica 1× por atendimento, mesmo com vários códigos/cirurgiões. Use para bônus de plantão de fim de semana/feriado.
                    </Label>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <RadioGroupItem value="por_paciente_dia" id={`au-pd-${c.label ?? "x"}`} className="mt-0.5" />
                    <Label htmlFor={`au-pd-${c.label ?? "x"}`} className="text-xs font-normal leading-tight">
                      <strong>Por paciente + dia</strong> — fallback quando o item não traz número de atendimento.
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Nota: Os códigos específicos deste bônus são informados acima, na seção <strong>Quando aplicar este cálculo</strong>.
              </p>
            </div>
          )}
          {c.calculation_type === "complemento" && (
            <div className="space-y-1">
              <Label className="text-xs">Valor alvo (R$) *</Label>
              <CurrencyInputBR value={c.target_amount} onChange={(v) => onChange({ target_amount: v })} />
            </div>
          )}
          </FieldGroup>

          {isPacote && (
            <div className="space-y-3">
              {/* Identificação */}
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor total do pacote (R$) *</Label>
                    <CurrencyInputBR
                      placeholder="Ex.: 29.321,93"
                      value={c.package_amount}
                      onChange={(v) => onChange({ package_amount: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo de pacote</Label>
                    <Select value={c.package_subtype} onValueChange={(v) => onChange({ package_subtype: v as "fechado" | "com_extras" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fechado">Fechado</SelectItem>
                        <SelectItem value="com_extras">Com extras</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Códigos principais — disparam o pacote *</Label>
                  <PackageCodeChips
                    value={c.package_main_code}
                    onChange={(v) => onChange({ package_main_code: v })}
                    placeholder="Digite código TUSS + Enter (aceita mais de um)"
                  />
                  <p className="text-[10px] text-muted-foreground">Um ou mais códigos. <strong>Basta qualquer um deles</strong> estar presente no atendimento para ativar o pacote (operador OU, não E).</p>
                </div>


                <div className="space-y-1.5">
                  <Label className="text-xs">Códigos incluídos — absorvidos pelo pacote</Label>
                  <PackageCodeChips
                    value={c.package_included_codes}
                    onChange={(v) => onChange({ package_included_codes: v })}
                    placeholder="Digite código + Enter (ex.: 30805228)"
                  />
                  <p className="text-[10px] text-muted-foreground">Todos os códigos que aparecem junto ao principal no mesmo atendimento e fazem parte do pacote.</p>
                </div>

                {isPacoteComExtras && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Códigos extras permitidos</Label>
                    <PackageCodeChips
                      value={c.extras_codes}
                      onChange={(v) => onChange({ extras_codes: v })}
                      placeholder="Digite código + Enter"
                    />
                  </div>
                )}

                {isPacoteComExtras && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                      <Checkbox checked={c.package_visits_count} onCheckedChange={(v) => onChange({ package_visits_count: !!v })} />
                      <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Visitas somam ao pacote</span>
                    </label>
                    <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                      <Checkbox checked={c.package_opinions_count} onCheckedChange={(v) => onChange({ package_opinions_count: !!v })} />
                      <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Pareceres somam ao pacote</span>
                    </label>
                    <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                      <Checkbox checked={c.package_auxiliaries_included} onCheckedChange={(v) => onChange({ package_auxiliaries_included: !!v })} />
                      <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Auxiliares incluídos no pacote</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Distribuição por função */}
              <PackageRolesEditor
                roles={c.package_roles_distribution}
                packageAmount={c.package_amount}
                onChange={(next) => onChange({ package_roles_distribution: next })}
              />
            </div>
          )}

          {c.calculation_type === "tabela_diferenciada" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tabela de referência *</Label>
                <Select
                  value={c.reference_table_id || "__none"}
                  onValueChange={(v) => onChange({ reference_table_id: v === "__none" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder={refTables.length ? "Selecionar tabela" : "Cadastre uma tabela"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Sem vínculo</SelectItem>
                    {refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {c.reference_table_id && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label className="text-xs">Multiplicador</Label>
                      <Input type="number" step="0.01" value={c.multiplier} onChange={(e) => onChange({ multiplier: e.target.value })} />
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs">Deflator (%)</Label>
                      <Input type="number" step="0.01" value={c.deflator_pct} onChange={(e) => onChange({ deflator_pct: e.target.value })} />
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs">% de repasse</Label>
                      <Input type="number" step="0.01" placeholder="100" value={c.repasse_pct} onChange={(e) => onChange({ repasse_pct: e.target.value })} />
                      <p className="text-[10px] text-muted-foreground leading-tight">Multiplicativo. Ex.: 70 = paga 70% do valor. Vazio = 100%.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label className="text-xs">Acréscimo (%)</Label>
                      <Input type="number" step="0.01" placeholder="0" value={c.acrescimo_pct} onChange={(e) => onChange({ acrescimo_pct: e.target.value })} />
                      <p className="text-[10px] text-muted-foreground leading-tight">Aditivo. Ex.: 20 = +20% sobre o valor calculado, antes do deflator.</p>
                    </div>
                  </div>
                  <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                    <Checkbox checked={c.apply_access_route} onCheckedChange={(v) => onChange({
                      apply_access_route: !!v,
                      // Ao desmarcar, limpar as vias para o motor não considerar fantasmas.
                      ...(!v ? { allowed_access_routes: [] } : {}),
                    })} />
                    <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Aplicar regra de via de acesso</span>
                  </label>
                  <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                    <Checkbox checked={c.include_auxiliaries} onCheckedChange={(v) => onChange({ include_auxiliaries: !!v })} />
                    <span style={{ fontSize: "12px", lineHeight: "1.4" }}>Considerar auxiliares</span>
                  </label>
                  {c.include_auxiliaries && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5"><Label className="text-xs">1º auxiliar (%)</Label>
                        <Input type="number" step="0.01" value={c.aux_first_pct} onChange={(e) => onChange({ aux_first_pct: e.target.value })} />
                      </div>
                      <div className="space-y-1.5"><Label className="text-xs">2º auxiliar+ (%)</Label>
                        <Input type="number" step="0.01" value={c.aux_second_pct} onChange={(e) => onChange({ aux_second_pct: e.target.value })} />
                      </div>
                      <div className="space-y-1.5"><Label className="text-xs">Instrumentador (%)</Label>
                        <Input type="number" step="0.01" value={c.instrumentador_pct} onChange={(e) => onChange({ instrumentador_pct: e.target.value })} />
                      </div>
                    </div>
                  )}
                </>
              )}
              
              {c.apply_access_route && (
                <div className="space-y-2 border-t border-border/40 pt-3">
                  <Label className="text-xs font-semibold">Configuração de Vias de Acesso</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Selecione as vias de acesso aceitas para este cálculo. Deixe vazio para aceitar qualquer via.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {[
                      { value: "Única ou principal", help: "1ª via, principal, única" },
                      { value: "Mesma via", help: "Mesma via de acesso, repetida" },
                      { value: "Outra via", help: "Via diferente, 2ª via, segunda via" },
                      { value: "Sem via", help: "Bônus, complemento, n/a" },
                    ].map(opt => {
                      const checked = c.allowed_access_routes.includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          data-checkbox-wrapper
                          style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "6px 8px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: checked ? "hsl(var(--accent))" : "transparent" }}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = v
                                ? [...c.allowed_access_routes, opt.value]
                                : c.allowed_access_routes.filter(x => x !== opt.value);
                              onChange({ allowed_access_routes: next });
                            }}
                          />
                          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                            <span style={{ fontSize: 12, fontWeight: 500 }}>{opt.value}</span>
                            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{opt.help}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {c.calculation_type === "exclusao" && (
            <div className="space-y-2 border border-amber-200 bg-amber-50/50 rounded-md p-3">
              <label data-checkbox-wrapper style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <Checkbox
                  checked={!!c.contagia_atendimento}
                  onCheckedChange={(v) => onChange({ contagia_atendimento: !!v })}
                />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Contagiar demais itens do mesmo atendimento + data
                  </span>
                  <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    Quando um item disparar esta exclusão, todos os demais itens do mesmo atendimento
                    (na mesma data) também serão excluídos — nada será pago.
                    <br />
                    Exceção: se pelo menos 1 item do atendimento pertencer a um médico listado na regra
                    (médicos do escopo/grupo), o atendimento inteiro é poupado do contágio.
                  </span>
                </span>
              </label>
            </div>
          )}

          <WhenApplySection c={c} onChange={onChange} isPacote={isPacote} specialCaseTypes={specialCaseTypes} paymentTypes={paymentTypes} />

          {c.calculation_type === "valor_fixo" && (
            <ComplementosBlock c={c} onChange={onChange} />
          )}

          {extras}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 *  Helpers de conversão (DB <-> State)
 * ============================================================ */
export function calcFromDb(r: any): CalcItem {
  const tMode = (r.time_mode as TimeMode) ?? "qualquer";
  const wdays = Array.isArray(r.weekdays) ? r.weekdays.map((n: any) => Number(n)) : [];
  const tStart = r.time_start ? String(r.time_start).slice(0, 5) : "";
  const tEnd = r.time_end ? String(r.time_end).slice(0, 5) : "";
  const eMode = (r.elective_mode as ElectiveMode) ?? "qualquer";

  return {
    id: r.id,
    label: r.label,
    calculation_type: r.calculation_type as RuleCalculationType,
    fixed_amount: r.fixed_amount != null ? String(r.fixed_amount) : "",
    fixed_amount_by_role: (r.fixed_amount_by_role && typeof r.fixed_amount_by_role === "object")
      ? Object.fromEntries(
          Object.entries(r.fixed_amount_by_role as Record<string, unknown>)
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => [k, String(v)]),
        )
      : {},
    target_amount: r.target_amount != null ? String(r.target_amount) : "",
    multiplier: r.multiplier != null ? String(r.multiplier) : "",
    deflator_pct: r.deflator_pct != null ? String(r.deflator_pct) : "",
    bonus_amount: r.bonus_amount != null ? String(r.bonus_amount) : "",
    bonus_pct: r.bonus_pct != null ? String(r.bonus_pct) : "",
    reference_table_id: r.reference_table_id ?? "",
    repasse_pct: r.repasse_pct != null ? String(r.repasse_pct) : "",
    acrescimo_pct: r.acrescimo_pct != null ? String(r.acrescimo_pct) : "",
    convenio_percentage: r.convenio_percentage != null ? String(r.convenio_percentage) : "",
    auxiliary_pct: r.auxiliary_pct != null ? String(r.auxiliary_pct) : "",
    aux_first_pct: r.aux_first_pct != null ? String(r.aux_first_pct) : "30",
    aux_second_pct: r.aux_second_pct != null ? String(r.aux_second_pct) : "20",
    instrumentador_pct: r.instrumentador_pct != null ? String(r.instrumentador_pct) : "10",
    include_auxiliaries: !!r.include_auxiliaries,
    package_amount: r.package_amount != null ? String(r.package_amount) : "",
    package_subtype: (r.package_subtype === "com_extras" ? "com_extras" : "fechado") as "fechado" | "com_extras",
    package_main_code: r.package_main_code ?? "",
    package_included_codes: Array.isArray(r.package_included_codes) ? r.package_included_codes.join(", ") : "",
    package_auxiliaries_included: r.package_auxiliaries_included !== false,
    package_opinions_count: !!r.package_opinions_count,
    package_visits_count: !!r.package_visits_count,
    extras_codes: Array.isArray(r.extras_codes) ? r.extras_codes.join(", ") : "",
    package_roles_distribution: Array.isArray(r.package_roles_distribution)
      ? r.package_roles_distribution.map((d: any) => ({
          role_key: String(d.role_key ?? ""),
          label: String(d.label ?? ""),
          dist_type: (d.dist_type === "fixo" ? "fixo" : "pct") as "fixo" | "pct",
          value: d.value != null ? String(d.value) : "",
        }))
      : [
          { role_key: "cirurgiao", label: "Cirurgião Principal", dist_type: "pct" as const, value: "" },
          { role_key: "aux1", label: "1º Auxiliar", dist_type: "pct" as const, value: "" },
          { role_key: "aux2", label: "2º Auxiliar", dist_type: "pct" as const, value: "" },
        ],
    apply_access_route: !!r.apply_access_route,
    allowed_access_routes: Array.isArray(r.allowed_access_routes) ? r.allowed_access_routes : [],
    has_conditions: !!r.has_conditions || tMode !== "qualquer" || wdays.length > 0 || !!r.includes_holidays || !!tStart || !!tEnd || eMode !== "qualquer" || (Array.isArray(r.allowed_access_routes) && r.allowed_access_routes.length > 0) || (Array.isArray(r.sectors) && r.sectors.length > 0) || (Array.isArray(r.specialties) && r.specialties.length > 0),
    time_mode: tMode,
    weekdays: wdays,
    time_start: tStart,
    time_end: tEnd,
    includes_holidays: !!r.includes_holidays,
    elective_mode: eMode,
    sectors: Array.isArray(r.sectors) ? r.sectors : [],
    specialties: Array.isArray(r.specialties) ? r.specialties : [],
    match_by_specialty: !!(r as any).match_by_specialty,
    force_totalized: !!r.force_totalized,
    application_unit: (r.application_unit === "por_atendimento" || r.application_unit === "por_paciente_dia") ? r.application_unit : "por_item",
    procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
    code_match_mode: (r.code_match_mode === "blacklist" || r.code_match_mode === "any") ? r.code_match_mode : "whitelist",
    agreement_aliases: Array.isArray(r.agreement_aliases) ? r.agreement_aliases : [],
    agreement_match_mode: r.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist",
    doctor_roles: Array.isArray(r.doctor_roles) ? r.doctor_roles : [],
    special_case_filter: Array.isArray(r.special_case_filter) ? r.special_case_filter : [],
    item_type_id: (r as any).item_type_id ?? null,
    context_conditions: Array.isArray(r.context_conditions)
      ? r.context_conditions.map((cc: any) => ({
          trigger_codes: Array.isArray(cc?.trigger_codes) ? cc.trigger_codes.map((x: any) => String(x)) : [],
          match_mode: cc?.match_mode === "all" ? "all" : "any",
          value: cc?.value != null ? String(cc.value) : "",
          complement_value: cc?.complement_value != null ? String(cc.complement_value) : "0",
        }))
      : [],
    adicional_fds_pct: r.adicional_fds_pct != null ? String(r.adicional_fds_pct) : "",
    adicional_feriado_pct: r.adicional_feriado_pct != null ? String(r.adicional_feriado_pct) : "",
    adicional_noturno_pct: r.adicional_noturno_pct != null ? String(r.adicional_noturno_pct) : "",
    adicional_urgencia_pct: (r as any).adicional_urgencia_pct != null ? String((r as any).adicional_urgencia_pct) : "",
    noturno_inicio: r.noturno_inicio ? String(r.noturno_inicio).slice(0, 5) : "",
    noturno_fim: r.noturno_fim ? String(r.noturno_fim).slice(0, 5) : "",
    is_catch_all: !!r.is_catch_all,
    contagia_atendimento: !!(r as any).contagia_atendimento,
    piso_habilitado: !!(r as any).piso_habilitado,
    piso_escopo: ((r as any).piso_escopo === "por_atendimento" ? "por_atendimento" : "por_item") as "por_item" | "por_atendimento",
    piso_valor_padrao: (r as any).piso_valor_padrao != null ? String((r as any).piso_valor_padrao) : "",
    piso_por_funcao: (() => {
      const raw = (r as any).piso_por_funcao;
      const byRole = new Map<string, PisoRoleItem>();
      for (const d of DEFAULT_PISO_ROLES) byRole.set(d.role, { ...d });
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item) continue;
          const key = String(item.role ?? "") as PisoRoleItem["role"];
          if (!byRole.has(key)) continue;
          byRole.set(key, {
            role: key,
            label: String(item.label ?? byRole.get(key)!.label),
            valor: item.valor != null ? String(item.valor) : "",
          });
        }
      }
      return Array.from(byRole.values());
    })(),
  };
}

const numOrNull = (v: string): number | null => {
  if (!v) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};
const splitCodes = (s: string): string[] =>
  s.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

/** Converte um CalcItem em payload pronto para inserir/atualizar em rule_calculations. */
export function calcToDbPayload(c: CalcItem, ruleId: string, sortOrder: number): Record<string, any> {
  const isPacote = c.calculation_type === "pacote"
    || c.calculation_type === "pacote_fechado"
    || c.calculation_type === "pacote_com_extras"
    || c.calculation_type === "pacote_por_atendimento";
  const isPacoteComExtras = isPacote && c.package_subtype === "com_extras";
  const isTabela = c.calculation_type === "tabela_diferenciada";
  return {
    rule_id: ruleId,
    sort_order: sortOrder,
    label: c.label?.trim() || null,
    calculation_type: c.calculation_type,
    fixed_amount: c.calculation_type === "valor_fixo" ? numOrNull(c.fixed_amount) : null,
    fixed_amount_by_role: c.calculation_type === "valor_fixo"
      ? (() => {
          const entries = Object.entries(c.fixed_amount_by_role ?? {})
            .map(([k, v]) => [k, numOrNull(v)] as const)
            .filter(([, v]) => v != null);
          return entries.length > 0 ? Object.fromEntries(entries) : null;
        })()
      : null,
    target_amount: c.calculation_type === "complemento" ? numOrNull(c.target_amount) : null,
    multiplier: isTabela ? numOrNull(c.multiplier) : null,
    deflator_pct: isTabela ? numOrNull(c.deflator_pct) : null,
    bonus_amount: c.calculation_type === "bonus" ? numOrNull(c.bonus_amount) : null,
    bonus_pct: c.calculation_type === "bonus" ? numOrNull(c.bonus_pct) : null,
    reference_table_id: isTabela ? (c.reference_table_id || null) : null,
    repasse_pct: isTabela ? numOrNull(c.repasse_pct) : null,
    acrescimo_pct: isTabela ? numOrNull(c.acrescimo_pct) : null,
    convenio_percentage: c.calculation_type === "percentual_sobre_convenio" ? numOrNull(c.convenio_percentage) : null,
    auxiliary_pct: isTabela ? numOrNull(c.auxiliary_pct) : null,
    aux_first_pct: (isTabela && c.include_auxiliaries) ? (numOrNull(c.aux_first_pct) ?? 30) : null,
    aux_second_pct: (isTabela && c.include_auxiliaries) ? (numOrNull(c.aux_second_pct) ?? 20) : null,
    instrumentador_pct: (isTabela && c.include_auxiliaries) ? (numOrNull(c.instrumentador_pct) ?? 10) : null,
    include_auxiliaries: isTabela ? c.include_auxiliaries : false,
    package_amount: isPacote ? numOrNull(c.package_amount) : null,
    package_subtype: isPacote ? c.package_subtype : null,
    package_main_code: isPacote ? (c.package_main_code.trim() || null) : null,
    package_included_codes: isPacote ? splitCodes(c.package_included_codes) : null,
    package_auxiliaries_included: isPacoteComExtras ? c.package_auxiliaries_included : false,
    package_opinions_count: isPacoteComExtras ? c.package_opinions_count : false,
    package_visits_count: isPacoteComExtras ? c.package_visits_count : false,
    extras_codes: isPacoteComExtras ? splitCodes(c.extras_codes) : null,
    package_roles_distribution: isPacote
      ? c.package_roles_distribution
          .filter((d) => d.value.trim() !== "")
          .map((d) => ({
            role_key: d.role_key,
            label: d.label,
            dist_type: d.dist_type,
            value: numOrNull(d.value) ?? 0,
          }))
      : null,
    apply_access_route: isTabela ? c.apply_access_route : false,
    allowed_access_routes: c.allowed_access_routes.length > 0 ? c.allowed_access_routes : null,
    has_conditions: c.has_conditions,
    time_mode: c.has_conditions ? c.time_mode : "qualquer",
    weekdays: c.has_conditions
      ? (c.time_mode === "personalizado"
          ? c.weekdays
          : c.time_mode === "fim_de_semana"
            ? [0, 6]
            : c.time_mode === "comercial"
              ? [1, 2, 3, 4, 5]
              : c.time_mode === "fora_comercial"
                ? [1, 2, 3, 4, 5]
                : [])
      : [],
    time_start: c.has_conditions ? (c.time_start || null) : null,
    time_end: c.has_conditions ? (c.time_end || null) : null,
    // Preset "feriado" força includes_holidays=true — garante que o motor
    // identifique a intenção mesmo se a UI não marcou o checkbox manualmente.
    includes_holidays: c.has_conditions ? (c.time_mode === "feriado" ? true : c.includes_holidays) : false,
    elective_mode: c.has_conditions ? c.elective_mode : "qualquer",
    sectors: c.has_conditions ? c.sectors : [],
    specialties: c.has_conditions ? c.specialties : [],
    // Toggle persistido independente de has_conditions: o filtro só atua quando
    // explicitamente ligado E há especialidades selecionadas (default off).
    match_by_specialty: c.has_conditions && c.match_by_specialty && c.specialties.length > 0,
    force_totalized: c.calculation_type === "percentual_sobre_convenio" ? c.force_totalized : false,
    application_unit: c.calculation_type === "bonus" ? c.application_unit : "por_item",
    // Para tipos de pacote, o escopo de código é determinado pelos campos do pacote
    // (main_code + incluídos + extras). Limpamos o filtro genérico para evitar resíduos.
    procedure_codes: isPacote ? null : (c.procedure_codes.length > 0 ? c.procedure_codes : null),
    // Normaliza: sem códigos listados ⇒ modo "any" (fallback). Evita o anti-padrão
    // "whitelist sem códigos" que faz o cálculo capturar qualquer item por engano.
    code_match_mode: isPacote ? "any" : (c.procedure_codes.length > 0 ? c.code_match_mode : "any"),
    agreement_aliases: c.agreement_aliases.length > 0 ? c.agreement_aliases : null,
    agreement_match_mode: c.agreement_aliases.length > 0 ? c.agreement_match_mode : null,
    doctor_roles: c.doctor_roles.length > 0 ? c.doctor_roles : null,
    special_case_filter: c.special_case_filter.length > 0 ? c.special_case_filter : null,
    item_type_id: c.item_type_id ?? null,
    context_conditions: c.calculation_type === "valor_fixo"
      ? c.context_conditions
          .filter((cc) => cc.trigger_codes.length > 0)
          .map((cc) => ({
            trigger_codes: cc.trigger_codes,
            match_mode: cc.match_mode,
            value: numOrNull(cc.value) ?? 0,
            complement_value: numOrNull(cc.complement_value) ?? 0,
          }))
      : [],
    // ---- Adicionais temporais ----
    adicional_fds_pct: numOrNull(c.adicional_fds_pct),
    adicional_feriado_pct: numOrNull(c.adicional_feriado_pct),
    adicional_noturno_pct: numOrNull(c.adicional_noturno_pct),
    adicional_urgencia_pct: numOrNull(c.adicional_urgencia_pct),
    noturno_inicio: (numOrNull(c.adicional_noturno_pct) ?? 0) > 0 ? (c.noturno_inicio || null) : null,
    noturno_fim: (numOrNull(c.adicional_noturno_pct) ?? 0) > 0 ? (c.noturno_fim || null) : null,
    is_catch_all: !!c.is_catch_all,
    contagia_atendimento: c.calculation_type === "exclusao" ? !!c.contagia_atendimento : false,
    // ---- Piso por procedimento (mínimo garantido) — só percentual_sobre_convenio ----
    piso_habilitado: c.calculation_type === "percentual_sobre_convenio" ? !!c.piso_habilitado : false,
    piso_escopo: c.calculation_type === "percentual_sobre_convenio" && c.piso_habilitado ? c.piso_escopo : null,
    piso_valor_padrao: c.calculation_type === "percentual_sobre_convenio" && c.piso_habilitado ? numOrNull(c.piso_valor_padrao) : null,
    piso_por_funcao: c.calculation_type === "percentual_sobre_convenio" && c.piso_habilitado
      ? c.piso_por_funcao
          .map((p) => ({ role: p.role, label: p.label, valor: numOrNull(p.valor) }))
          .filter((p) => p.valor != null && (p.valor as number) > 0)
      : [],
  };
}

/**
 * Misconfigurações que indicam anti-padrão de "whitelist sem códigos".
 * Permitido apenas em `tabela_diferenciada`, onde a própria tabela define o universo de códigos.
 */
export function calcItemHasWhitelistWithoutCodes(c: CalcItem): boolean {
  // Catch-all explícito ignora filtros de código por definição — não conta como anti-padrão.
  if (c.is_catch_all) return false;
  const isPkg = c.calculation_type === "pacote"
    || c.calculation_type === "pacote_fechado"
    || c.calculation_type === "pacote_com_extras"
    || c.calculation_type === "pacote_por_atendimento";
  if (isPkg) return false;
  return (
    c.code_match_mode === "whitelist" &&
    c.procedure_codes.length === 0 &&
    c.calculation_type !== "tabela_diferenciada"
  );
}

/** Erros por item para feedback visual no formulário (apenas validações fortes). */
export function calcItemErrors(c: CalcItem): number {
  return calcItemErrorMessages(c).length;
}

/**
 * Mesma checagem de `calcItemErrors`, mas retorna mensagens descritivas para
 * que a UI consiga apontar EXATAMENTE qual campo está faltando em qual cálculo
 * (em vez de mostrar apenas a contagem agregada no passo).
 */
export function calcItemErrorMessages(c: CalcItem): string[] {
  const msgs: string[] = [];
  if (!c.label || !c.label.trim()) {
    msgs.push("Informe um nome para a linha de cálculo (ajuda na auditoria do item).");
  }
  if (c.calculation_type === "percentual_sobre_convenio" && !c.convenio_percentage) {
    msgs.push("Informe o percentual sobre o convênio.");
  }
  if (c.calculation_type === "valor_fixo" && !c.fixed_amount) {
    msgs.push("Informe o valor fixo do repasse.");
  }
  if (c.calculation_type === "complemento" && !c.target_amount) {
    msgs.push("Informe o valor-alvo do complemento.");
  }
  if (c.calculation_type === "tabela_diferenciada" && !c.reference_table_id) {
    msgs.push("Selecione a tabela de referência.");
  }
  if (
    (c.calculation_type === "pacote" || c.calculation_type === "pacote_fechado"
      || c.calculation_type === "pacote_com_extras" || c.calculation_type === "pacote_por_atendimento")
    && !c.package_amount
  ) {
    msgs.push("Informe o valor do pacote.");
  }
  if (c.calculation_type === "bonus" && !c.bonus_amount && !c.bonus_pct) {
    msgs.push("Informe o valor ou o percentual do bônus.");
  }
  if (c.has_conditions && c.time_start && c.time_end && c.time_start === c.time_end) {
    msgs.push("Janela de horário inválida: início e fim são iguais.");
  }
  if (calcItemHasWhitelistWithoutCodes(c)) {
    msgs.push("Modo \"apenas estes códigos\" exige ao menos 1 código de procedimento.");
  }
  if (c.is_catch_all && c.code_match_mode !== "any" && (c.procedure_codes?.length ?? 0) > 0) {
    msgs.push(
      "Este cálculo está marcado como catch-all — filtros de código/palavras-chave configurados aqui serão ignorados pelo motor. Desmarque o catch-all para aplicar essa restrição, ou remova os códigos/palavras-chave para manter como catch-all.",
    );
  }
  return msgs;
}

function agreementScopesOverlap(a: CalcItem, b: CalcItem): boolean {
  const aTags = new Set((a.agreement_aliases ?? []).filter(Boolean));
  const bTags = new Set((b.agreement_aliases ?? []).filter(Boolean));
  if (aTags.size === 0 || bTags.size === 0) return true;
  const aMode = a.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
  const bMode = b.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
  const intersects = [...aTags].some((tag) => bTags.has(tag));
  if (aMode === "whitelist" && bMode === "whitelist") return intersects;
  if (aMode === "blacklist" && bMode === "blacklist") return true;
  const whitelist = aMode === "whitelist" ? aTags : bTags;
  const blacklist = aMode === "blacklist" ? aTags : bTags;
  return [...whitelist].some((tag) => !blacklist.has(tag));
}

/** Erros que dependem da relação entre cálculos da mesma regra. */
export function calcCrossItemErrorMessages(items: CalcItem[]): Map<number, string[]> {
  const errors = new Map<number, string[]>();
  const byReferenceTable = new Map<string, number[]>();
  items.forEach((c, idx) => {
    if (c.calculation_type !== "tabela_diferenciada" || !c.reference_table_id) return;
    const indices = byReferenceTable.get(c.reference_table_id) ?? [];
    const isCatchAllByCode = c.code_match_mode === "any" && (c.procedure_codes?.length ?? 0) === 0;
    const overlapsEarlier = indices.some((prevIdx) => agreementScopesOverlap(items[prevIdx], c));
    if (indices.length > 0 && isCatchAllByCode && overlapsEarlier) {
      const list = errors.get(idx) ?? [];
      list.push("Este cálculo usa a mesma tabela de outro cálculo e não tem filtro de código TUSS. Se for um caso único por convênio, confirme que o 'apenas' e o 'exceto' são listas complementares; caso contrário, informe códigos ou separe a regra.");
      errors.set(idx, list);
    }
    indices.push(idx);
    byReferenceTable.set(c.reference_table_id, indices);
  });

  // Catch-all: no máximo 1 por regra (espelha o índice único parcial no DB).
  const catchAllIdxs: number[] = [];
  items.forEach((c, idx) => { if (c.is_catch_all) catchAllIdxs.push(idx); });
  if (catchAllIdxs.length > 1) {
    for (const idx of catchAllIdxs) {
      const list = errors.get(idx) ?? [];
      list.push(`Apenas um cálculo da regra pode ser marcado como "piso (catch-all)". Há ${catchAllIdxs.length} marcados — desmarque os excedentes.`);
      errors.set(idx, list);
    }
  }
  return errors;
}

/**
 * Sanity checks financeiros — retornam alertas visuais (warnings) sem bloquear
 * o salvamento. Valores fora dos ranges típicos podem indicar erro de digitação
 * (ex.: 999 em vez de 99, multiplicador 50 em vez de 5).
 */
export function calcItemWarnings(c: CalcItem): string[] {
  const warnings: string[] = [];
  if (c.calculation_type === "percentual_sobre_convenio") {
    const pct = numOrNull(c.convenio_percentage);
    if (pct !== null && (pct < 1 || pct > 300)) {
      warnings.push(`Percentual sobre convênio = ${pct}% fora do range usual (1% a 300%).`);
    }
  }
  if (c.calculation_type === "tabela_diferenciada") {
    const mult = numOrNull(c.multiplier);
    if (mult !== null && (mult < 0.1 || mult > 10)) {
      warnings.push(`Multiplicador = ${mult} fora do range usual (0,1 a 10).`);
    }
    const defl = numOrNull(c.deflator_pct);
    if (defl !== null && (defl < 0 || defl > 50)) {
      warnings.push(`Deflator = ${defl}% acima do range usual (0% a 50%).`);
    }
  }
  if (c.calculation_type === "bonus") {
    const bonus = numOrNull(c.bonus_amount);
    if (bonus !== null && bonus > 50000) {
      warnings.push(`Bônus fixo = R$ ${bonus.toLocaleString("pt-BR")} acima de R$ 50.000 por item.`);
    }
  }
  return warnings;
}
