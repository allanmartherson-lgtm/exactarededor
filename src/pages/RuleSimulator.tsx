import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface SimForm {
  procedure_code: string;
  procedure_name: string;
  agreement_name: string;
  doctor_name: string;
  doctor_role: string;
  access_route: string;
  sector: string;
  specialty: string;
  company_name: string;
  attendance_number: string;
  procedure_date: string;
  gross_amount: string;
  procedure_amount: string;
  quantity: string;
  payment_type: string;
  reference_date: string;
  tipo_linha: string;
}

const empty: SimForm = {
  procedure_code: "",
  procedure_name: "",
  agreement_name: "",
  doctor_name: "",
  doctor_role: "cirurgiao",
  access_route: "",
  sector: "",
  specialty: "",
  company_name: "",
  attendance_number: "",
  procedure_date: new Date().toISOString().slice(0, 10),
  gross_amount: "",
  procedure_amount: "",
  quantity: "1",
  payment_type: "centro_cirurgico",
  reference_date: new Date().toISOString().slice(0, 10),
  tipo_linha: "",
};

export default function RuleSimulator() {
  const [form, setForm] = useState<SimForm>(empty);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SimForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const run = async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const payload = {
        procedure_code: form.procedure_code.trim() || null,
        procedure_name: form.procedure_name.trim() || null,
        agreement_name: form.agreement_name.trim() || null,
        doctor_name: form.doctor_name.trim() || null,
        doctor_role: form.doctor_role.trim() || null,
        access_route: form.access_route.trim() || null,
        sector: form.sector.trim() || null,
        specialty: form.specialty.trim() || null,
        company_name: form.company_name.trim() || null,
        attendance_number: form.attendance_number.trim() || null,
        procedure_date: form.procedure_date || null,
        gross_amount: Number(form.gross_amount.replace(",", ".")) || 0,
        procedure_amount: form.procedure_amount ? Number(form.procedure_amount.replace(",", ".")) : null,
        quantity: Number(form.quantity) || 1,
        payment_type: form.payment_type || null,
        reference_date: form.reference_date || null,
        tipo_linha: form.tipo_linha || null,
      };
      const { data, error } = await supabase.functions.invoke("simulate-rule", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha desconhecida");
      setData(data);
    } catch (e: any) {
      const msg = e?.message ?? "Erro";
      setError(msg);
      toast({ title: "Falha na simulação", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const result = data?.result;
  
  const trace = result?.selection_trace;
  const breakdown = result?.calculation_breakdown ?? [];

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <FlaskConical className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Simulador de Regras</h1>
          <p className="text-sm text-muted-foreground">
            Cole um item de exemplo e veja qual regra/cálculo se aplica, com o caminho de fallback
            completo. Não persiste nada.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------- Form ---------- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Item simulado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código TUSS/CBHPM"><Input value={form.procedure_code} onChange={(e) => set("procedure_code", e.target.value)} placeholder="31005497" /></Field>
              <Field label="Convênio"><Input value={form.agreement_name} onChange={(e) => set("agreement_name", e.target.value)} placeholder="Unimed" /></Field>
              <Field label="Setor"><Input value={form.sector} onChange={(e) => set("sector", e.target.value)} placeholder="centro_cirurgico" /></Field>
              <Field label="Função do médico"><Input value={form.doctor_role} onChange={(e) => set("doctor_role", e.target.value)} placeholder="cirurgiao" /></Field>
              <Field label="Via de acesso"><Input value={form.access_route} onChange={(e) => set("access_route", e.target.value)} placeholder="videolaparoscopia" /></Field>
              <Field label="Especialidade (informativa)"><Input value={form.specialty} onChange={(e) => set("specialty", e.target.value)} placeholder="Cir. Geral" /></Field>
              <Field label="Empresa (nome)"><Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="Hospital X" /></Field>
              <Field label="Médico (nome)"><Input value={form.doctor_name} onChange={(e) => set("doctor_name", e.target.value)} /></Field>
              <Field label="Valor pago (gross)"><Input value={form.gross_amount} onChange={(e) => set("gross_amount", e.target.value)} placeholder="0,00" /></Field>
              <Field label="Valor base (procedure)"><Input value={form.procedure_amount} onChange={(e) => set("procedure_amount", e.target.value)} placeholder="opcional" /></Field>
              <Field label="Qtd"><Input value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
              <Field label="Atendimento"><Input value={form.attendance_number} onChange={(e) => set("attendance_number", e.target.value)} /></Field>
              <Field label="Data do proc."><Input type="date" value={form.procedure_date} onChange={(e) => set("procedure_date", e.target.value)} /></Field>
              <Field label="Tipo linha"><Input value={form.tipo_linha} onChange={(e) => set("tipo_linha", e.target.value)} placeholder="(vazio = procedimento)" /></Field>
              <Field label="Tipo pagamento"><Input value={form.payment_type} onChange={(e) => set("payment_type", e.target.value)} /></Field>
              <Field label="Data de referência"><Input type="date" value={form.reference_date} onChange={(e) => set("reference_date", e.target.value)} /></Field>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={run} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
                Simular
              </Button>
              <Button variant="ghost" onClick={() => { setForm(empty); setData(null); setError(null); }}>Limpar</Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {data && (
              <p className="text-[11px] text-muted-foreground">
                {data.total_active_rules} regras ativas avaliadas.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---------- Result ---------- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!result && <p className="text-sm text-muted-foreground">Preencha o item e clique em "Simular".</p>}
            {result && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={result.status} />
                  <Badge variant="outline">{result.matched_priority}</Badge>
                  <Badge variant="outline">{result.calculation_type_used}</Badge>
                  {result.needs_human_review && <Badge variant="destructive">Revisão humana</Badge>}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <KV label="Regra vencedora" value={result.matched_rule_name ?? "—"} />
                  <KV label="Valor esperado" value={fmtMoney(result.expected_amount)} />
                  <KV label="Valor pago" value={fmtMoney(Number(form.gross_amount.replace(",", ".")) || 0)} />
                  <KV label="Divergência" value={result.diff_pct != null ? `${(result.diff_pct * 100).toFixed(2)}%` : "—"} />
                </div>

                <div>
                  <Label className="text-xs">Explicação do cálculo</Label>
                  <Textarea readOnly value={result.calculation_explanation ?? ""} className="text-xs h-24 mt-1" />
                </div>

                {result.alerts?.length > 0 && (
                  <div>
                    <Label className="text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alertas ({result.alerts.length})</Label>
                    <ul className="mt-1 space-y-1 text-xs">
                      {result.alerts.map((a: string, i: number) => (
                        <li key={i} className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1">{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {breakdown.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-xs">Cálculos avaliados na regra vencedora</Label>
                      <div className="mt-2 space-y-1.5">
                        {breakdown.map((b: any, i: number) => (
                          <div key={i} className={`rounded border px-2 py-1.5 text-xs ${b.matched ? "border-emerald-500/30 bg-emerald-500/5" : "border-muted bg-muted/30"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{b.label || b.calculation_type}</span>
                              <span className="font-mono">{b.matched ? fmtMoney(b.expected) : `skip: ${b.skip_reason ?? "—"}`}</span>
                            </div>
                            {b.explanation && <p className="text-muted-foreground mt-0.5">{b.explanation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {trace?.levels?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-xs">
                        Caminho de fallback — níveis avaliados ({trace.levels.length})
                        {trace.item_sector && <span className="ml-2 text-muted-foreground">setor: {trace.item_sector}</span>}
                      </Label>
                      <div className="mt-2 space-y-2 max-h-96 overflow-y-auto pr-1">
                        {trace.levels.map((lvl: any, i: number) => (
                          <div key={i} className="rounded border border-border">
                            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40 text-xs">
                              <span className="font-medium">{lvl.level}</span>
                              <span className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">{lvl.outcome}</Badge>
                                <span className="text-muted-foreground">{lvl.bucket_size} candidata(s)</span>
                              </span>
                            </div>
                            {lvl.candidates?.length > 0 && (
                              <ul className="text-xs divide-y divide-border">
                                {lvl.candidates.map((c: any, j: number) => {
                                  const isWinner = c.rule_id === result.matched_rule_id && c.result === "winner";
                                  return (
                                    <li key={j} className={`flex items-center justify-between gap-2 px-2 py-1 ${isWinner ? "bg-primary/5" : ""}`}>
                                      <span className="truncate">
                                        {isWinner && "🏆 "}{c.rule_name}
                                        {c.with_code && <span className="ml-1 text-[10px] text-muted-foreground">[c/ código]</span>}
                                      </span>
                                      <span className="flex items-center gap-1.5 shrink-0">
                                        <Badge variant={c.result === "winner" ? "default" : "outline"} className="text-[10px]">{c.result}</Badge>
                                        {c.filter_reason && <span className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={c.filter_reason}>{c.filter_reason}</span>}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { v: any; icon: any }> = {
    aprovado: { v: "default", icon: CheckCircle2 },
    reprovado: { v: "destructive", icon: XCircle },
    alerta: { v: "secondary", icon: AlertTriangle },
    sem_regra: { v: "outline", icon: AlertTriangle },
  };
  const m = map[status] ?? { v: "outline", icon: AlertTriangle };
  const Icon = m.icon;
  return <Badge variant={m.v}><Icon className="h-3 w-3 mr-1" />{status}</Badge>;
}
function fmtMoney(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "—";
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
