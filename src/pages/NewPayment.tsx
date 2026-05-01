import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";
import { FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";

interface ParsedRow {
  doctor_name: string;
  doctor_document: string;
  doctor_email: string;
  description: string;
  gross_amount: number;
  raw_data: Record<string, unknown>;
}

const norm = (s: string) => s.toLowerCase().trim().replace(/[\s_-]+/g, "");

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (norm(rk).includes(norm(k))) return row[rk];
    }
  }
  return undefined;
};

const NewPayment = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { document.title = "Nova base | MedPay Approval"; }, []);

  const onFile = async (f: File) => {
    setFile(f);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const parsed: ParsedRow[] = json.map((row) => {
      const amount = Number(String(pick(row, ["valor bruto", "valor", "vlrbruto", "bruto"]) ?? 0).toString().replace(/[^\d,.-]/g, "").replace(",", "."));
      return {
        doctor_name: String(pick(row, ["medico", "nome", "prestador", "fornecedor"]) ?? "").trim(),
        doctor_document: String(pick(row, ["cpf", "cnpj", "documento", "doc"]) ?? "").trim(),
        doctor_email: String(pick(row, ["email", "e-mail"]) ?? "").trim(),
        description: String(pick(row, ["descricao", "descrição", "servico", "serviço", "competencia", "competência"]) ?? "").trim(),
        gross_amount: isNaN(amount) ? 0 : amount,
        raw_data: row,
      };
    }).filter((r) => r.doctor_name || r.gross_amount > 0);
    setRows(parsed);
    if (!reference) setReference(f.name.replace(/\.[^.]+$/, ""));
  };

  const total = rows.reduce((s, r) => s + r.gross_amount, 0);

  const submit = async () => {
    if (!reference.trim()) {
      toast({ title: "Informe a referência do lote", variant: "destructive" }); return;
    }
    if (rows.length === 0) {
      toast({ title: "Carregue um arquivo válido", variant: "destructive" }); return;
    }
    setSubmitting(true);

    let filePath: string | null = null;
    if (file) {
      const path = `${user!.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-files").upload(path, file);
      if (!upErr) filePath = path;
    }

    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: description.trim() || null,
        status: "em_analise_ia",
        total_amount: total,
        items_count: rows.length,
        source_file_path: filePath,
        created_by: user!.id,
      })
      .select()
      .single();

    if (error || !payment) {
      setSubmitting(false);
      toast({ title: "Erro ao criar pagamento", description: error?.message, variant: "destructive" });
      return;
    }

    const items = rows.map((r) => ({ payment_id: payment.id, ...r, raw_data: r.raw_data as never }));
    const { error: itemsErr } = await supabase.from("payment_items").insert(items);
    if (itemsErr) {
      setSubmitting(false);
      toast({ title: "Erro ao salvar itens", description: itemsErr.message, variant: "destructive" });
      return;
    }

    await supabase.from("payment_observations").insert({
      payment_id: payment.id,
      author_type: "sistema",
      author_id: user!.id,
      message: `Lote criado com ${rows.length} itens, total ${formatCurrency(total)}.`,
      status_to: "em_analise_ia",
    });

    // Disparar análise IA
    toast({ title: "Lote criado", description: "Iniciando análise por IA..." });
    supabase.functions.invoke("analyze-payment", { body: { payment_id: payment.id } });

    navigate(`/pagamentos/${payment.id}`);
  };

  return (
    <>
      <PageHeader title="Nova base de pagamento" description="Faça upload da planilha. A IA cruzará os dados com as regras." />
      <div className="p-8 max-w-4xl space-y-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ref">Referência do lote *</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: Pagamento Médicos Maio/2026" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Descrição</Label>
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Observações iniciais (opcional)" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Arquivo (.xlsx, .xls, .csv)</CardTitle>
            <CardDescription>Colunas reconhecidas: médico/nome, CPF/CNPJ, email, descrição, valor bruto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary-soft/30 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet className="h-10 w-10 text-primary" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{rows.length} linhas · {formatCurrency(total)}</p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Clique para selecionar ou arraste o arquivo</p>
                  <p className="text-xs text-muted-foreground mt-1">Excel ou CSV até 10MB</p>
                </>
              )}
            </label>

            {rows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Médico</th>
                        <th className="px-3 py-2 font-medium">Documento</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.slice(0, 50).map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{r.doctor_name || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.doctor_document || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.doctor_email || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.gross_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center py-2 bg-muted/40">
                    Mostrando 50 de {rows.length} linhas
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || rows.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Criar e analisar com IA
          </Button>
        </div>
      </div>
    </>
  );
};

export default NewPayment;