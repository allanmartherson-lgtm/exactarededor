import { Button } from "@/components/ui/button";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { RULE_SECTOR_LABELS } from "@/lib/status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
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
};

/** Construtor de item vazio (default sensato). */
export function makeEmptyCalc(): CalcItem {
  return {
    calculation_type: "informativo",
    fixed_amount: "", target_amount: "", multiplier: "", deflator_pct: "",
    bonus_amount: "", bonus_pct: "", reference_table_id: "", repasse_pct: "",
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
            <div className="space-y-1">
              <Label className="text-xs">Valor fixo (R$)</Label>
              <Input type="number" step="0.01" value={c.fixed_amount} onChange={(e) => onChange({ fixed_amount: e.target.value })} />
            </div>
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
              <p className="text-[11px] text-muted-foreground italic">
                Nota: Os códigos específicos para este bônus devem ser informados na seção <strong>Códigos específicos</strong> do formulário principal.
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
                      <Input type="number" step="0.01" value={c.repasse_pct} onChange={(e) => onChange({ repasse_pct: e.target.value })} />
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
  };
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
  if (c.has_conditions && c.time_start && c.time_end && c.time_start === c.time_end) n++;
  return n;
}
