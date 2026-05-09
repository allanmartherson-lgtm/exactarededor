import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Building2, Plus, Trash2, Pencil, Upload, Download, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { CompanySlaSection } from "@/components/CompanySlaSection";
import { CompanyDoctorsSection } from "@/components/CompanyDoctorsSection";
import { dedupEmails, normalizeEmail, parseEmailList, tryAddEmail } from "@/lib/email";

interface Company {
  id: string;
  name: string;
  document: string | null;
  aliases: string[];
  notes: string | null;
  /** E-mails de destino para pedidos de NF (TO). O e-mail do médico vai como CC. */
  invoice_emails: string[];
}

const empty: Company = { id: "", name: "", document: "", aliases: [], notes: "", invoice_emails: [] };

const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");
const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) for (const rk of Object.keys(row)) if (norm(rk).includes(norm(k))) return row[rk];
  return undefined;
};
const toStr = (v: unknown): string => v == null ? "" : String(v).trim();
const COMPANIES_PAGE_SIZE = 1000;

const fetchAllCompanies = async (columns = "*", orderBy?: string) => {
  const all: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from("companies").select(columns);
    if (orderBy) query = query.order(orderBy);

    const { data, error } = await query.range(from, from + COMPANIES_PAGE_SIZE - 1);
    if (error) throw error;

    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < COMPANIES_PAGE_SIZE) break;
    from += COMPANIES_PAGE_SIZE;
  }

  return all;
};

const Companies = () => {
  const [items, setItems] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company>(empty);
  const [aliasInput, setAliasInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{
    total: number;
    success: number;
    updated: number;
    errors: string[];
    show: boolean;
  }>({ total: 0, success: 0, updated: 0, errors: [], show: false });

  useEffect(() => { document.title = "Empresas | MedPay"; load(); }, []);

  const load = async () => {
    try {
      const data = await fetchAllCompanies("*", "name");
      setItems(data as Company[]);
    } catch (error: any) {
      toast({ title: "Erro ao carregar empresas", description: error.message, variant: "destructive" });
    }
  };

  const save = async () => {
    if (!editing.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    const docDigits = onlyDigits(editing.document ?? "");
    if (docDigits && !isValidCNPJ(docDigits)) {
      toast({
        title: "CNPJ inválido",
        description: "Confira os dígitos verificadores. O cadastro só é salvo com CNPJ válido (deixe em branco se não souber).",
        variant: "destructive",
      });
      return;
    }
    // Verificação prévia de duplicidade por CNPJ (independente de máscara)
    if (docDigits) {
      const { data: dups } = await supabase
        .from("companies")
        .select("id, name, document")
        .or(`document.eq.${docDigits},document.eq.${formatCNPJ(docDigits)}`);
      const conflict = (dups ?? []).find(
        (c: any) => onlyDigits(c.document ?? "") === docDigits && c.id !== editing.id
      );
      if (conflict) {
        toast({
          title: "CNPJ já cadastrado",
          description: `Este CNPJ já pertence à empresa "${conflict.name}". Edite o registro existente em vez de criar um duplicado.`,
          variant: "destructive",
        });
        return;
      }
    }
    // Aproveita e-mail digitado mas não confirmado (Enter/blur).
    // tryAddEmail aplica trim+lowercase+dedup — mesmo helper usado no chip.
    let finalEmails = dedupEmails(editing.invoice_emails ?? []);
    if (emailInput.trim()) {
      const result = tryAddEmail(finalEmails, emailInput);
      if (!result.ok) {
        toast({
          title: "E-mail inválido no campo",
          description: `"${normalizeEmail(emailInput)}" não é um e-mail válido. Corrija ou apague antes de salvar.`,
          variant: "destructive",
        });
        return;
      }
      finalEmails = result.emails;
    }

    const payload = {
      name: editing.name.trim(),
      // Persiste sempre normalizado com máscara (ou null se vazio)
      document: docDigits ? formatCNPJ(docDigits) : null,
      aliases: editing.aliases,
      notes: editing.notes?.trim() || null,
      invoice_emails: finalEmails,
    };
    const { error } = editing.id
      ? await supabase.from("companies").update(payload).eq("id", editing.id)
      : await supabase.from("companies").insert(payload);
    if (error) {
      // 23505 = unique_violation (índice único do CNPJ no banco)
      if ((error as any).code === "23505") {
        toast({
          title: "CNPJ já cadastrado",
          description: "Já existe uma empresa com este CNPJ no sistema.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Erro", description: error.message, variant: "destructive" });
      }
      return;
    }
    toast({ title: editing.id ? "Empresa atualizada" : "Empresa criada" });
    setOpen(false); setEditing(empty); setAliasInput(""); setEmailInput(""); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir empresa?")) return;
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["nome", "cnpj", "apelidos", "emails_nf", "notas"],
      ["Clínica Cirúrgica de Taguatinga Ltda", "00.000.000/0001-00", "Cirurgica Taguatinga; Tag Cirurgica", "financeiro@clinica.com; nf@clinica.com", "Centro cirúrgico DF Star"],
      ["Hemodinâmica Brasília S/S", "11.111.111/0001-11", "Hemo Brasilia", "contato@hemobsb.com", ""],
    ]);
    ws["!cols"] = [{ wch: 40 }, { wch: 22 }, { wch: 40 }, { wch: 40 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Empresas");
    XLSX.writeFile(wb, "modelo-empresas.xlsx");
  };

  const importFile = async (f: File) => {
    setImporting(true);
    setImportProgress(0);
    setImportResults({ total: 0, success: 0, updated: 0, errors: [], show: false });
    
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const parsedRows = json.map((row) => {
        const name = toStr(pick(row, ["nome", "razao social", "razão social", "empresa"]));
        const documentRaw = toStr(pick(row, ["cnpj", "cpf", "documento", "doc"])) || null;
        const aliasRaw = toStr(pick(row, ["apelidos", "alias", "variacoes", "variações", "nomes alternativos"]));
        const aliases = aliasRaw
          ? aliasRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
          : [];
        const emailsRaw = toStr(pick(row, ["emails_nf", "emails nf", "email nf", "email", "emails", "e-mails"]));
        const invoice_emails = parseEmailList(emailsRaw);
        const notes = toStr(pick(row, ["notas", "observacoes", "observações", "obs"])) || null;
        return { name, documentRaw, aliases, invoice_emails, notes };
      }).filter((r) => r.name);

      if (!parsedRows.length) {
        toast({ 
          title: "Nenhuma linha válida encontrada", 
          description: "Verifique se a coluna 'nome' está preenchida.", 
          variant: "destructive" 
        });
        setImporting(false);
        return;
      }

      setImportResults(prev => ({ ...prev, total: parsedRows.length, show: true }));

      // Validação de CNPJ por linha
      const validRows = parsedRows.filter((r) => {
        const d = onlyDigits(r.documentRaw ?? "");
        if (d && !isValidCNPJ(d)) {
          setImportResults(prev => ({ 
            ...prev, 
            errors: [...prev.errors, `${r.name}: CNPJ inválido (${r.documentRaw})`] 
          }));
          return false;
        }
        return true;
      }).map((r) => ({
        name: r.name,
        document: r.documentRaw ? (onlyDigits(r.documentRaw) ? formatCNPJ(onlyDigits(r.documentRaw)) : null) : null,
        aliases: r.aliases,
        invoice_emails: r.invoice_emails,
        notes: r.notes,
      }));

      const existing = await fetchAllCompanies("id, name, document");
      const byName = new Map(existing.map((c: any) => [c.name.toLowerCase(), c.id]));
      const byCnpj = new Map<string, string>();
      for (const c of existing as any[]) {
        const d = onlyDigits(c.document ?? "");
        if (d.length === 14) byCnpj.set(d, c.id);
      }

      // Processamento em lotes (50 por vez)
      const BATCH_SIZE = 50;
      let insertedCount = 0;
      let updatedCount = 0;
      const seenCnpjInBatch = new Set<string>();

      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        
        // No loop individual por enquanto para lidar com lógica de update vs insert por item
        // mas em uma operação assíncrona paralela controlada
        const promises = batch.map(async (row) => {
          const d = onlyDigits(row.document ?? "");
          
          if (d) {
            if (seenCnpjInBatch.has(d)) {
              return { success: false, error: `${row.name}: CNPJ duplicado na planilha (${formatCNPJ(d)})` };
            }
            seenCnpjInBatch.add(d);
          }

          const existingId = (d && byCnpj.get(d)) || byName.get(row.name.toLowerCase());
          
          const payload = {
            name: row.name,
            document: row.document,
            aliases: row.aliases,
            invoice_emails: row.invoice_emails,
            notes: row.notes
          };

          const { error } = existingId
            ? await supabase.from("companies").update(payload).eq("id", existingId)
            : await supabase.from("companies").insert(payload);

          if (error) {
            return { 
              success: false, 
              error: `${row.name}: ${(error as any).code === "23505" ? "CNPJ já cadastrado" : error.message}` 
            };
          }

          return { success: true, isUpdate: !!existingId };
        });

        const results = await Promise.all(promises);
        
        results.forEach(res => {
          if (res.success) {
            if (res.isUpdate) updatedCount++;
            else insertedCount++;
          } else if (res.error) {
            setImportResults(prev => ({ ...prev, errors: [...prev.errors, res.error!] }));
          }
        });

        const progress = Math.min(100, Math.round(((i + batch.length) / validRows.length) * 100));
        setImportProgress(progress);
        setImportResults(prev => ({ ...prev, success: insertedCount, updated: updatedCount }));
      }

      toast({
        title: "Importação finalizada",
        description: `${insertedCount} criados, ${updatedCount} atualizados.`
      });
      load();
    } catch (e) {
      console.error("Erro na importação:", e);
      toast({ 
        title: "Erro ao importar", 
        description: "Ocorreu um erro ao processar o arquivo.", 
        variant: "destructive" 
      });
    } finally {
      setImporting(false);
    }
  };

  const filtered = search.trim()
    ? items.filter((c) =>
        [c.name, c.document ?? "", ...(c.aliases ?? [])].join(" ").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <>
      <PageHeader title="Empresas" description="Cadastro de clínicas/PJs para reconhecimento automático nas planilhas." />
      <div className="p-8 max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Input placeholder="Buscar por nome, CNPJ ou apelido..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> Modelo
            </Button>
            <label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={importing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { importFile(f); e.target.value = ""; } }}
              />
              <Button variant="outline" size="sm" disabled={importing} asChild>
                <span className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : "Importar"}
                </span>
              </Button>
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(empty); setAliasInput(""); } }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(empty)}><Plus className="h-4 w-4 mr-2" /> Nova empresa</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing.id ? "Editar empresa" : "Nova empresa"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nome oficial *</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Clínica Cirúrgica de Taguatinga Ltda" />
                </div>
                <div className="space-y-1.5">
                  <Label>CNPJ</Label>
                  <Input
                    value={editing.document ?? ""}
                    onChange={(e) => setEditing({ ...editing, document: formatCNPJ(e.target.value) })}
                    placeholder="00.000.000/0001-00"
                    inputMode="numeric"
                    maxLength={18}
                  />
                  {(() => {
                    const d = onlyDigits(editing.document ?? "");
                    if (!d) return <p className="text-xs text-muted-foreground">Opcional. Se preenchido, deve ser um CNPJ válido.</p>;
                    if (d.length < 14) return <p className="text-xs text-muted-foreground">Continue digitando — {d.length}/14 dígitos.</p>;
                    return isValidCNPJ(d)
                      ? <p className="text-xs text-emerald-600 inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> CNPJ válido.</p>
                      : <p className="text-xs text-destructive inline-flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> CNPJ inválido — confira os dígitos.</p>;
                  })()}
                </div>
                <div className="space-y-1.5">
                  <Label>Apelidos / variações de nome</Label>
                  <p className="text-xs text-muted-foreground">Use para casos em que o nome do arquivo difere do oficial. Pressione Enter para adicionar.</p>
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && aliasInput.trim()) {
                        e.preventDefault();
                        setEditing({ ...editing, aliases: [...editing.aliases, aliasInput.trim()] });
                        setAliasInput("");
                      }
                    }}
                    placeholder="Ex: Cirurgica Taguatinga"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {editing.aliases.map((a, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {a}
                        <button onClick={() => setEditing({ ...editing, aliases: editing.aliases.filter((_, j) => j !== i) })}>×</button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>E-mails para pedido de NF</Label>
                  <p className="text-xs text-muted-foreground">
                    O pedido de Nota Fiscal será enviado a estes endereços (TO).
                    O e-mail do médico será incluído como cópia (CC). Pressione Enter, vírgula ou ponto-e-vírgula para adicionar.
                  </p>
                  <Input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onBlur={() => {
                      // Confirma automaticamente ao sair do campo (evita perder o e-mail digitado).
                      // tryAddEmail cuida de trim/lowercase/dedup/validação.
                      const result = tryAddEmail(editing.invoice_emails ?? [], emailInput);
                      if (!result.ok) return; // inválido: mantém no input pra o usuário corrigir
                      setEditing({ ...editing, invoice_emails: result.emails });
                      setEmailInput("");
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === "," || e.key === ";") && emailInput.trim()) {
                        e.preventDefault();
                        const result = tryAddEmail(editing.invoice_emails ?? [], emailInput);
                        if (!result.ok) {
                          toast({
                            title: "E-mail inválido",
                            description: normalizeEmail(emailInput),
                            variant: "destructive",
                          });
                          return;
                        }
                        setEditing({ ...editing, invoice_emails: result.emails });
                        setEmailInput("");
                      }
                    }}
                    placeholder="financeiro@empresa.com"
                    className={emailInput.trim() ? "ring-2 ring-warning/40" : undefined}
                  />
                  {emailInput.trim() && (
                    <p className="text-xs text-warning">
                      ⚠ Pressione <kbd className="px-1 rounded bg-muted">Enter</kbd> para adicionar este e-mail. (Ao salvar, será adicionado automaticamente.)
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {(editing.invoice_emails ?? []).map((a, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        <Mail className="h-3 w-3" />
                        {a}
                        <button
                          aria-label={`Remover ${a}`}
                          onClick={() => setEditing({ ...editing, invoice_emails: editing.invoice_emails.filter((_, j) => j !== i) })}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <Textarea rows={2} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Prazos específicos</Label>
                  <CompanySlaSection companyId={editing.id} />
                </div>
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <CompanyDoctorsSection companyId={editing.id} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="text-base">{filtered.length} empresa(s)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-hidden">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">Nenhuma empresa cadastrada ainda.</p>
            ) : (
              <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[32%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[24%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium cell-mono">CNPJ</th>
                    <th className="px-4 py-2 font-medium">Apelidos</th>
                    <th className="px-4 py-2 font-medium">E-mails NF</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium">
                        <div className="flex min-w-0 items-center gap-2">
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate" title={c.name}>{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground cell-mono">
                        {c.document ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            {c.document}
                            {isValidCNPJ(c.document)
                              ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                              : <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(c.aliases ?? []).map((a, i) => <Badge key={i} variant="outline" className="text-xs">{a}</Badge>)}
                          {(c.aliases ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(c.invoice_emails ?? []).map((a, i) => (
                            <Badge key={i} variant="outline" className="text-xs gap-1">
                              <Mail className="h-3 w-3" />
                              {a}
                            </Badge>
                          ))}
                          {(c.invoice_emails ?? []).length === 0 && (
                            <span className="text-muted-foreground text-xs">— sem cadastro</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ImportResultsDialog 
        open={importResults.show} 
        results={importResults}
        progress={importProgress}
        importing={importing}
        onOpenChange={(v) => !importing && setImportResults(prev => ({ ...prev, show: v }))}
      />
    </>
  );
};

const ImportResultsDialog = ({ open, results, progress, importing, onOpenChange }: { 
  open: boolean, 
  results: any, 
  progress: number, 
  importing: boolean,
  onOpenChange: (open: boolean) => void 
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {importing ? "Importando..." : "Resultado da Importação"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          {importing && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Processando linhas...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{results.success}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Novos</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{results.updated}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Atualizados</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg border-destructive/20 border">
              <div className="text-2xl font-bold text-destructive">{results.errors.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Erros/Pulos</div>
            </div>
          </div>

          {results.errors.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Detalhes dos erros:</Label>
              <div className="max-h-[200px] overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1">
                {results.errors.map((err: string, i: number) => (
                  <div key={i} className="text-xs flex gap-2 text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!importing && (
            <div className="bg-emerald-50 text-emerald-700 p-3 rounded-md flex gap-2 text-sm border border-emerald-100">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <p>Importação de {results.total} linhas concluída com sucesso.</p>
            </div>
          )}
        </div>

        {!importing && (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Companies;
