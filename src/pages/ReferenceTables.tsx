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
import { formatCurrency } from "@/lib/status";
import { Plus, Trash2, Upload, ChevronRight, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";

type RefTable = { id: string; name: string; description: string | null; year: number | null; created_at: string };
type RefItem = { id: string; code: string; description: string | null; amount: number };

const ReferenceTables = () => {
  const { user } = useAuth();
  const [tables, setTables] = useState<RefTable[]>([]);
  const [selected, setSelected] = useState<RefTable | null>(null);
  const [items, setItems] = useState<RefItem[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadTables = () => supabase.from("reference_tables").select("*").order("created_at", { ascending: false }).then(({ data }) => setTables((data ?? []) as RefTable[]));
  const loadItems = (id: string) => supabase.from("reference_table_items").select("*").eq("reference_table_id", id).order("code").then(({ data }) => setItems((data ?? []) as RefItem[]));

  useEffect(() => { document.title = "Tabelas de referência | MedPay"; loadTables(); }, []);
  useEffect(() => { if (selected) loadItems(selected.id); }, [selected]);

  const createTable = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("reference_tables").insert({
      name: String(f.get("name")),
      description: String(f.get("description")) || null,
      year: f.get("year") ? Number(f.get("year")) : null,
      created_by: user!.id,
    });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setOpen(false); loadTables(); toast({ title: "Tabela criada" });
  };

  const removeTable = async (id: string) => {
    if (!confirm("Excluir esta tabela e todos os itens?")) return;
    await supabase.from("reference_tables").delete().eq("id", id);
    if (selected?.id === id) setSelected(null);
    loadTables();
  };

  const removeItem = async (id: string) => {
    await supabase.from("reference_table_items").delete().eq("id", id);
    if (selected) loadItems(selected.id);
  };

  const importItems = async (file: File) => {
    if (!selected) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      const findKey = (row: any, candidates: string[]) => Object.keys(row).find((k) => candidates.some((c) => k.toLowerCase().includes(c)));
      const toInsert = rows.map((row) => {
        const codeKey = findKey(row, ["codigo", "código", "code"]);
        const descKey = findKey(row, ["descricao", "descrição", "description", "procedimento"]);
        const valKey = findKey(row, ["valor", "amount", "preco", "preço"]);
        const code = codeKey ? String(row[codeKey]).trim() : "";
        if (!code) return null;
        const raw = valKey ? String(row[valKey]).replace(/[R$\s.]/g, "").replace(",", ".") : "0";
        return { reference_table_id: selected.id, code, description: descKey ? String(row[descKey]) : null, amount: Number(raw) || 0 };
      }).filter(Boolean) as any[];
      if (toInsert.length === 0) return toast({ title: "Nenhuma linha válida", description: "Verifique colunas: código, descrição, valor", variant: "destructive" });
      const { error } = await supabase.from("reference_table_items").insert(toInsert);
      if (error) throw error;
      loadItems(selected.id);
      toast({ title: `${toInsert.length} itens importados` });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  if (selected) {
    return (
      <>
        <PageHeader
          title={selected.name}
          description={`${items.length} itens cadastrados${selected.year ? ` · ${selected.year}` : ""}`}
          actions={
            <>
              <Button variant="outline" onClick={() => setSelected(null)}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
              <label>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importItems(f); e.currentTarget.value = ""; }} />
                <Button asChild disabled={importing}><span><Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : "Importar planilha"}</span></Button>
              </label>
            </>
          }
        />
        <div className="p-8">
          <p className="text-xs text-muted-foreground mb-3">A planilha deve ter colunas: <strong>código</strong>, <strong>descrição</strong> (opcional) e <strong>valor</strong>.</p>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {items.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum item. Importe uma planilha.</p> :
                <div className="divide-y divide-border">
                  {items.map((it) => (
                    <div key={it.id} className="px-6 py-3 flex items-center gap-4">
                      <span className="font-mono text-sm text-muted-foreground w-24">{it.code}</span>
                      <span className="flex-1 text-sm truncate">{it.description ?? "—"}</span>
                      <span className="text-sm font-medium">{formatCurrency(it.amount)}</span>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(it.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Tabelas de referência" description="CBHPM, AMB ou tabelas próprias usadas em regras de tabela diferenciada."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nova tabela</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova tabela de referência</DialogTitle></DialogHeader>
              <form onSubmit={createTable} className="space-y-3">
                <div className="space-y-1.5"><Label>Nome</Label><Input name="name" required maxLength={100} placeholder="Ex: CBHPM 2018" /></div>
                <div className="space-y-1.5"><Label>Descrição</Label><Input name="description" maxLength={300} /></div>
                <div className="space-y-1.5"><Label>Ano</Label><Input name="year" type="number" min={1900} max={2100} /></div>
                <Button type="submit" className="w-full">Criar</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          {tables.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma tabela. Crie a primeira.</p> :
            <div className="divide-y divide-border">
              {tables.map((t) => (
                <button key={t.id} onClick={() => setSelected(t)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/40 text-left">
                  <div>
                    <p className="font-medium text-sm">{t.name}{t.year ? <span className="text-muted-foreground font-normal"> · {t.year}</span> : null}</p>
                    {t.description && <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); removeTable(t.id); }}><Trash2 className="h-4 w-4" /></Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>}
        </CardContent></Card>
      </div>
    </>
  );
};
export default ReferenceTables;