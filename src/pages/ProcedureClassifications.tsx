import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Row = {
  id: string;
  code_tuss: string;
  description: string | null;
  sector_classified: string;
  confidence: string;
  active: boolean;
  observation: string | null;
};

const SECTOR_OPTIONS = ["hemodinamica", "cirurgia", "consulta", "visita", "parecer", "procedimento", "outro"];
const CONFIDENCE_OPTIONS = ["alta", "media", "baixa"];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const findKey = (row: any, candidates: string[]) =>
  Object.keys(row).find((k) => candidates.some((c) => norm(k).includes(norm(c))));
const chunk = <T,>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const ProcedureClassifications = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = () =>
    supabase
      .from("procedure_classifications" as any)
      .select("*")
      .order("code_tuss")
      .then(({ data }) => setRows(((data ?? []) as unknown) as Row[]));

  useEffect(() => {
    document.title = "Classificação de procedimentos | MedPay";
    load();
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("procedure_classifications" as any).insert({
      code_tuss: String(f.get("code_tuss")).trim(),
      description: (String(f.get("description") || "") || null) as any,
      sector_classified: String(f.get("sector_classified") || "hemodinamica"),
      confidence: String(f.get("confidence") || "alta"),
      active: f.get("active") === "on",
      observation: (String(f.get("observation") || "") || null) as any,
      created_by: user!.id,
    } as any);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false);
    load();
    toast({ title: "Procedimento classificado" });
  };

  const toggleActive = async (r: Row) => {
    await supabase.from("procedure_classifications" as any).update({ active: !r.active } as any).eq("id", r.id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta classificação?")) return;
    await supabase.from("procedure_classifications" as any).delete().eq("id", id);
    load();
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      const toUpsert = data
        .map((row) => {
          const codeKey = findKey(row, ["codigo_tuss", "código_tuss", "tuss", "codigo", "código", "code"]);
          const descKey = findKey(row, ["descricao", "descrição", "description", "procedimento"]);
          const sectorKey = findKey(row, ["setor", "sector"]);
          const confKey = findKey(row, ["confianca", "confiança", "confidence"]);
          const activeKey = findKey(row, ["ativo", "active"]);
          const obsKey = findKey(row, ["observacao", "observação", "obs", "nota"]);
          const code = codeKey ? String(row[codeKey]).trim() : "";
          if (!code) return null;
          const sector = sectorKey ? norm(String(row[sectorKey])).trim() : "hemodinamica";
          const activeVal = activeKey ? String(row[activeKey]).trim().toLowerCase() : "sim";
          return {
            code_tuss: code,
            description: descKey ? String(row[descKey]) || null : null,
            sector_classified: SECTOR_OPTIONS.includes(sector) ? sector : "hemodinamica",
            confidence: confKey ? norm(String(row[confKey])).trim() || "alta" : "alta",
            active: !["nao", "não", "no", "false", "0", "inativo"].includes(activeVal),
            observation: obsKey ? String(row[obsKey]) || null : null,
          };
        })
        .filter(Boolean) as any[];
      if (toUpsert.length === 0) {
        toast({ title: "Nenhuma linha válida", description: "Colunas: codigo_tuss, descrição, setor, confiança, ativo, observação", variant: "destructive" });
        return;
      }
      for (const c of chunk(toUpsert, 500)) {
        const { error } = await supabase
          .from("procedure_classifications" as any)
          .upsert(c, { onConflict: "code_tuss,sector_classified" } as any);
        if (error) throw error;
      }
      load();
      toast({ title: `${toUpsert.length} classificações importadas` });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.code_tuss.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q))
    : rows;

  return (
    <>
      <PageHeader
        title="Classificação de procedimentos"
        description="Classifica automaticamente itens da base por código TUSS. Não calcula pagamento."
        actions={
          <>
            <label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <Button asChild variant="outline" disabled={importing}>
                <span>
                  <Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : "Importar"}
                </span>
              </Button>
            </label>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> Nova classificação
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova classificação</DialogTitle>
                </DialogHeader>
                <form onSubmit={create} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Código TUSS</Label>
                    <Input name="code_tuss" required maxLength={32} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrição</Label>
                    <Input name="description" maxLength={300} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Setor</Label>
                      <select name="sector_classified" defaultValue="hemodinamica" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                        {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Confiança</Label>
                      <select name="confidence" defaultValue="alta" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                        {CONFIDENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Observação</Label>
                    <Input name="observation" maxLength={300} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked /> Ativo
                  </label>
                  <Button type="submit" className="w-full">Criar</Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código TUSS ou descrição…"
            className="max-w-md"
          />
          <span className="text-xs text-muted-foreground">
            {filtered.length} de {rows.length}
          </span>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? "Nenhuma classificação. Crie ou importe uma planilha." : "Nenhum resultado."}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {filtered.slice(0, 300).map((r) => (
                  <div key={r.id} className="px-6 py-3 flex items-center gap-4">
                    <span className="font-mono text-sm text-muted-foreground w-28">{r.code_tuss}</span>
                    <span className="flex-1 text-sm truncate">{r.description ?? "—"}</span>
                    <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 w-32 text-center">
                      {r.sector_classified}
                    </span>
                    <span className="text-xs text-muted-foreground w-16 text-center">{r.confidence}</span>
                    <button
                      onClick={() => toggleActive(r)}
                      className={`text-xs rounded-full px-2 py-0.5 border ${r.active ? "bg-success-soft text-success border-success/30" : "bg-muted text-muted-foreground border-border"}`}
                    >
                      {r.active ? "ativo" : "inativo"}
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default ProcedureClassifications;