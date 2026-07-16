// Simulador de Margem — Fase 1 (comparativo Aurum × Exacta com HM real).
//
// Objetivo desta fase: substituir o `custo_hm` do Aurum (que traz o honorário
// que caiu na conta pelo faturamento) pelo REPASSE REAL pago pelo Exacta
// (`payment_items.gross_amount`). A margem recalculada mostra o cenário
// verdadeiro — quase sempre pior que o Aurum sozinho.
//
// Regras de agregação (definidas com o usuário):
//   • Modo médico → soma gross_amount de todos os payment_items daquele médico
//     no intervalo escolhido (match por doctor_name normalizado).
//   • Modo procedimento → o "código principal" (Aurum) é balizador, mas o
//     Exacta deve trazer o HONORÁRIO INTEIRO do atendimento. Passo:
//       1) Match fuzzy ds_procedimento (Aurum) ↔ procedure_name (Exacta)
//          para descobrir os attendance_number cobertos.
//       2) Somar gross_amount de TODOS os itens desses attendance_number
//          (mesmo com TUSS diferentes: primeiro/segundo aux, anestesia, etc.).
//
// Motor de simulação (percentual convênio, tabela diferenciada, valor fixo)
// entra na Fase 3 e volta pra este arquivo depois — foi removido dessa versão
// porque ainda estava calcado no modelo antigo (base único-registro).
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertCircle, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { cn } from "@/lib/utils";

type Modo = "medico" | "procedimento";
type Carater = "todos" | "Eletiva" | "Urgência";
type Periodo = "todos" | "Diurno" | "Noturno";
type Faturado = "todos" | "sim" | "nao";

interface AurumBase {
  carater: string;
  periodo_internacao: string;
  faturado: boolean;
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
  pct_margem: number | null;
}
interface AurumMedicoRow extends AurumBase { medico_cirurgiao: string }
interface AurumProcRow extends AurumBase { ds_procedimento: string }

interface ExactaItem {
  attendance_number: string | null;
  doctor_name: string | null;
  procedure_name: string | null;
  gross_amount: number | null;
}

interface LinhaComparativa {
  nome: string;
  ano: number;
  qtd_cirurgias: number;
  receita_liquida: number;
  custo_total_aurum: number;
  custo_hm_aurum: number;
  outros_custos: number; // custo_total − custo_hm
  margem_aurum: number;
  hm_exacta_real: number | null; // null = sem match Exacta
  hm_exacta_qtd_itens: number;
  hm_exacta_qtd_atendimentos: number;
  custo_total_recalc: number | null;
  margem_recalc: number | null;
  delta_margem: number | null;
  pct_margem_aurum: number;
  pct_margem_recalc: number | null;
}

const BRL = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PCT = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v) < 1 ? v * 100 : v;
  return `${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};

const NUM = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// Normalizador comum: minúscula, sem acento, só alfanum + espaço.
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Score fuzzy simples: exato > substring > intersecção de tokens>2 chars.
// Retorna número; ≥ 20 já é considerado match utilizável.
function fuzzyScore(target: string, candidate: string): number {
  if (!target || !candidate) return 0;
  if (target === candidate) return 1000;
  if (candidate.includes(target) || target.includes(candidate)) {
    return 500 - Math.abs(candidate.length - target.length);
  }
  const tTok = new Set(target.split(" ").filter((t) => t.length > 3));
  if (tTok.size === 0) return 0;
  let hit = 0;
  for (const t of candidate.split(" ")) if (tTok.has(t)) hit++;
  return hit >= 2 ? hit * 10 : 0;
}

function firstOfYear(y: number) { return `${y}-01-01`; }
function firstOfNextYear(y: number) { return `${y + 1}-01-01`; }

export function SimuladorMargem() {
  const hospitalId = useEnforcedHospitalId();

  // Filtros gerais
  const [modo, setModo] = useState<Modo>("medico");
  const [ano, setAno] = useState<number | null>(null);
  const [carater, setCarater] = useState<Carater>("todos");
  const [periodo, setPeriodo] = useState<Periodo>("todos");
  const [faturado, setFaturado] = useState<Faturado>("todos");
  const [busca, setBusca] = useState("");

  // Intervalo Exacta (default = ano Aurum selecionado)
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Dados
  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([]);
  const [aurumMedico, setAurumMedico] = useState<AurumMedicoRow[]>([]);
  const [aurumProc, setAurumProc] = useState<AurumProcRow[]>([]);
  const [exactaItems, setExactaItems] = useState<ExactaItem[]>([]);
  const [loadingAurum, setLoadingAurum] = useState(false);
  const [loadingExacta, setLoadingExacta] = useState(false);

  // Descobre anos disponíveis (uma vez por hospital).
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("aurum_margem_medico" as never)
        .select("ano")
        .eq("hospital_id", hospitalId)
        .limit(20000);
      if (cancelled || error) return;
      const rows = (data ?? []) as Array<{ ano: number }>;
      const anos = Array.from(new Set(rows.map((r) => r.ano).filter(Number.isFinite))).sort((a, b) => b - a);
      setAnosDisponiveis(anos);
      setAno((prev) => (prev && anos.includes(prev)) ? prev : (anos[0] ?? null));
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  // Sincroniza intervalo Exacta com ano Aurum quando o usuário troca de ano.
  useEffect(() => {
    if (!ano) return;
    setDateFrom(firstOfYear(ano));
    setDateTo(firstOfNextYear(ano));
  }, [ano]);

  // Carrega Aurum (linhas agregadas por médico / procedimento).
  useEffect(() => {
    if (!hospitalId || !ano) return;
    let cancelled = false;
    setLoadingAurum(true);
    void (async () => {
      try {
        const tabela = modo === "medico" ? "aurum_margem_medico" : "aurum_margem_procedimento";
        let q = supabase
          .from(tabela as never)
          .select("*")
          .eq("hospital_id", hospitalId)
          .eq("ano", ano);
        if (carater !== "todos") q = q.eq("carater", carater);
        if (periodo !== "todos") q = q.eq("periodo_internacao", periodo);
        if (faturado !== "todos") q = q.eq("faturado", faturado === "sim");
        const { data, error } = await q.limit(20000);
        if (cancelled) return;
        if (error) throw error;
        if (modo === "medico") {
          setAurumMedico((data ?? []) as AurumMedicoRow[]);
          setAurumProc([]);
        } else {
          setAurumProc((data ?? []) as AurumProcRow[]);
          setAurumMedico([]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Falha ao carregar Aurum: ${msg}`);
      } finally {
        if (!cancelled) setLoadingAurum(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId, modo, ano, carater, periodo, faturado]);

  // Carrega itens Exacta no intervalo (paginado).
  useEffect(() => {
    if (!hospitalId || !dateFrom || !dateTo) return;
    let cancelled = false;
    setLoadingExacta(true);
    void (async () => {
      try {
        const rows = await fetchAllPaginated<ExactaItem>((from, to) =>
          supabase
            .from("payment_items")
            .select("attendance_number,doctor_name,procedure_name,gross_amount")
            .eq("hospital_id", hospitalId)
            .eq("is_cancelled", false)
            .gte("procedure_date", dateFrom)
            .lt("procedure_date", dateTo)
            .range(from, to),
        );
        if (cancelled) return;
        setExactaItems(rows);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Falha ao carregar Exacta: ${msg}`);
        setExactaItems([]);
      } finally {
        if (!cancelled) setLoadingExacta(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId, dateFrom, dateTo]);

  // Índices Exacta pré-processados para não recomputar por linha.
  const exactaIndex = useMemo(() => {
    const porMedico = new Map<string, { total: number; atendimentos: Set<string>; itens: number }>();
    const porAtendimento = new Map<string, number>(); // soma gross de todos os itens do atendimento
    const procIndex: Array<{ normProc: string; attendance: string }> = [];

    for (const it of exactaItems) {
      const g = Number(it.gross_amount ?? 0);
      const nMed = norm(it.doctor_name);
      const att = (it.attendance_number ?? "").trim();
      const nProc = norm(it.procedure_name);

      if (nMed) {
        const cur = porMedico.get(nMed) ?? { total: 0, atendimentos: new Set<string>(), itens: 0 };
        cur.total += g;
        cur.itens += 1;
        if (att) cur.atendimentos.add(att);
        porMedico.set(nMed, cur);
      }
      if (att) {
        porAtendimento.set(att, (porAtendimento.get(att) ?? 0) + g);
        if (nProc) procIndex.push({ normProc: nProc, attendance: att });
      }
    }
    return { porMedico, porAtendimento, procIndex };
  }, [exactaItems]);

  // Casa cada linha Aurum com o Exacta e monta as linhas comparativas.
  const linhas: LinhaComparativa[] = useMemo(() => {
    const out: LinhaComparativa[] = [];

    const emp = (row: AurumBase, nome: string, exacta: { total: number | null; itens: number; atendimentos: number }): LinhaComparativa => {
      const custoTotal = Number(row.custo_total ?? 0);
      const custoHmAurum = Number(row.custo_hm ?? 0);
      const receitaLiq = Number(row.receita_liquida ?? 0);
      const outros = custoTotal - custoHmAurum;
      const margemAurum = Number(row.margem ?? (receitaLiq - custoTotal));
      const pctMargemAurum = receitaLiq > 0 ? margemAurum / receitaLiq : 0;

      let custoRecalc: number | null = null;
      let margemRecalc: number | null = null;
      let delta: number | null = null;
      let pctMargemRecalc: number | null = null;
      if (exacta.total != null) {
        custoRecalc = outros + exacta.total;
        margemRecalc = receitaLiq - custoRecalc;
        delta = margemRecalc - margemAurum;
        pctMargemRecalc = receitaLiq > 0 ? margemRecalc / receitaLiq : null;
      }
      return {
        nome,
        ano: row.ano,
        qtd_cirurgias: Number(row.qtd_cirurgias ?? 0),
        receita_liquida: receitaLiq,
        custo_total_aurum: custoTotal,
        custo_hm_aurum: custoHmAurum,
        outros_custos: outros,
        margem_aurum: margemAurum,
        hm_exacta_real: exacta.total,
        hm_exacta_qtd_itens: exacta.itens,
        hm_exacta_qtd_atendimentos: exacta.atendimentos,
        custo_total_recalc: custoRecalc,
        margem_recalc: margemRecalc,
        delta_margem: delta,
        pct_margem_aurum: pctMargemAurum,
        pct_margem_recalc: pctMargemRecalc,
      };
    };

    // Linhas "Total" no Aurum são totalizadores gerais da planilha — ignoramos
    // para não poluir o comparativo (nunca terão match no Exacta e distorcem KPIs).
    const isTotalRow = (nome: string | null | undefined) => {
      const n = norm(nome);
      return !n || n === "total" || n.startsWith("total ");
    };

    if (modo === "medico") {
      for (const row of aurumMedico) {
        const nome = row.medico_cirurgiao;
        if (isTotalRow(nome)) continue;
        const hit = exactaIndex.porMedico.get(norm(nome));
        const ex = hit
          ? { total: hit.total, itens: hit.itens, atendimentos: hit.atendimentos.size }
          : { total: null, itens: 0, atendimentos: 0 };
        out.push(emp(row, nome, ex));
      }
    } else {
      // Procedimento: fuzzy match ds_procedimento vs procedure_name Exacta.
      // Passo 1: agrupamos procIndex por procedure_name normalizado uma vez.
      const porProc: Map<string, Set<string>> = new Map();
      for (const { normProc, attendance } of exactaIndex.procIndex) {
        const cur = porProc.get(normProc) ?? new Set<string>();
        cur.add(attendance);
        porProc.set(normProc, cur);
      }
      const procNames = Array.from(porProc.keys());

      for (const row of aurumProc) {
        const nome = row.ds_procedimento;
        if (isTotalRow(nome)) continue;
        const target = norm(nome);
        // encontra os melhores procedure_name Exacta
        const matched = new Set<string>();
        for (const cand of procNames) {
          if (fuzzyScore(target, cand) >= 20) {
            const atts = porProc.get(cand);
            if (atts) for (const a of atts) matched.add(a);
          }
        }
        // soma o honorário INTEIRO desses atendimentos
        let total = 0;
        for (const att of matched) total += exactaIndex.porAtendimento.get(att) ?? 0;
        const ex = matched.size > 0
          ? { total, itens: 0, atendimentos: matched.size }
          : { total: null as number | null, itens: 0, atendimentos: 0 };
        out.push(emp(row, nome, ex));
      }
    }
    return out;
  }, [modo, aurumMedico, aurumProc, exactaIndex]);

  // Filtro busca
  const linhasFiltradas = useMemo(() => {
    const q = norm(busca);
    if (!q) return linhas;
    return linhas.filter((l) => norm(l.nome).includes(q));
  }, [linhas, busca]);

  // Ordenação padrão: maior receita líquida no topo
  const linhasOrdenadas = useMemo(
    () => [...linhasFiltradas].sort((a, b) => b.receita_liquida - a.receita_liquida),
    [linhasFiltradas],
  );

  // Totais consolidados (KPIs)
  const totais = useMemo(() => {
    let receita = 0, custoAurum = 0, hmAurum = 0, hmExacta = 0, matched = 0;
    for (const l of linhasOrdenadas) {
      receita += l.receita_liquida;
      custoAurum += l.custo_total_aurum;
      hmAurum += l.custo_hm_aurum;
      if (l.hm_exacta_real != null) {
        hmExacta += l.hm_exacta_real;
        matched += 1;
      }
    }
    const margemAurum = receita - custoAurum;
    const custoRecalc = custoAurum - hmAurum + hmExacta;
    const margemRecalc = receita - custoRecalc;
    return {
      receita, custoAurum, hmAurum, hmExacta, matched,
      margemAurum, margemRecalc,
      delta: margemRecalc - margemAurum,
      pctMatched: linhasOrdenadas.length > 0 ? matched / linhasOrdenadas.length : 0,
    };
  }, [linhasOrdenadas]);

  const semAurum = anosDisponiveis.length === 0;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Comparativo Aurum × Repasse Real (Exacta)</CardTitle>
            <Badge variant="outline" className="text-xs">Fase 1</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="col-span-2">
              <Label className="text-xs">Base</Label>
              <Select value={modo} onValueChange={(v) => setModo(v as Modo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="medico">Por médico cirurgião</SelectItem>
                  <SelectItem value="procedimento">Por procedimento (principal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Ano Aurum</Label>
              <Select
                value={ano ? String(ano) : ""}
                onValueChange={(v) => setAno(Number(v))}
                disabled={semAurum}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {anosDisponiveis.map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Caráter</Label>
              <Select value={carater} onValueChange={(v) => setCarater(v as Carater)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Eletiva">Eletiva</SelectItem>
                  <SelectItem value="Urgência">Urgência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Diurno">Diurno</SelectItem>
                  <SelectItem value="Noturno">Noturno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Faturado</Label>
              <Select value={faturado} onValueChange={(v) => setFaturado(v as Faturado)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div>
              <Label className="text-xs">Exacta — de</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Exacta — até</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Buscar por nome</Label>
              <Input
                placeholder={modo === "medico" ? "Ex.: dr. joão silva" : "Ex.: colecistectomia"}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (ano) {
                    setDateFrom(firstOfYear(ano));
                    setDateTo(firstOfNextYear(ano));
                  }
                }}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> Sincronizar Exacta com ano Aurum
              </Button>
            </div>
          </div>

          {semAurum && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="h-4 w-4" />
              Nenhuma base Aurum importada para este hospital. Vá em "Bases Aurum" para subir o XLSX.
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPIs consolidados */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Receita líquida</div>
            <div className="text-lg font-semibold">{BRL(totais.receita)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">HM Aurum × Exacta</div>
            <div className="text-sm">
              <span className="font-semibold">{BRL(totais.hmAurum)}</span>{" "}
              <span className="text-muted-foreground">vs</span>{" "}
              <span className="font-semibold">{BRL(totais.hmExacta)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{NUM(totais.matched)} de {NUM(linhasOrdenadas.length)} linhas casadas ({PCT(totais.pctMatched)})</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Margem Aurum → Recalculada</div>
            <div className="text-sm">
              <span className="font-semibold">{BRL(totais.margemAurum)}</span>{" "}
              <span className="text-muted-foreground">→</span>{" "}
              <span className="font-semibold">{BRL(totais.margemRecalc)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Δ Margem (Recalc − Aurum)</div>
            <div className={cn(
              "text-lg font-semibold",
              totais.delta > 0 ? "text-emerald-600" : totais.delta < 0 ? "text-red-600" : "",
            )}>
              {BRL(totais.delta)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela comparativa */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              {modo === "medico" ? "Médicos cirurgiões" : "Procedimentos (código principal)"}
              {(loadingAurum || loadingExacta) && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">carregando…</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              Coluna "HM Exacta" = repasse real pago no período. Substitui o "Custo HM" do Aurum.
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="min-w-[240px]">{modo === "medico" ? "Médico" : "Procedimento"}</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Receita Líq.</TableHead>
                  <TableHead className="text-right">Custo total (Aurum)</TableHead>
                  <TableHead className="text-right">HM Aurum</TableHead>
                  <TableHead className="text-right">HM Exacta (real)</TableHead>
                  <TableHead className="text-right">Margem Aurum</TableHead>
                  <TableHead className="text-right">Margem Recalc</TableHead>
                  <TableHead className="text-right">Δ Margem</TableHead>
                  <TableHead className="text-right">Δ % Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasOrdenadas.length === 0 && !loadingAurum && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhuma linha para os filtros escolhidos.
                    </TableCell>
                  </TableRow>
                )}
                {linhasOrdenadas.map((l) => {
                  const semMatch = l.hm_exacta_real == null;
                  return (
                    <TableRow key={`${l.nome}-${l.ano}`}>
                      <TableCell className="font-medium">
                        <div className="truncate max-w-[280px]" title={l.nome}>{l.nome}</div>
                        {semMatch && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-600">sem match no exacta</span>
                        )}
                        {!semMatch && modo === "procedimento" && (
                          <span className="text-[10px] text-muted-foreground">
                            {NUM(l.hm_exacta_qtd_atendimentos)} atendimento(s) somado(s)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{NUM(l.qtd_cirurgias)}</TableCell>
                      <TableCell className="text-right">{BRL(l.receita_liquida)}</TableCell>
                      <TableCell className="text-right">
                        <div>{BRL(l.custo_total_aurum)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {l.receita_liquida > 0 ? PCT(l.custo_total_aurum / l.receita_liquida) : "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{BRL(l.custo_hm_aurum)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {l.receita_liquida > 0 ? PCT(l.custo_hm_aurum / l.receita_liquida) : "—"}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-right", semMatch ? "text-muted-foreground" : "font-medium")}>
                        <div>{BRL(l.hm_exacta_real)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {!semMatch && l.receita_liquida > 0 && l.hm_exacta_real != null
                            ? PCT(l.hm_exacta_real / l.receita_liquida)
                            : "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{BRL(l.margem_aurum)}</div>
                        <div className="text-[10px] text-muted-foreground">{PCT(l.pct_margem_aurum)}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{BRL(l.margem_recalc)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {l.pct_margem_recalc != null ? PCT(l.pct_margem_recalc) : "—"}
                        </div>
                      </TableCell>

                      <TableCell className={cn(
                        "text-right font-semibold",
                        (l.delta_margem ?? 0) > 0 ? "text-emerald-600" : (l.delta_margem ?? 0) < 0 ? "text-red-600" : "",
                      )}>
                        {BRL(l.delta_margem)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {l.pct_margem_recalc != null && l.pct_margem_aurum
                          ? PCT(l.pct_margem_recalc - l.pct_margem_aurum)
                          : "—"}
                      </TableCell>

                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        Fase 2 (próxima): base histórica de simulação por atendimento para cada médico/procedimento.
        Fase 3: motor de simulação com modelos <em>percentual convênio</em>, <em>tabela diferenciada</em> e <em>valor fixo</em>.
      </div>
    </div>
  );
}
