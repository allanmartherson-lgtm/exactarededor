// Simulador de Cenário — experiência input-first.
// O usuário escolhe médico/procedimento + ano + modelo, clica "Simular" e vê:
//  - DRE em 3 colunas (Aurum | Exacta Real | Simulado)
//  - Cards de resumo (HM Aurum, HM Exacta, HM Simulado + Δ margem)
//  - Botão para salvar cenário em `simulacao_cenario`.
//
// Escopo: cruza `aurum_margem_medico`/`aurum_margem_procedimento` (custos)
// com `payment_items` (repasse real e base convênio). Usa `doctor_aliases`
// e `procedure_aliases` como fallback de match.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Calculator, ChevronsUpDown, Check, Save, AlertTriangle, Loader2, Info,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { cn } from "@/lib/utils";
import { normAccessRoute } from "@/lib/normAccessRoute";
import { applyHistoricalAuxOverride } from "@/lib/simulatorAuxOverride";

// Input decimal tolerante: aceita vírgula ou ponto, permite ficar vazio
// enquanto o usuário digita (ex.: apagar o 0 para digitar 5, ou digitar
// "1," antes do "5"). Só reporta um número válido; enquanto o texto for
// parcial/vazio mantém o último número (não força "0" no meio da edição).
function DecimalInput({
  value,
  onChange,
  step = "0.1",
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string>(() => String(value));
  // Ressincroniza quando o valor externo muda por outro caminho (reset, etc.)
  useEffect(() => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed !== value) {
      setDraft(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="decimal"
      step={step}
      className={className}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw.trim() === "") return; // não força número enquanto vazio
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        const n = Number(draft.replace(",", "."));
        if (!Number.isFinite(n)) {
          setDraft(String(value));
        } else {
          onChange(n);
          setDraft(String(n));
        }
      }}
    />
  );
}

// ---- Fatores CBHPM para o Simulado (padrão AMB/CBHPM 2018) ----
// Percentual do valor do procedimento devido a cada função da equipe.
// Cirurgião principal recebe 100%; auxiliares em cascata; anestesista 30%.
// Ajuste esta tabela ao contrato hospitalar quando divergir.
function roleFactor(role: string | null | undefined): number {
  const r = (role ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!r) return 1;
  if (r.includes("principal") || r === "cirurgiao" || r.includes("unico")) return 1;
  if (r.includes("primeiro")) return 0.30;
  if (r.includes("segundo")) return 0.20;
  if (r.includes("terceiro") || r.includes("quarto")) return 0.20;
  if (r.includes("anestes")) return 0.30;
  if (r.includes("instrument")) return 0.20;
  if (r.includes("pediatra")) return 0.20;
  if (r.includes("clinic")) return 0.15;
  if (r.includes("visita")) return 0.15;
  return 1;
}

// Redutor da via de acesso para procedimentos combinados (CBHPM padrão).
// Aplicado sobre o valor do procedimento adicional segundo a via.
function viaFactor(access: string | null | undefined): number {
  const key = normAccessRoute(access);
  if (key === "mesma_via") return 0.50;
  if (key === "outra_via") return 0.70;
  // "unica_principal", "sem_via" ou desconhecido → 100%
  return 1;
}

type Modo = "medico" | "procedimento";
type Modelo = "percentual" | "tabela_diferenciada";

const BRL = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PCT = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v) < 1 ? v * 100 : v;
  return `${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Linhas "Total"/"Subtotal" das planilhas Aurum — ignorar.
const isTotalRow = (nome: string | null | undefined) => {
  const n = norm(nome);
  if (!n) return true;
  if (n === "total" || n === "totais" || n === "subtotal" || n === "total geral") return true;
  if (n.startsWith("total ") || n.startsWith("subtotal ")) return true;
  if (n.startsWith("total") && n.split(" ").filter((t) => t.length > 3).length < 2) return true;
  return false;
};

interface AurumRow {
  ano: number;
  qtd_cirurgias: number | null;
  receita: number | null;
  impostos: number | null;
  glosa_externa: number | null;
  receita_liquida: number | null;
  custo_total: number | null;
  custo_opme: number | null;
  custo_mat_med: number | null;
  custo_hm: number | null;
  custo_exames_img: number | null;
  custo_laboratorio: number | null;
  margem: number | null;
  medico_cirurgiao?: string | null;
  ds_procedimento?: string | null;
}

interface AurumAggregated {
  qtd_cirurgias: number;
  receita: number;
  impostos: number;
  glosa_externa: number;
  receita_liquida: number;
  custo_total: number;
  custo_opme: number;
  custo_mat_med: number;
  custo_hm: number;
  custo_exames_img: number;
  custo_laboratorio: number;
  outros_custos: number;
  margem: number;
  pct_margem: number;
}

interface ExactaAggregated {
  gross: number;         // valor pago ao médico (gross_amount)
  expected: number;      // valor esperado pela regra (expected_amount)
  baseConvenio: number;  // valor bruto do convênio (procedure_amount) — base 100%
  itens: number;
  atendimentos: number;
  sem_carater: number;
  // Detalhes por item — usados para calcular o Simulado por linha.
  detalhes: ItemDetalhe[];
}

interface ItemDetalhe {
  id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  agreement_text: string | null;
  doctor_role: string | null;
  doctor_name: string | null;
  access_route: string | null;
  sector: string | null;
  specialty: string | null;
  quantity: number;
  procedure_amount: number;
  gross_amount: number;
  expected_amount: number;
  company_name: string | null;
  applied_rule_label: string | null;
  applied_calc_method: string | null;
}

interface SimPerItem {
  expected_amount: number;
  matched: boolean;
  calculation_type_used: string | null;
  alerts: string[];
  /** true quando o motor não achou regra e caímos no fallback "manter pago à época" (gross_amount).
   *  Evita distorcer o Simulado zerando itens que hoje são pacote, sem_acordo, etc. */
  usedFallback?: boolean;
}

interface Simulado {
  novo_hm: number;
  nova_margem: number;
  nova_pct_margem: number;
}

const sumAurum = (rows: AurumRow[]): AurumAggregated => {
  const num = (v: number | null | undefined) => Number(v ?? 0);
  const agg = rows.reduce(
    (a, r) => ({
      qtd_cirurgias: a.qtd_cirurgias + num(r.qtd_cirurgias),
      receita: a.receita + num(r.receita),
      impostos: a.impostos + num(r.impostos),
      glosa_externa: a.glosa_externa + num(r.glosa_externa),
      receita_liquida: a.receita_liquida + num(r.receita_liquida),
      custo_total: a.custo_total + num(r.custo_total),
      custo_opme: a.custo_opme + num(r.custo_opme),
      custo_mat_med: a.custo_mat_med + num(r.custo_mat_med),
      custo_hm: a.custo_hm + num(r.custo_hm),
      custo_exames_img: a.custo_exames_img + num(r.custo_exames_img),
      custo_laboratorio: a.custo_laboratorio + num(r.custo_laboratorio),
      margem: a.margem + num(r.margem),
    }),
    {
      qtd_cirurgias: 0, receita: 0, impostos: 0, glosa_externa: 0, receita_liquida: 0,
      custo_total: 0, custo_opme: 0, custo_mat_med: 0, custo_hm: 0,
      custo_exames_img: 0, custo_laboratorio: 0, margem: 0,
    },
  );
  return {
    ...agg,
    outros_custos: agg.custo_total - agg.custo_hm,
    pct_margem: agg.receita_liquida > 0 ? agg.margem / agg.receita_liquida : 0,
  };
};

/** Linha da DRE em 3 colunas. */
function DreLine({
  op, label, aurum, exacta, simulado, indent, bold, highlight, tooltip,
  simuladoTone, denomAurum, denomExacta, denomSim, base,
  denomLabelAurum = "cir", denomLabelExacta = "atend", denomLabelSim = "cir",
}: {
  op: string;
  label: string;
  aurum: number | null;
  exacta: number | null;
  simulado: number | null;
  indent?: boolean;
  bold?: boolean;
  highlight?: "amber" | "success" | "danger";
  tooltip?: string;
  simuladoTone?: "positive" | "negative" | "neutral";
  // Denominadores para média por cirurgia/atendimento em cada coluna.
  denomAurum?: number | null;
  denomExacta?: number | null;
  denomSim?: number | null;
  // Base para % (tipicamente Receita Bruta) — comum a todas as colunas.
  base?: number | null;
  denomLabelAurum?: string;
  denomLabelExacta?: string;
  denomLabelSim?: string;
}) {
  const bg =
    highlight === "amber" ? "bg-amber-50" :
    highlight === "success" ? "bg-emerald-50" :
    highlight === "danger" ? "bg-red-50" : "";
  const simCor =
    simuladoTone === "positive" ? "text-emerald-700" :
    simuladoTone === "negative" ? "text-red-700" : "text-foreground";

  // Renderiza célula com Total (destaque) + linha discreta "média (pct%)".
  const Cell = ({
    v, denom, denomLabel, extraCls, corTotal,
  }: {
    v: number | null;
    denom?: number | null;
    denomLabel?: string;
    extraCls?: string;
    corTotal?: string;
  }) => {
    const media = v != null && denom != null && denom > 0 ? v / denom : null;
    const pct = v != null && base != null && base !== 0 ? v / base : null;
    const pctStr =
      pct == null || !Number.isFinite(pct)
        ? null
        : `${(pct * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    return (
      <div className={cn("text-right tabular-nums flex flex-col leading-tight", extraCls)}>
        <span className={cn("text-sm", bold && "font-semibold", corTotal)}>{BRL(v)}</span>
        {(media != null || pctStr) && (
          <span className="text-[10px] text-muted-foreground font-normal">
            {media != null ? `${BRL(media)}${denomLabel ? `/${denomLabel}` : ""}` : ""}
            {media != null && pctStr ? " " : ""}
            {pctStr ? `(${pctStr})` : ""}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] items-start gap-2 py-1 border-b border-dashed border-muted/40 last:border-0",
        indent && "pl-3",
        bg && `${bg} -mx-2 px-2 rounded`,
      )}
      title={tooltip}
    >
      <span className="text-xs text-muted-foreground pt-0.5">{op}</span>
      <span className={cn("text-sm truncate pt-0.5", bold && "font-semibold")}>{label}</span>
      <Cell v={aurum} denom={denomAurum} denomLabel={denomLabelAurum} />
      <Cell v={exacta} denom={denomExacta} denomLabel={denomLabelExacta} />
      <Cell
        v={simulado}
        denom={denomSim}
        denomLabel={denomLabelSim}
        extraCls="bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r"
        corTotal={simCor}
      />
    </div>
  );
}

export function SimuladorCenario() {
  const hospitalId = useEnforcedHospitalId();
  const [modo, setModo] = useState<Modo>("medico");
  const [nomes, setNomes] = useState<string[]>([]);
  const [loadingNomes, setLoadingNomes] = useState(false);
  const [nomeSelecionado, setNomeSelecionado] = useState<string>("");
  const [nomeOpen, setNomeOpen] = useState(false);
  const [nomeQuery, setNomeQuery] = useState("");
  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([]);
  const [ano, setAno] = useState<number | null>(null);
  const [modelo, setModelo] = useState<Modelo>("percentual");
  const [pctNovo, setPctNovo] = useState<number>(100);
  const [refTables, setRefTables] = useState<Array<{ id: string; name: string }>>([]);
  const [refTableId, setRefTableId] = useState<string>("");
  const [multiplicador, setMultiplicador] = useState<number>(1);
  const [deflator, setDeflator] = useState<number>(0);
  const [acrescimo, setAcrescimo] = useState<number>(0);
  // Percentuais de auxiliares NÃO são configurados aqui: são derivados
  // automaticamente do histórico real (aux.gross / principal.gross) após a
  // resposta do motor, garantindo paridade com o que foi pago à época.
  const [carater, setCarater] = useState<"todos" | "Eletiva" | "Urgência">("todos");
  // Aurum só contempla pacientes INTERNADOS (cirúrgicos). Filtro default-on
  // limita o Exacta a itens de Centro Cirúrgico / Hemodinâmica para evitar
  // que consultas/pareceres/SADT distorçam a comparação.
  const [apenasInternados, setApenasInternados] = useState<boolean>(true);
  // Slugs canônicos + códigos hospital-específicos (DFStar) que representam
  // setores cirúrgicos internados. Ampliar quando novas unidades entrarem.
  const SURGICAL_SECTORS = ["centro_cirurgico", "hemodinamica", "1556", "1574"];

  // Filtro (B): quando ligado, itens sem regra sintética compatível são
  // removidos tanto do Exacta Real quanto do Simulado — cenário puro só do
  // que casou. Default OFF: usamos o fallback "manter pago" (A) para não
  // distorcer casos de pacote/sem_acordo.
  const [excluirSemMatch, setExcluirSemMatch] = useState<boolean>(false);

  const [simulando, setSimulando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<null | {
    nome: string;
    ano: number;
    aurum: AurumAggregated;
    exacta: ExactaAggregated | null; // null quando sem match
    simulado: Simulado;
    perItem: Record<string, SimPerItem>;
    parametros: {
      modelo: Modelo;
      pct?: number;
      multiplicador?: number;
      deflator?: number;
      acrescimo?: number;
      reference_table_id?: string | null;
    };
    aviso?: string;
  }>(null);

  const tabelaAurum = modo === "medico" ? "aurum_margem_medico" : "aurum_margem_procedimento";
  const nomeCampo = modo === "medico" ? "medico_cirurgiao" : "ds_procedimento";

  // Reset quando muda o modo — a lista de nomes é outra.
  useEffect(() => {
    setNomeSelecionado("");
    setNomeQuery("");
    setResultado(null);
  }, [modo]);

  // Carrega anos disponíveis + nomes distintos para o combobox.
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    setLoadingNomes(true);
    void (async () => {
      try {
        const rows = await fetchAllPaginated<Record<string, unknown>>((from, to) =>
          supabase
            .from(tabelaAurum as never)
            .select(`ano, ${nomeCampo}`)
            .eq("hospital_id", hospitalId)
            .range(from, to) as never,
        );
        if (cancelled) return;
        const anosSet = new Set<number>();
        const nomesSet = new Set<string>();
        for (const r of rows) {
          const a = Number(r.ano);
          if (Number.isFinite(a)) anosSet.add(a);
          const n = r[nomeCampo] as string | null | undefined;
          if (n && !isTotalRow(n)) nomesSet.add(String(n).trim());
        }
        const anos = Array.from(anosSet).sort((a, b) => b - a);
        setAnosDisponiveis(anos);
        setAno((prev) => (prev && anos.includes(prev)) ? prev : (anos[0] ?? null));
        setNomes(Array.from(nomesSet).sort((a, b) => a.localeCompare(b, "pt-BR")));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Falha ao carregar base Aurum: ${msg}`);
      } finally {
        if (!cancelled) setLoadingNomes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId, tabelaAurum, nomeCampo]);

  // Reference tables para modelo "tabela diferenciada".
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("reference_tables")
        .select("id, name")
        .eq("hospital_id", hospitalId)
        .eq("active", true)
        .order("name");
      if (!cancelled) setRefTables((data ?? []) as Array<{ id: string; name: string }>);
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  // Sugestões filtradas por query — top 20.
  const sugestoes = useMemo(() => {
    const q = norm(nomeQuery);
    if (!q) return nomes.slice(0, 20);
    return nomes.filter((n) => norm(n).includes(q)).slice(0, 20);
  }, [nomes, nomeQuery]);

  const podeSimular = !!hospitalId && !!nomeSelecionado && !!ano;

  const simular = useCallback(async () => {
    if (!hospitalId || !nomeSelecionado || !ano) return;
    setSimulando(true);
    try {
      // 1) Aurum — todas as linhas do nome+ano.
      let aurumQ = supabase
        .from(tabelaAurum as never)
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("ano", ano)
        .eq(nomeCampo, nomeSelecionado);
      if (carater !== "todos") aurumQ = aurumQ.eq("carater", carater);
      const { data: aurumData, error: aurumErr } = await aurumQ;
      if (aurumErr) throw aurumErr;
      const aurumRows = (aurumData ?? []) as AurumRow[];
      if (aurumRows.length === 0) {
        toast.error("Sem dados no Aurum para o nome/ano selecionado.");
        setResultado(null);
        return;
      }
      const aurum = sumAurum(aurumRows);

      // 2) Exacta — busca por nome + fallback por alias.
      const targetNorm = norm(nomeSelecionado);
      const nomesAlvo = new Set<string>([targetNorm]);

      if (modo === "medico") {
        // procura alias -> pega doctor_id -> pega nome canônico
        const { data: aliasRows } = await supabase
          .from("doctor_aliases")
          .select("doctor_id")
          .eq("alias_normalized", targetNorm)
          .limit(5);
        const docIds = (aliasRows ?? []).map((r: { doctor_id: string | null }) => r.doctor_id).filter(Boolean) as string[];
        if (docIds.length) {
          const { data: docs } = await supabase.from("doctors").select("full_name").in("id", docIds);
          for (const d of (docs ?? []) as Array<{ full_name: string | null }>) {
            if (d.full_name) nomesAlvo.add(norm(d.full_name));
          }
        }
      } else {
        const { data: procAlias } = await supabase
          .from("procedure_aliases" as never)
          .select("canonical_name")
          .eq("hospital_id", hospitalId)
          .eq("alias_normalized", targetNorm)
          .limit(5);
        for (const p of ((procAlias ?? []) as Array<{ canonical_name: string | null }>)) {
          if (p.canonical_name) nomesAlvo.add(norm(p.canonical_name));
        }
      }

      const dateFrom = `${ano}-01-01`;
      const dateTo = `${ano + 1}-01-01`;

      let exacta: ExactaAggregated | null = null;

      if (modo === "medico") {
        // Passo 1: resolver doctor_id(s) via doctor_aliases
        const doctorIds = new Set<string>();
        const { data: aliasRows } = await supabase
          .from("doctor_aliases")
          .select("doctor_id")
          .eq("alias_normalized", targetNorm)
          .limit(10);
        for (const r of (aliasRows ?? []) as Array<{ doctor_id: string | null }>) {
          if (r.doctor_id) doctorIds.add(r.doctor_id);
        }
        // Fallback: buscar direto na tabela doctors por full_name
        if (doctorIds.size === 0) {
          const { data: docRows } = await supabase
            .from("doctors")
            .select("id")
            .ilike("full_name", nomeSelecionado.trim())
            .limit(5);
          for (const r of (docRows ?? []) as Array<{ id: string }>) {
            doctorIds.add(r.id);
          }
        }
        if (doctorIds.size === 0) {
          exacta = null;
        } else {
          const idsArr = Array.from(doctorIds);

          // Passo 2: descobre os attendance_number onde o médico-alvo
          // atuou como CIRURGIÃO PRINCIPAL. O Aurum (controladoria) só
          // atribui a cirurgia ao principal — nunca ao auxiliar. Então o
          // escopo do Exacta tem que espelhar isso: se o médico foi apenas
          // auxiliar em um atendimento, esse atendimento NÃO entra.
          // Depois, no passo 3, puxamos todos os itens (aux/anestesista/etc)
          // desses atendimentos para bater com o custo total do Aurum.
          const attsAlvo = new Set<string>();
          const attsRows = await fetchAllPaginated<{ attendance_number: string | null }>((from, to) => {
            let q = supabase
              .from("payment_items")
              .select("attendance_number")
              .eq("hospital_id", hospitalId)
              .eq("is_cancelled", false)
              .in("doctor_id", idsArr)
              .gte("procedure_date", dateFrom)
              .lt("procedure_date", dateTo)
              .not("attendance_number", "is", null)
              // Só atendimentos em que o médico foi principal/único (nunca aux).
              .or("doctor_role.ilike.%principal%,doctor_role.ilike.%unico%,doctor_role.ilike.%único%,doctor_role.eq.Cirurgião,doctor_role.eq.CIRURGIAO,doctor_role.eq.Cirurgiao");
            if (apenasInternados) {
              q = q.in("sector", SURGICAL_SECTORS);
            }
            if (carater === "Eletiva") {
              q = q.or("attendance_character.ilike.%ELETIV%,attendance_character.ilike.%Eletiva%");
            } else if (carater === "Urgência") {
              q = q.or("attendance_character.ilike.%URGENCIA%,attendance_character.ilike.%Urgência%");
            }
            return q.range(from, to);
          });
          for (const r of attsRows) {
            if (r.attendance_number) attsAlvo.add(String(r.attendance_number));
          }

          if (attsAlvo.size === 0) {
            exacta = null;
          } else {
            // Passo 3: agrega TODOS os itens desses atendimentos — inclui
            // auxiliares, anestesista, instrumentador e qualquer PJ. Assim o
            // custo HM real reflete o valor total pago pela cirurgia, no
            // mesmo escopo do Custo HM contábil do Aurum.
            let gross = 0, expected = 0, baseConv = 0, count = 0, semCar = 0;
            const detalhes: ItemDetalhe[] = [];
            const attsArr = Array.from(attsAlvo);
            const chunk = 200;
            for (let i = 0; i < attsArr.length; i += chunk) {
              const slice = attsArr.slice(i, i + chunk);
              const partial = await fetchAllPaginated<{
                id: string;
                attendance_number: string | null;
                gross_amount: number | null;
                expected_amount: number | null;
                procedure_amount: number | null;
                attendance_character: string | null;
                procedure_code: string | null;
                procedure_name: string | null;
                agreement_text: string | null;
                doctor_role: string | null;
                doctor_name: string | null;
                access_route: string | null;
                sector: string | null;
                specialty: string | null;
                quantity: number | null;
                company_name: string | null;
                applied_rule_label: string | null;
                applied_calc_method: string | null;
              }>((from, to) => {
                let q = supabase
                  .from("payment_items")
                  .select("id,attendance_number,gross_amount,expected_amount,procedure_amount,attendance_character,procedure_code,procedure_name,agreement_text,doctor_role,doctor_name,access_route,sector,specialty,quantity,company_name,applied_rule_label,applied_calc_method")
                  .eq("hospital_id", hospitalId)
                  .eq("is_cancelled", false)
                  .in("attendance_number", slice);
                if (carater === "Eletiva") {
                  q = q.or("attendance_character.ilike.%ELETIV%,attendance_character.ilike.%Eletiva%");
                } else if (carater === "Urgência") {
                  q = q.or("attendance_character.ilike.%URGENCIA%,attendance_character.ilike.%Urgência%");
                }
                return q.range(from, to);
              });
              for (const it of partial) {
                gross += Number(it.gross_amount ?? 0);
                expected += Number(it.expected_amount ?? 0);
                baseConv += Number(it.procedure_amount ?? 0);
                count += 1;
                if (!it.attendance_character || String(it.attendance_character).trim() === "") semCar += 1;
                detalhes.push({
                  id: it.id,
                  attendance_number: it.attendance_number,
                  procedure_code: it.procedure_code,
                  procedure_name: it.procedure_name,
                  agreement_text: it.agreement_text,
                  doctor_role: it.doctor_role,
                  doctor_name: it.doctor_name,
                  access_route: it.access_route,
                  sector: it.sector,
                  specialty: it.specialty,
                  quantity: Number(it.quantity ?? 1) || 1,
                  procedure_amount: Number(it.procedure_amount ?? 0),
                  gross_amount: Number(it.gross_amount ?? 0),
                  expected_amount: Number(it.expected_amount ?? 0),
                  company_name: it.company_name ?? null,
                  applied_rule_label: it.applied_rule_label ?? null,
                  applied_calc_method: it.applied_calc_method ?? null,
                });
              }
            }
            exacta = count > 0
              ? { gross, expected, baseConvenio: baseConv, itens: count, atendimentos: attsAlvo.size, sem_carater: semCar, detalhes }
              : null;
          }
        }
      } else {
        // Modo procedimento: descobre attendance_number cujo item principal
        // bate com o nome (ou alias), depois soma gross+expected de TODOS os
        // itens desses atendimentos.
        // 1ª query: server-side ilike por procedure_name para cada variante.
        const principais: Array<{
          attendance_number: string | null;
          procedure_name: string | null;
          access_route: string | null;
        }> = [];
        for (const nomeAlvo of nomesAlvo) {
          const ilikeTerm = `%${nomeAlvo.split(" ").filter((t) => t.length > 2).join("%")}%`;
          const parte = await fetchAllPaginated<{
            attendance_number: string | null;
            procedure_name: string | null;
            access_route: string | null;
          }>((from, to) => {
            let q = supabase
              .from("payment_items")
              .select("attendance_number,procedure_name,access_route")
              .eq("hospital_id", hospitalId)
              .eq("is_cancelled", false)
              .gte("procedure_date", dateFrom)
              .lt("procedure_date", dateTo)
              .not("attendance_number", "is", null)
              .ilike("procedure_name", ilikeTerm);
            if (apenasInternados) {
              q = q.in("sector", SURGICAL_SECTORS);
            }
            if (carater === "Eletiva") {
              q = q.or("attendance_character.ilike.%ELETIV%,attendance_character.ilike.%Eletiva%");
            } else if (carater === "Urgência") {
              q = q.or("attendance_character.ilike.%URGENCIA%,attendance_character.ilike.%Urgência%");
            }
            return q.range(from, to);
          });
          principais.push(...parte);
        }
        const attsMatched = new Set<string>();
        for (const it of principais) {
          const ar = (it.access_route ?? "").toLowerCase();
          if (!(ar.includes("nica") || ar.includes("principal"))) continue;
          if (!it.attendance_number) continue;
          if (nomesAlvo.has(norm(it.procedure_name))) attsMatched.add(it.attendance_number);
        }
        if (attsMatched.size === 0) {
          exacta = null;
        } else {
          // Agora soma tudo desses atendimentos (todos os TUSS).
          let gross = 0, expected = 0, baseConv = 0, count = 0, semCar = 0;
          const detalhes: ItemDetalhe[] = [];
          const attsArr = Array.from(attsMatched);
          const chunk = 200;
          for (let i = 0; i < attsArr.length; i += chunk) {
            const slice = attsArr.slice(i, i + chunk);
            const partial = await fetchAllPaginated<{
              id: string;
              attendance_number: string | null;
              gross_amount: number | null;
              expected_amount: number | null;
              procedure_amount: number | null;
              attendance_character: string | null;
              procedure_code: string | null;
              procedure_name: string | null;
              agreement_text: string | null;
              doctor_role: string | null;
              doctor_name: string | null;
              access_route: string | null;
              sector: string | null;
              specialty: string | null;
              quantity: number | null;
              company_name: string | null;
              applied_rule_label: string | null;
              applied_calc_method: string | null;
            }>((from, to) => {
              let q = supabase
                .from("payment_items")
                .select("id,attendance_number,gross_amount,expected_amount,procedure_amount,attendance_character,procedure_code,procedure_name,agreement_text,doctor_role,doctor_name,access_route,sector,specialty,quantity,company_name,applied_rule_label,applied_calc_method")
                .eq("hospital_id", hospitalId)
                .eq("is_cancelled", false)
                .in("attendance_number", slice);
              if (carater === "Eletiva") {
                q = q.or("attendance_character.ilike.%ELETIV%,attendance_character.ilike.%Eletiva%");
              } else if (carater === "Urgência") {
                q = q.or("attendance_character.ilike.%URGENCIA%,attendance_character.ilike.%Urgência%");
              }
              return q.range(from, to);
            });
            for (const it of partial) {
              gross += Number(it.gross_amount ?? 0);
              expected += Number(it.expected_amount ?? 0);
              baseConv += Number(it.procedure_amount ?? 0);
              count += 1;
              if (!it.attendance_character || String(it.attendance_character).trim() === "") semCar += 1;
              detalhes.push({
                id: it.id,
                attendance_number: it.attendance_number,
                procedure_code: it.procedure_code,
                procedure_name: it.procedure_name,
                agreement_text: it.agreement_text,
                doctor_role: it.doctor_role,
                doctor_name: it.doctor_name,
                access_route: it.access_route,
                sector: it.sector,
                specialty: it.specialty,
                quantity: Number(it.quantity ?? 1) || 1,
                procedure_amount: Number(it.procedure_amount ?? 0),
                gross_amount: Number(it.gross_amount ?? 0),
                expected_amount: Number(it.expected_amount ?? 0),
                company_name: it.company_name ?? null,
                applied_rule_label: it.applied_rule_label ?? null,
                applied_calc_method: it.applied_calc_method ?? null,
              });
            }
          }
          exacta = { gross, expected, baseConvenio: baseConv, itens: count, atendimentos: attsMatched.size, sem_carater: semCar, detalhes };
        }
      }

      // 3) Cálculo do cenário simulado — via edge function `simulate-scenario`,
      //    que invoca o MESMO motor determinístico usado no pagamento real.
      //    Assim eliminamos heurísticas hardcoded no cliente (fatores por
      //    função/via, redutor de tabela) e garantimos paridade com a regra
      //    quando os parâmetros forem idênticos.
      const baseConvenio = exacta?.baseConvenio ?? 0;
      const grossReal = exacta?.gross ?? 0;
      const fatorEfetivo = baseConvenio > 0 ? grossReal / baseConvenio : 0;
      const detalhes = exacta?.detalhes ?? [];

      let novoHm = 0;
      let itensCalculados = 0;
      let itensSemMatch = 0;
      let motorErro: string | null = null;
      const perItem: Record<string, SimPerItem> = {};

      if (detalhes.length === 0) {
        // Sem itens do Exacta → não há como simular via motor.
      } else if (modelo === "tabela_diferenciada" && !refTableId) {
        motorErro = "Selecione uma tabela de referência.";
      } else {
        const scenario = modelo === "percentual"
          ? {
              calculation_type: "percentual_sobre_convenio" as const,
              convenio_percentage: pctNovo,
              apply_access_route: true,
              include_auxiliaries: true,
            }
          : {
              calculation_type: "tabela_diferenciada" as const,
              reference_table_id: refTableId,
              multiplier: multiplicador,
              deflator_pct: deflator,
              acrescimo_pct: acrescimo,
              apply_access_route: true,
              include_auxiliaries: true,
            };
        const { data: simResp, error: simErr } = await supabase.functions.invoke("simulate-scenario", {
          body: {
            hospital_id: hospitalId,
            scenario,
            items: detalhes.map((d) => ({
              id: d.id,
              attendance_number: d.attendance_number,
              procedure_code: d.procedure_code,
              procedure_name: d.procedure_name,
              agreement_text: d.agreement_text,
              doctor_role: d.doctor_role,
              doctor_name: d.doctor_name,
              access_route: d.access_route,
              sector: d.sector,
              specialty: d.specialty,
              procedure_amount: d.procedure_amount,
              gross_amount: d.gross_amount,
              quantity: d.quantity,
            })),
            reference_date: `${ano}-06-30`,
          },
        });
        if (simErr) {
          motorErro = simErr.message ?? "Falha ao chamar motor de simulação.";
        } else if (!simResp?.ok) {
          motorErro = simResp?.error ?? "Motor de simulação retornou erro.";
        } else {
          novoHm = Number(simResp.total_expected ?? 0);
          itensCalculados = Number(simResp.summary?.matched ?? 0);
          itensSemMatch = Number(simResp.summary?.without_match ?? 0);
          for (const p of (simResp.per_item ?? []) as Array<{
            id: string; expected_amount: number; matched: boolean;
            calculation_type_used: string | null; alerts: string[] | null;
          }>) {
            const matched = !!p.matched;
            // Fallback (A): item sem regra sintética compatível NÃO pode zerar
            // no Simulado — isso distorce pacote/sem_acordo/Sul América etc.
            // Mantemos o valor pago à época (gross_amount) e sinalizamos
            // usedFallback para UI/export/filtro.
            let expected = Number(p.expected_amount ?? 0);
            let usedFallback = false;
            if (!matched) {
              const det = detalhes.find((d) => d.id === p.id);
              expected = Number(det?.gross_amount ?? 0);
              usedFallback = true;
            }
            perItem[p.id] = {
              expected_amount: expected,
              matched,
              calculation_type_used: p.calculation_type_used ?? null,
              alerts: Array.isArray(p.alerts) ? p.alerts : [],
              usedFallback,
            };
          }

          // Override histórico para auxiliares — extraído para módulo puro
          // testável (src/lib/simulatorAuxOverride.ts). Bug regressão coberto:
          // regex antiga `/auxili/` NÃO reconhecia "Primeiro Aux" (forma curta
          // do Tasy), então o simulado ficava igual ao do cirurgião principal.
          applyHistoricalAuxOverride(
            detalhes.map((d) => ({
              id: d.id,
              attendance_number: d.attendance_number,
              procedure_code: d.procedure_code,
              doctor_role: d.doctor_role,
              gross_amount: Number(d.gross_amount ?? 0),
            })),
            perItem,
          );
          novoHm = Object.values(perItem).reduce((s, p) => s + (p.expected_amount ?? 0), 0);
        }
      }

      const novaMargem = aurum.receita_liquida + aurum.outros_custos - novoHm;
      const novaPct = aurum.receita_liquida > 0 ? novaMargem / aurum.receita_liquida : 0;

      let aviso: string;
      if (exacta == null) {
        aviso = "Sem itens do Exacta para este médico/procedimento no ano. HM Exacta real e Simulado indisponíveis.";
      } else if (motorErro) {
        aviso = `⚠ ${motorErro}`;
      } else if (modelo === "percentual") {
        aviso = `Percentual sobre convênio: ${pctNovo}% aplicado pelo motor real (${itensCalculados}/${detalhes.length} itens). Fator efetivo pago hoje: ${(fatorEfetivo * 100).toFixed(1)}%.`;
      } else {
        const cobertura = detalhes.length > 0 ? (itensCalculados / detalhes.length) * 100 : 0;
        const partes = [
          `Tabela diferenciada via motor real: mult ${multiplicador} × (1-defl ${deflator}%) × (1+acr ${acrescimo}%).`,
          `${itensCalculados}/${detalhes.length} itens calculados (${cobertura.toFixed(0)}% de cobertura)${itensSemMatch ? ` — ${itensSemMatch} sem match` : ""}.`,
          itensSemMatch > 0 ? "⚠ Cobertura parcial subestima o Simulado — verifique se a tabela cobre todos os TUSS." : "",
        ].filter(Boolean);
        aviso = partes.join(" ");
      }




      setResultado({
        nome: nomeSelecionado,
        ano,
        aurum,
        exacta,
        simulado: { novo_hm: novoHm, nova_margem: novaMargem, nova_pct_margem: novaPct },
        perItem,
        parametros: {
          modelo,
          pct: modelo === "percentual" ? pctNovo : undefined,
          multiplicador: modelo === "tabela_diferenciada" ? multiplicador : undefined,
          deflator: modelo === "tabela_diferenciada" ? deflator : undefined,
          acrescimo: modelo === "tabela_diferenciada" ? acrescimo : undefined,
          reference_table_id: modelo === "tabela_diferenciada" ? (refTableId || null) : null,
        },
        aviso,
      });
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : JSON.stringify(e);
      console.error("SimuladorCenario error:", e);
      toast.error(`Falha ao simular: ${msg}`);
    } finally {
      setSimulando(false);
    }
  }, [hospitalId, nomeSelecionado, ano, modo, modelo, pctNovo, multiplicador, deflator, acrescimo, refTableId, tabelaAurum, nomeCampo, carater, apenasInternados]);

  const salvarCenario = useCallback(async () => {
    if (!resultado || !hospitalId) return;
    setSalvando(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const criadoPor = userRes.user?.id ?? null;
      const modeloLabel = resultado.parametros.modelo === "percentual" ? "% convênio" : "Tabela diferenciada";
      const hmExactaReal = resultado.exacta?.gross ?? null;
      const margemRealExacta = resultado.exacta
        ? resultado.aurum.receita_liquida + resultado.aurum.outros_custos - resultado.exacta.gross
        : null;
      const payload = {
        hospital_id: hospitalId,
        nome: `${modo === "medico" ? "Médico" : "Procedimento"}: ${resultado.nome} — ${modeloLabel}`,
        tipo: modo,
        medico_nome: modo === "medico" ? resultado.nome : null,
        procedimento_nome: modo === "procedimento" ? resultado.nome : null,
        ano_referencia: resultado.ano,
        pct_repasse: resultado.parametros.pct ?? null,
        dobra_cbhpm: resultado.parametros.multiplicador ?? null,
        margem_aurum_original: resultado.aurum.margem,
        pct_margem_aurum_original: resultado.aurum.pct_margem,
        custo_hm_aurum: resultado.aurum.custo_hm,
        repasse_real_exacta: hmExactaReal,
        repasse_simulado: resultado.simulado.novo_hm,
        margem_simulada: resultado.simulado.nova_margem,
        pct_margem_simulada: resultado.simulado.nova_pct_margem,
        delta_margem: margemRealExacta != null ? resultado.simulado.nova_margem - margemRealExacta : null,
        parametros_json: resultado.parametros,
        resultado_json: {
          aurum: resultado.aurum,
          exacta: resultado.exacta,
          simulado: resultado.simulado,
        },
        criado_por: criadoPor,
      };
      const { error } = await supabase.from("simulacao_cenario" as never).insert(payload as never);
      if (error) throw error;
      toast.success("Cenário salvo.");
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : JSON.stringify(e);
      console.error("SimuladorCenario error:", e);
      toast.error(`Falha ao salvar: ${msg}`);
    } finally {
      setSalvando(false);
    }
  }, [resultado, hospitalId, modo]);

  // Exporta Excel detalhado item a item — útil para investigar por que o
  // Simulado diverge do real (falta de match, TUSS sem preço na tabela,
  // funções auxiliares zeradas etc.). Inclui a regra aplicada hoje, a PJ
  // vinculada e o valor pago à época.
  const exportarDetalhado = useCallback(() => {
    if (!resultado || !resultado.exacta) {
      toast.error("Nada para exportar — rode a simulação primeiro.");
      return;
    }
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        const det = resultado.exacta!.detalhes;
        const rows = det.map((d) => {
          const sim = resultado.perItem[d.id];
          const simExpected = sim?.expected_amount ?? 0;
          const deltaSimVsPago = simExpected - d.gross_amount;
          const deltaRegraVsPago = d.expected_amount - d.gross_amount;
          return {
            "Atendimento": d.attendance_number ?? "",
            "Data": "", // não temos a data no detalhe agregado; ignorada por simplicidade
            "Código (TUSS)": d.procedure_code ?? "",
            "Procedimento": d.procedure_name ?? "",
            "Convênio": d.agreement_text ?? "",
            "Médico": d.doctor_name ?? "",
            "Função": d.doctor_role ?? "",
            "Via de acesso": d.access_route ?? "",
            "Setor": d.sector ?? "",
            "Especialidade": d.specialty ?? "",
            "PJ (empresa)": d.company_name ?? "",
            "Qtd": d.quantity,
            "Base convênio (proc_amount)": d.procedure_amount,
            "Valor pago à época (gross)": d.gross_amount,
            "Valor esperado pela regra (época)": d.expected_amount,
            "Regra aplicada (época)": d.applied_rule_label ?? "",
            "Método de cálculo (época)": d.applied_calc_method ?? "",
            "Δ Regra − Pago (época)": Number(deltaRegraVsPago.toFixed(2)),
            "Simulado (motor real)": simExpected,
            "Método simulado": sim?.calculation_type_used ?? "",
            "Simulado sem match?": sim ? (sim.matched ? "" : "SEM MATCH") : "—",
            "Alertas simulado": sim?.alerts?.join(" | ") ?? "",
            "Δ Simulado − Pago": Number(deltaSimVsPago.toFixed(2)),
          };
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "Itens");

        // Aba de parâmetros — audit trail do cenário exportado.
        const params = [
          ["Nome", resultado.nome],
          ["Ano", resultado.ano],
          ["Modelo", resultado.parametros.modelo],
          ["% convênio", resultado.parametros.pct ?? ""],
          ["Tabela referência (id)", resultado.parametros.reference_table_id ?? ""],
          ["Multiplicador", resultado.parametros.multiplicador ?? ""],
          ["Deflator (%)", resultado.parametros.deflator ?? ""],
          ["Acréscimo (%)", resultado.parametros.acrescimo ?? ""],
          ["Total pago (real)", resultado.exacta!.gross],
          ["Total esperado (regra época)", resultado.exacta!.expected],
          ["Total simulado (motor)", resultado.simulado.novo_hm],
          ["Itens", det.length],
          ["Itens sem match no simulado", det.filter((d) => !resultado.perItem[d.id]?.matched).length],
        ];
        const wsp = XLSX.utils.aoa_to_sheet(params);
        XLSX.utils.book_append_sheet(wb, wsp, "Parâmetros");

        const safe = resultado.nome.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
        XLSX.writeFile(wb, `simulador_${safe}_${resultado.ano}.xlsx`);
        toast.success(`Exportado ${det.length} itens.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Falha ao exportar: ${msg}`);
      }
    })();
  }, [resultado]);

  // Vista derivada — aplica o toggle "excluir sem match" (B) sobre o resultado
  // bruto, sem re-simular. Também calcula os KPIs "sem match" para o banner.
  const disp = useMemo(() => {
    if (!resultado) return null;
    const { aurum, exacta, simulado, perItem } = resultado;
    const semMatchDet = exacta
      ? exacta.detalhes.filter((d) => perItem[d.id]?.usedFallback)
      : [];
    const semMatchCount = semMatchDet.length;
    const semMatchValor = semMatchDet.reduce((s, d) => s + d.gross_amount, 0);

    if (!exacta || !excluirSemMatch) {
      return { exacta, simulado, semMatchCount, semMatchValor };
    }

    const detFilt = exacta.detalhes.filter((d) => !perItem[d.id]?.usedFallback);
    const attSet = new Set(
      detFilt.map((d) => d.attendance_number).filter(Boolean) as string[],
    );
    const gross = detFilt.reduce((s, d) => s + d.gross_amount, 0);
    const expected = detFilt.reduce((s, d) => s + d.expected_amount, 0);
    const baseConvenio = detFilt.reduce((s, d) => s + d.procedure_amount, 0);
    const semCarater = detFilt.filter((d) => !d.attendance_number).length; // aproximação
    const novoHm = detFilt.reduce(
      (s, d) => s + (perItem[d.id]?.expected_amount ?? 0),
      0,
    );
    const novaMargem = aurum.receita_liquida + aurum.outros_custos - novoHm;
    const novaPct = aurum.receita_liquida > 0 ? novaMargem / aurum.receita_liquida : 0;

    return {
      exacta: {
        ...exacta,
        gross,
        expected,
        baseConvenio,
        itens: detFilt.length,
        atendimentos: attSet.size,
        sem_carater: semCarater,
        detalhes: detFilt,
      },
      simulado: { novo_hm: novoHm, nova_margem: novaMargem, nova_pct_margem: novaPct },
      semMatchCount,
      semMatchValor,
    };
  }, [resultado, excluirSemMatch]);

  // Renderização — inclui estados sem base.

  if (hospitalId && !loadingNomes && anosDisponiveis.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma base Aurum importada para este hospital. Vá em <strong>Bases Aurum</strong> para fazer upload.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* SEÇÃO 1 — Formulário */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Simulador de Cenário
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Linha 1 */}
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_8rem_9rem] gap-3 items-end">
            <div>
              <Label className="text-xs">Tipo</Label>
              <div className="inline-flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setModo("medico")}
                  className={cn(
                    "px-3 py-2 text-sm",
                    modo === "medico" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  Por Médico
                </button>
                <button
                  type="button"
                  onClick={() => setModo("procedimento")}
                  className={cn(
                    "px-3 py-2 text-sm border-l",
                    modo === "procedimento" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  Por Procedimento
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs">
                {modo === "medico" ? "Médico cirurgião" : "Procedimento"}
              </Label>
              <Popover open={nomeOpen} onOpenChange={setNomeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    disabled={loadingNomes}
                  >
                    <span className="truncate text-left">
                      {loadingNomes ? "Carregando…" : (nomeSelecionado || `Digite para buscar…`)}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[min(30rem,90vw)]" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Digite parte do nome…"
                      value={nomeQuery}
                      onValueChange={setNomeQuery}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhum resultado.</CommandEmpty>
                      <CommandGroup heading={`${sugestoes.length} de ${nomes.length}`}>
                        {sugestoes.map((n) => (
                          <CommandItem
                            key={n}
                            value={n}
                            onSelect={() => {
                              setNomeSelecionado(n);
                              setNomeOpen(false);
                              setResultado(null);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", nomeSelecionado === n ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">{n}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs">Ano</Label>
              <Select
                value={ano ? String(ano) : ""}
                onValueChange={(v) => { setAno(Number(v)); setResultado(null); }}
              >
                <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
                <SelectContent>
                  {anosDisponiveis.map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Caráter</Label>
              <Select
                value={carater}
                onValueChange={(v) => { setCarater(v as typeof carater); setResultado(null); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Eletiva">Eletiva</SelectItem>
                  <SelectItem value="Urgência">Urgência</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Escopo — Aurum só tem receita de INTERNADOS cirúrgicos.
              Filtro default-on evita distorção por consultas/pareceres/SADT. */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <input
              id="apenas-internados"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={apenasInternados}
              onChange={(e) => { setApenasInternados(e.target.checked); setResultado(null); }}
            />
            <Label htmlFor="apenas-internados" className="text-xs cursor-pointer m-0">
              Apenas internados cirúrgicos (Centro Cirúrgico / Hemodinâmica)
            </Label>
            <span className="text-[11px] text-muted-foreground ml-auto">
              Aurum agrega só cirúrgicos; desmarcar inclui consultas, pareceres e SADT e pode distorcer a comparação.
            </span>
          </div>


          {/* Linha 2 — modelo */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-[14rem] flex-1 max-w-[20rem]">
              <Label className="text-xs">Modelo de simulação</Label>
              <Select value={modelo} onValueChange={(v) => { setModelo(v as Modelo); setResultado(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">Percentual sobre convênio</SelectItem>
                  <SelectItem value="tabela_diferenciada">Tabela diferenciada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {modelo === "percentual" ? (
              <div className="max-w-[8rem]">
                <Label className="text-xs">Novo %</Label>
                <DecimalInput value={pctNovo} onChange={setPctNovo} />
              </div>
            ) : (
              <>
                <div className="min-w-[12rem] flex-1 max-w-[18rem]">
                  <Label className="text-xs">Tabela de referência</Label>
                  <Select value={refTableId} onValueChange={setRefTableId}>
                    <SelectTrigger>
                      <SelectValue placeholder={refTables.length === 0 ? "Nenhuma cadastrada" : "Selecione…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {refTables.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-w-[7rem]">
                  <Label className="text-xs">Multiplicador (x)</Label>
                  <DecimalInput value={multiplicador} onChange={setMultiplicador} />
                </div>
                <div className="max-w-[7rem]">
                  <Label className="text-xs">Deflator (%)</Label>
                  <DecimalInput value={deflator} onChange={setDeflator} />
                </div>
                <div className="max-w-[7rem]">
                  <Label className="text-xs">Acréscimo (%)</Label>
                  <DecimalInput value={acrescimo} onChange={setAcrescimo} />
                </div>
              </>
            )}
          </div>

          {/* Linha 3 — ação */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              size="lg"
              onClick={simular}
              disabled={!podeSimular || simulando}
            >
              {simulando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
              Simular
            </Button>
            <span className="text-xs text-muted-foreground">
              {podeSimular
                ? "Clique em Simular para calcular o cenário."
                : "Selecione um médico/procedimento e configure o cenário."}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* SEÇÃO 2 — Resultado */}
      {resultado && (
        <>
          {resultado.aviso && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{resultado.aviso}</span>
            </div>
          )}

          {/* DRE 3 colunas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                DRE comparativa — {resultado.nome} <span className="text-xs text-muted-foreground">({resultado.ano})</span>
              </CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                Aurum: {resultado.aurum.qtd_cirurgias.toLocaleString("pt-BR")} cirurgia(s)
                {" | "}
                Exacta: {resultado.exacta ? `${resultado.exacta.itens.toLocaleString("pt-BR")} item(ns) em ${resultado.exacta.atendimentos.toLocaleString("pt-BR")} atendimento(s)` : "sem match"}
                {" | "}
                Filtro: {carater === "todos" ? "Todos" : carater}
              </div>
              {carater === "todos" && resultado.exacta && resultado.exacta.sem_carater > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {resultado.exacta.sem_carater} de {resultado.exacta.itens} itens do Exacta não têm caráter preenchido e foram incluídos no total.
                </div>
              )}
            </CardHeader>
            <CardContent className="px-2 sm:px-6">
              {/* Wrapper com scroll horizontal em telas estreitas — a DRE tem 3 colunas de valores
                  e não cabe legivelmente em <640px. Melhor pan lateral do que espremer as células. */}
              <div className="overflow-x-auto -mx-2 sm:mx-0">
                <div className="rounded-md border p-3 bg-muted/20 min-w-[560px]">
                {/* Cabeçalho */}
                <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 pb-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span></span>
                  <span></span>
                  <span className="text-right">Aurum</span>
                  <span className="text-right">Exacta Real</span>
                  <span className="text-right text-primary font-bold bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r">Simulado</span>
                </div>

                {(() => {
                  const A = resultado.aurum;
                  const exGross = resultado.exacta?.gross ?? null;
                  const sim = resultado.simulado;
                  const receitaLiqExacta = A.receita_liquida;
                  const margemExacta = exGross != null ? A.receita_liquida + A.outros_custos - exGross : null;
                  const pctExacta = margemExacta != null && A.receita_liquida > 0 ? margemExacta / A.receita_liquida : null;

                  // Convenção: se simulado piora margem (HM maior), coluna Simulado da linha HM em vermelho.
                  const simHmTone: "positive" | "negative" | "neutral" =
                    exGross == null ? "neutral" :
                    sim.novo_hm > exGross ? "negative" : "positive";

                  // Médias por cirurgia / atendimento — usadas nas sub-linhas dentro de cada célula da DRE.
                  const qc = A.qtd_cirurgias;
                  const atd = resultado.exacta?.atendimentos ?? 0;

                  // % HM sobre receita líquida
                  const rl = A.receita_liquida;
                  const pctHmAurum = rl > 0 ? A.custo_hm / rl : null;
                  const pctHmExacta = rl > 0 && exGross != null ? exGross / rl : null;
                  const pctHmSim = rl > 0 ? sim.novo_hm / rl : null;

                  return (
                    <>
                      <DreLine op="(+)" label="Receita Bruta" aurum={A.receita} exacta={A.receita} simulado={A.receita}
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} bold />
                      <DreLine op="(−)" label="Impostos" aurum={-A.impostos} exacta={-A.impostos} simulado={-A.impostos} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine op="(−)" label="Glosas" aurum={-A.glosa_externa} exacta={-A.glosa_externa} simulado={-A.glosa_externa} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine op="(=)" label="Receita Líquida" aurum={A.receita_liquida} exacta={receitaLiqExacta} simulado={A.receita_liquida} bold
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine op="(−)" label="OPME" aurum={-A.custo_opme} exacta={-A.custo_opme} simulado={-A.custo_opme} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine op="(−)" label="Mat/Med" aurum={-A.custo_mat_med} exacta={-A.custo_mat_med} simulado={-A.custo_mat_med} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine
                        op="(−)"
                        label="Honorários Médicos"
                        aurum={-A.custo_hm}
                        exacta={exGross != null ? -exGross : null}
                        simulado={-sim.novo_hm}
                        indent
                        highlight="amber"
                        simuladoTone={simHmTone}
                        denomAurum={qc}
                        denomExacta={atd}
                        denomSim={qc}
                        base={A.receita}
                        tooltip="Aurum: contábil. Exacta Real: gross_amount pago. Simulado: cenário calculado."
                      />
                      {/* Sub-linha extra: % HM sobre Receita Líquida (referência clássica de honorários). */}
                      <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 items-baseline text-[10px] text-muted-foreground pl-3">
                        <span></span>
                        <span className="italic">% da Receita Líquida</span>
                        <span className="text-right tabular-nums">{PCT(pctHmAurum)}</span>
                        <span className="text-right tabular-nums">{PCT(pctHmExacta)}</span>
                        <span className="text-right tabular-nums bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r">{PCT(pctHmSim)}</span>
                      </div>
                      <DreLine op="(−)" label="Exames Imagem" aurum={-A.custo_exames_img} exacta={-A.custo_exames_img} simulado={-A.custo_exames_img} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <DreLine op="(−)" label="Laboratório" aurum={-A.custo_laboratorio} exacta={-A.custo_laboratorio} simulado={-A.custo_laboratorio} indent
                        denomAurum={qc} denomExacta={atd || qc} denomSim={qc} base={A.receita} />
                      <div className="mt-2 pt-2 border-t space-y-1">
                        <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 items-baseline">
                          <span className="text-xs text-muted-foreground">(=)</span>
                          <span className="text-sm font-semibold">Margem de Contribuição</span>
                          <span className={cn("text-sm text-right tabular-nums font-semibold", A.margem >= 0 ? "text-emerald-700" : "text-red-700")}>{BRL(A.margem)}</span>
                          <span className={cn("text-sm text-right tabular-nums font-semibold", (margemExacta ?? 0) >= 0 ? "text-emerald-700" : "text-red-700")}>{BRL(margemExacta)}</span>
                          <span className={cn("text-xl text-right tabular-nums font-bold bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r", sim.nova_margem >= 0 ? "text-emerald-700" : "text-red-700")}>{BRL(sim.nova_margem)}</span>
                        </div>
                        <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 items-baseline text-xs text-muted-foreground">
                          <span></span>
                          <span>% Margem</span>
                          <span className="text-right tabular-nums">{PCT(A.pct_margem)}</span>
                          <span className="text-right tabular-nums">{PCT(pctExacta)}</span>
                          <span className="text-right tabular-nums bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r font-semibold text-primary">{PCT(sim.nova_pct_margem)}</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cards de resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryCard
              title="HM Aurum (contábil)"
              valor={resultado.aurum.custo_hm}
              pct={resultado.aurum.receita_liquida > 0 ? resultado.aurum.custo_hm / resultado.aurum.receita_liquida : null}
              tone="neutral"
            />
            <SummaryCard
              title="HM Exacta (real pago)"
              valor={resultado.exacta?.gross ?? null}
              pct={resultado.exacta && resultado.aurum.receita_liquida > 0 ? resultado.exacta.gross / resultado.aurum.receita_liquida : null}
              extra={resultado.exacta ? `${resultado.exacta.itens} item(s) · ${resultado.exacta.atendimentos} atend.` : "sem match"}
              tone="neutral"
            />
            <SummaryCard
              title="HM Simulado (cenário)"
              valor={resultado.simulado.novo_hm}
              pct={resultado.aurum.receita_liquida > 0 ? resultado.simulado.novo_hm / resultado.aurum.receita_liquida : null}
              extra={
                resultado.exacta
                  ? `Δ vs Exacta: ${BRL(resultado.simulado.novo_hm - resultado.exacta.gross)}`
                  : undefined
              }
              tone={
                resultado.exacta == null ? "neutral" :
                resultado.simulado.novo_hm > resultado.exacta.gross ? "negative" : "positive"
              }
              highlight
            />
          </div>

          {/* Destaque + salvar */}
          <Card>
            <CardContent className="py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="text-sm">
                {(() => {
                  const A = resultado.aurum;
                  const exGross = resultado.exacta?.gross ?? null;
                  const margemAtual = exGross != null ? A.receita_liquida + A.outros_custos - exGross : A.margem;
                  const pctAtual = A.receita_liquida > 0 ? margemAtual / A.receita_liquida : 0;
                  const delta = resultado.simulado.nova_margem - margemAtual;
                  const deltaCor = delta > 0 ? "text-emerald-700" : delta < 0 ? "text-red-700" : "";
                  return (
                    <>
                      <span className="text-muted-foreground">Margem atual: </span>
                      <span className="font-semibold">{BRL(margemAtual)} ({PCT(pctAtual)})</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="text-muted-foreground">Simulada: </span>
                      <span className="font-semibold">{BRL(resultado.simulado.nova_margem)} ({PCT(resultado.simulado.nova_pct_margem)})</span>
                      <span className="mx-2 text-muted-foreground">|</span>
                      <span className="text-muted-foreground">Δ </span>
                      <span className={cn("font-semibold", deltaCor)}>{BRL(delta)}</span>
                    </>
                  );
                })()}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={exportarDetalhado} disabled={!resultado.exacta}>
                  Exportar Excel detalhado
                </Button>
                <Button type="button" onClick={salvarCenario} disabled={salvando}>
                  {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar cenário
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// Ícone helper para não colidir com import — mantém API do lucide.
function ChevronsUpDream() {
  return <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />;
}

function SummaryCard({
  title, valor, pct, extra, tone = "neutral", highlight = false,
}: {
  title: string;
  valor: number | null;
  pct: number | null;
  extra?: string;
  tone?: "positive" | "negative" | "neutral";
  highlight?: boolean;
}) {
  const cor =
    tone === "positive" ? "text-emerald-700" :
    tone === "negative" ? "text-red-700" : "text-foreground";
  return (
    <Card className={cn(highlight && "border-2 border-primary bg-primary/5")}>
      <CardContent className="py-4">
        <div className={cn("text-xs font-medium uppercase tracking-wide", highlight ? "text-primary font-bold" : "text-muted-foreground")}>{title}</div>
        <div className={cn("text-2xl font-semibold tabular-nums mt-1", highlight ? "text-primary" : cor)}>{BRL(valor)}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {pct != null ? `${PCT(pct)} da receita líquida` : "—"}
          {extra ? ` · ${extra}` : ""}
        </div>
      </CardContent>
    </Card>
  );
}
