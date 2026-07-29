// Hub de Hospitais — visão completa por hospital.
// Lista de hospitais + detalhe com sub-abas: Dados cadastrais, Piso de repasse,
// Reaprovação, Módulo de fluxo. Todas as sub-abas de configuração leem/gravam a
// mesma linha em hospital_settings (upsert por hospital_id).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Plus, ChevronRight, ArrowLeft, Save, ShieldCheck, RotateCcw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useHospital, type Hospital } from "@/contexts/HospitalContext";

const UF_LIST = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type SubTab = "cadastro" | "piso" | "reaprovacao" | "workflow";
const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "cadastro", label: "Dados cadastrais" },
  { value: "piso", label: "Piso de repasse" },
  { value: "reaprovacao", label: "Reaprovação" },
  { value: "workflow", label: "Módulo de fluxo" },
];
const VALID_SUB = new Set(SUB_TABS.map((t) => t.value));

export default function HospitaisHub() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const rawSub = params.get("sub") as SubTab | null;
  const sub: SubTab = rawSub && VALID_SUB.has(rawSub) ? rawSub : "cadastro";

  useEffect(() => { document.title = "Hospitais | Exacta"; }, []);

  const setId = (nextId: string | null, nextSub: SubTab = "cadastro") => {
    const next = new URLSearchParams(params);
    if (nextId) { next.set("id", nextId); next.set("sub", nextSub); }
    else { next.delete("id"); next.delete("sub"); }
    setParams(next, { replace: true });
  };
  const setSub = (v: SubTab) => {
    const next = new URLSearchParams(params);
    next.set("sub", v);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Hospitais"
        description="Cadastro completo de cada hospital: dados, piso de repasse, reaprovação e módulo de fluxo — tudo num só lugar."
        icon={Building2}
      />
      <div className="p-4 md:p-6 space-y-6">
        {!id ? (
          <HospitalsList onSelect={(hid) => setId(hid, "cadastro")} />
        ) : (
          <HospitalDetail hospitalId={id} sub={sub} onSubChange={setSub} onBack={() => setId(null)} />
        )}
      </div>
    </div>
  );
}

// ------------------------------ Lista ------------------------------

function HospitalsList({ onSelect }: { onSelect: (id: string) => void }) {
  const { refresh } = useHospital();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", state_uf: "DF", cnpj: "", active: true });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("hospitals").select("*").order("name");
    if (error) toast.error(error.message);
    setHospitals((data ?? []) as Hospital[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!form.slug.trim() || !form.name.trim() || !form.state_uf) {
      toast.error("slug, nome e UF são obrigatórios");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("hospitals").insert({
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      state_uf: form.state_uf.toUpperCase(),
      cnpj: form.cnpj.trim() || null,
      active: form.active,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Hospital criado");
    setOpen(false);
    setForm({ slug: "", name: "", state_uf: "DF", cnpj: "", active: true });
    await load();
    await refresh();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Hospitais cadastrados</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Novo hospital</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo hospital</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="slug">Slug (identificador técnico)</Label>
                <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="ex.: rd_brasilia" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex.: Hospital DF Star" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="uf">UF</Label>
                  <select id="uf" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.state_uf} onChange={(e) => setForm({ ...form, state_uf: e.target.value })}>
                    {UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cnpj">CNPJ (opcional)</Label>
                  <Input id="cnpj" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="active">Ativo</Label>
                <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : hospitals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum hospital cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>UF</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hospitals.map((h) => (
                <TableRow key={h.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelect(h.id)}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell className="font-mono text-xs">{h.slug}</TableCell>
                  <TableCell>{h.state_uf}</TableCell>
                  <TableCell className="font-mono text-xs">{h.cnpj ?? "—"}</TableCell>
                  <TableCell>
                    <span className={h.active ? "text-emerald-600" : "text-muted-foreground"}>
                      {h.active ? "Ativo" : "Inativo"}
                    </span>
                  </TableCell>
                  <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------ Detalhe ------------------------------

function HospitalDetail({ hospitalId, sub, onSubChange, onBack }: {
  hospitalId: string;
  sub: SubTab;
  onSubChange: (s: SubTab) => void;
  onBack: () => void;
}) {
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("hospitals").select("*").eq("id", hospitalId).maybeSingle();
      if (!cancelled) {
        if (error) toast.error(error.message);
        setHospital((data ?? null) as Hospital | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  const content = useMemo(() => {
    if (!hospital) return null;
    switch (sub) {
      case "cadastro": return <CadastroTab hospital={hospital} onUpdated={setHospital} />;
      case "piso": return <PisoTab hospitalId={hospital.id} />;
      case "reaprovacao": return <ReaprovacaoTab hospitalId={hospital.id} />;
      case "workflow": return <WorkflowTab hospitalId={hospital.id} />;
    }
  }, [hospital, sub]);

  if (loading) return <p className="text-sm text-muted-foreground">Carregando hospital…</p>;
  if (!hospital) return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1"><ArrowLeft className="h-4 w-4" /> Voltar</Button>
      <p className="text-sm text-muted-foreground">Hospital não encontrado.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Todos os hospitais
        </Button>
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{hospital.name}</h2>
          <span className="text-xs text-muted-foreground font-mono">{hospital.slug} · {hospital.state_uf}</span>
          {!hospital.active && <span className="text-xs text-muted-foreground">(inativo)</span>}
        </div>
      </div>

      <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Seções do hospital">
        {SUB_TABS.map((item) => {
          const isActive = sub === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onSubChange(item.value)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
              aria-pressed={isActive}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {content}
    </div>
  );
}

// ------------------------------ Sub-abas ------------------------------

function CadastroTab({ hospital, onUpdated }: { hospital: Hospital; onUpdated: (h: Hospital) => void }) {
  const { refresh } = useHospital();
  const [name, setName] = useState(hospital.name);
  const [stateUf, setStateUf] = useState(hospital.state_uf);
  const [cnpj, setCnpj] = useState(hospital.cnpj ?? "");
  const [active, setActive] = useState(hospital.active);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !stateUf) { toast.error("Nome e UF são obrigatórios"); return; }
    setSaving(true);
    const payload = { name: name.trim(), state_uf: stateUf.toUpperCase(), cnpj: cnpj.trim() || null, active };
    const { data, error } = await supabase.from("hospitals").update(payload).eq("id", hospital.id).select().maybeSingle();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (data) onUpdated(data as Hospital);
    toast.success("Hospital atualizado");
    await refresh();
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5 max-w-2xl">
        <div className="grid gap-1.5">
          <Label>Slug (identificador técnico)</Label>
          <Input value={hospital.slug} disabled />
          <p className="text-[11px] text-muted-foreground">O slug é imutável após a criação.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="uf">UF</Label>
            <select id="uf" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={stateUf} onChange={(e) => setStateUf(e.target.value)}>
              {UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cnpj">CNPJ (opcional)</Label>
            <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="active">Ativo</Label>
            <p className="text-[11px] text-muted-foreground">Hospitais inativos não aparecem no seletor.</p>
          </div>
          <Switch id="active" checked={active} onCheckedChange={setActive} />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Loader/upserter comum para hospital_settings
function useHospitalSettings<K extends string>(hospitalId: string, columns: readonly K[]) {
  const [values, setValues] = useState<Partial<Record<K, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const cols = columns.join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("hospital_settings")
        .select(cols)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!cancelled) {
        if (error && error.code !== "PGRST116") toast.error(error.message);
        setValues((data ?? {}) as Partial<Record<K, unknown>>);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId, cols]);

  const upsert = async (patch: Partial<Record<K, unknown>>) => {
    const { error } = await supabase
      .from("hospital_settings")
      .upsert({ hospital_id: hospitalId, ...patch }, { onConflict: "hospital_id" });
    if (error) throw error;
  };

  return { values, loading, upsert, setValues };
}

function PisoTab({ hospitalId }: { hospitalId: string }) {
  const { values, loading, upsert } = useHospitalSettings(hospitalId, ["min_payout_pct", "min_payout_brl"] as const);
  const [pct, setPct] = useState<number>(0);
  const [brl, setBrl] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (values) {
      setPct(Number(values.min_payout_pct ?? 0));
      setBrl(Number(values.min_payout_brl ?? 0));
    }
  }, [values]);

  const save = async () => {
    if (pct < 0 || pct > 100) { toast.error("Percentual deve estar entre 0 e 100."); return; }
    if (brl < 0) { toast.error("Valor mínimo não pode ser negativo."); return; }
    setSaving(true);
    try {
      await upsert({ min_payout_pct: pct, min_payout_brl: brl });
      toast.success("Piso de repasse salvo. Novas aplicações já respeitam a regra.");
    } catch (err) {
      toast.error(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const exemplo10k = Math.max(10000 * (pct / 100), brl);
  const exemplo1500 = Math.max(1500 * (pct / 100), brl);

  return (
    <Card>
      <CardContent className="p-6 space-y-5 max-w-3xl">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Nunca descontar glosas ao ponto de zerar o líquido da PJ. A cada aplicação, o motor calcula:
            <div className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">
              piso = max( <span className="text-primary">percentual</span> × líquido do lote, <span className="text-primary">valor mínimo</span> )<br />
              capacidade de desconto = líquido − piso
            </div>
            Se a glosa não coube na capacidade, a tela de Créditos e Débitos oferece <strong>parcelar</strong> ou <strong>adiar</strong> — nada é aplicado silenciosamente.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pct">Percentual do líquido a preservar (%)</Label>
            <Input id="pct" type="number" min={0} max={100} step={1}
              value={pct} onChange={(e) => setPct(Number(e.target.value))}
              disabled={loading || saving} />
            <p className="text-[11px] text-muted-foreground">Ex.: 20% preserva sempre 1/5 do líquido.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brl">Valor mínimo em R$ a preservar</Label>
            <Input id="brl" type="number" min={0} step={50}
              value={brl} onChange={(e) => setBrl(Number(e.target.value))}
              disabled={loading || saving} />
            <p className="text-[11px] text-muted-foreground">Ex.: R$ 500 garante NF mínima mesmo em lote pequeno.</p>
          </div>
        </div>

        <div className="rounded-md border p-3 text-xs text-muted-foreground bg-muted/40">
          <div className="font-medium text-foreground mb-1.5">Simulação com estes valores</div>
          <div>Líquido de R$ 10.000 → preservados <strong className="text-foreground">R$ {exemplo10k.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> · capacidade <strong className="text-foreground">R$ {(10000 - exemplo10k).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
          <div>Líquido de R$ 1.500 → preservados <strong className="text-foreground">R$ {exemplo1500.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> · capacidade <strong className="text-foreground">R$ {Math.max(0, 1500 - exemplo1500).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={loading || saving} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar piso"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Piso 0/0 significa "sem piso" — glosa pode zerar o líquido (comportamento antigo).
        </p>
      </CardContent>
    </Card>
  );
}

function ReaprovacaoTab({ hospitalId }: { hospitalId: string }) {
  const { values, loading, upsert } = useHospitalSettings(
    hospitalId,
    ["reapproval_threshold_pct", "reapproval_threshold_brl", "reapproval_require_reason"] as const,
  );
  const [pct, setPct] = useState<number>(0);
  const [brl, setBrl] = useState<number>(0.01);
  const [requireReason, setRequireReason] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (values) {
      setPct(Number(values.reapproval_threshold_pct ?? 0));
      setBrl(Number(values.reapproval_threshold_brl ?? 0.01));
      setRequireReason(Boolean(values.reapproval_require_reason ?? true));
    }
  }, [values]);

  const save = async () => {
    if (pct < 0 || pct > 100) { toast.error("Percentual deve estar entre 0 e 100."); return; }
    if (brl < 0) { toast.error("Valor limite não pode ser negativo."); return; }
    setSaving(true);
    try {
      await upsert({
        reapproval_threshold_pct: pct,
        reapproval_threshold_brl: brl,
        reapproval_require_reason: requireReason,
      });
      toast.success("Regras de reaprovação salvas.");
    } catch (err) {
      toast.error(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5 max-w-3xl">
        <div className="flex items-start gap-3">
          <RotateCcw className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Quando um lote já aprovado é editado (pelo analista, por pendência de nota fiscal ou por troca de empresa),
            o sistema exige nova aprovação se a variação for relevante. Defina o gatilho abaixo — variações menores
            passam direto, sem reabrir o fluxo de aprovação.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rpct">Variação mínima em % para exigir reaprovação</Label>
            <Input id="rpct" type="number" min={0} max={100} step={0.5}
              value={pct} onChange={(e) => setPct(Number(e.target.value))}
              disabled={loading || saving} />
            <p className="text-[11px] text-muted-foreground">Ex.: 5% ignora ajustes menores que 5% do total do lote.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rbrl">Variação mínima em R$ para exigir reaprovação</Label>
            <Input id="rbrl" type="number" min={0} step={10}
              value={brl} onChange={(e) => setBrl(Number(e.target.value))}
              disabled={loading || saving} />
            <p className="text-[11px] text-muted-foreground">Reaprovação dispara quando AMBOS (% e R$) são superados.</p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="req-reason">Exigir justificativa na reaprovação</Label>
            <p className="text-[11px] text-muted-foreground">
              Quando ligado, quem reaprovar precisa escrever o motivo da alteração.
            </p>
          </div>
          <Switch id="req-reason" checked={requireReason} onCheckedChange={setRequireReason} disabled={loading || saving} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={loading || saving} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar regras"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Limites 0% e R$ 0,01 (padrão) fazem qualquer alteração exigir reaprovação — comportamento mais conservador.
        </p>
      </CardContent>
    </Card>
  );
}

function WorkflowTab({ hospitalId }: { hospitalId: string }) {
  const { values, loading, upsert } = useHospitalSettings(hospitalId, ["workflow_module"] as const);
  const [mode, setMode] = useState<"completo" | "validacao">("completo");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (values) {
      const v = String(values.workflow_module ?? "completo");
      setMode(v === "validacao" ? "validacao" : "completo");
    }
  }, [values]);

  const save = async (next: "completo" | "validacao") => {
    setSaving(true);
    try {
      await upsert({ workflow_module: next });
      setMode(next);
      toast.success(`Módulo alterado para "${next === "completo" ? "Completo" : "Validação"}".`);
    } catch (err) {
      toast.error(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const Option = ({ value, title, desc }: { value: "completo" | "validacao"; title: string; desc: string }) => {
    const isActive = mode === value;
    return (
      <button
        type="button"
        disabled={loading || saving}
        onClick={() => save(value)}
        className={cn(
          "text-left rounded-lg border p-4 transition-colors",
          isActive ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="font-medium">{title}</div>
          {isActive && <span className="text-[11px] font-semibold text-primary">ATIVO</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      </button>
    );
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5 max-w-3xl">
        <div className="flex items-start gap-3">
          <Workflow className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Define o fluxo de trabalho deste hospital. A troca afeta os botões de encaminhamento, a timeline dos lotes
            e os KPIs de pendência.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Option
            value="completo"
            title="Completo"
            desc="Analista → Validador → Diretor → NF → Pago. Fluxo padrão com todas as etapas."
          />
          <Option
            value="validacao"
            title="Validação"
            desc="Termina em 'Validação concluída'. Esconde etapas de Diretor/NF/Pago da timeline e dos KPIs."
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          {saving ? "Salvando…" : "A alteração é aplicada imediatamente para novos lotes."}
        </p>
      </CardContent>
    </Card>
  );
}
