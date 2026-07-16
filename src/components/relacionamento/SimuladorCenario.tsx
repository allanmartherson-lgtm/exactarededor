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
  gross: number;
  expected: number;
  itens: number;
  atendimentos: number;
  sem_carater: number;
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
  simuladoTone,
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
}) {
  const bg =
    highlight === "amber" ? "bg-amber-50" :
    highlight === "success" ? "bg-emerald-50" :
    highlight === "danger" ? "bg-red-50" : "";
  const simCor =
    simuladoTone === "positive" ? "text-emerald-700" :
    simuladoTone === "negative" ? "text-red-700" : "text-foreground";
  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] items-baseline gap-2 py-1 border-b border-dashed border-muted/40 last:border-0",
        indent && "pl-3",
        bg && `${bg} -mx-2 px-2 rounded`,
      )}
      title={tooltip}
    >
      <span className="text-xs text-muted-foreground">{op}</span>
      <span className={cn("text-sm truncate", bold && "font-semibold")}>{label}</span>
      <span className={cn("text-sm text-right tabular-nums", bold && "font-semibold")}>{BRL(aurum)}</span>
      <span className={cn("text-sm text-right tabular-nums", bold && "font-semibold")}>{BRL(exacta)}</span>
      <span className={cn(
        "text-sm text-right tabular-nums bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r",
        bold && "font-semibold",
        simCor,
      )}>{BRL(simulado)}</span>
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
  const [carater, setCarater] = useState<"todos" | "Eletiva" | "Urgência">("todos");

  const [simulando, setSimulando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<null | {
    nome: string;
    ano: number;
    aurum: AurumAggregated;
    exacta: ExactaAggregated | null; // null quando sem match
    simulado: Simulado;
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
          let gross = 0, expected = 0, count = 0, semCar = 0;
          const atts = new Set<string>();
          const itens = await fetchAllPaginated<{
            gross_amount: number | null;
            expected_amount: number | null;
            attendance_number: string | null;
            attendance_character: string | null;
          }>((from, to) => {
            let q = supabase
              .from("payment_items")
              .select("gross_amount,expected_amount,attendance_number,attendance_character")
              .eq("hospital_id", hospitalId)
              .eq("is_cancelled", false)
              .in("doctor_id", idsArr)
              .gte("procedure_date", dateFrom)
              .lt("procedure_date", dateTo);
            if (carater === "Eletiva") {
              q = q.or("attendance_character.ilike.%ELETIV%,attendance_character.ilike.%Eletiva%");
            } else if (carater === "Urgência") {
              q = q.or("attendance_character.ilike.%URGENCIA%,attendance_character.ilike.%Urgência%");
            }
            return q.range(from, to);
          });
          for (const it of itens) {
            gross += Number(it.gross_amount ?? 0);
            expected += Number(it.expected_amount ?? 0);
            count += 1;
            if (it.attendance_number) atts.add(it.attendance_number);
            if (!it.attendance_character || String(it.attendance_character).trim() === "") semCar += 1;
          }
          exacta = count > 0 ? { gross, expected, itens: count, atendimentos: atts.size, sem_carater: semCar } : null;
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
          let gross = 0, expected = 0, count = 0, semCar = 0;
          // Rebusca todos os itens desses atendimentos (agregado).
          const attsArr = Array.from(attsMatched);
          // Buscamos em blocos pra evitar URL gigante.
          const chunk = 200;
          for (let i = 0; i < attsArr.length; i += chunk) {
            const slice = attsArr.slice(i, i + chunk);
            const partial = await fetchAllPaginated<{
              gross_amount: number | null;
              expected_amount: number | null;
              attendance_character: string | null;
            }>((from, to) => {
              let q = supabase
                .from("payment_items")
                .select("gross_amount,expected_amount,attendance_character")
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
              count += 1;
              if (!it.attendance_character || String(it.attendance_character).trim() === "") semCar += 1;
            }
          }
          exacta = { gross, expected, itens: count, atendimentos: attsMatched.size, sem_carater: semCar };
        }
      }

      // 3) Cálculo do cenário simulado.
      const baseConvenio = exacta?.expected ?? 0;
      let novoHm = 0;
      if (modelo === "percentual") {
        novoHm = baseConvenio * (pctNovo / 100);
      } else {
        // Tabela diferenciada — sem lookup TUSS direto ainda; usa expected como base.
        novoHm = baseConvenio * multiplicador * (1 - deflator / 100) * (1 + acrescimo / 100);
      }
      const novaMargem = aurum.receita_liquida + aurum.outros_custos - novoHm;
      const novaPct = aurum.receita_liquida > 0 ? novaMargem / aurum.receita_liquida : 0;

      const aviso = exacta == null
        ? "Sem itens do Exacta para este médico/procedimento no ano. HM Exacta real e Simulado indisponíveis (base convênio zerada)."
        : baseConvenio <= 0
          ? "Itens do Exacta encontrados, mas sem expected_amount (base convênio) — Simulado zerado."
          : undefined;

      setResultado({
        nome: nomeSelecionado,
        ano,
        aurum,
        exacta,
        simulado: { novo_hm: novoHm, nova_margem: novaMargem, nova_pct_margem: novaPct },
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
  }, [hospitalId, nomeSelecionado, ano, modo, modelo, pctNovo, multiplicador, deflator, acrescimo, refTableId, tabelaAurum, nomeCampo, carater]);

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
                <Input
                  type="number" step="0.1" value={pctNovo}
                  onChange={(e) => setPctNovo(Number(e.target.value))}
                />
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
                  <Input type="number" step="0.1" value={multiplicador} onChange={(e) => setMultiplicador(Number(e.target.value))} />
                </div>
                <div className="max-w-[7rem]">
                  <Label className="text-xs">Deflator (%)</Label>
                  <Input type="number" step="0.1" value={deflator} onChange={(e) => setDeflator(Number(e.target.value))} />
                </div>
                <div className="max-w-[7rem]">
                  <Label className="text-xs">Acréscimo (%)</Label>
                  <Input type="number" step="0.1" value={acrescimo} onChange={(e) => setAcrescimo(Number(e.target.value))} />
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
            <CardContent>
              <div className="rounded-md border p-3 bg-muted/20">
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

                  // Médias por cirurgia / atendimento
                  const qc = A.qtd_cirurgias;
                  const atd = resultado.exacta?.atendimentos ?? 0;
                  const mediaHmAurum = qc > 0 ? A.custo_hm / qc : null;
                  const mediaHmExacta = exGross != null && atd > 0 ? exGross / atd : null;
                  const mediaHmSim = qc > 0 ? sim.novo_hm / qc : null;

                  // % HM sobre receita líquida
                  const rl = A.receita_liquida;
                  const pctHmAurum = rl > 0 ? A.custo_hm / rl : null;
                  const pctHmExacta = rl > 0 && exGross != null ? exGross / rl : null;
                  const pctHmSim = rl > 0 ? sim.novo_hm / rl : null;

                  return (
                    <>
                      <DreLine op="(+)" label="Receita Bruta" aurum={A.receita} exacta={A.receita} simulado={A.receita} />
                      <DreLine op="(−)" label="Impostos" aurum={-A.impostos} exacta={-A.impostos} simulado={-A.impostos} indent />
                      <DreLine op="(−)" label="Glosas" aurum={-A.glosa_externa} exacta={-A.glosa_externa} simulado={-A.glosa_externa} indent />
                      <DreLine op="(=)" label="Receita Líquida" aurum={A.receita_liquida} exacta={receitaLiqExacta} simulado={A.receita_liquida} bold />
                      <DreLine op="(−)" label="OPME" aurum={-A.custo_opme} exacta={-A.custo_opme} simulado={-A.custo_opme} indent />
                      <DreLine op="(−)" label="Mat/Med" aurum={-A.custo_mat_med} exacta={-A.custo_mat_med} simulado={-A.custo_mat_med} indent />
                      <DreLine
                        op="(−)"
                        label="Honorários Médicos"
                        aurum={-A.custo_hm}
                        exacta={exGross != null ? -exGross : null}
                        simulado={-sim.novo_hm}
                        indent
                        highlight="amber"
                        simuladoTone={simHmTone}
                        tooltip="Aurum: contábil. Exacta Real: gross_amount pago. Simulado: cenário calculado."
                      />
                      {/* Sub-linha: média por cirurgia/atendimento */}
                      <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 items-baseline text-[11px] text-muted-foreground pl-3">
                        <span></span>
                        <span className="italic">média por cirurgia/atend.</span>
                        <span className="text-right tabular-nums">{mediaHmAurum != null ? `${BRL(mediaHmAurum)}/cir` : "—"}</span>
                        <span className="text-right tabular-nums">{mediaHmExacta != null ? `${BRL(mediaHmExacta)}/atend` : "—"}</span>
                        <span className="text-right tabular-nums bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r">{mediaHmSim != null ? `${BRL(mediaHmSim)}/cir` : "—"}</span>
                      </div>
                      {/* Sub-linha: % da Receita Líquida */}
                      <div className="grid grid-cols-[2rem_1fr_repeat(3,minmax(6rem,1fr))] gap-2 items-baseline text-[11px] text-muted-foreground pl-3">
                        <span></span>
                        <span className="italic">% da Receita Líquida</span>
                        <span className="text-right tabular-nums">{PCT(pctHmAurum)}</span>
                        <span className="text-right tabular-nums">{PCT(pctHmExacta)}</span>
                        <span className="text-right tabular-nums bg-blue-50 dark:bg-blue-950/30 -my-1 -mr-2 py-1 pr-2 pl-2 rounded-r">{PCT(pctHmSim)}</span>
                      </div>
                      <DreLine op="(−)" label="Exames Imagem" aurum={-A.custo_exames_img} exacta={-A.custo_exames_img} simulado={-A.custo_exames_img} indent />
                      <DreLine op="(−)" label="Laboratório" aurum={-A.custo_laboratorio} exacta={-A.custo_laboratorio} simulado={-A.custo_laboratorio} indent />
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
              <Button type="button" onClick={salvarCenario} disabled={salvando}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar cenário
              </Button>
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
    <Card className={cn(highlight && "border-primary bg-primary/5")}>
      <CardContent className="py-4">
        <div className={cn("text-xs font-medium uppercase tracking-wide", highlight ? "text-primary font-bold" : "text-muted-foreground")}>{title}</div>
        <div className={cn("text-2xl font-semibold tabular-nums mt-1", cor)}>{BRL(valor)}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {pct != null ? `${PCT(pct)} da receita líquida` : "—"}
          {extra ? ` · ${extra}` : ""}
        </div>
      </CardContent>
    </Card>
  );
}
