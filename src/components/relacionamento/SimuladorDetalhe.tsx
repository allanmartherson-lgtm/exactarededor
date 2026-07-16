// Painel de detalhamento + simulador de cenário para uma linha comparativa.
// Renderizado abaixo da tabela em SimuladorMargem.tsx quando o usuário clica numa linha.
//
// Estrutura:
//   Seção 1: DRE (Demonstração do Resultado) da linha selecionada, somente leitura.
//   Seção 2: Formulário de simulação (percentual sobre convênio OU tabela diferenciada).
//   Seção 3: Comparativo 3 colunas (Aurum × Exacta real × Simulado) + Salvar cenário.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Save, Calculator, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface LinhaComparativaDetalhe {
  nome: string;
  ano: number;
  qtd_cirurgias: number;
  // DRE (Aurum)
  receita: number;
  impostos: number;
  glosa_externa: number;
  receita_liquida: number;
  custo_opme: number;
  custo_mat_med: number;
  custo_hm_aurum: number;
  custo_exames_img: number;
  custo_laboratorio: number;
  custo_total_aurum: number;
  outros_custos: number;
  margem_aurum: number;
  pct_margem_aurum: number;
  // Exacta
  hm_exacta_real: number | null;
  hm_exacta_expected: number;
  custo_total_recalc: number | null;
  margem_recalc: number | null;
  pct_margem_recalc: number | null;
  delta_margem: number | null;
}

type Modelo = "percentual" | "tabela_diferenciada";
type Modo = "medico" | "procedimento";

interface Props {
  linha: LinhaComparativaDetalhe;
  modo: Modo;
  hospitalId: string;
  onClose: () => void;
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

// Linha de DRE com rótulo + valor formatado. `variant` controla cor do valor.
function DreLine({
  op, label, valor, tooltip, highlight, variant, indent, bold,
}: {
  op: string;
  label: string;
  valor: number | null;
  tooltip?: string;
  highlight?: "amber";
  variant?: "positive" | "negative" | "neutral";
  indent?: boolean;
  bold?: boolean;
}) {
  const cor =
    variant === "positive"
      ? (valor ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"
      : variant === "negative"
      ? "text-red-700"
      : "text-foreground";
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 py-1 border-b border-dashed border-muted/40 last:border-0",
        indent && "pl-4",
        highlight === "amber" && "bg-amber-50 -mx-2 px-2 rounded",
      )}
      title={tooltip}
    >
      <span className="text-xs text-muted-foreground w-6 shrink-0">{op}</span>
      <span className={cn("text-sm flex-1 truncate", bold && "font-semibold")}>{label}</span>
      <span className={cn("text-sm tabular-nums", cor, bold && "font-semibold")}>{BRL(valor)}</span>
    </div>
  );
}

export function SimuladorDetalhe({ linha, modo, hospitalId, onClose }: Props) {
  const [modelo, setModelo] = useState<Modelo>("percentual");

  // Percentual sobre convênio
  const pctSugerido = useMemo(() => {
    if (linha.hm_exacta_expected > 0 && linha.hm_exacta_real != null && linha.hm_exacta_real > 0) {
      return Math.round((linha.hm_exacta_real / linha.hm_exacta_expected) * 100);
    }
    return 100;
  }, [linha.hm_exacta_real, linha.hm_exacta_expected]);
  const [pctNovo, setPctNovo] = useState<number>(pctSugerido);

  // Tabela diferenciada
  const [refTableId, setRefTableId] = useState<string>("");
  const [multiplicador, setMultiplicador] = useState<number>(1);
  const [deflator, setDeflator] = useState<number>(0);
  const [acrescimo, setAcrescimo] = useState<number>(0);
  const [refTables, setRefTables] = useState<Array<{ id: string; name: string }>>([]);
  const [salvando, setSalvando] = useState(false);
  const [simulado, setSimulado] = useState<null | {
    novo_hm: number;
    novo_custo_total: number;
    nova_margem: number;
    nova_pct_margem: number;
  }>(null);

  // Reset quando a linha muda
  useEffect(() => {
    setPctNovo(pctSugerido);
    setSimulado(null);
  }, [linha.nome, pctSugerido]);

  // Carrega tabelas de referência do hospital.
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("reference_tables")
        .select("id, name")
        .eq("hospital_id", hospitalId)
        .eq("active", true)
        .order("name");
      if (cancelled || error) return;
      setRefTables((data ?? []) as Array<{ id: string; name: string }>);
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  function calcular() {
    let novoHm = 0;
    if (modelo === "percentual") {
      if (linha.hm_exacta_expected <= 0) {
        toast.error("Base convênio (expected_amount) é zero — não é possível simular percentual.");
        return;
      }
      novoHm = linha.hm_exacta_expected * (pctNovo / 100);
    } else {
      // TODO: lookup real na reference_table_items por tuss_code do procedimento.
      // Fase atual: usa expected_amount como valor base (mesmo total do convênio).
      const valorBase = linha.hm_exacta_expected;
      if (valorBase <= 0) {
        toast.error("Sem valor base disponível para simular tabela diferenciada.");
        return;
      }
      novoHm = valorBase * multiplicador * (1 - deflator / 100) * (1 + acrescimo / 100);
    }
    const novoCustoTotal = linha.outros_custos + novoHm;
    const novaMargem = linha.receita_liquida - novoCustoTotal;
    const novaPct = linha.receita_liquida > 0 ? novaMargem / linha.receita_liquida : 0;
    setSimulado({
      novo_hm: novoHm,
      novo_custo_total: novoCustoTotal,
      nova_margem: novaMargem,
      nova_pct_margem: novaPct,
    });
  }

  async function salvarCenario() {
    if (!simulado) return;
    setSalvando(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const criadoPor = userRes.user?.id ?? null;
      const modeloLabel = modelo === "percentual" ? "% convênio" : "Tabela diferenciada";
      const payload = {
        hospital_id: hospitalId,
        nome: `${modo === "medico" ? "Médico" : "Procedimento"}: ${linha.nome} — ${modeloLabel}`,
        tipo: modo,
        medico_nome: modo === "medico" ? linha.nome : null,
        procedimento_nome: modo === "procedimento" ? linha.nome : null,
        ano_referencia: linha.ano,
        pct_repasse: modelo === "percentual" ? pctNovo : null,
        dobra_cbhpm: modelo === "tabela_diferenciada" ? multiplicador : null,
        margem_aurum_original: linha.margem_aurum,
        pct_margem_aurum_original: linha.pct_margem_aurum,
        custo_hm_aurum: linha.custo_hm_aurum,
        repasse_real_exacta: linha.hm_exacta_real,
        repasse_simulado: simulado.novo_hm,
        margem_simulada: simulado.nova_margem,
        pct_margem_simulada: simulado.nova_pct_margem,
        delta_margem: linha.margem_recalc != null ? simulado.nova_margem - linha.margem_recalc : null,
        parametros_json: {
          modelo,
          percentual: modelo === "percentual" ? pctNovo : null,
          multiplicador: modelo === "tabela_diferenciada" ? multiplicador : null,
          deflator: modelo === "tabela_diferenciada" ? deflator : null,
          acrescimo: modelo === "tabela_diferenciada" ? acrescimo : null,
          reference_table_id: modelo === "tabela_diferenciada" ? refTableId || null : null,
        },
        resultado_json: {
          novo_hm: simulado.novo_hm,
          novo_custo_total: simulado.novo_custo_total,
          nova_margem: simulado.nova_margem,
          nova_pct_margem: simulado.nova_pct_margem,
        },
        criado_por: criadoPor,
      };
      const { error } = await supabase.from("simulacao_cenario" as never).insert(payload as never);
      if (error) throw error;
      toast.success("Cenário salvo.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao salvar cenário: ${msg}`);
    } finally {
      setSalvando(false);
    }
  }

  const deltaVsExacta =
    simulado != null && linha.margem_recalc != null
      ? simulado.nova_margem - linha.margem_recalc
      : null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              {linha.nome}
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">
              {modo === "medico" ? "Médico cirurgião" : "Procedimento"} · Ano {linha.ano} · {linha.qtd_cirurgias.toLocaleString("pt-BR")} cirurgia(s)
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* SEÇÃO 1 — DRE */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            DRE — Demonstração do Resultado
          </div>
          <div className="rounded-md border p-3 bg-muted/20">
            <DreLine op="(+)" label="Receita Bruta" valor={linha.receita} />
            <DreLine op="(−)" label="Impostos" valor={-linha.impostos} variant="negative" indent />
            <DreLine op="(−)" label="Glosas Externas" valor={-linha.glosa_externa} variant="negative" indent />
            <DreLine op="(=)" label="Receita Líquida" valor={linha.receita_liquida} bold />
            <DreLine op="(−)" label="OPME" valor={-linha.custo_opme} variant="negative" indent />
            <DreLine op="(−)" label="Materiais e Medicamentos" valor={-linha.custo_mat_med} variant="negative" indent />
            <DreLine
              op="(−)"
              label="Honorários Médicos (Aurum)"
              valor={-linha.custo_hm_aurum}
              variant="negative"
              indent
              highlight="amber"
              tooltip="Valor contábil do faturamento — NÃO é o repasse real."
            />
            <DreLine
              op="(−)"
              label="Honorários Médicos (Exacta real)"
              valor={linha.hm_exacta_real != null ? -linha.hm_exacta_real : null}
              variant="negative"
              indent
              tooltip="Soma real de gross_amount pago no período."
            />
            <DreLine op="(−)" label="Exames de Imagem" valor={-linha.custo_exames_img} variant="negative" indent />
            <DreLine op="(−)" label="Laboratório" valor={-linha.custo_laboratorio} variant="negative" indent />
            <div className="mt-2 pt-2 border-t space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground w-6">(=)</span>
                <span className="text-sm flex-1 font-semibold">Margem c/ HM Aurum</span>
                <span className={cn(
                  "text-sm tabular-nums font-semibold",
                  linha.margem_aurum >= 0 ? "text-emerald-700" : "text-red-700",
                )}>
                  {BRL(linha.margem_aurum)} <span className="text-xs text-muted-foreground">({PCT(linha.pct_margem_aurum)})</span>
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground w-6">(=)</span>
                <span className="text-sm flex-1 font-semibold">Margem c/ HM Exacta</span>
                <span className={cn(
                  "text-sm tabular-nums font-semibold",
                  (linha.margem_recalc ?? 0) >= 0 ? "text-emerald-700" : "text-red-700",
                )}>
                  {BRL(linha.margem_recalc)}{" "}
                  <span className="text-xs text-muted-foreground">({PCT(linha.pct_margem_recalc)})</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2">
                <div>
                  Base Convênio (expected_amount): <span className="font-medium text-foreground">{BRL(linha.hm_exacta_expected)}</span>
                </div>
                <div className="text-right">
                  Δ Margem:{" "}
                  <span className={cn(
                    "font-medium",
                    (linha.delta_margem ?? 0) > 0 ? "text-emerald-700" : (linha.delta_margem ?? 0) < 0 ? "text-red-700" : "",
                  )}>
                    {BRL(linha.delta_margem)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 2 — Simulação */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Simular novo acordo
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-md border p-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Modelo de pagamento</Label>
              <Select value={modelo} onValueChange={(v) => { setModelo(v as Modelo); setSimulado(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">Percentual sobre convênio</SelectItem>
                  <SelectItem value="tabela_diferenciada">Tabela diferenciada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {modelo === "percentual" && (
              <>
                <div className="md:col-span-2">
                  <Label className="text-xs">Base convênio (expected_amount)</Label>
                  <Input value={BRL(linha.hm_exacta_expected)} disabled />
                </div>
                <div>
                  <Label className="text-xs">Novo percentual (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={pctNovo}
                    onChange={(e) => setPctNovo(Number(e.target.value))}
                  />
                </div>
                <div className="md:col-span-3 flex items-end">
                  <Button type="button" onClick={calcular} className="w-full md:w-auto">
                    <Calculator className="mr-1 h-3 w-3" /> Simular
                  </Button>
                </div>
              </>
            )}

            {modelo === "tabela_diferenciada" && (
              <>
                <div className="md:col-span-2">
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
                <div>
                  <Label className="text-xs">Multiplicador (x)</Label>
                  <Input type="number" step="0.1" value={multiplicador} onChange={(e) => setMultiplicador(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Deflator (%)</Label>
                  <Input type="number" step="0.1" value={deflator} onChange={(e) => setDeflator(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Acréscimo (%)</Label>
                  <Input type="number" step="0.1" value={acrescimo} onChange={(e) => setAcrescimo(Number(e.target.value))} />
                </div>
                <div className="md:col-span-4">
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Nesta fase, o valor base usa o <strong>expected_amount</strong> (convênio). O lookup direto por TUSS na <em>reference_table_items</em> entra na próxima etapa.</span>
                  </div>
                  <Button type="button" onClick={calcular}>
                    <Calculator className="mr-1 h-3 w-3" /> Simular
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* SEÇÃO 3 — Resultado */}
        {simulado && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Comparativo do cenário
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ResultCard title="HM Aurum (contábil)" tone="neutral">
                <ResultRow label="Honorários" v={linha.custo_hm_aurum} />
                <ResultRow label="Custo Total" v={linha.custo_total_aurum} />
                <ResultRow label="Margem (R$)" v={linha.margem_aurum} bold />
                <ResultRow label="Margem (%)" v={linha.pct_margem_aurum} pct />
              </ResultCard>
              <ResultCard title="HM Exacta (real)" tone="neutral">
                <ResultRow label="Honorários" v={linha.hm_exacta_real} />
                <ResultRow label="Custo Total" v={linha.custo_total_recalc} />
                <ResultRow label="Margem (R$)" v={linha.margem_recalc} bold />
                <ResultRow label="Margem (%)" v={linha.pct_margem_recalc} pct />
              </ResultCard>
              <ResultCard
                title="Cenário Simulado"
                tone={
                  linha.margem_recalc != null && simulado.nova_margem > linha.margem_recalc
                    ? "good"
                    : linha.margem_recalc != null && simulado.nova_margem < linha.margem_recalc
                    ? "bad"
                    : "neutral"
                }
              >
                <ResultRow label="Honorários" v={simulado.novo_hm} />
                <ResultRow label="Custo Total" v={simulado.novo_custo_total} />
                <ResultRow label="Margem (R$)" v={simulado.nova_margem} bold />
                <ResultRow label="Margem (%)" v={simulado.nova_pct_margem} pct />
                <div className="flex items-baseline gap-2 pt-2 mt-1 border-t">
                  <span className="text-xs text-muted-foreground flex-1">Δ vs Exacta Real</span>
                  <span className={cn(
                    "text-sm tabular-nums font-semibold",
                    (deltaVsExacta ?? 0) > 0 ? "text-emerald-700" : (deltaVsExacta ?? 0) < 0 ? "text-red-700" : "",
                  )}>
                    {BRL(deltaVsExacta)}
                  </span>
                </div>
              </ResultCard>
            </div>
            <div className="flex justify-end mt-3">
              <Button type="button" onClick={salvarCenario} disabled={salvando}>
                <Save className="mr-1 h-3 w-3" /> {salvando ? "Salvando…" : "Salvar cenário"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultCard({
  title, tone, children,
}: {
  title: string;
  tone: "good" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const border =
    tone === "good" ? "border-emerald-300 bg-emerald-50/40"
    : tone === "bad" ? "border-red-300 bg-red-50/40"
    : "border-muted";
  return (
    <div className={cn("rounded-md border p-3 space-y-1", border)}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function ResultRow({ label, v, bold, pct }: { label: string; v: number | null; bold?: boolean; pct?: boolean }) {
  const fmt = pct
    ? (v == null || !Number.isFinite(v) ? "—" : `${(Math.abs(v) < 1 ? v * 100 : v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)
    : BRL(v);
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={cn("text-sm tabular-nums", bold && "font-semibold")}>{fmt}</span>
    </div>
  );
}
