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
import {
  TONE_CLASSES,
  type RuleSeverity,
  type RuleScope,
  type RuleSector,
  type RuleTargetType,
  RULE_SCOPE_LABELS,
  RULE_SECTOR_LABELS,
  RULE_TARGET_TYPE_LABELS,
} from "@/lib/status";
import { Plus, Sparkles, Trash2, Upload, FileText, Filter } from "lucide-react";
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
  const [scope, setScope] = useState<RuleScope>("master");
  const [targetType, setTargetType] = useState<RuleTargetType>("medico");
  const [filterScope, setFilterScope] = useState<"todos" | RuleScope>("todos");
  const [filterSector, setFilterSector] = useState<"todos" | RuleSector>("todos");

  const load = () => supabase.from("rules").select("*").order("created_at", { ascending: false }).then(({ data }) => setRules(data ?? []));
  useEffect(() => { document.title = "Regras | MedPay"; load(); }, []);

  const createRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const isEspecifica = scope === "especifica";
    const payload: any = {
      name: String(f.get("name")),
      description: String(f.get("description")) || null,
      rule_text: String(f.get("rule_text")),
      severity: String(f.get("severity")) as RuleSeverity,
      scope,
      sector: String(f.get("sector")) as RuleSector,
      target_type: isEspecifica ? targetType : null,
      target_identifier: isEspecifica ? (String(f.get("target_identifier")) || null) : null,
      target_name: isEspecifica ? (String(f.get("target_name")) || null) : null,
      created_by: user!.id,
    };
    if (isEspecifica && !payload.target_identifier && !payload.target_name) {
      return toast({ title: "Informe CPF/CNPJ ou nome do alvo", variant: "destructive" });
    }
    const { error } = await supabase.from("rules").insert(payload);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false); setScope("master"); setTargetType("medico"); load(); toast({ title: "Regra criada" });
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
      const toInsert = data.rules.map((r: any) => ({
        name: r.name,
        description: r.description ?? null,
        rule_text: r.rule_text,
        severity: r.severity,
        scope: r.scope ?? "master",
        sector: r.sector ?? "outro",
        target_type: r.target_type ?? null,
        target_identifier: r.target_identifier ?? null,
        target_name: r.target_name ?? null,
        created_by: user!.id,
      }));
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

  const filtered = rules.filter((r) =>
    (filterScope === "todos" || r.scope === filterScope) &&
    (filterSector === "todos" || r.sector === filterSector)
  );

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
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Nova regra</DialogTitle></DialogHeader>
              <form onSubmit={createRule} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Escopo</Label>
                    <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Setor</Label>
                    <Select name="sector" defaultValue="outro">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {scope === "especifica" && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                    <div className="space-y-1.5"><Label>Aplicar a</Label>
                      <Select value={targetType} onValueChange={(v) => setTargetType(v as RuleTargetType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(RULE_TARGET_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label>{targetType === "medico" ? "CPF" : "CNPJ"} (opcional)</Label>
                        <Input name="target_identifier" maxLength={30} placeholder={targetType === "medico" ? "000.000.000-00" : "00.000.000/0000-00"} />
                      </div>
                      <div className="space-y-1.5"><Label>Nome (opcional)</Label>
                        <Input name="target_name" maxLength={150} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Informe CPF/CNPJ ou nome — a IA usa para casar a regra no item.</p>
                  </div>
                )}
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
        <div className="flex items-center gap-3 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterScope} onValueChange={(v) => setFilterScope(v as any)}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Escopo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os escopos</SelectItem>
              {Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSector} onValueChange={(v) => setFilterSector(v as any)}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Setor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os setores</SelectItem>
              {Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground ml-auto">{filtered.length} de {rules.length}</p>
        </div>
        <Card className="shadow-card"><CardContent className="p-0">
          {filtered.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma regra encontrada.</p> :
            <div className="divide-y divide-border">{filtered.map((r) => (
              <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{r.name}</p>
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE_CLASSES[sevTone[r.severity as RuleSeverity]]}`}>{r.severity}</span>
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE_CLASSES[r.scope === "master" ? "primary" : "info"]}`}>
                      {RULE_SCOPE_LABELS[r.scope as RuleScope] ?? r.scope}
                    </span>
                    <span className="text-xs rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
                      {RULE_SECTOR_LABELS[r.sector as RuleSector] ?? r.sector}
                    </span>
                    {r.scope === "especifica" && (r.target_name || r.target_identifier) && (
                      <span className="text-xs rounded-full border border-border bg-background px-2 py-0.5">
                        {r.target_type === "medico" ? "👤" : "🏥"} {r.target_name ?? r.target_identifier}
                      </span>
                    )}
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