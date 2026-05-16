import { Button } from "@/components/ui/button";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { RULE_SECTOR_LABELS } from "@/lib/status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
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

export type CalcItem = {
  /** id na DB quando carregado do banco; novos itens não têm id. */
  id?: string;
  label?: string | null;

  // método
  calculation_type: RuleCalculationType;

  // parâmetros financeiros (todos opcionais — dependem do método)
  fixed_amount: string;
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
  force_totalized: boolean;
  /** Para bônus: define se aplica por linha, por atendimento ou por paciente+dia (fallback). */
  application_unit: "por_item" | "por_atendimento" | "por_paciente_dia";

  // ---- Filtros restritivos por cálculo (refactor: tudo no cálculo) ----
  /** Códigos TUSS aos quais este cálculo se aplica. Vazio = qualquer código. */
  procedure_codes: string[];
  code_match_mode: "whitelist" | "blacklist" | "any";
  /** Convênios aceitos/bloqueados; herda da regra-pai se vazio (legado). */
  agreement_aliases: string[];
  agreement_match_mode: "whitelist" | "blacklist";
  /** Funções do médico aplicáveis. */
  doctor_roles: string[];

  /** Condições de contexto (somente para valor_fixo). */
  context_conditions: ContextConditionItem[];
};

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
    fixed_amount: "", target_amount: "", multiplier: "", deflator_pct: "",
    bonus_amount: "", bonus_pct: "", reference_table_id: "", repasse_pct: "", acrescimo_pct: "",
    convenio_percentage: "", auxiliary_pct: "",
    aux_first_pct: "30", aux_second_pct: "20", instrumentador_pct: "10",
    include_auxiliaries: false,
    package_amount: "", package_subtype: "fechado", package_main_code: "",
    package_included_codes: "", package_auxiliaries_included: true,
    package_opinions_count: false, package_visits_count: false,
    extras_codes: "", apply_access_route: false,
    allowed_access_routes: [],
    has_conditions: false, time_mode: "qualquer", weekdays: [],
    time_start: "", time_end: "", includes_holidays: false, elective_mode: "qualquer",
    sectors: [], specialties: [],
    force_totalized: false,
    application_unit: "por_item",
    procedure_codes: [],
    code_match_mode: "whitelist",
    agreement_aliases: [],
    agreement_match_mode: "whitelist",
    doctor_roles: [],
    context_conditions: [],
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

type RefTable = { id: string; name: string; purpose?: string };

export type RuleCalculationsEditorProps = {
  value: CalcItem[];
  onChange: (next: CalcItem[]) => void;
  refTables: RefTable[];
  /** Quando "informativa/bloqueio", o editor fica oculto (regra não calcula). */
  enabled: boolean;
};

/**
 * Editor de uma LISTA de itens de cálculo (1:N). Cada item carrega seu próprio
 * bloco de "Aplica-se a algum período, dia ou horário específico?" porque a
 * janela temporal pertence ao cálculo, não à regra.
 */
export function RuleCalculationsEditor({ value, onChange, refTables, enabled }: RuleCalculationsEditorProps) {
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
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Adicionar cálculo
      </Button>
      {value.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Quando há mais de um cálculo, o motor avalia cada um independentemente
          e <strong>soma</strong> os valores dos cálculos cujas condições baterem.
        </p>
      )}
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
  return (
    <div className="space-y-1">
      <Label className="text-xs">Valor fixo (R$)</Label>
      <Input type="number" step="0.01" value={c.fixed_amount} onChange={(e) => onChange({ fixed_amount: e.target.value })} />
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
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={hasComplementos}
            onCheckedChange={(v) => toggleComplementos(!!v)}
            className="mt-0.5"
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
                    <Input
                      type="number" step="0.01"
                      className="h-8 text-xs"
                      value={cond.value}
                      onChange={(e) => {
                        const next = [...c.context_conditions];
                        next[ci] = { ...cond, value: e.target.value };
                        onChange({ context_conditions: next });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Valor esperado do complemento (R$)</Label>
                    <Input
                      type="number" step="0.01"
                      className="h-8 text-xs"
                      value={cond.complement_value}
                      onChange={(e) => {
                        const next = [...c.context_conditions];
                        next[ci] = { ...cond, complement_value: e.target.value };
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
 *  Card de UM cálculo (método + parâmetros + condições)
 * ============================================================ */
function CalcCard({
  index, total, item, refTables, onChange, onRemove,
}: {
  index: number; total: number; item: CalcItem; refTables: RefTable[];
  onChange: (patch: Partial<CalcItem>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const c = item;
  const isPacote = c.calculation_type === "pacote"
    || c.calculation_type === "pacote_fechado"
    || c.calculation_type === "pacote_com_extras"
    || c.calculation_type === "pacote_por_atendimento";
  const isPacoteComExtras = isPacote && c.package_subtype === "com_extras";

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-1" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          Cálculo #{index + 1}
        </span>
        <Input
          placeholder="Rótulo opcional (ex.: Bônus fim de semana)"
          value={c.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-7 text-xs flex-1"
        />
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          {RULE_CALCULATION_TYPE_LABELS[c.calculation_type]}
        </span>
        <Button
          type="button" variant="ghost" size="sm"
          className={cn("h-7 px-2 text-destructive", total === 1 && "opacity-60")}
          onClick={onRemove}
          title={total === 1 ? "Limpar este cálculo" : "Remover cálculo"}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {open && (
        <>
          {/* === MÉTODO + PARÂMETROS === */}
          <div className="space-y-1.5">
            <Label className="text-xs">Método de cálculo *</Label>
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
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <Checkbox
                  checked={c.force_totalized}
                  onCheckedChange={(v) => onChange({ force_totalized: !!v })}
                />
                <span className="text-xs font-medium">Considerar valor do convênio como já totalizado (ignora quantidade)</span>
              </label>
            </div>
          )}
          {c.calculation_type === "valor_fixo" && (
            <ValorFixoBlock c={c} onChange={onChange} />
          )}
          {c.calculation_type === "bonus" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Bônus fixo (R$)</Label>
                  <Input type="number" step="0.01" value={c.bonus_amount} onChange={(e) => onChange({ bonus_amount: e.target.value })} />
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
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="por_item" id={`au-item-${c.label ?? "x"}`} className="mt-0.5" />
                    <Label htmlFor={`au-item-${c.label ?? "x"}`} className="text-xs font-normal leading-tight">
                      <strong>Por item / código</strong> — aplica 1× em cada linha que casar (padrão).
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="por_atendimento" id={`au-att-${c.label ?? "x"}`} className="mt-0.5" />
                    <Label htmlFor={`au-att-${c.label ?? "x"}`} className="text-xs font-normal leading-tight">
                      <strong>Por atendimento (paciente)</strong> — aplica 1× por atendimento, mesmo com vários códigos/cirurgiões. Use para bônus de plantão de fim de semana/feriado.
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
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
              <Input type="number" step="0.01" value={c.target_amount} onChange={(e) => onChange({ target_amount: e.target.value })} />
            </div>
          )}

          {isPacote && (
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de pacote *</Label>
                <Select value={c.package_subtype} onValueChange={(v) => onChange({ package_subtype: v as "fechado" | "com_extras" })}>
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
                  <Input type="number" step="0.01" value={c.package_amount} onChange={(e) => onChange({ package_amount: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Código principal do pacote</Label>
                  <Input placeholder="Ex.: 31005497" value={c.package_main_code} onChange={(e) => onChange({ package_main_code: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Códigos incluídos no pacote</Label>
                <Input placeholder="Ex.: 31002, 31003" value={c.package_included_codes} onChange={(e) => onChange({ package_included_codes: e.target.value })} />
              </div>
              {isPacoteComExtras && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Códigos extras permitidos</Label>
                  <Input placeholder="Ex.: 31005470" value={c.extras_codes} onChange={(e) => onChange({ extras_codes: e.target.value })} />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className={cn("flex items-start gap-2", !isPacoteComExtras && "opacity-50")}>
                  <Checkbox checked={c.package_visits_count} disabled={!isPacoteComExtras}
                    onCheckedChange={(v) => onChange({ package_visits_count: !!v })} />
                  <span className="text-xs">Visitas somam ao pacote</span>
                </label>
                <label className={cn("flex items-start gap-2", !isPacoteComExtras && "opacity-50")}>
                  <Checkbox checked={c.package_opinions_count} disabled={!isPacoteComExtras}
                    onCheckedChange={(v) => onChange({ package_opinions_count: !!v })} />
                  <span className="text-xs">Pareceres somam ao pacote</span>
                </label>
                <label className={cn("flex items-start gap-2", !isPacoteComExtras && "opacity-50")}>
                  <Checkbox checked={c.package_auxiliaries_included} disabled={!isPacoteComExtras}
                    onCheckedChange={(v) => onChange({ package_auxiliaries_included: !!v })} />
                  <span className="text-xs">Auxiliares incluídos no pacote</span>
                </label>
              </div>
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
                  <label className="flex items-start gap-2">
                    <Checkbox checked={c.apply_access_route} onCheckedChange={(v) => onChange({ apply_access_route: !!v })} />
                    <span className="text-xs">Aplicar regra de via de acesso</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={c.include_auxiliaries} onCheckedChange={(v) => onChange({ include_auxiliaries: !!v })} />
                    <span className="text-xs">Considerar auxiliares</span>
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
              
              <div className="space-y-2 border-t border-border/40 pt-3">
                <Label className="text-xs font-semibold">Configuração de Vias de Acesso</Label>
                <p className="text-[11px] text-muted-foreground">
                  Selecione as vias de acesso aceitas para este cálculo. Deixe vazio para aceitar qualquer via.
                </p>
                <div className="space-y-1.5">
                  <Input
                    placeholder="Digite a via e pressione Enter (ex: Única ou principal, Mesma Via)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const target = e.target as HTMLInputElement;
                        const v = target.value.trim();
                        if (v && !c.allowed_access_routes.includes(v)) {
                          onChange({ allowed_access_routes: [...c.allowed_access_routes, v] });
                        }
                        target.value = "";
                      }
                    }}
                  />
                  {c.allowed_access_routes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {c.allowed_access_routes.map(a => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => onChange({ allowed_access_routes: c.allowed_access_routes.filter(x => x !== a) })}
                          className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-destructive hover:text-white transition-colors"
                        >
                          {a} ✕
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === FILTROS RESTRITIVOS (códigos / convênios / função) === */}
          <div className="rounded-md border border-amber-300/40 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-3">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                Quando aplicar este cálculo
              </Label>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Restrinja este cálculo específico por código, convênio ou função do médico.
                Deixe em branco para aplicar a todos. <strong>Cada cálculo tem seu próprio escopo</strong> —
                use vários cálculos numa mesma regra para cobrir cenários diferentes.
              </p>
            </div>

            {/* Códigos */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Códigos TUSS / CBHPM</Label>
                <Select
                  value={c.code_match_mode}
                  onValueChange={(v) => onChange({ code_match_mode: v as CalcItem["code_match_mode"] })}
                >
                  <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whitelist">Apenas estes códigos</SelectItem>
                    <SelectItem value="blacklist">Todos exceto estes</SelectItem>
                    <SelectItem value="any">Qualquer código</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {c.code_match_mode !== "any" && (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Digite um código e pressione Enter (ex: 31005497)"
                      className="h-8 text-xs flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          const t = e.target as HTMLInputElement;
                          const vals = t.value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
                          const merged = Array.from(new Set([...c.procedure_codes, ...vals]));
                          if (merged.length !== c.procedure_codes.length) onChange({ procedure_codes: merged });
                          t.value = "";
                        }
                      }}
                    />
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      id={`import-codes-${c.id ?? c.label}`}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const XLSX = await import("xlsx");
                          const buf = await file.arrayBuffer();
                          const wb = XLSX.read(buf, { type: "array" });
                          const found = new Set<string>();
                          for (const sheetName of wb.SheetNames) {
                            const sh = wb.Sheets[sheetName];
                            const rows = XLSX.utils.sheet_to_json<any>(sh, { header: 1, raw: false, defval: "" });
                            for (const row of rows as any[][]) {
                              for (const cell of row) {
                                const s = String(cell ?? "").trim();
                                // TUSS / CBHPM: exatamente 8 dígitos
                                const matches = s.match(/\b\d{8}\b/g);
                                if (matches) matches.forEach(m => found.add(m));
                              }
                            }
                          }
                          if (found.size === 0) {
                            toast.error("Nenhum código TUSS (8 dígitos) encontrado na planilha");
                          } else {
                            const merged = Array.from(new Set([...c.procedure_codes, ...found]));
                            const added = merged.length - c.procedure_codes.length;
                            onChange({ procedure_codes: merged });
                            toast.success(`${found.size} códigos detectados • ${added} novos adicionados`);
                          }
                        } catch (err) {
                          toast.error("Falha ao ler a planilha: " + (err as Error).message);
                        } finally {
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs whitespace-nowrap"
                      onClick={() => document.getElementById(`import-codes-${c.id ?? c.label}`)?.click()}
                    >
                      📎 Importar planilha
                    </Button>
                  </div>
                  {c.procedure_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {c.procedure_codes.map(code => (
                        <button key={code} type="button"
                          onClick={() => onChange({ procedure_codes: c.procedure_codes.filter(x => x !== code) })}
                          className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-destructive hover:text-white transition-colors font-mono"
                        >{code} ✕</button>
                      ))}
                    </div>
                  )}
                  {c.code_match_mode === "whitelist"
                    && c.procedure_codes.length === 0
                    && c.calculation_type !== "tabela_diferenciada" && (
                    <p className="text-[11px] text-destructive leading-tight">
                      ⚠️ <strong>Whitelist sem códigos</strong> faz este cálculo capturar
                      qualquer item. Liste os códigos específicos ou troque o modo para
                      "Qualquer código". Permitido apenas em "Tabela diferenciada".
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Convênios */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Convênios</Label>
                <Select
                  value={c.agreement_match_mode}
                  onValueChange={(v) => onChange({ agreement_match_mode: v as CalcItem["agreement_match_mode"] })}
                >
                  <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whitelist">Apenas estes convênios</SelectItem>
                    <SelectItem value="blacklist">Todos exceto estes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Digite o convênio e pressione Enter (ex: Unimed)"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const t = e.target as HTMLInputElement;
                    const v = t.value.trim();
                    if (v && !c.agreement_aliases.includes(v)) {
                      onChange({ agreement_aliases: [...c.agreement_aliases, v] });
                    }
                    t.value = "";
                  }
                }}
              />
              {c.agreement_aliases.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {c.agreement_aliases.map(a => (
                    <button key={a} type="button"
                      onClick={() => onChange({ agreement_aliases: c.agreement_aliases.filter(x => x !== a) })}
                      className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-destructive hover:text-white transition-colors"
                    >{a} ✕</button>
                  ))}
                </div>
              )}
            </div>

            {/* Função do médico */}
            <div className="space-y-1.5">
              <Label className="text-xs">Função do médico</Label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "cirurgiao", label: "Cirurgião principal" },
                  { v: "primeiro_aux", label: "1º auxiliar" },
                  { v: "demais_aux", label: "Demais auxiliares" },
                  { v: "instrumentador", label: "Instrumentador" },
                ].map(opt => {
                  const sel = c.doctor_roles.includes(opt.v);
                  return (
                    <Button key={opt.v} type="button" size="sm"
                      variant={sel ? "default" : "outline"}
                      className="h-7 px-3 text-[11px]"
                      onClick={() => {
                        const next = sel ? c.doctor_roles.filter(x => x !== opt.v) : [...c.doctor_roles, opt.v];
                        onChange({ doctor_roles: next });
                      }}
                    >{opt.label}</Button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-muted-foreground">Vazio = qualquer função.</p>
            </div>
          </div>

          {c.calculation_type === "valor_fixo" && (
            <ComplementosBlock c={c} onChange={onChange} />
          )}

          {/* === CONDIÇÕES (vinculadas a ESTE cálculo) === */}
          <div className="rounded-md border border-border bg-card p-3 space-y-3">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={c.has_conditions}
                onCheckedChange={(v) => onChange({ has_conditions: !!v })}
                className="mt-0.5"
              />
              <span>
                Aplica-se a algum período, dia, horário ou via específica?
                <span className="block text-xs text-muted-foreground">
                  Marque para restringir este cálculo a determinadas janelas ou vias de acesso.
                </span>
              </span>
            </label>

            {c.has_conditions && (
              <div className="space-y-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dias / período</Label>
                    <Select value={c.time_mode} onValueChange={(v) => onChange({ time_mode: v as TimeMode })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TIME_MODE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo de atendimento</Label>
                    <Select value={c.elective_mode} onValueChange={(v) => onChange({ elective_mode: v as ElectiveMode })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ELECTIVE_MODE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {c.time_mode === "personalizado" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dias da semana</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_LABELS.map((d) => {
                        const checked = c.weekdays.includes(d.v);
                        return (
                          <Button
                            key={d.v}
                            type="button"
                            size="sm"
                            variant={checked ? "default" : "outline"}
                            className="h-7 px-3 text-[11px]"
                            onClick={() => {
                              const next = checked ? c.weekdays.filter((x) => x !== d.v) : [...c.weekdays, d.v];
                              onChange({ weekdays: next });
                            }}
                          >
                            {d.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(c.time_mode === "personalizado" || c.time_mode === "comercial") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Horário inicial</Label>
                      <Input
                        type="time"
                        value={c.time_start}
                        onChange={(e) => onChange({ time_start: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Horário final</Label>
                      <Input
                        type="time"
                        value={c.time_end}
                        onChange={(e) => onChange({ time_end: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={c.includes_holidays}
                      onCheckedChange={(v) => onChange({ includes_holidays: !!v })}
                    />
                    <span className="text-xs">Incluir feriados</span>
                  </label>
                </div>

                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <Label className="text-xs font-semibold">Vias de acesso permitidas</Label>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Restringir este cálculo apenas a vias específicas (ex: "Única ou principal"). 
                    O motor normaliza variações automaticamente.
                  </p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {["Única ou Principal", "Mesma Via", "Outra Via", "Sem Via (Bônus/Complemento)"].map((route) => {
                        const isSelected = c.allowed_access_routes.includes(route);
                        return (
                          <Button
                            key={route}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-[10px] px-2 rounded-full"
                            onClick={() => {
                              const next = isSelected 
                                ? c.allowed_access_routes.filter(r => r !== route)
                                : [...c.allowed_access_routes, route];
                              onChange({ allowed_access_routes: next });
                            }}
                          >
                            {route}
                            {isSelected && <span className="ml-1">✕</span>}
                          </Button>
                        );
                      })}
                    </div>
                    
                    <Input
                      placeholder="Outro nome (se necessário)..."
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          const input = (e.target as HTMLInputElement).value.trim();
                          if (input) {
                            // Normalização automática se o usuário digitar algo que mapeie para os padrões
                            const n = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                            let normalized = input;
                            
                            if (/(unica|principal|unica\/principal|unica ou principal|1[aª]|1[.\s]?via|primeira\s?via|unica\s?\/\s?principal|1\.[aª]\s?via)/i.test(n)) {
                              normalized = "Única ou Principal";
                            } else if (/(mesma\s?via|mesma|repetida)/i.test(n)) {
                              normalized = "Mesma Via";
                            } else if (/(outra\s?via|via\s?diferente|diferente|2[aª]|segunda\s?via)/i.test(n)) {
                              normalized = "Outra Via";
                            } else if (/(sem\s?via|bonus|complemento|n\/a|nao\s?se\s?aplica)/i.test(n)) {
                              normalized = "Sem Via (Bônus/Complemento)";
                            }

                            if (!c.allowed_access_routes.includes(normalized)) {
                              onChange({ allowed_access_routes: [...c.allowed_access_routes, normalized] });
                            }
                          }
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />

                    {c.allowed_access_routes.filter(a => !["Única ou Principal", "Mesma Via", "Outra Via", "Sem Via (Bônus/Complemento)"].includes(a)).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {c.allowed_access_routes.filter(a => !["Única ou Principal", "Mesma Via", "Outra Via", "Sem Via (Bônus/Complemento)"].includes(a)).map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => onChange({ allowed_access_routes: c.allowed_access_routes.filter((x) => x !== a) })}
                            className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-destructive hover:text-white transition-colors"
                          >
                            {a} ✕
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <Label className="text-xs font-semibold">Restrições Adicionais (Setores e Especialidades)</Label>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Opcional: Restringir este cálculo apenas a setores ou especialidades específicas.
                  </p>
                  <div className="grid grid-cols-1 gap-4 mt-2">
                    <div className="space-y-2">
                      <Label className="text-[11px]">Setores (apenas se informado na produção)</Label>
                      <MultiSelectChips
                        options={Object.values(RULE_SECTOR_LABELS)}
                        values={c.sectors}
                        onChange={(vals) => onChange({ sectors: vals })}
                        placeholder="Todos os setores"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px]">Especialidades (apenas se informado na produção)</Label>
                      <div className="space-y-1.5">
                        <Input
                          placeholder="Digite a especialidade e pressione Enter"
                          className="h-8 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              const val = (e.target as HTMLInputElement).value.trim();
                              if (val && !c.specialties.includes(val)) {
                                onChange({ specialties: [...c.specialties, val] });
                              }
                              (e.target as HTMLInputElement).value = "";
                            }
                          }}
                        />
                        {c.specialties.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {c.specialties.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => onChange({ specialties: c.specialties.filter((x) => x !== s) })}
                                className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-destructive hover:text-white transition-colors"
                              >
                                {s} ✕
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
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
    force_totalized: !!r.force_totalized,
    application_unit: (r.application_unit === "por_atendimento" || r.application_unit === "por_paciente_dia") ? r.application_unit : "por_item",
    procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
    code_match_mode: (r.code_match_mode === "blacklist" || r.code_match_mode === "any") ? r.code_match_mode : "whitelist",
    agreement_aliases: Array.isArray(r.agreement_aliases) ? r.agreement_aliases : [],
    agreement_match_mode: r.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist",
    doctor_roles: Array.isArray(r.doctor_roles) ? r.doctor_roles : [],
    context_conditions: Array.isArray(r.context_conditions)
      ? r.context_conditions.map((cc: any) => ({
          trigger_codes: Array.isArray(cc?.trigger_codes) ? cc.trigger_codes.map((x: any) => String(x)) : [],
          match_mode: cc?.match_mode === "all" ? "all" : "any",
          value: cc?.value != null ? String(cc.value) : "",
          complement_value: cc?.complement_value != null ? String(cc.complement_value) : "0",
        }))
      : [],
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
    apply_access_route: isTabela ? c.apply_access_route : false,
    allowed_access_routes: c.allowed_access_routes.length > 0 ? c.allowed_access_routes : null,
    has_conditions: c.has_conditions,
    time_mode: c.has_conditions ? c.time_mode : "qualquer",
    weekdays: c.has_conditions && c.time_mode === "personalizado" ? c.weekdays : [],
    time_start: c.has_conditions ? (c.time_start || null) : null,
    time_end: c.has_conditions ? (c.time_end || null) : null,
    includes_holidays: c.has_conditions ? c.includes_holidays : false,
    elective_mode: c.has_conditions ? c.elective_mode : "qualquer",
    sectors: c.has_conditions ? c.sectors : [],
    specialties: c.has_conditions ? c.specialties : [],
    force_totalized: c.calculation_type === "percentual_sobre_convenio" ? c.force_totalized : false,
    application_unit: c.calculation_type === "bonus" ? c.application_unit : "por_item",
    procedure_codes: c.procedure_codes.length > 0 ? c.procedure_codes : null,
    // Normaliza: sem códigos listados ⇒ modo "any" (fallback). Evita o anti-padrão
    // "whitelist sem códigos" que faz o cálculo capturar qualquer item por engano.
    code_match_mode: c.procedure_codes.length > 0 ? c.code_match_mode : "any",
    agreement_aliases: c.agreement_aliases.length > 0 ? c.agreement_aliases : null,
    agreement_match_mode: c.agreement_aliases.length > 0 ? c.agreement_match_mode : null,
    doctor_roles: c.doctor_roles.length > 0 ? c.doctor_roles : null,
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
  };
}

/**
 * Misconfigurações que indicam anti-padrão de "whitelist sem códigos".
 * Permitido apenas em `tabela_diferenciada`, onde a própria tabela define o universo de códigos.
 */
export function calcItemHasWhitelistWithoutCodes(c: CalcItem): boolean {
  return (
    c.code_match_mode === "whitelist" &&
    c.procedure_codes.length === 0 &&
    c.calculation_type !== "tabela_diferenciada"
  );
}

/** Erros por item para feedback visual no formulário (apenas validações fortes). */
export function calcItemErrors(c: CalcItem): number {
  let n = 0;
  if (c.calculation_type === "percentual_sobre_convenio" && !c.convenio_percentage) n++;
  if (c.calculation_type === "valor_fixo" && !c.fixed_amount) n++;
  if (c.calculation_type === "complemento" && !c.target_amount) n++;
  if (c.calculation_type === "tabela_diferenciada" && !c.reference_table_id) n++;
  if ((c.calculation_type === "pacote" || c.calculation_type === "pacote_fechado"
    || c.calculation_type === "pacote_com_extras" || c.calculation_type === "pacote_por_atendimento") && !c.package_amount) n++;
  if (c.calculation_type === "bonus" && !c.bonus_amount && !c.bonus_pct) n++;
  if (c.has_conditions && c.time_start && c.time_end && c.time_start === c.time_end) n++;
  if (calcItemHasWhitelistWithoutCodes(c)) n++;
  return n;
}
