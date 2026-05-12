import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { FlaskConical, Loader2, AlertTriangle, CheckCircle2, XCircle, ChevronsUpDown, Search } from "lucide-react";
import { DoctorCombobox, type DoctorOption } from "@/components/DoctorCombobox";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { COMMON_SPECIALTIES } from "@/lib/specialties";
import { RULE_SECTOR_LABELS } from "@/lib/status";
import { cn } from "@/lib/utils";

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

const DOCTOR_ROLES = [
  { v: "cirurgiao", label: "Cirurgião principal" },
  { v: "primeiro_aux", label: "1º auxiliar" },
  { v: "demais_aux", label: "Demais auxiliares" },
  { v: "instrumentador", label: "Instrumentador" },
  { v: "anestesista", label: "Anestesista" },
  { v: "clinico", label: "Clínico" },
];

const ACCESS_ROUTES = [
  "Única ou Principal",
  "Mesma Via",
  "Outra Via",
  "Sem Via (Bônus/Complemento)",
];

const TIPO_LINHA = [
  { v: "", label: "Procedimento (padrão)" },
  { v: "visita", label: "Visita" },
  { v: "complemento_bonus", label: "Complemento/Bônus" },
  { v: "outro", label: "Outro" },
];

const PAYMENT_TYPE = [
  { v: "centro_cirurgico", label: "Centro Cirúrgico" },
  { v: "hemodinamica", label: "Hemodinâmica" },
  { v: "consulta", label: "Consulta" },
  { v: "parecer", label: "Parecer" },
  { v: "visita", label: "Visita" },
  { v: "outro", label: "Outro" },
];

export default function RuleSimulator() {
  const [form, setForm] = useState<SimForm>(empty);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<DoctorOption | null>(null);
  const [company, setCompany] = useState<CompanyOption | null>(null);

  const set = <K extends keyof SimForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Sync doctor → form
  useEffect(() => { if (doctor) set("doctor_name", doctor.name); }, [doctor]);
  useEffect(() => { if (company) set("company_name", company.name); }, [company]);

  const run = async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const payload = {
        procedure_code: form.procedure_code.trim() || null,
        procedure_name: form.procedure_name.trim() || null,
        agreement_name: form.agreement_name.trim() || null,
        doctor_name: form.doctor_name.trim() || null,
        doctor_document: doctor?.crm ? String(doctor.crm).trim() : null,
        doctor_role: form.doctor_role.trim() || null,
        access_route: form.access_route.trim() || null,
        sector: form.sector.trim() || null,
        specialty: form.specialty.trim() || null,
        company_id: company?.id ?? null,
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
            Selecione os campos a partir das bases reais e veja qual regra/cálculo se aplica,
            com o caminho completo de fallback. Não persiste nada.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------- Form ---------- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Item simulado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código TUSS/CBHPM">
                <ProcedureCombobox
                  code={form.procedure_code}
                  onSelect={(p) => { set("procedure_code", p.code); set("procedure_name", p.description ?? ""); }}
                  onClear={() => { set("procedure_code", ""); set("procedure_name", ""); }}
                />
              </Field>
              <Field label="Convênio">
                <AgreementCombobox value={form.agreement_name} onChange={(v) => set("agreement_name", v)} />
              </Field>

              <Field label="Setor">
                <Select value={form.sector || "__none"} onValueChange={(v) => set("sector", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— qualquer —</SelectItem>
                    {Object.entries(RULE_SECTOR_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Função do médico">
                <Select value={form.doctor_role} onValueChange={(v) => set("doctor_role", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCTOR_ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Via de acesso">
                <Select value={form.access_route || "__none"} onValueChange={(v) => set("access_route", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— não se aplica —</SelectItem>
                    {ACCESS_ROUTES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Especialidade (informativa)">
                <Select value={form.specialty || "__none"} onValueChange={(v) => set("specialty", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none">— não definida —</SelectItem>
                    {COMMON_SPECIALTIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Empresa">
                <CompanyCombobox value={company} onChange={setCompany} />
              </Field>
              <Field label="Médico">
                <DoctorCombobox value={doctor} onChange={setDoctor} />
              </Field>

              <Field label="Valor pago (gross)"><Input value={form.gross_amount} onChange={(e) => set("gross_amount", e.target.value)} placeholder="0,00" /></Field>
              <Field label="Valor base (procedure)"><Input value={form.procedure_amount} onChange={(e) => set("procedure_amount", e.target.value)} placeholder="opcional" /></Field>
              <Field label="Qtd"><Input value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
              <Field label="Atendimento"><Input value={form.attendance_number} onChange={(e) => set("attendance_number", e.target.value)} placeholder="opcional" /></Field>

              <Field label="Data do proc."><Input type="date" value={form.procedure_date} onChange={(e) => set("procedure_date", e.target.value)} /></Field>

              <Field label="Tipo linha">
                <Select value={form.tipo_linha || "__none"} onValueChange={(v) => set("tipo_linha", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPO_LINHA.map((t) => <SelectItem key={t.v || "__none"} value={t.v || "__none"}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Tipo pagamento">
                <Select value={form.payment_type} onValueChange={(v) => set("payment_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPE.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Data de referência"><Input type="date" value={form.reference_date} onChange={(e) => set("reference_date", e.target.value)} /></Field>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={run} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
                Simular
              </Button>
              <Button variant="ghost" onClick={() => { setForm(empty); setDoctor(null); setCompany(null); setData(null); setError(null); }}>Limpar</Button>
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

/* ============== Combobox auxiliares ============== */

function ProcedureCombobox({
  code,
  onSelect,
  onClear,
}: {
  code: string;
  onSelect: (p: { code: string; description: string | null }) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<{ code: string; description: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    if (!open) return;
    const myId = ++reqId.current;
    setLoading(true);
    const term = debounced.trim().replace(/[%,]/g, " ");
    let q = supabase.from("reference_table_items").select("code, description").not("code", "is", null).limit(30);
    if (term) q = q.or(`code.ilike.%${term}%,description.ilike.%${term}%`);
    q.then(({ data }) => {
      if (reqId.current !== myId) return;
      // dedupe by code
      const seen = new Set<string>();
      const out: { code: string; description: string | null }[] = [];
      (data ?? []).forEach((r: any) => {
        if (!r.code || seen.has(r.code)) return;
        seen.add(r.code);
        out.push({ code: r.code, description: r.description });
      });
      setItems(out);
      setLoading(false);
    });
  }, [debounced, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className="truncate text-left">{code || <span className="text-muted-foreground">Buscar TUSS/CBHPM…</span>}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código ou descrição…" className="border-0 shadow-none focus-visible:ring-0 h-9" />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <CommandList className="max-h-72">
            {!loading && items.length === 0 && <CommandEmpty>Nenhum código encontrado.</CommandEmpty>}
            <CommandGroup>
              {items.map((p) => (
                <CommandItem key={p.code} value={p.code} onSelect={() => { onSelect(p); setOpen(false); }}>
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-xs">{p.code}</span>
                    <span className="text-xs text-muted-foreground truncate">{p.description ?? "—"}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {code && (
              <div className="p-2 border-t">
                <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onClear(); setOpen(false); }}>Limpar seleção</Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AgreementCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const term = search.trim().replace(/[%,]/g, " ");
    let q = supabase.from("payment_items").select("agreement_text").not("agreement_text", "is", null).limit(500);
    if (term) q = q.ilike("agreement_text", `%${term}%`);
    q.then(({ data }) => {
      const seen = new Set<string>();
      const out: string[] = [];
      (data ?? []).forEach((r: any) => {
        const v = (r.agreement_text || "").trim();
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
      });
      out.sort((a, b) => a.localeCompare(b, "pt-BR"));
      setItems(out.slice(0, 50));
      setLoading(false);
    });
  }, [open, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}>
          <span className="truncate text-left">{value || "Selecionar convênio…"}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar convênio…" className="border-0 shadow-none focus-visible:ring-0 h-9" />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <CommandList className="max-h-72">
            {!loading && items.length === 0 && <CommandEmpty>Nenhum convênio encontrado.</CommandEmpty>}
            <CommandGroup>
              {items.map((v) => (
                <CommandItem key={v} value={v} onSelect={() => { onChange(v); setOpen(false); }}>
                  {v}
                </CommandItem>
              ))}
            </CommandGroup>
            {value && (
              <div className="p-2 border-t">
                <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onChange(""); setOpen(false); }}>Limpar</Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ============== Helpers de UI ============== */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="min-w-0 [&_*]:max-w-full">{children}</div>
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
