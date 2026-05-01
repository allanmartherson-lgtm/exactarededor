import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
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
  type RuleType,
  RULE_SCOPE_LABELS,
  RULE_SECTOR_LABELS,
  RULE_TARGET_TYPE_LABELS,
  RULE_TYPE_LABELS,
  RULE_TYPE_DESCRIPTIONS,
  formatCurrency,
} from "@/lib/status";
import { Plus, Sparkles, Trash2, Upload, FileText, Filter, ChevronDown, ChevronRight, Search } from "lucide-react";
import * as XLSX from "xlsx";

const sevTone: Record<RuleSeverity, keyof typeof TONE_CLASSES> = { info: "info", aviso: "warning", bloqueio: "destructive" };

type RuleRow = any;
type DraftRule = {
  enabled: boolean;
  name: string; description: string; rule_text: string;
  severity: RuleSeverity; scope: RuleScope; sector: RuleSector;
  target_type: RuleTargetType | null; target_identifier: string | null; target_name: string | null;
  rule_type: RuleType;
  package_amount: number | null; bonus_amount: number | null; bonus_pct: number | null;
  target_amount: number | null; multiplier: number | null; deflator_pct: number | null;
  reference_table_id: string | null; procedure_codes: string[];
};

const num = (v: any): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};

const Rules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [refTables, setRefTables] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // form state
  const [scope, setScope] = useState<RuleScope>("master");
  const [targetType, setTargetType] = useState<RuleTargetType>("medico");
  const [ruleType, setRuleType] = useState<RuleType>("informativo");
  const [refTableId, setRefTableId] = useState<string>("");
  const [codesInput, setCodesInput] = useState<string>("");
  const parsedCodes = useMemo(
    () => codesInput.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean),
    [codesInput]
  );

  // filters
  const [filterScope, setFilterScope] = useState<"todos" | RuleScope>("todos");
  const [filterSector, setFilterSector] = useState<"todos" | RuleSector>("todos");
  const [filterType, setFilterType] = useState<"todos" | RuleType>("todos");
  const [filterTarget, setFilterTarget] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = () => supabase.from("rules").select("*").order("created_at", { ascending: false }).then(({ data }) => setRules(data ?? []));
  const loadRefs = () => supabase.from("reference_tables").select("id,name").order("name").then(({ data }) => setRefTables((data ?? []) as any));
  useEffect(() => { document.title = "Regras | MedPay"; load(); loadRefs(); }, []);

  const createRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const isEspecifica = scope === "especifica";
    const codesRaw = String(f.get("procedure_codes") ?? "").trim();
    const payload: any = {
      name: String(f.get("name")),
      description: String(f.get("description")) || null,
      rule_text: String(f.get("rule_text")),
      severity: String(f.get("severity")) as RuleSeverity,
      scope, sector: String(f.get("sector")) as RuleSector,
      target_type: isEspecifica ? targetType : null,
      target_identifier: isEspecifica ? (String(f.get("target_identifier")) || null) : null,
      target_name: isEspecifica ? (String(f.get("target_name")) || null) : null,
      rule_type: ruleType,
      package_amount: ruleType === "pacote" ? num(f.get("package_amount")) : null,
      bonus_amount: ruleType === "bonus" ? num(f.get("bonus_amount")) : null,
      bonus_pct: ruleType === "bonus" ? num(f.get("bonus_pct")) : null,
      target_amount: ruleType === "complemento" ? num(f.get("target_amount")) : null,
      multiplier: ruleType === "tabela_diferenciada" ? num(f.get("multiplier")) : null,
      deflator_pct: ruleType === "tabela_diferenciada" ? num(f.get("deflator_pct")) : null,
      reference_table_id: ruleType === "tabela_diferenciada" && refTableId ? refTableId : null,
      procedure_codes: codesRaw ? codesRaw.split(/[,;\s]+/).filter(Boolean) : null,
      created_by: user!.id,
    };
    if (isEspecifica && !payload.target_identifier && !payload.target_name) {
      return toast({ title: "Informe CPF/CNPJ ou nome do alvo", variant: "destructive" });
    }
    const { error } = await supabase.from("rules").insert(payload);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false); setScope("master"); setTargetType("medico"); setRuleType("informativo"); setRefTableId(""); setCodesInput(""); load(); toast({ title: "Regra criada" });
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const importWithAi = async () => {
    if (!importText.trim() && !importFile) return toast({ title: "Adicione texto ou um arquivo", variant: "destructive" });
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
          body.file = { name: importFile.name, mimeType: importFile.type || "application/octet-stream", dataBase64: await fileToBase64(importFile) };
        }
      }
      const { data, error } = await supabase.functions.invoke("convert-rules", { body });
      if (error || !data?.rules) return toast({ title: "Erro", description: error?.message ?? data?.error ?? "Falha", variant: "destructive" });
      const ds: DraftRule[] = data.rules.map((r: any) => ({
        enabled: true,
        name: r.name ?? "", description: r.description ?? "", rule_text: r.rule_text ?? "",
        severity: r.severity ?? "aviso", scope: r.scope ?? "master", sector: r.sector ?? "outro",
        target_type: r.target_type ?? null, target_identifier: r.target_identifier ?? null, target_name: r.target_name ?? null,
        rule_type: r.rule_type ?? "informativo",
        package_amount: r.package_amount ?? null, bonus_amount: r.bonus_amount ?? null, bonus_pct: r.bonus_pct ?? null,
        target_amount: r.target_amount ?? null, multiplier: r.multiplier ?? null, deflator_pct: r.deflator_pct ?? null,
        reference_table_id: null, procedure_codes: Array.isArray(r.procedure_codes) ? r.procedure_codes : [],
      }));
      setDrafts(ds); setImportOpen(false); setReviewOpen(true); setImportText(""); setImportFile(null);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally { setImporting(false); }
  };

  const updateDraft = (i: number, patch: Partial<DraftRule>) => setDrafts((ds) => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  const saveDrafts = async () => {
    const selected = drafts.filter((d) => d.enabled);
    if (selected.length === 0) return toast({ title: "Nenhuma regra selecionada", variant: "destructive" });
    const toInsert = selected.map((d) => ({
      name: d.name, description: d.description || null, rule_text: d.rule_text,
      severity: d.severity, scope: d.scope, sector: d.sector,
      target_type: d.scope === "especifica" ? d.target_type : null,
      target_identifier: d.scope === "especifica" ? d.target_identifier : null,
      target_name: d.scope === "especifica" ? d.target_name : null,
      rule_type: d.rule_type,
      package_amount: d.rule_type === "pacote" ? d.package_amount : null,
      bonus_amount: d.rule_type === "bonus" ? d.bonus_amount : null,
      bonus_pct: d.rule_type === "bonus" ? d.bonus_pct : null,
      target_amount: d.rule_type === "complemento" ? d.target_amount : null,
      multiplier: d.rule_type === "tabela_diferenciada" ? d.multiplier : null,
      deflator_pct: d.rule_type === "tabela_diferenciada" ? d.deflator_pct : null,
      reference_table_id: d.rule_type === "tabela_diferenciada" ? d.reference_table_id : null,
      procedure_codes: d.procedure_codes.length ? d.procedure_codes : null,
      created_by: user!.id,
    }));
    const { error } = await supabase.from("rules").insert(toInsert);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    setReviewOpen(false); setDrafts([]); load();
    toast({ title: `${toInsert.length} regra(s) salva(s)` });
  };

  const remove = async (id: string) => { await supabase.from("rules").delete().eq("id", id); load(); };

  // filtered + grouped
  const filtered = useMemo(() => rules.filter((r) =>
    (filterScope === "todos" || r.scope === filterScope) &&
    (filterSector === "todos" || r.sector === filterSector) &&
    (filterType === "todos" || r.rule_type === filterType) &&
    (!filterTarget.trim() || `${r.target_name ?? ""} ${r.target_identifier ?? ""}`.toLowerCase().includes(filterTarget.toLowerCase()))
  ), [rules, filterScope, filterSector, filterType, filterTarget]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; type: "master" | "medico" | "empresa"; rules: RuleRow[] }>();
    for (const r of filtered) {
      let key: string, label: string, type: "master" | "medico" | "empresa";
      if (r.scope === "master") { key = "__master"; label = "Regras Master (geral)"; type = "master"; }
      else {
        const ident = (r.target_identifier ?? r.target_name ?? "sem alvo").toLowerCase();
        key = `${r.target_type}:${ident}`;
        label = r.target_name ?? r.target_identifier ?? "Sem alvo";
        type = (r.target_type === "empresa" ? "empresa" : "medico");
      }
      if (!map.has(key)) map.set(key, { key, label, type, rules: [] });
      map.get(key)!.rules.push(r);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.type === "master") return -1;
      if (b.type === "master") return 1;
      return a.label.localeCompare(b.label);
    });
  }, [filtered]);

  const renderCalcBadge = (r: RuleRow) => {
    if (r.rule_type === "pacote" && r.package_amount != null) return <span className="text-xs font-medium">{formatCurrency(r.package_amount)} (pacote)</span>;
    if (r.rule_type === "tabela_diferenciada") {
      const ref = refTables.find((t) => t.id === r.reference_table_id);
      const parts = [ref?.name ?? "tabela", r.multiplier ? `× ${r.multiplier}` : null, r.deflator_pct ? `− ${r.deflator_pct}%` : null].filter(Boolean);
      return <span className="text-xs font-medium">{parts.join(" ")}</span>;
    }
    if (r.rule_type === "bonus") return <span className="text-xs font-medium">{r.bonus_amount != null ? `+${formatCurrency(r.bonus_amount)}` : r.bonus_pct != null ? `+${r.bonus_pct}%` : "bônus"}</span>;
    if (r.rule_type === "complemento" && r.target_amount != null) return <span className="text-xs font-medium">complementa até {formatCurrency(r.target_amount)}</span>;
    return null;
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
                  <p className="text-sm text-muted-foreground">PDF, Word, Excel, CSV, TXT, .eml ou imagem. A IA extrai e mostra para revisão antes de salvar.</p>
                  <Input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.eml,image/*"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
                  {importFile && <p className="text-xs text-muted-foreground">Selecionado: {importFile.name} ({(importFile.size / 1024).toFixed(0)} KB)</p>}
                  <Button onClick={importWithAi} disabled={importing || !importFile} className="w-full">
                    {importing ? "Processando..." : "Extrair e revisar"}
                  </Button>
                </TabsContent>
                <TabsContent value="text" className="space-y-3">
                  <p className="text-sm text-muted-foreground">Cole o texto/manual ou conteúdo de e-mail.</p>
                  <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Ex: Pacote gastroplastia R$ 8.000 para Clínica X..." />
                  <Button onClick={importWithAi} disabled={importing || !importText.trim()} className="w-full">
                    {importing ? "Processando..." : "Extrair e revisar"}
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
                      <SelectContent>{Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Setor</Label>
                    <Select name="sector" defaultValue="outro">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {scope === "especifica" && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                    <div className="space-y-1.5"><Label>Aplicar a</Label>
                      <Select value={targetType} onValueChange={(v) => setTargetType(v as RuleTargetType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(RULE_TARGET_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label>{targetType === "medico" ? "CPF" : "CNPJ"}</Label>
                        <Input name="target_identifier" maxLength={30} />
                      </div>
                      <div className="space-y-1.5"><Label>Nome</Label><Input name="target_name" maxLength={150} /></div>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5"><Label>Tipo de regra</Label>
                  <Select value={ruleType} onValueChange={(v) => setRuleType(v as RuleType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{RULE_TYPE_DESCRIPTIONS[ruleType]}</p>
                </div>

                {ruleType === "pacote" && (
                  <div className="space-y-1.5"><Label>Valor do pacote (R$)</Label><Input name="package_amount" type="number" step="0.01" required /></div>
                )}
                {ruleType === "tabela_diferenciada" && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                    <div className="space-y-1.5"><Label>Tabela de referência</Label>
                      <Select value={refTableId} onValueChange={setRefTableId}>
                        <SelectTrigger><SelectValue placeholder={refTables.length ? "Selecione" : "Cadastre uma tabela primeiro"} /></SelectTrigger>
                        <SelectContent>{refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label>Multiplicador</Label><Input name="multiplier" type="number" step="0.01" placeholder="Ex: 1.5" /></div>
                      <div className="space-y-1.5"><Label>Deflator (%)</Label><Input name="deflator_pct" type="number" step="0.01" placeholder="Ex: 5" /></div>
                    </div>
                    <div className="flex items-start gap-2 pt-1">
                      <Checkbox id="include_aux" name="include_auxiliaries" defaultChecked={false} />
                      <div className="flex-1">
                        <Label htmlFor="include_aux" className="cursor-pointer">Incluir auxiliares no valor esperado</Label>
                        <p className="text-xs text-muted-foreground">Soma <code>valor_base × nº_aux × %_aux</code> (CBHPM informa o nº de auxiliares por código).</p>
                      </div>
                    </div>
                    <div className="space-y-1.5"><Label>% por auxiliar (default 30%)</Label><Input name="auxiliary_pct" type="number" step="0.01" placeholder="30" /></div>
                  </div>
                )}
                {ruleType === "bonus" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Bônus fixo (R$)</Label><Input name="bonus_amount" type="number" step="0.01" /></div>
                    <div className="space-y-1.5"><Label>Bônus (%)</Label><Input name="bonus_pct" type="number" step="0.01" /></div>
                  </div>
                )}
                {ruleType === "complemento" && (
                  <div className="space-y-1.5"><Label>Valor alvo (R$)</Label><Input name="target_amount" type="number" step="0.01" required /></div>
                )}

                <div className="space-y-1.5"><Label>Códigos de procedimento (opcional)</Label>
                  <Input
                    name="procedure_codes"
                    placeholder="Ex: 31005497, 31005470; 31002390"
                    value={codesInput}
                    onChange={(e) => setCodesInput(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Separe por vírgula <code>,</code>, ponto e vírgula <code>;</code> ou espaço. Limita a regra a estes códigos.
                  </p>
                  {parsedCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {parsedCodes.map((c, i) => (
                        <span key={`${c}-${i}`} className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono">
                          {c}
                        </span>
                      ))}
                      <span className="text-xs text-muted-foreground self-center ml-1">
                        {parsedCodes.length} código{parsedCodes.length > 1 ? "s" : ""} detectado{parsedCodes.length > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5"><Label>Nome</Label><Input name="name" required maxLength={100} /></div>
                <div className="space-y-1.5"><Label>Descrição</Label><Input name="description" maxLength={300} /></div>
                <div className="space-y-1.5"><Label>Texto da regra</Label><Textarea name="rule_text" required rows={3} maxLength={2000} /></div>
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
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterScope} onValueChange={(v) => setFilterScope(v as any)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os escopos</SelectItem>
              {Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSector} onValueChange={(v) => setFilterSector(v as any)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os setores</SelectItem>
              {Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)} placeholder="Buscar empresa/médico" className="pl-8 w-[220px]" />
          </div>
          <p className="text-xs text-muted-foreground ml-auto">{filtered.length} de {rules.length}</p>
        </div>

        {groups.length === 0 ? (
          <Card className="shadow-card"><CardContent className="px-6 py-12"><p className="text-center text-sm text-muted-foreground">Nenhuma regra encontrada.</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const isCollapsed = collapsed[g.key] === true;
              return (
                <Card key={g.key} className="shadow-card overflow-hidden">
                  <button onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                    className="w-full px-6 py-3 flex items-center gap-3 bg-muted/40 hover:bg-muted/60 text-left border-b border-border">
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="text-sm">{g.type === "master" ? "📘" : g.type === "empresa" ? "🏥" : "👤"}</span>
                    <p className="font-medium text-sm flex-1">{g.label}</p>
                    <span className="text-xs text-muted-foreground">{g.rules.length} regra{g.rules.length > 1 ? "s" : ""}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-border">
                      {g.rules.map((r) => (
                        <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <p className="font-medium text-sm">{r.name}</p>
                              <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE_CLASSES[sevTone[r.severity as RuleSeverity]]}`}>{r.severity}</span>
                              <span className="text-xs rounded-full border border-border bg-background px-2 py-0.5">{RULE_TYPE_LABELS[r.rule_type as RuleType] ?? r.rule_type}</span>
                              <span className="text-xs rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">{RULE_SECTOR_LABELS[r.sector as RuleSector] ?? r.sector}</span>
                              {renderCalcBadge(r)}
                              {r.procedure_codes && r.procedure_codes.length > 0 && (
                                <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono">{r.procedure_codes.join(", ")}</span>
                              )}
                            </div>
                            {r.description && <p className="text-xs text-muted-foreground mb-1">{r.description}</p>}
                            <p className="text-sm">{r.rule_text}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Tela de revisão pós-importação */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar regras extraídas pela IA</DialogTitle>
            <p className="text-sm text-muted-foreground">Confira, edite e selecione quais salvar. {drafts.filter(d => d.enabled).length} de {drafts.length} marcadas.</p>
          </DialogHeader>
          <div className="space-y-4">
            {drafts.map((d, i) => (
              <Card key={i} className={`p-4 ${d.enabled ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-3 mb-3">
                  <Checkbox checked={d.enabled} onCheckedChange={(v) => updateDraft(i, { enabled: !!v })} className="mt-1" />
                  <Input value={d.name} onChange={(e) => updateDraft(i, { name: e.target.value })} placeholder="Nome" className="font-medium" />
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                    <Select value={d.rule_type} onValueChange={(v) => updateDraft(i, { rule_type: v as RuleType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Severidade</Label>
                    <Select value={d.severity} onValueChange={(v) => updateDraft(i, { severity: v as RuleSeverity })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="aviso">Aviso</SelectItem><SelectItem value="bloqueio">Bloqueio</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Setor</Label>
                    <Select value={d.sector} onValueChange={(v) => updateDraft(i, { sector: v as RuleSector })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1"><Label className="text-xs">Escopo</Label>
                    <Select value={d.scope} onValueChange={(v) => updateDraft(i, { scope: v as RuleScope })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(RULE_SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {d.scope === "especifica" && <>
                    <div className="space-y-1"><Label className="text-xs">Tipo de alvo</Label>
                      <Select value={d.target_type ?? "medico"} onValueChange={(v) => updateDraft(i, { target_type: v as RuleTargetType })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(RULE_TARGET_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Nome do alvo</Label>
                      <Input value={d.target_name ?? ""} onChange={(e) => updateDraft(i, { target_name: e.target.value })} />
                    </div>
                    <div className="space-y-1 col-span-3"><Label className="text-xs">CPF/CNPJ</Label>
                      <Input value={d.target_identifier ?? ""} onChange={(e) => updateDraft(i, { target_identifier: e.target.value })} />
                    </div>
                  </>}
                </div>

                {d.rule_type === "pacote" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Valor do pacote (R$)</Label>
                    <Input type="number" step="0.01" value={d.package_amount ?? ""} onChange={(e) => updateDraft(i, { package_amount: num(e.target.value) })} />
                  </div>
                )}
                {d.rule_type === "tabela_diferenciada" && (
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="space-y-1"><Label className="text-xs">Tabela</Label>
                      <Select value={d.reference_table_id ?? ""} onValueChange={(v) => updateDraft(i, { reference_table_id: v })}>
                        <SelectTrigger><SelectValue placeholder={refTables.length ? "Selecione" : "Cadastre uma tabela"} /></SelectTrigger>
                        <SelectContent>{refTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Multiplicador</Label>
                      <Input type="number" step="0.01" value={d.multiplier ?? ""} onChange={(e) => updateDraft(i, { multiplier: num(e.target.value) })} />
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Deflator (%)</Label>
                      <Input type="number" step="0.01" value={d.deflator_pct ?? ""} onChange={(e) => updateDraft(i, { deflator_pct: num(e.target.value) })} />
                    </div>
                  </div>
                )}
                {d.rule_type === "bonus" && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1"><Label className="text-xs">Bônus fixo (R$)</Label>
                      <Input type="number" step="0.01" value={d.bonus_amount ?? ""} onChange={(e) => updateDraft(i, { bonus_amount: num(e.target.value) })} />
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Bônus (%)</Label>
                      <Input type="number" step="0.01" value={d.bonus_pct ?? ""} onChange={(e) => updateDraft(i, { bonus_pct: num(e.target.value) })} />
                    </div>
                  </div>
                )}
                {d.rule_type === "complemento" && (
                  <div className="space-y-1 mb-3"><Label className="text-xs">Valor alvo (R$)</Label>
                    <Input type="number" step="0.01" value={d.target_amount ?? ""} onChange={(e) => updateDraft(i, { target_amount: num(e.target.value) })} />
                  </div>
                )}

                <div className="space-y-1 mb-3"><Label className="text-xs">Códigos de procedimento</Label>
                  <Input value={d.procedure_codes.join(", ")} onChange={(e) => updateDraft(i, { procedure_codes: e.target.value.split(/[,;\s]+/).filter(Boolean) })} placeholder="Ex: 31005497, 31005470" />
                </div>
                <div className="space-y-1 mb-2"><Label className="text-xs">Descrição</Label>
                  <Input value={d.description} onChange={(e) => updateDraft(i, { description: e.target.value })} />
                </div>
                <div className="space-y-1"><Label className="text-xs">Texto da regra</Label>
                  <Textarea rows={2} value={d.rule_text} onChange={(e) => updateDraft(i, { rule_text: e.target.value })} />
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancelar</Button>
            <Button onClick={saveDrafts}>Salvar {drafts.filter(d => d.enabled).length} regra(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Rules;