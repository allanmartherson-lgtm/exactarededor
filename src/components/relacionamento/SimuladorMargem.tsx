// Simulador de Margem — cruza Aurum (custo hospitalar) com Exacta (repasse real).
// Permite simular cenários de acordo comercial e salvar em simulacao_cenario.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertCircle, Check, ChevronsUpDown, Save, TrendingUp, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";

type Modo = "medico" | "procedimento";
type Carater = "todos" | "Eletiva" | "Urgência";
type Periodo = "todos" | "Diurno" | "Noturno";
type Faturado = "todos" | "sim" | "nao";

interface AurumRow {
  carater: string;
  periodo_internacao: string;
  faturado: boolean;
  ano: number;
  medico_cirurgiao?: string;
  ds_procedimento?: string;
  qtd_cirurgias: number | null;
  receita: number | null;
  impostos: number | null;
  glosa_externa: number | null;
  receita_liquida: number | null;
  custo_total: number | null;
  margem: number | null;
  pct_margem: number | null;
  custo_hm: number | null;
}

const BRL = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PCT = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${(v * (Math.abs(v) < 1 ? 100 : 1)).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const sumNullable = (arr: (number | null | undefined)[]) =>
  arr.reduce<number>((acc, v) => acc + (v ?? 0), 0);

const normalizeDesc = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface CbhpmLookupItem {
  codigo: string;
  descricao: string;
  valor_base: number;
  norm: string;
}

interface CenarioSalvo {
  id: string;
  nome: string;
  tipo: "medico" | "procedimento";
  medico_nome: string | null;
  procedimento_nome: string | null;
  ano_referencia: number | null;
  pct_repasse: number | null;
  dobra_cbhpm: number | null;
  via_acesso_pct: number | null;
  volume_estimado: number | null;
  margem_simulada: number | null;
  pct_margem_simulada: number | null;
  created_at: string;
  parametros_json: Record<string, unknown> | null;
}

function Autocomplete({
  value, options, onChange, placeholder, loading,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  placeholder: string;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between"
          disabled={loading}
        >
          <span className="truncate">
            {value ?? (loading ? "Carregando..." : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              {options.slice(0, 200).map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => {
                    onChange(opt === value ? null : opt);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{opt}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SimuladorMargem() {
  const hospitalId = useEnforcedHospitalId();
  const [modo, setModo] = useState<Modo>("medico");

  // Filtros
  const [selName, setSelName] = useState<string | null>(null);
  const [ano, setAno] = useState<number | null>(null);
  const [carater, setCarater] = useState<Carater>("todos");
  const [periodo, setPeriodo] = useState<Periodo>("todos");
  const [faturado, setFaturado] = useState<Faturado>("todos");

  // Dados
  const [names, setNames] = useState<string[]>([]);
  const [anos, setAnos] = useState<number[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [aurumRows, setAurumRows] = useState<AurumRow[]>([]);
  const [loadingAurum, setLoadingAurum] = useState(false);
  const [exactaRepasse, setExactaRepasse] = useState<number | null>(null);
  const [exactaQtd, setExactaQtd] = useState<number>(0);
  const [loadingExacta, setLoadingExacta] = useState(false);

  // Cenário
  const [pctRepasse, setPctRepasse] = useState(30);
  const [dobra, setDobra] = useState(1);
  const [viaAcessoPct, setViaAcessoPct] = useState(0);
  const [volume, setVolume] = useState(0);
  const [cbhpmBase, setCbhpmBase] = useState(0);
  const [cbhpmMatch, setCbhpmMatch] = useState<{ codigo: string; descricao: string } | null>(null);

  // CBHPM (cache por hospital)
  const [cbhpmList, setCbhpmList] = useState<CbhpmLookupItem[]>([]);

  // Salvar
  const [saveOpen, setSaveOpen] = useState(false);
  const [nomeCenario, setNomeCenario] = useState("");
  const [descCenario, setDescCenario] = useState("");
  const [saving, setSaving] = useState(false);

  // Cenários salvos
  const [cenarios, setCenarios] = useState<CenarioSalvo[]>([]);
  const [cenariosTick, setCenariosTick] = useState(0);

  const tabela = modo === "medico" ? "aurum_margem_medico" : "aurum_margem_procedimento";
  const keyField = modo === "medico" ? "medico_cirurgiao" : "ds_procedimento";

  // Carrega lista de nomes + anos disponíveis.
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    setLoadingList(true);
    setSelName(null);
    void (async () => {
      const { data, error } = await supabase
        .from(tabela as unknown as never)
        .select(`${keyField},ano`)
        .eq("hospital_id", hospitalId)
        .limit(20000);
      if (cancelled) return;
      if (error) {
        toast.error(`Falha ao carregar base Aurum: ${error.message}`);
        setNames([]);
        setAnos([]);
      } else {
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const nSet = new Set<string>();
        const aSet = new Set<number>();
        for (const r of rows) {
          const n = String(r[keyField] ?? "").trim();
          if (n) nSet.add(n);
          const a = Number(r.ano);
          if (Number.isFinite(a)) aSet.add(a);
        }
        const sortedNames = Array.from(nSet).sort((a, b) => a.localeCompare(b, "pt-BR"));
        const sortedAnos = Array.from(aSet).sort((a, b) => b - a);
        setNames(sortedNames);
        setAnos(sortedAnos);
        setAno((prev) => prev && sortedAnos.includes(prev) ? prev : (sortedAnos[0] ?? null));
      }
      setLoadingList(false);
    })();
    return () => { cancelled = true; };
  }, [hospitalId, tabela, keyField]);

  // Carrega linhas Aurum agregadas para a seleção.
  useEffect(() => {
    if (!hospitalId || !selName || !ano) {
      setAurumRows([]);
      return;
    }
    let cancelled = false;
    setLoadingAurum(true);
    void (async () => {
      let q = supabase
        .from(tabela as unknown as never)
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("ano", ano)
        .eq(keyField, selName);
      if (carater !== "todos") q = q.eq("carater", carater);
      if (periodo !== "todos") q = q.eq("periodo_internacao", periodo);
      if (faturado !== "todos") q = q.eq("faturado", faturado === "sim");
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        toast.error(`Falha ao carregar dados: ${error.message}`);
        setAurumRows([]);
      } else {
        setAurumRows((data ?? []) as AurumRow[]);
      }
      setLoadingAurum(false);
    })();
    return () => { cancelled = true; };
  }, [hospitalId, tabela, keyField, selName, ano, carater, periodo, faturado]);

  // Busca repasse real no Exacta.
  useEffect(() => {
    if (!hospitalId || !selName || !ano) {
      setExactaRepasse(null);
      setExactaQtd(0);
      return;
    }
    let cancelled = false;
    setLoadingExacta(true);
    void (async () => {
      const start = `${ano}-01-01`;
      const end = `${ano + 1}-01-01`;
      const col = modo === "medico" ? "doctor_name" : "procedure_name";
      const { data, error } = await supabase
        .from("payment_items")
        .select("gross_amount")
        .eq("hospital_id", hospitalId)
        .eq("is_cancelled", false)
        .gte("procedure_date", start)
        .lt("procedure_date", end)
        .ilike(col, `%${selName.trim()}%`)
        .limit(50000);
      if (cancelled) return;
      if (error) {
        setExactaRepasse(null);
        setExactaQtd(0);
      } else {
        const rows = (data ?? []) as Array<{ gross_amount: number | null }>;
        setExactaRepasse(rows.length ? sumNullable(rows.map((r) => r.gross_amount)) : null);
        setExactaQtd(rows.length);
      }
      setLoadingExacta(false);
    })();
    return () => { cancelled = true; };
  }, [hospitalId, selName, ano, modo]);

  // Carrega tabela CBHPM a partir do submenu "Tabelas de Referência".
  // Busca reference_tables ativas cujo nome contenha "CBHPM" no hospital ativo
  // e agrega os itens (code/description/amount) para o auto-lookup.
  useEffect(() => {
    if (!hospitalId) {
      setCbhpmList([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: tables, error: tErr } = await supabase
        .from("reference_tables")
        .select("id,name,active,hospital_id")
        .eq("hospital_id", hospitalId)
        .eq("active", true)
        .ilike("name", "%cbhpm%");
      if (cancelled) return;
      if (tErr || !tables || tables.length === 0) {
        setCbhpmList([]);
        return;
      }
      const ids = tables.map((t) => t.id);
      const { data, error } = await supabase
        .from("reference_table_items")
        .select("code,description,amount")
        .in("reference_table_id", ids)
        .limit(50000);
      if (cancelled) return;
      if (error) {
        setCbhpmList([]);
        return;
      }
      const rows = (data ?? []) as Array<{ code: string; description: string | null; amount: number | null }>;
      setCbhpmList(
        rows
          .filter((r) => r.description && r.amount != null)
          .map((r) => ({
            codigo: r.code,
            descricao: r.description as string,
            valor_base: Number(r.amount ?? 0),
            norm: normalizeDesc(r.description as string),
          })),
      );
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  // Auto-lookup CBHPM ao selecionar procedimento.
  useEffect(() => {
    if (modo !== "procedimento" || !selName || cbhpmList.length === 0) {
      setCbhpmMatch(null);
      return;
    }
    const target = normalizeDesc(selName);
    if (!target) return;
    // Match: exato, contém, ou tokens em comum (score simples).
    let best: { item: CbhpmLookupItem; score: number } | null = null;
    const targetTokens = new Set(target.split(" ").filter((t) => t.length > 2));
    for (const item of cbhpmList) {
      let score = 0;
      if (item.norm === target) score = 1000;
      else if (item.norm.includes(target) || target.includes(item.norm)) {
        score = 500 - Math.abs(item.norm.length - target.length);
      } else if (targetTokens.size > 0) {
        const tokens = item.norm.split(" ");
        let hit = 0;
        for (const t of tokens) if (targetTokens.has(t)) hit++;
        if (hit > 0) score = hit * 10 - Math.abs(item.norm.length - target.length) * 0.01;
      }
      if (score > 0 && (!best || score > best.score)) best = { item, score };
    }
    if (best && best.score >= 20) {
      setCbhpmMatch({ codigo: best.item.codigo, descricao: best.item.descricao });
      setCbhpmBase(best.item.valor_base);
    } else {
      setCbhpmMatch(null);
    }
  }, [modo, selName, cbhpmList]);

  // Carrega cenários salvos.
  useEffect(() => {
    if (!hospitalId) {
      setCenarios([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("simulacao_cenario" as unknown as never)
        .select("id,nome,tipo,medico_nome,procedimento_nome,ano_referencia,pct_repasse,dobra_cbhpm,via_acesso_pct,volume_estimado,margem_simulada,pct_margem_simulada,created_at,parametros_json")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (!error) setCenarios((data ?? []) as CenarioSalvo[]);
    })();
    return () => { cancelled = true; };
  }, [hospitalId, cenariosTick]);

  // Agregados Aurum.
  const aur = useMemo(() => {
    if (aurumRows.length === 0) return null;
    const receita = sumNullable(aurumRows.map((r) => r.receita));
    const receitaLiq = sumNullable(aurumRows.map((r) => r.receita_liquida));
    const custoTotal = sumNullable(aurumRows.map((r) => r.custo_total));
    const custoHm = sumNullable(aurumRows.map((r) => r.custo_hm));
    const margem = sumNullable(aurumRows.map((r) => r.margem));
    const qtd = sumNullable(aurumRows.map((r) => r.qtd_cirurgias));
    const pctMargem = receitaLiq > 0 ? margem / receitaLiq : null;
    return { receita, receitaLiq, custoTotal, custoHm, margem, pctMargem, qtd };
  }, [aurumRows]);

  // Margem real (com Exacta) — só ajusta se houve repasse encontrado.
  const real = useMemo(() => {
    if (!aur || exactaRepasse == null) return null;
    const custoAjustado = aur.custoTotal - aur.custoHm + exactaRepasse;
    const margemReal = aur.receitaLiq - custoAjustado;
    const pctReal = aur.receitaLiq > 0 ? margemReal / aur.receitaLiq : null;
    return { custoAjustado, margemReal, pctReal };
  }, [aur, exactaRepasse]);

  // Cenário simulado.
  const sim = useMemo(() => {
    if (!aur) return null;
    const repasseUnit = cbhpmBase * dobra * (1 + viaAcessoPct / 100);
    const repasseSim = repasseUnit * (volume || 0);
    const custoAjustado = aur.custoTotal - aur.custoHm + repasseSim;
    const margemSim = aur.receitaLiq - custoAjustado;
    const pctSim = aur.receitaLiq > 0 ? margemSim / aur.receitaLiq : null;
    return { repasseUnit, repasseSim, custoAjustado, margemSim, pctSim };
  }, [aur, cbhpmBase, dobra, viaAcessoPct, volume]);

  const saveScenario = useCallback(async () => {
    if (!hospitalId || !aur || !selName) return;
    if (!nomeCenario.trim()) {
      toast.error("Informe um nome para o cenário.");
      return;
    }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const payload = {
        hospital_id: hospitalId,
        nome: nomeCenario.trim(),
        descricao: descCenario.trim() || null,
        tipo: modo,
        medico_nome: modo === "medico" ? selName : null,
        procedimento_nome: modo === "procedimento" ? selName : null,
        ano_referencia: ano,
        volume_estimado: volume || null,
        pct_repasse: pctRepasse,
        dobra_cbhpm: dobra,
        via_acesso_pct: viaAcessoPct,
        margem_aurum_original: aur.margem,
        pct_margem_aurum_original: aur.pctMargem,
        custo_hm_aurum: aur.custoHm,
        repasse_real_exacta: exactaRepasse,
        repasse_simulado: sim?.repasseSim ?? null,
        margem_simulada: sim?.margemSim ?? null,
        pct_margem_simulada: sim?.pctSim ?? null,
        delta_margem: sim ? sim.margemSim - aur.margem : null,
        parametros_json: {
          carater, periodo, faturado, cbhpm_base: cbhpmBase,
        },
        resultado_json: {
          aurum: aur, real, sim,
        },
        criado_por: userRes.user?.id ?? null,
      };
      const { error } = await supabase
        .from("simulacao_cenario" as unknown as never)
        .insert(payload as never);
      if (error) throw error;
      toast.success("Cenário salvo.");
      setSaveOpen(false);
      setNomeCenario("");
      setDescCenario("");
      setCenariosTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar cenário.");
    } finally {
      setSaving(false);
    }
  }, [
    hospitalId, aur, selName, nomeCenario, descCenario, modo, ano, volume,
    pctRepasse, dobra, viaAcessoPct, exactaRepasse, sim, real, carater,
    periodo, faturado, cbhpmBase,
  ]);

  const loadCenario = useCallback((c: CenarioSalvo) => {
    setModo(c.tipo);
    const nome = c.tipo === "medico" ? c.medico_nome : c.procedimento_nome;
    if (nome) setSelName(nome);
    if (c.ano_referencia) setAno(c.ano_referencia);
    if (c.pct_repasse != null) setPctRepasse(Number(c.pct_repasse));
    if (c.dobra_cbhpm != null) setDobra(Number(c.dobra_cbhpm));
    if (c.via_acesso_pct != null) setViaAcessoPct(Number(c.via_acesso_pct));
    if (c.volume_estimado != null) setVolume(Number(c.volume_estimado));
    const params = c.parametros_json ?? {};
    const cb = (params as Record<string, unknown>).cbhpm_base;
    if (typeof cb === "number") setCbhpmBase(cb);
    const kar = (params as Record<string, unknown>).carater;
    if (typeof kar === "string") setCarater(kar as Carater);
    const per = (params as Record<string, unknown>).periodo;
    if (typeof per === "string") setPeriodo(per as Periodo);
    const fat = (params as Record<string, unknown>).faturado;
    if (typeof fat === "string") setFaturado(fat as Faturado);
    toast.success(`Cenário "${c.nome}" carregado.`);
  }, []);

  const deleteCenario = useCallback(async (c: CenarioSalvo) => {
    if (!window.confirm(`Excluir o cenário "${c.nome}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase
      .from("simulacao_cenario" as unknown as never)
      .delete()
      .eq("id", c.id);
    if (error) {
      toast.error(`Falha ao excluir: ${error.message}`);
      return;
    }
    toast.success("Cenário excluído.");
    setCenariosTick((t) => t + 1);
  }, []);

  const canRender = !!aur && !!selName && !!ano;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Seleção */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seleção</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                {(["medico", "procedimento"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModo(m)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      modo === m
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Por {m === "medico" ? "Médico" : "Procedimento"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2 space-y-1.5">
                <Label>{modo === "medico" ? "Médico" : "Procedimento"}</Label>
                <Autocomplete
                  value={selName}
                  options={names}
                  onChange={setSelName}
                  placeholder={modo === "medico" ? "Buscar médico..." : "Buscar procedimento..."}
                  loading={loadingList}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ano</Label>
                <Select
                  value={ano ? String(ano) : ""}
                  onValueChange={(v) => setAno(Number(v))}
                  disabled={anos.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {anos.map((a) => (
                      <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Caráter</Label>
                <Select value={carater} onValueChange={(v) => setCarater(v as Carater)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Eletiva">Eletiva</SelectItem>
                    <SelectItem value="Urgência">Urgência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Faturado</Label>
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
          </CardContent>
        </Card>

        {!hospitalId && (
          <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Selecione um hospital ativo para carregar as bases.
          </div>
        )}

        {hospitalId && names.length === 0 && !loadingList && (
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            Sem base Aurum importada para <strong>{modo === "medico" ? "médicos" : "procedimentos"}</strong>.
            Vá para a aba <strong>Bases Aurum</strong> e faça o upload da planilha.
          </div>
        )}

        {canRender && aur && (
          <>
            {/* Cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Aurum */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Margem Aurum (HM contábil)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Receita" value={BRL(aur.receita)} />
                  <Row label="Receita líquida" value={BRL(aur.receitaLiq)} />
                  <Row label="Custo total" value={BRL(aur.custoTotal)} />
                  <div className="flex items-center justify-between rounded-md bg-yellow-50 dark:bg-yellow-950/40 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 text-yellow-800 dark:text-yellow-200">
                      <span>Custo HM</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertCircle className="h-3.5 w-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Este valor NÃO reflete o repasse real ao médico.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-medium text-yellow-900 dark:text-yellow-100">
                      {BRL(aur.custoHm)}
                    </span>
                  </div>
                  <Row label="Margem" value={BRL(aur.margem)} strong />
                  <Row label="% Margem" value={PCT(aur.pctMargem)} strong />
                  <div className="pt-1 text-xs text-muted-foreground">
                    {aur.qtd || 0} cirurgias · {aurumRows.length} linhas
                  </div>
                </CardContent>
              </Card>

              {/* Real */}
              <Card
                className={cn(
                  real && real.margemReal > aur.margem && "border-emerald-500/60",
                  real && real.margemReal < aur.margem && "border-red-500/60",
                )}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Margem Real (com repasse Exacta)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {loadingExacta ? (
                    <p className="text-muted-foreground">Carregando repasse Exacta…</p>
                  ) : exactaRepasse == null || !real ? (
                    <p className="text-sm text-muted-foreground">
                      Sem dados de repasse no Exacta para este {modo === "medico" ? "médico" : "procedimento"}.
                    </p>
                  ) : (
                    <>
                      <Row label="Receita líquida" value={BRL(aur.receitaLiq)} />
                      <Row label="Custo total ajustado" value={BRL(real.custoAjustado)} />
                      <Row
                        label="Repasse real (Exacta)"
                        value={BRL(exactaRepasse)}
                        hint={`${exactaQtd} itens`}
                      />
                      <Row label="Margem real" value={BRL(real.margemReal)} strong
                        tone={real.margemReal > aur.margem ? "up" : real.margemReal < aur.margem ? "down" : undefined}
                      />
                      <Row label="% Margem real" value={PCT(real.pctReal)} strong
                        tone={real.margemReal > aur.margem ? "up" : real.margemReal < aur.margem ? "down" : undefined}
                      />
                      <div className="pt-1 text-xs text-muted-foreground">
                        Δ vs. Aurum: {BRL(real.margemReal - aur.margem)}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Simulador */}
              <Card className="border-primary/40">
                <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Simulador de cenário
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="space-y-1.5">
                    <Label className="text-xs">% de repasse simulado</Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[pctRepasse]}
                        onValueChange={([v]) => setPctRepasse(v)}
                        min={0}
                        max={200}
                        step={1}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={pctRepasse}
                        onChange={(e) => setPctRepasse(Number(e.target.value) || 0)}
                        className="w-20"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Dobra CBHPM</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={dobra}
                        onChange={(e) => setDobra(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Via acesso (%)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={viaAcessoPct}
                        onChange={(e) => setViaAcessoPct(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        CBHPM base (R$)
                        {cbhpmMatch && (
                          <span className="ml-1 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                            · auto ({cbhpmMatch.codigo})
                          </span>
                        )}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={cbhpmBase}
                        onChange={(e) => {
                          setCbhpmBase(Number(e.target.value) || 0);
                          setCbhpmMatch(null);
                        }}
                      />
                      {cbhpmMatch && (
                        <p className="text-[10px] text-muted-foreground truncate" title={cbhpmMatch.descricao}>
                          {cbhpmMatch.descricao}
                        </p>
                      )}
                      {modo === "procedimento" && !cbhpmMatch && selName && cbhpmList.length > 0 && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">
                          Sem match CBHPM — informe o valor manualmente.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Volume (cirurgias)</Label>
                      <Input
                        type="number"
                        step="1"
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                  {sim && (
                    <div className="space-y-2 rounded-md bg-muted/50 p-2 text-sm">
                      <Row label="Repasse unit." value={BRL(sim.repasseUnit)} />
                      <Row label="Repasse simulado" value={BRL(sim.repasseSim)} />
                      <Row label="Margem simulada" value={BRL(sim.margemSim)} strong
                        tone={sim.margemSim > aur.margem ? "up" : sim.margemSim < aur.margem ? "down" : undefined}
                      />
                      <Row label="% Margem simulada" value={PCT(sim.pctSim)} strong />
                    </div>
                  )}
                  <Button
                    type="button"
                    onClick={() => setSaveOpen(true)}
                    className="w-full"
                    disabled={!sim}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar cenário
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Tabela comparativa */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparativo</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Métrica</TableHead>
                      <TableHead className="text-right">Aurum</TableHead>
                      <TableHead className="text-right">Real (Exacta)</TableHead>
                      <TableHead className="text-right">Simulado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <CompareRow label="Receita líquida"
                      a={BRL(aur.receitaLiq)} b={BRL(aur.receitaLiq)} c={BRL(aur.receitaLiq)} />
                    <CompareRow label="Custo total"
                      a={BRL(aur.custoTotal)}
                      b={real ? BRL(real.custoAjustado) : "—"}
                      c={sim ? BRL(sim.custoAjustado) : "—"} />
                    <CompareRow label="Repasse HM/Médico"
                      a={BRL(aur.custoHm)}
                      b={exactaRepasse != null ? BRL(exactaRepasse) : "—"}
                      c={sim ? BRL(sim.repasseSim) : "—"} />
                    <CompareRow label="Margem R$"
                      a={BRL(aur.margem)}
                      b={real ? BRL(real.margemReal) : "—"}
                      c={sim ? BRL(sim.margemSim) : "—"} strong />
                    <CompareRow label="% Margem"
                      a={PCT(aur.pctMargem)}
                      b={real ? PCT(real.pctReal) : "—"}
                      c={sim ? PCT(sim.pctSim) : "—"} strong />
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        {/* Cenários salvos — sempre visível quando há hospital ativo */}
        {hospitalId && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                Cenários Salvos{" "}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({cenarios.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cenarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum cenário salvo ainda. Configure uma simulação acima e clique em "Salvar cenário".
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Médico / Procedimento</TableHead>
                        <TableHead className="w-16 text-right">Ano</TableHead>
                        <TableHead className="w-24 text-right">% Repasse</TableHead>
                        <TableHead className="w-32 text-right">Margem Sim.</TableHead>
                        <TableHead className="w-32">Criado em</TableHead>
                        <TableHead className="w-32 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cenarios.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-medium">{c.nome}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {c.tipo === "medico" ? "Médico" : "Procedimento"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[240px] truncate"
                            title={c.medico_nome ?? c.procedimento_nome ?? ""}>
                            {c.medico_nome ?? c.procedimento_nome ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {c.ano_referencia ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {c.pct_repasse != null ? `${c.pct_repasse}%` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {BRL(c.margem_simulada)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(c.created_at).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => loadCenario(c)}
                                title="Carregar este cenário no simulador"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span className="ml-1 hidden sm:inline">Carregar</span>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void deleteCenario(c)}
                                title="Excluir cenário"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {loadingAurum && (
          <div className="text-center text-sm text-muted-foreground">Carregando…</div>
        )}

        {/* Dialog salvar cenário */}
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Salvar cenário</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome do cenário</Label>
                <Input
                  value={nomeCenario}
                  onChange={(e) => setNomeCenario(e.target.value)}
                  placeholder="Ex: Acordo Dr. X — 2026 (dobra 1.5)"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição (opcional)</Label>
                <Textarea
                  value={descCenario}
                  onChange={(e) => setDescCenario(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={saveScenario} disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function Row({
  label, value, strong, hint, tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  hint?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-xs opacity-70">({hint})</span>}
      </span>
      <span
        className={cn(
          strong && "font-semibold",
          tone === "up" && "text-emerald-600 dark:text-emerald-400",
          tone === "down" && "text-red-600 dark:text-red-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CompareRow({
  label, a, b, c, strong,
}: { label: string; a: string; b: string; c: string; strong?: boolean }) {
  return (
    <TableRow>
      <TableCell className={cn(strong && "font-medium")}>{label}</TableCell>
      <TableCell className={cn("text-right tabular-nums", strong && "font-semibold")}>{a}</TableCell>
      <TableCell className={cn("text-right tabular-nums", strong && "font-semibold")}>{b}</TableCell>
      <TableCell className={cn("text-right tabular-nums", strong && "font-semibold")}>{c}</TableCell>
    </TableRow>
  );
}
