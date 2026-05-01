import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentType, type PaymentKind } from "@/lib/status";
import { FileSpreadsheet, Loader2, Sparkles, Upload, X, Building2, CheckCircle2, AlertCircle } from "lucide-react";

interface ParsedRow {
  doctor_name: string;
  doctor_document: string;
  doctor_email: string;
  description: string;
  gross_amount: number;
  // novos
  company_name: string | null;
  company_id: string | null;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  access_route: string | null;
  doctor_role: string | null;
  agreement_text: string | null;
  procedure_amount: number | null;
  quantity: number | null;
  procedure_date: string | null;
  raw_data: Record<string, unknown>;
}

interface FileBucket {
  file: File;
  rows: ParsedRow[];
  rawCompanyName: string;
  matchedCompany: { id: string; name: string } | null;
  matchScore: number;
}

interface CompanyRow { id: string; name: string; aliases: string[] }

const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (norm(rk).includes(norm(k))) return row[rk];
    }
  }
  return undefined;
};

const toNumber = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

const toStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const excelDateToISO = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0))).toISOString();
  }
  const s = String(v).trim();
  // dd/mm/yyyy [hh:mm]
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0))).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Levenshtein simples
const lev = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
};
const similarity = (a: string, b: string): number => {
  const an = norm(a), bn = norm(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.9;
  const d = lev(an, bn);
  return 1 - d / Math.max(an.length, bn.length);
};

const extractCompanyFromFilename = (filename: string): string => {
  let name = filename.replace(/\.[^.]+$/, "");
  // remove sufixos comuns: " - Centro Cirurgico", "Maio 2026", etc
  name = name.replace(/\s*-\s*(centro\s*cirurgico|cc|hemodin[âa]mica|consultas?|pareceres?|ambulatorial)\b.*$/i, "");
  name = name.replace(/\s+\d{1,2}[-_/]\d{2,4}.*$/, "");
  name = name.replace(/\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*/i, "");
  return name.trim();
};

const matchCompany = (rawName: string, companies: CompanyRow[]): { company: CompanyRow | null; score: number } => {
  if (!companies.length) return { company: null, score: 0 };
  let best: { company: CompanyRow | null; score: number } = { company: null, score: 0 };
  for (const c of companies) {
    const candidates = [c.name, ...(c.aliases || [])];
    for (const cand of candidates) {
      const s = similarity(rawName, cand);
      if (s > best.score) best = { company: c, score: s };
    }
  }
  return best;
};

const NewPayment = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [competenceMonth, setCompetenceMonth] = useState(""); // YYYY-MM
  const [paymentDueDate, setPaymentDueDate] = useState(""); // YYYY-MM-DD
  const [paymentType, setPaymentType] = useState<PaymentType | "">("");
  const [paymentKind, setPaymentKind] = useState<PaymentKind | "">("");
  const [costCenter, setCostCenter] = useState("");
  const [buckets, setBuckets] = useState<FileBucket[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);

  useEffect(() => { document.title = "Nova base | MedPay Approval"; }, []);

  useEffect(() => {
    supabase.from("companies").select("id,name,aliases").then(({ data }) => {
      setCompanies((data ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] })));
    });
  }, []);

  const parseFile = async (f: File): Promise<FileBucket> => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

    const rawCompanyName = extractCompanyFromFilename(f.name);
    const { company, score } = matchCompany(rawCompanyName, companies);

    const rows: ParsedRow[] = json.map((row) => {
      const role = toStr(pick(row, ["funcao", "função", "papel"]));
      const repasse = toNumber(pick(row, ["vl repasse", "valor repasse", "vlrepasse", "repasse", "vl. repasse"]));
      const procVal = toNumber(pick(row, ["valor procedimento", "valor proce", "vl proce", "vlproce"]));
      const grossFromAny = repasse || toNumber(pick(row, ["valor bruto", "valor", "vlrbruto", "bruto"])) || procVal;

      return {
        doctor_name: toStr(pick(row, ["medico", "médico", "nome", "prestador", "fornecedor"])) ?? "",
        doctor_document: toStr(pick(row, ["cpf", "cnpj", "documento", "doc"])) ?? "",
        doctor_email: toStr(pick(row, ["email", "e-mail"])) ?? "",
        description: toStr(pick(row, ["procedmat", "proced/mat", "proced.", "procedimento", "descricao", "descrição", "servico", "serviço"])) ?? "",
        gross_amount: grossFromAny,
        company_name: company?.name ?? rawCompanyName ?? null,
        company_id: company?.id ?? null,
        attendance_number: toStr(pick(row, ["nr atendimento", "n atendimento", "atendimento", "nratendim"])),
        procedure_code: toStr(pick(row, ["codigo procedimento", "código procedimento", "codigoproc", "codproc", "cod. tuss", "tuss"])),
        procedure_name: toStr(pick(row, ["procedmat", "proced/mat", "proced.", "procedimento"])),
        access_route: toStr(pick(row, ["via de acesso", "viaacesso", "via acesso"])),
        doctor_role: role,
        agreement_text: toStr(pick(row, ["percentual", "acordo"])),
        procedure_amount: procVal || null,
        quantity: toNumber(pick(row, ["qtd", "quantidade"])) || null,
        procedure_date: excelDateToISO(pick(row, ["data"])),
        raw_data: row,
      };
    }).filter((r) => r.doctor_name || r.gross_amount > 0 || r.procedure_code);

    return { file: f, rows, rawCompanyName, matchedCompany: company ? { id: company.id, name: company.name } : null, matchScore: score };
  };

  const onFiles = async (fileList: FileList) => {
    const newBuckets: FileBucket[] = [];
    for (const f of Array.from(fileList)) {
      try { newBuckets.push(await parseFile(f)); }
      catch (e) { toast({ title: `Erro lendo ${f.name}`, description: String(e), variant: "destructive" }); }
    }
    setBuckets((prev) => [...prev, ...newBuckets]);
    if (!reference && newBuckets.length === 1) {
      setReference(newBuckets[0].file.name.replace(/\.[^.]+$/, ""));
    } else if (!reference && newBuckets.length > 1) {
      const today = new Date();
      setReference(`Pagamento ${today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`);
    }
  };

  const removeBucket = (idx: number) => setBuckets((prev) => prev.filter((_, i) => i !== idx));

  const allRows = useMemo(() => buckets.flatMap((b) => b.rows), [buckets]);
  const total = allRows.reduce((s, r) => s + r.gross_amount, 0);

  const submit = async () => {
    if (!reference.trim()) {
      toast({ title: "Informe a referência do lote", variant: "destructive" }); return;
    }
    if (!competenceMonth) {
      toast({ title: "Informe a competência (mês de apuração)", variant: "destructive" }); return;
    }
    if (!paymentType) {
      toast({ title: "Selecione o tipo de pagamento", variant: "destructive" }); return;
    }
    if (!paymentKind) {
      toast({ title: "Selecione a categoria do pagamento", variant: "destructive" }); return;
    }
    if (allRows.length === 0) {
      toast({ title: "Carregue pelo menos um arquivo válido", variant: "destructive" }); return;
    }
    setSubmitting(true);

    // Upload de todos os arquivos
    const uploadedPaths: string[] = [];
    for (const b of buckets) {
      const path = `${user!.id}/${Date.now()}-${b.file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-files").upload(path, b.file);
      if (!upErr) uploadedPaths.push(path);
    }

    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: description.trim() || null,
        status: "em_analise_ia",
        total_amount: total,
        items_count: allRows.length,
        source_file_path: uploadedPaths[0] ?? null,
        created_by: user!.id,
        competence_month: `${competenceMonth}-01`,
        payment_due_date: paymentDueDate || null,
        payment_type: paymentType as PaymentType,
        payment_kind: paymentKind as PaymentKind,
        cost_center_code: costCenter.trim() || null,
      })
      .select()
      .single();

    if (error || !payment) {
      setSubmitting(false);
      toast({ title: "Erro ao criar pagamento", description: error?.message, variant: "destructive" });
      return;
    }

    const items = allRows.map((r) => ({
      payment_id: payment.id,
      doctor_name: r.doctor_name,
      doctor_document: r.doctor_document,
      doctor_email: r.doctor_email,
      description: r.description,
      gross_amount: r.gross_amount,
      company_name: r.company_name,
      company_id: r.company_id,
      attendance_number: r.attendance_number,
      procedure_code: r.procedure_code,
      procedure_name: r.procedure_name,
      access_route: r.access_route,
      doctor_role: r.doctor_role,
      agreement_text: r.agreement_text,
      procedure_amount: r.procedure_amount,
      quantity: r.quantity,
      procedure_date: r.procedure_date,
      raw_data: r.raw_data as never,
    }));
    const { error: itemsErr } = await supabase.from("payment_items").insert(items);
    if (itemsErr) {
      setSubmitting(false);
      toast({ title: "Erro ao salvar itens", description: itemsErr.message, variant: "destructive" });
      return;
    }

    const fileSummary = buckets.map((b) =>
      `${b.file.name} → ${b.matchedCompany ? `${b.matchedCompany.name} (match ${Math.round(b.matchScore * 100)}%)` : `empresa nova: ${b.rawCompanyName}`} · ${b.rows.length} itens`
    ).join(" | ");

    await supabase.from("payment_observations").insert({
      payment_id: payment.id,
      author_type: "sistema",
      author_id: user!.id,
      message: `Lote criado com ${allRows.length} itens, total ${formatCurrency(total)}. Arquivos: ${fileSummary}`,
      status_to: "em_analise_ia",
    });

    toast({ title: "Lote criado", description: "Iniciando análise por IA..." });
    supabase.functions.invoke("analyze-payment", { body: { payment_id: payment.id } });

    navigate(`/pagamentos/${payment.id}`);
  };

  return (
    <>
      <PageHeader title="Nova base de pagamento" description="Anexe uma ou várias planilhas. A empresa é detectada pelo nome do arquivo." />
      <div className="p-8 max-w-5xl space-y-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ref">Referência do lote *</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: Pagamento Médicos Maio/2026" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="competence">Competência (mês de apuração) *</Label>
                <Input id="competence" type="month" value={competenceMonth} onChange={(e) => setCompetenceMonth(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due">Previsão de pagamento</Label>
                <Input id="due" type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tipo de pagamento *</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((k) => (
                      <SelectItem key={k} value={k}>{PAYMENT_TYPE_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Categoria *</Label>
                <Select value={paymentKind} onValueChange={(v) => setPaymentKind(v as PaymentKind)}>
                  <SelectTrigger><SelectValue placeholder="Atual / Pendência / Misto" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cc">Centro de custos</Label>
                <Input id="cc" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="Ex: CC-001 / Cirurgia Geral" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Descrição</Label>
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Observações iniciais (opcional)" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Arquivos (.xlsx, .xls, .csv)</CardTitle>
            <CardDescription>
              Pode anexar várias planilhas — cada arquivo representa uma empresa (detectada pelo nome). Colunas reconhecidas: Nr. Atendimento, Paciente, Convênio, Data, Proced/Mat, Via de Acesso, Código TUSS, Qtd, Valor Procedimento, Percentual, Vl. Repasse, Médico, Função.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary-soft/30 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && onFiles(e.target.files)}
              />
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">Clique para selecionar ou arraste arquivos</p>
              <p className="text-xs text-muted-foreground mt-1">Excel ou CSV — múltiplos arquivos suportados</p>
            </label>

            {buckets.length > 0 && (
              <div className="space-y-2">
                {buckets.map((b, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 flex items-start gap-3 bg-card">
                    <FileSpreadsheet className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{b.file.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="gap-1">
                          <Building2 className="h-3 w-3" />
                          {b.matchedCompany?.name ?? b.rawCompanyName}
                        </Badge>
                        {b.matchedCompany ? (
                          <Badge variant="secondary" className="gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> match {Math.round(b.matchScore * 100)}%
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-warning">
                            <AlertCircle className="h-3 w-3" /> empresa não cadastrada
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {b.rows.length} linhas · {formatCurrency(b.rows.reduce((s, r) => s + r.gross_amount, 0))}
                        </span>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeBucket(idx)} className="flex-shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Total: {allRows.length} itens · {formatCurrency(total)}
                </p>
              </div>
            )}

            {allRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr className="text-left">
                        <th className="px-2 py-2 font-medium">Empresa</th>
                        <th className="px-2 py-2 font-medium">Médico</th>
                        <th className="px-2 py-2 font-medium">Função</th>
                        <th className="px-2 py-2 font-medium">TUSS</th>
                        <th className="px-2 py-2 font-medium">Via</th>
                        <th className="px-2 py-2 font-medium">Acordo</th>
                        <th className="px-2 py-2 font-medium text-right">Repasse</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {allRows.slice(0, 60).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 truncate max-w-[140px]">{r.company_name ?? "—"}</td>
                          <td className="px-2 py-1.5 truncate max-w-[140px]">{r.doctor_name || "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.doctor_role ?? "—"}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.procedure_code ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.access_route ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.agreement_text ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.gross_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {allRows.length > 60 && (
                  <p className="text-xs text-muted-foreground text-center py-2 bg-muted/40">
                    Mostrando 60 de {allRows.length} linhas
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || allRows.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Criar e analisar com IA
          </Button>
        </div>
      </div>
    </>
  );
};

export default NewPayment;
