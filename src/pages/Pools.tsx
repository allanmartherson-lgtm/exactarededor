import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Pencil, Calculator, ArrowUp, ArrowDown, X, CalendarRange, Filter } from "lucide-react";
import { toast } from "sonner";
import { CompanyCombobox } from "@/components/CompanyCombobox";
import { Link } from "react-router-dom";

type FiltrosCaptura = {
  tipo_ato_ids?: string[];
  setor_slugs?: string[];
  convenio_slugs?: string[];
  funcoes?: string[];
  doctor_include_ids?: string[];
  doctor_exclude_ids?: string[];
};

type Pool = {
  id: string;
  nome: string;
  descricao: string | null;
  base_calculo: "soma_convenio_100" | "soma_expected" | "soma_bruto";
  ativo: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  escopo_producao: "participantes" | "filtrado";
  filtros_captura: FiltrosCaptura;
  garante_piso?: boolean;
  piso_valor?: number | null;
};
type Deduction = {
  id?: string;
  pool_id?: string;
  ordem: number;
  tipo: "fixo_mensal" | "plantao" | "ajuste_credito" | "ajuste_debito" | "glosa_parcelada" | "valor_referencia_externa";
  descricao: string;
  valor: number | null;
  company_id: string | null;
  obrigatoria: boolean;
  valor_variavel: boolean;
};
type Participant = {
  id?: string;
  pool_id?: string;
  participant_type: "company" | "hospital_nao_paga";
  company_id: string | null;
  percentual: number;
  ordem_exibicao: number;
  _label?: string;
};
type Company = { id: string; name: string };


const BASE_LABELS: Record<string, string> = {
  soma_convenio_100: "Soma 100% convênio",
  soma_expected: "Soma de valor esperado (pós-regras)",
  soma_bruto: "Soma de valor bruto",
};
const DED_LABELS: Record<string, string> = {
  fixo_mensal: "Fixo mensal",
  plantao: "Plantão",
  ajuste_credito: "Ajuste — crédito",
  ajuste_debito: "Ajuste — débito",
  glosa_parcelada: "Glosa parcelada",
  valor_referencia_externa: "Valor referência externa",
};

import { useHospital } from "@/contexts/HospitalContext";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";

export default function Pools({ embedded = false }: { embedded?: boolean } = {}) {
  const { hospital, switching: hospitalSwitching } = useHospital();
  const activeHospitalId = hospital?.id ?? null;
  const [pools, setPools] = useState<Pool[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Pool | null>(null);
  const [editDeds, setEditDeds] = useState<Deduction[]>([]);
  const [editParts, setEditParts] = useState<Participant[]>([]);
  const [showPoolDialog, setShowPoolDialog] = useState(false);
  const [filtrosRaw, setFiltrosRaw] = useState<Record<string, string>>({});

  const parseCsv = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
  const bindFiltro = (key: "tipo_ato_ids" | "setor_slugs" | "convenio_slugs" | "funcoes" | "doctor_include_ids" | "doctor_exclude_ids") => ({
    value: filtrosRaw[key] ?? ((editing?.filtros_captura as any)?.[key] ?? []).join(", "),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setFiltrosRaw(prev => ({ ...prev, [key]: raw }));
      setEditing(ed => ed ? { ...ed, filtros_captura: { ...ed.filtros_captura, [key]: parseCsv(raw) } } : ed);
    },
  });

  const loadAll = async () => {
    setLoading(true);
    const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
    const [p, companiesAll] = await Promise.all([
      supabase.from("pools").select("*").order("created_at", { ascending: false }),
      fetchAllPaginated<{ id: string; name: string }>((from, to) =>
        supabase.from("companies").select("id, name").order("name").range(from, to),
      ),
    ]);
    setPools((p.data || []) as Pool[]);
    setCompanies(companiesAll.filter(c => !c.name.trim().toUpperCase().startsWith("__E2E")));
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const openPool = async (pool: Pool | null) => {
    setEditing(pool ? { ...pool, filtros_captura: pool.filtros_captura ?? {} } : {
      id: "", nome: "", descricao: "", base_calculo: "soma_convenio_100",
      ativo: true, vigencia_inicio: null, vigencia_fim: null,
      escopo_producao: "participantes", filtros_captura: {},
      garante_piso: false, piso_valor: null,
    });
    setFiltrosRaw({});
    if (pool?.id) {
      const [d, pp] = await Promise.all([
        supabase.from("pool_deductions").select("*").eq("pool_id", pool.id).order("ordem"),
        supabase.from("pool_participants").select("*").eq("pool_id", pool.id).order("ordem_exibicao"),
      ]);
      setEditDeds(((d.data || []) as any[]).map((x) => ({ ...x, valor_variavel: !!x.valor_variavel })) as Deduction[]);
      const cMap = new Map(companies.map(c => [c.id, c.name]));
      setEditParts(((pp.data || []) as Participant[]).map(x => ({
        ...x, _label: x.participant_type === "hospital_nao_paga" ? "Hospital (não paga)" : (x.company_id ? cMap.get(x.company_id) : ""),
      })));
    } else {
      setEditDeds([]);
      setEditParts([]);
    }
    setShowPoolDialog(true);
  };

  const sumPct = useMemo(() => editParts.reduce((s, p) => s + (Number(p.percentual) || 0), 0), [editParts]);

  const savePool = async () => {
    if (!editing) return;
    if (!editing.nome.trim()) { toast.error("Nome obrigatório"); return; }
    if (Math.round(sumPct * 100) !== 10000) { toast.error("Soma dos percentuais deve ser 100"); return; }
    if (!hospital?.id) { toast.error("Selecione uma unidade hospitalar antes de criar um pool."); return; }
    const hospitalId = hospital.id;

    let poolId = editing.id;
    if (!poolId) {
      const { data, error } = await supabase.from("pools").insert({
        hospital_id: hospitalId,
        nome: editing.nome, descricao: editing.descricao, base_calculo: editing.base_calculo,
        ativo: editing.ativo, vigencia_inicio: editing.vigencia_inicio, vigencia_fim: editing.vigencia_fim,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      poolId = data.id;
    } else {
      const { error } = await supabase.from("pools").update({
        nome: editing.nome, descricao: editing.descricao, base_calculo: editing.base_calculo,
        ativo: editing.ativo, vigencia_inicio: editing.vigencia_inicio, vigencia_fim: editing.vigencia_fim,
      }).eq("id", poolId);
      if (error) { toast.error(error.message); return; }
    }

    // Normaliza filtros antes de persistir: trim, dedupe, lowercase em slugs.
    const normList = (arr: any, lower = false): string[] => {
      if (!Array.isArray(arr)) return [];
      const out = arr
        .flatMap((v: any) => String(v ?? "").split(","))
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => (lower ? s.toLowerCase() : s));
      return Array.from(new Set(out));
    };
    const fc = (editing.filtros_captura ?? {}) as any;
    const filtrosNorm = {
      tipo_ato_ids: normList(fc.tipo_ato_ids),
      setor_slugs: normList(fc.setor_slugs, true),
      convenio_slugs: normList(fc.convenio_slugs, true),
      funcoes: normList(fc.funcoes),
      doctor_include_ids: normList(fc.doctor_include_ids),
      doctor_exclude_ids: normList(fc.doctor_exclude_ids),
    };
    // Salva escopo + filtros (separado para não quebrar caso o type ainda não esteja regenerado)
    await supabase.from("pools").update({
      escopo_producao: editing.escopo_producao ?? "participantes",
      filtros_captura: filtrosNorm,
      garante_piso: !!editing.garante_piso,
      piso_valor: editing.garante_piso ? (Number(editing.piso_valor) || 0) : null,
    } as any).eq("id", poolId);

    await supabase.from("pool_deductions").delete().eq("pool_id", poolId);
    if (editDeds.length) {
      const rows = editDeds.map((d, i) => ({
        hospital_id: hospitalId,
        pool_id: poolId, ordem: i, tipo: d.tipo, descricao: d.descricao,
        valor: d.valor_variavel ? null : d.valor, company_id: d.company_id,
        obrigatoria: d.obrigatoria, valor_variavel: d.valor_variavel,
      }));
      const { error } = await supabase.from("pool_deductions").insert(rows as any);
      if (error) { toast.error(error.message); return; }
    }

    await supabase.from("pool_participants").delete().eq("pool_id", poolId);
    if (editParts.length) {
      const rows = editParts.map((p, i) => ({
        hospital_id: hospitalId,
        pool_id: poolId, participant_type: p.participant_type,
        company_id: p.participant_type === "company" ? p.company_id : null,
        percentual: p.percentual, ordem_exibicao: i,
      }));
      const { error } = await supabase.from("pool_participants").insert(rows);
      if (error) { toast.error(error.message); return; }
    }

    toast.success("Pool salvo");
    setShowPoolDialog(false);
    setEditing(null);
    loadAll();
  };

  const removePool = async (id: string) => {
    if (!confirm("Excluir este pool?")) return;
    const { error } = await supabase.from("pools").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pool excluído");
    loadAll();
  };

  // --- Simulador ---
  const [simBase, setSimBase] = useState<string>("");
  const simBolo = useMemo(() => {
    const b = parseFloat(simBase) || 0;
    let dedTotal = 0;
    const lines = editDeds.map(d => ({ desc: d.descricao || DED_LABELS[d.tipo], val: Number(d.valor) || 0 }));
    dedTotal = lines.reduce((s, l) => s + l.val, 0);
    const liquido = b - dedTotal;
    const quotas = editParts.map(p => ({
      label: p._label || (p.participant_type === "hospital_nao_paga" ? "Hospital (não paga)" : "—"),
      tipo: p.participant_type, pct: p.percentual, val: liquido * (Number(p.percentual) || 0) / 100,
    }));
    return { b, lines, dedTotal, liquido, quotas };
  }, [simBase, editDeds, editParts]);




  return (
    <div className={embedded ? "space-y-6" : "space-y-6"}>
      {!embedded && (
        <PageHeader
          title="Pools de rateio"
          description="Configure rateio de produção entre empresas e ajustes financeiros recorrentes."
        />
      )}

      <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openPool(null)}><Plus className="w-4 h-4 mr-1" /> Novo pool</Button>
          </div>
          {loading ? <p>Carregando…</p> : pools.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum pool cadastrado.</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {pools.map(p => (
                <Card key={p.id}>
                  <CardContent className="flex justify-between items-center py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.nome}</span>
                        {p.ativo ? <Badge variant="default">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{BASE_LABELS[p.base_calculo]} · {p.descricao || "—"}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/pools/${p.id}/valores-mensais`}>Valores mensais</Link>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openPool(p)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removePool(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
      </div>


      {/* ===== Dialog Pool ===== */}
      <Dialog open={showPoolDialog} onOpenChange={setShowPoolDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar pool" : "Novo pool"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome</Label>
                  <Input value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} placeholder="Infecto BSB — split hospital" />
                </div>
                <div>
                  <Label>Base de cálculo</Label>
                  <Select value={editing.base_calculo} onValueChange={(v: any) => setEditing({ ...editing, base_calculo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(BASE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Descrição</Label>
                  <Textarea value={editing.descricao || ""} onChange={e => setEditing({ ...editing, descricao: e.target.value })} rows={2} />
                </div>
                <div>
                  <Label>Vigência início</Label>
                  <DateInput value={editing.vigencia_inicio || ""} onChange={(v) => setEditing({ ...editing, vigencia_inicio: v || null })} />
                </div>
                <div>
                  <Label>Vigência fim</Label>
                  <DateInput value={editing.vigencia_fim || ""} onChange={(v) => setEditing({ ...editing, vigencia_fim: v || null })} />
                </div>
                <div className="flex items-center gap-2 col-span-2">
                  <Switch checked={editing.ativo} onCheckedChange={v => setEditing({ ...editing, ativo: v })} />
                  <Label>Ativo</Label>
                </div>
              </div>

              {/* Mínimo garantido por participante */}
              <div className="border rounded-md p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base">Mínimo garantido por participante</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Quando ativo, cada participante real (PJ) tem a quota elevada até o piso. A diferença é bancada pelo hospital e fica registrada no run como complemento.
                    </p>
                  </div>
                  <Switch
                    checked={!!editing.garante_piso}
                    onCheckedChange={v => setEditing({ ...editing, garante_piso: v })}
                  />
                </div>
                {editing.garante_piso && (
                  <div className="max-w-xs">
                    <Label>Piso por participante (R$)</Label>
                    <CurrencyInput
                      value={editing.piso_valor}
                      onChange={(v) => setEditing({ ...editing, piso_valor: v })}
                      placeholder="R$ 25.000,00"
                    />
                  </div>
                )}
              </div>



              {/* Escopo de produção */}
              <div className="border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  <Label className="text-base">Escopo de produção</Label>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="escopo"
                      checked={(editing.escopo_producao ?? "participantes") === "participantes"}
                      onChange={() => setEditing({ ...editing, escopo_producao: "participantes" })}
                    />
                    Produção das empresas participantes (padrão)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="escopo"
                      checked={editing.escopo_producao === "filtrado"}
                      onChange={() => setEditing({ ...editing, escopo_producao: "filtrado" })}
                    />
                    Captura por filtro (ignora empresa do médico)
                  </label>
                </div>
                {editing.escopo_producao === "filtrado" && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="col-span-2 text-xs text-muted-foreground">
                      Liste valores separados por vírgula. Use slugs/IDs conforme cadastrado. Itens que casarem com TODOS os filtros serão absorvidos pelo pool.
                    </div>
                    <div>
                      <Label className="text-xs">Slugs de tipo de ato (separados por vírgula)</Label>
                      <Input
                        {...bindFiltro("tipo_ato_ids")}
                        placeholder="ex: <uuid do payment_type 'visita'>"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Setores (slugs)</Label>
                      <Input
                        {...bindFiltro("setor_slugs")}
                        placeholder="ex: cti-adulto, uti-coronariana"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Convênios (slugs)</Label>
                      <Input
                        {...bindFiltro("convenio_slugs")}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Funções no ato</Label>
                      <Input
                        {...bindFiltro("funcoes")}
                        placeholder="ex: Visita, Parecer"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">IDs de médicos a INCLUIR (vazio = todos)</Label>
                      <Input
                        {...bindFiltro("doctor_include_ids")}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">IDs de médicos a EXCLUIR</Label>
                      <Input
                        {...bindFiltro("doctor_exclude_ids")}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Deduções */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-base">Deduções (aplicadas em ordem)</Label>
                  <div className="flex gap-2">
                    {editing.id && editDeds.some(d => d.valor_variavel) && (
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/pools/${editing.id}/valores-mensais`}>
                          <CalendarRange className="w-4 h-4 mr-1" /> Valores mensais
                        </Link>
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditDeds([...editDeds, { ordem: editDeds.length, tipo: "fixo_mensal", descricao: "", valor: 0, company_id: null, obrigatoria: true, valor_variavel: false }])}>
                      <Plus className="w-4 h-4 mr-1" />Dedução
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {editDeds.map((d, i) => (
                    <Card key={i}><CardContent className="py-3 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <Label className="text-xs">Tipo</Label>
                        <Select value={d.tipo} onValueChange={(v: any) => {
                          const n = [...editDeds];
                          // Auto-vincula natureza do valor ao tipo:
                          // plantão sempre varia por competência; fixo mensal por padrão é recorrente.
                          // Ajustes/glosa vêm de tabelas externas — força recorrente=false.
                          const autoVariavel = v === "plantao" ? true : v === "fixo_mensal" ? false : false;
                          n[i] = { ...d, tipo: v, valor_variavel: autoVariavel, valor: autoVariavel ? null : (d.valor ?? 0) };
                          setEditDeds(n);
                        }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(DED_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs">Descrição</Label>
                        <Input value={d.descricao} onChange={e => { const n = [...editDeds]; n[i] = { ...d, descricao: e.target.value }; setEditDeds(n); }} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Valor (R$)</Label>
                        {d.valor_variavel ? (
                          <div className="h-9 flex items-center px-3 border rounded-md bg-muted text-xs text-muted-foreground">por competência</div>
                        ) : (
                          <CurrencyInput value={d.valor} onChange={(v) => { const n = [...editDeds]; n[i] = { ...d, valor: v }; setEditDeds(n); }} />
                        )}
                      </div>
                      <div className="col-span-1 flex flex-col items-center pb-1">
                        <Label className="text-[10px] text-center leading-tight" title="Ligado: valor muda mês a mês (plantão, escala). Desligado: mesmo valor todo mês (fixo de coordenação).">
                          Varia/mês
                        </Label>
                        <Switch
                          checked={d.valor_variavel}
                          disabled={d.tipo === "plantao"}
                          onCheckedChange={(v) => { const n = [...editDeds]; n[i] = { ...d, valor_variavel: v, valor: v ? null : (d.valor ?? 0) }; setEditDeds(n); }}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Empresa origem</Label>
                        <div className="flex gap-1 items-center">
                          <CompanyCombobox
                            value={d.company_id ? { id: d.company_id, name: companies.find(c => c.id === d.company_id)?.name ?? "", document: null } : null}
                            onChange={(c) => { const n = [...editDeds]; n[i] = { ...d, company_id: c?.id ?? null }; setEditDeds(n); }}
                            placeholder="—"
                          />
                          {d.company_id && (
                            <Button size="icon" variant="ghost" onClick={() => { const n = [...editDeds]; n[i] = { ...d, company_id: null }; setEditDeds(n); }}><X className="w-3 h-3" /></Button>
                          )}
                        </div>
                      </div>
                      <div className="col-span-1 flex gap-1">
                        {i > 0 && <Button size="icon" variant="ghost" onClick={() => { const n = [...editDeds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setEditDeds(n); }}><ArrowUp className="w-3 h-3" /></Button>}
                        {i < editDeds.length - 1 && <Button size="icon" variant="ghost" onClick={() => { const n = [...editDeds]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setEditDeds(n); }}><ArrowDown className="w-3 h-3" /></Button>}
                        <Button size="icon" variant="ghost" onClick={() => setEditDeds(editDeds.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              </div>

              {/* Participantes */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-base">Participantes — soma <span className={Math.round(sumPct * 100) === 10000 ? "text-green-600" : "text-destructive"}>{sumPct.toFixed(2)}%</span></Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditParts([...editParts, { participant_type: "company", company_id: null, percentual: 0, ordem_exibicao: editParts.length }])}>
                      <Plus className="w-4 h-4 mr-1" />Empresa
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditParts([...editParts, { participant_type: "hospital_nao_paga", company_id: null, percentual: 0, ordem_exibicao: editParts.length, _label: "Hospital (não paga)" }])}>
                      <Plus className="w-4 h-4 mr-1" />Hospital (não paga)
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {editParts.map((p, i) => (
                    <Card key={i}><CardContent className="py-3 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-7">
                        <Label className="text-xs">Participante</Label>
                        {p.participant_type === "hospital_nao_paga" ? (
                          <div className="h-9 flex items-center px-3 border rounded-md bg-muted text-sm">Hospital (não paga) — sentinela informativa</div>
                        ) : (
                          <CompanyCombobox
                            value={p.company_id ? { id: p.company_id, name: companies.find(c => c.id === p.company_id)?.name ?? p._label ?? "", document: null } : null}
                            onChange={(c) => { const n = [...editParts]; n[i] = { ...p, company_id: c?.id ?? null, _label: c?.name }; setEditParts(n); }}
                            placeholder="Selecione…"
                          />
                        )}
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs">Percentual (%)</Label>
                        <PercentInput value={p.percentual} onChange={(v) => { const n = [...editParts]; n[i] = { ...p, percentual: v ?? 0 }; setEditParts(n); }} />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <Button size="icon" variant="ghost" onClick={() => setEditParts(editParts.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              </div>

              {/* Simulador */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Simulador</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label>Base ({BASE_LABELS[editing.base_calculo]})</Label>
                      <CurrencyInput value={simBase ? Number(simBase) : null} onChange={(v) => setSimBase(v == null ? "" : String(v))} placeholder="R$ 115.332,19" />
                    </div>
                  </div>
                  {simBase && (
                    <div className="text-sm font-mono space-y-1 pt-2 border-t">
                      <div className="flex justify-between"><span>Base</span><span>R$ {simBolo.b.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      {simBolo.lines.map((l, i) => <div key={i} className="flex justify-between text-muted-foreground"><span>(−) {l.desc}</span><span>−R$ {l.val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>)}
                      <div className="flex justify-between font-semibold border-t pt-1"><span>Bolo líquido</span><span>R$ {simBolo.liquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      <div className="pt-2 border-t">Rateio:</div>
                      {simBolo.quotas.map((q, i) => (
                        <div key={i} className={`flex justify-between ${q.tipo === "hospital_nao_paga" ? "text-muted-foreground italic" : ""}`}>
                          <span>{q.label} ({q.pct}%){q.tipo === "hospital_nao_paga" ? " — receita hospital (não paga)" : ""}</span>
                          <span>R$ {q.val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPoolDialog(false)}>Cancelar</Button>
            <Button onClick={savePool}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
