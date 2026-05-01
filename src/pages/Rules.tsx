import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { TONE_CLASSES, type RuleSeverity } from "@/lib/status";
import { Plus, Sparkles, Trash2, Upload, FileText } from "lucide-react";
import * as XLSX from "xlsx";

const sevTone: Record<RuleSeverity, keyof typeof TONE_CLASSES> = { info: "info", aviso: "warning", bloqueio: "destructive" };

const Rules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const load = () => supabase.from("rules").select("*").order("created_at", { ascending: false }).then(({ data }) => setRules(data ?? []));
  useEffect(() => { document.title = "Regras | MedPay"; load(); }, []);

  const createRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("rules").insert({
      name: String(f.get("name")), description: String(f.get("description")) || null,
      rule_text: String(f.get("rule_text")), severity: String(f.get("severity")) as RuleSeverity,
      created_by: user!.id,
    });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false); load(); toast({ title: "Regra criada" });
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const importWithAi = async () => {
    if (!importText.trim() && !importFile) {
      return toast({ title: "Adicione texto ou um arquivo", variant: "destructive" });
    }
    setImporting(true);
    try {
      const body: any = {};
      if (importText.trim()) body.text = importText;

      if (importFile) {
        const ext = importFile.name.toLowerCase().split(".").pop() ?? "";
        const isSpreadsheet = ["xlsx", "xls", "csv"].includes(ext);
        const isText = ["txt", "md", "eml"].includes(ext);

        if (isSpreadsheet) {
          const buf = await importFile.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const sheets = wb.SheetNames.map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
          body.text = (body.text ? body.text + "\n\n" : "") + sheets;
        } else if (isText) {
          const txt = await importFile.text();
          body.text = (body.text ? body.text + "\n\n" : "") + txt;
        } else {
          // PDF, DOCX, imagens → multimodal
          body.file = {
            name: importFile.name,
            mimeType: importFile.type || "application/octet-stream",
            dataBase64: await fileToBase64(importFile),
          };
        }
      }

      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) {
        return toast({ title: "Erro", description: error?.message ?? data?.error ?? "Falha", variant: "destructive" });
      }
      const toInsert = data.rules.map((r: any) => ({ ...r, created_by: user!.id }));
      await supabase.from("rules").insert(toInsert);
      setImportOpen(false); setImportText(""); setImportFile(null); load();
      toast({ title: `${toInsert.length} regra(s) importada(s)` });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const remove = async (id: string) => {
    await supabase.from("rules").delete().eq("id", id); load();
  };

  return (
    <>
      <PageHeader title="Regras de validação" description="A IA usa essas regras para analisar cada pagamento."
        actions={<>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" /> Importar com IA</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Importar regras com IA</DialogTitle></DialogHeader>
              <Tabs defaultValue="file" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="file"><Upload className="h-4 w-4 mr-2" />Arquivo</TabsTrigger>
                  <TabsTrigger value="text"><FileText className="h-4 w-4 mr-2" />Texto</TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="space-y-3">
                  <p className="text-sm text-muted-foreground">PDF, Word (.docx), Excel (.xlsx/.csv), TXT, e-mail (.eml) ou imagem. A IA extrai e estrutura as regras.</p>
                  <Input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.eml,image/*"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
                  {importFile && <p className="text-xs text-muted-foreground">Selecionado: {importFile.name} ({(importFile.size / 1024).toFixed(0)} KB)</p>}
                  <Button onClick={importWithAi} disabled={importing || !importFile} className="w-full">
                    {importing ? "Processando..." : "Converter e importar"}
                  </Button>
                </TabsContent>
                <TabsContent value="text" className="space-y-3">
                  <p className="text-sm text-muted-foreground">Cole o texto/manual ou conteúdo de e-mail. A IA vai estruturar.</p>
                  <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Ex: Valor máximo por consulta R$ 500. CPF obrigatório. Não pagar duplicidade no mês..." />
                  <Button onClick={importWithAi} disabled={importing || !importText.trim()} className="w-full">
                    {importing ? "Processando..." : "Converter e importar"}
                  </Button>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nova regra</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova regra</DialogTitle></DialogHeader>
              <form onSubmit={createRule} className="space-y-3">
                <div className="space-y-1.5"><Label>Nome</Label><Input name="name" required maxLength={100} /></div>
                <div className="space-y-1.5"><Label>Descrição</Label><Input name="description" maxLength={300} /></div>
                <div className="space-y-1.5"><Label>Texto da regra</Label><Textarea name="rule_text" required rows={4} maxLength={2000} /></div>
                <div className="space-y-1.5"><Label>Severidade</Label>
                  <Select name="severity" defaultValue="aviso"><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="aviso">Aviso</SelectItem><SelectItem value="bloqueio">Bloqueio</SelectItem></SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full">Criar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </>}
      />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          {rules.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma regra ainda.</p> :
            <div className="divide-y divide-border">{rules.map((r) => (
              <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{r.name}</p>
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE_CLASSES[sevTone[r.severity as RuleSeverity]]}`}>{r.severity}</span>
                  </div>
                  {r.description && <p className="text-xs text-muted-foreground mb-1">{r.description}</p>}
                  <p className="text-sm">{r.rule_text}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}</div>}
        </CardContent></Card>
      </div>
    </>
  );
};
export default Rules;