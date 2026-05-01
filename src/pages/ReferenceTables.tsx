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
import { Plus, Trash2, Upload, ChevronRight, ArrowLeft, Sparkles } from "lucide-react";
import * as XLSX from "xlsx";

type RefKind = "simples" | "cbhpm";
type RefTable = { id: string; name: string; description: string | null; year: number | null; kind: RefKind; created_at: string };
type RefItem = { id: string; code: string; description: string | null; amount: number | null; port: string | null; port_multiplier: number | null; aux_count: number | null };
type PortValue = { id: string; port: string; amount: number };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const findKey = (row: any, candidates: string[]) =>
  Object.keys(row).find((k) => candidates.some((c) => norm(k).includes(norm(c))));
const parseNumber = (v: any): number | null => {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
};
const chunk = <T,>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const ReferenceTables = () => {
  const { user } = useAuth();
  const [tables, setTables] = useState<RefTable[]>([]);
  const [selected, setSelected] = useState<RefTable | null>(null);
  const [items, setItems] = useState<RefItem[]>([]);
  const [portValues, setPortValues] = useState<PortValue[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadTables = () =>
    supabase.from("reference_tables").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setTables((data ?? []) as RefTable[]));
  const loadItems = (id: string) =>
    supabase.from("reference_table_items").select("*").eq("reference_table_id", id).order("code")
      .then(({ data }) => setItems((data ?? []) as RefItem[]));
  const loadPortValues = (id: string) =>
    supabase.from("reference_table_port_values").select("*").eq("reference_table_id", id).order("port")
      .then(({ data }) => setPortValues((data ?? []) as PortValue[]));

  useEffect(() => { document.title = "Tabelas de referência | MedPay"; loadTables(); }, []);
  useEffect(() => {
    if (selected) {
      loadItems(selected.id);
      if (selected.kind === "cbhpm") loadPortValues(selected.id);
    }
  }, [selected]);

  const createTable = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("reference_tables").insert({
      name: String(f.get("name")),
      description: String(f.get("description")) || null,
      year: f.get("year") ? Number(f.get("year")) : null,
      kind: String(f.get("kind") || "simples") as RefKind,
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

  // Classifica uma aba como tabela de "portes" (porte→valor) ou "códigos" (id/descrição/porte).
  // Permite tanto 1 arquivo com 2 abas quanto 2 arquivos separados.
  const classifySheet = (rows: any[], sheetName = ""): "ports" | "codes" | "unknown" => {
    const normalizedName = norm(sheetName);
    if (/valores?\s+por\s+porte|valores?\s+portes?/.test(normalizedName)) return "ports";
    if (rows.length === 0) return "unknown";
    const keys = Object.keys(rows[0]).map((k) => norm(k.trim()));
    const hasPorte = keys.some((k) => k === "porte" || k.startsWith("porte"));
    const hasValor = keys.some((k) => /valor|amount|preco/.test(k));
    const hasCodigo = keys.some(
      (k) => /id do procedim|codigo|code/.test(k) && !/grupo|subgrupo/.test(k),
    );
    const hasDescricao = keys.some((k) => /descri/.test(k));
    if (hasPorte && hasValor && keys.length <= 4) return "ports";
    if (hasCodigo && hasDescricao) return "codes";
    return "unknown";
  };

  const importFiles = async (files: FileList) => {
    if (!selected) return;
    setImporting(true);
    try {
      const allSheets: { name: string; rows: any[] }[] = [];
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        for (const sn of wb.SheetNames) {
          allSheets.push({
            name: `${file.name} → ${sn}`,
            rows: XLSX.utils.sheet_to_json<any>(wb.Sheets[sn], { defval: "" }),
          });
        }
      }

      const isCbhpm = selected.kind === "cbhpm";

      if (isCbhpm) {
        const portsSheet = allSheets.find((s) => classifySheet(s.rows, s.name) === "ports");
        const codesSheet = allSheets.find((s) => classifySheet(s.rows, s.name) === "codes");

        // Diagnóstico claro do que foi detectado em cada aba
        const detected = allSheets
          .map((s) => `${s.name}: ${classifySheet(s.rows, s.name)} (${s.rows.length} linhas)`)
          .join(" | ");
        console.log("[CBHPM import] arquivos detectados:", detected);

        if (!portsSheet && !codesSheet) {
          return toast({
            title: "Nenhuma planilha reconhecida",
            description: `Detectado: ${detected}. Suba 1 arquivo com 2 abas OU 2 arquivos separados.`,
            variant: "destructive",
          });
        }
        if (!portsSheet) {
          toast({
            title: "Aba de portes não encontrada",
            description: `Você precisa do arquivo "VALORES POR PORTE" também. Detectado: ${detected}`,
            variant: "destructive",
          });
        }
        if (!codesSheet) {
          toast({
            title: "Aba de códigos não encontrada",
            description: `Detectado: ${detected}`,
            variant: "destructive",
          });
        }

        const portsToInsert = portsSheet
          ? (portsSheet.rows
              .map((row) => {
                const entries = Object.entries(row).filter(([, value]) => String(value ?? "").trim() !== "");
                const pKey = Object.keys(row).find((k) => norm(k.trim()).startsWith("porte"));
                const vKey = findKey(row, ["valor", "amount", "preco", "preço"]);
                const portValue = pKey ? row[pKey] : entries.find(([, value]) => /^\d+[A-C]$/i.test(String(value).trim()))?.[1];
                const amountValue = vKey ? row[vKey] : entries.map(([, value]) => parseNumber(value)).find((value) => value != null && value > 1);
                const port = portValue ? String(portValue).trim().toUpperCase() : "";
                const amount = parseNumber(amountValue);
                if (!port || amount == null) return null;
                return { reference_table_id: selected.id, port, amount };
              })
              .filter(Boolean) as any[])
          : [];

        const itemsToInsert = codesSheet
          ? (codesSheet.rows
              .map((row) => {
                const codeKey = Object.keys(row).find(
                  (k) => /id do procedim|c[oó]digo/i.test(k) && !/grupo|subgrupo/i.test(k),
                );
                const descKey =
                  Object.keys(row).find((k) => /descri.*procedim/i.test(k)) ??
                  findKey(row, ["descrição", "descricao", "procedimento"]);
                // CBHPM oficial: o "Porte" real é a leitura conjunta de 3 colunas
                //   H = fração (0,10 / 0,04 / 1 / vazio)
                //   I = preposição "de" (descartável)
                //   J = porte base ("1A", "6B"…)
                // No pandas/xlsx essas colunas chegam como "Porte" (H), "Unnamed: 8" (I) e "Unnamed: 9" (J).
                const fractionKey =
                  Object.keys(row).find((k) => k.trim().toLowerCase() === "porte") ??
                  Object.keys(row).find((k) => /unnamed:\s*7/i.test(k));
                const portBaseKey =
                  Object.keys(row).find((k) => /unnamed:\s*9/i.test(k)) ??
                  Object.keys(row).find((k) => k.trim().toLowerCase() === "porte base");
                const auxKey = Object.keys(row).find((k) => /n[º°ºo]?\s*de\s*aux|aux/i.test(k));
                const code = codeKey ? String(row[codeKey]).trim() : "";
                if (!code || /^id do/i.test(code)) return null;
                // Porte base (chave para buscar valor monetário)
                let port: string | null = portBaseKey ? String(row[portBaseKey]).trim() : null;
                if (!port || port === "" || port.toLowerCase() === "nan") port = null;
                // Fração: pode vir como número (0,10) ou texto vazio. Vazio => 1 (porte cheio).
                const fracRaw = fractionKey ? row[fractionKey] : null;
                let portMultiplier: number = 1;
                if (fracRaw !== "" && fracRaw != null) {
                  const n = parseNumber(fracRaw);
                  if (n != null && n > 0) portMultiplier = n;
                }
                const auxRaw = auxKey ? parseNumber(row[auxKey]) : null;
                return {
                  reference_table_id: selected.id,
                  code,
                  description: descKey ? String(row[descKey]) : null,
                  port,
                  port_multiplier: portMultiplier,
                  aux_count: auxRaw != null ? Math.round(auxRaw) : null,
                  amount: null,
                };
              })
              .filter(Boolean) as any[])
          : [];

        if (portsToInsert.length === 0 && itemsToInsert.length === 0) {
          return toast({ title: "Nenhum dado reconhecido", variant: "destructive" });
        }

        // Limpa dados antigos antes de reimportar (evita duplicatas)
        if (portsToInsert.length > 0) {
          await supabase.from("reference_table_port_values").delete().eq("reference_table_id", selected.id);
        }
        if (itemsToInsert.length > 0) {
          await supabase.from("reference_table_items").delete().eq("reference_table_id", selected.id);
        }
        for (const c of chunk(portsToInsert, 500)) {
          const { error } = await supabase.from("reference_table_port_values").insert(c);
          if (error) throw error;
        }
        for (const c of chunk(itemsToInsert, 1000)) {
          const { error } = await supabase.from("reference_table_items").insert(c);
          if (error) throw error;
        }
        loadItems(selected.id);
        loadPortValues(selected.id);
        toast({
          title: "✅ CBHPM importada",
          description: `${portsToInsert.length} portes · ${itemsToInsert.length} códigos (${itemsToInsert.filter((i: any) => i.port).length} com porte)`,
        });
      } else {
        const rows = allSheets[0]?.rows ?? [];
        const toInsert = rows
          .map((row) => {
            const codeKey = findKey(row, ["codigo", "código", "code"]);
            const descKey = findKey(row, ["descricao", "descrição", "description", "procedimento"]);
            const valKey = findKey(row, ["valor", "amount", "preco", "preço"]);
            const code = codeKey ? String(row[codeKey]).trim() : "";
            if (!code) return null;
            return {
              reference_table_id: selected.id,
              code,
              description: descKey ? String(row[descKey]) : null,
              amount: parseNumber(valKey ? row[valKey] : null) ?? 0,
            };
          })
          .filter(Boolean) as any[];
        if (toInsert.length === 0)
          return toast({
            title: "Nenhuma linha válida",
            description: "Colunas esperadas: código, descrição, valor",
            variant: "destructive",
          });
        for (const c of chunk(toInsert, 1000)) {
          const { error } = await supabase.from("reference_table_items").insert(c);
          if (error) throw error;
        }
        loadItems(selected.id);
        toast({ title: `${toInsert.length} itens importados` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  if (selected) {
    const isCbhpm = selected.kind === "cbhpm";
    return (
      <>
        <PageHeader
          title={selected.name}
          description={`${items.length} códigos${isCbhpm ? ` · ${portValues.length} portes` : ""}${selected.year ? ` · ${selected.year}` : ""}`}
          actions={
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
              <label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const fs = e.target.files;
                    if (fs && fs.length) importFiles(fs);
                    e.currentTarget.value = "";
                  }}
                />
                <Button asChild disabled={importing}>
                  <span><Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : "Importar planilha(s)"}</span>
                </Button>
              </label>
            </>
          }
        />
        <div className="p-8 space-y-6">
          {isCbhpm ? (
            <div className="rounded-lg border border-info/30 bg-info-soft text-info p-3 text-xs flex gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Tabela CBHPM</strong> · você pode subir <strong>1 arquivo com 2 abas</strong>{" "}
                ou <strong>2 arquivos separados</strong> (segure Ctrl/Cmd para selecionar os dois):
                um com <strong>porte → valor</strong> e outro com{" "}
                <strong>códigos</strong> (ID, descrição, porte, nº de auxiliares). O valor de cada
                código é calculado por <code>valor_porte × multiplicador − deflator</code>.
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A planilha deve ter colunas: <strong>código</strong>, <strong>descrição</strong> (opcional) e{" "}
              <strong>valor</strong>.
            </p>
          )}

          {isCbhpm && (
            <Card className="shadow-card">
              <CardContent className="p-0">
                <div className="px-6 py-3 border-b border-border bg-muted/30 text-sm font-medium">
                  Valores por porte ({portValues.length})
                </div>
                {portValues.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                    Importe a planilha para popular os portes.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 p-4">
                    {portValues.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-md border border-border bg-card px-3 py-2 text-sm flex items-center justify-between"
                      >
                        <span className="font-mono text-muted-foreground">{p.port}</span>
                        <span className="font-medium">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-card">
            <CardContent className="p-0">
              <div className="px-6 py-3 border-b border-border bg-muted/30 text-sm font-medium">
                Códigos ({items.length}){items.length > 200 ? " · mostrando 200 primeiros" : ""}
              </div>
              {items.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                  Nenhum item. Importe uma planilha.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {items.slice(0, 200).map((it) => (
                    <div key={it.id} className="px-6 py-3 flex items-center gap-4">
                      <span className="font-mono text-sm text-muted-foreground w-28">{it.code}</span>
                      <span className="flex-1 text-sm truncate">{it.description ?? "—"}</span>
                      {isCbhpm ? (
                        <>
                          <span className="text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono w-24 text-center">
                            {it.port
                              ? it.port_multiplier && it.port_multiplier !== 1
                                ? `${it.port_multiplier.toLocaleString("pt-BR")} × ${it.port}`
                                : it.port
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground w-16 text-center">
                            {it.aux_count != null ? `${it.aux_count} aux` : "—"}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-medium">{formatCurrency(it.amount ?? 0)}</span>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => removeItem(it.id)}>
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
  }

  return (
    <>
      <PageHeader
        title="Tabelas de referência"
        description="CBHPM, AMB ou tabelas próprias usadas em regras de tabela diferenciada."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Nova tabela</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova tabela de referência</DialogTitle>
              </DialogHeader>
              <form onSubmit={createTable} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input name="name" required maxLength={100} placeholder="Ex: CBHPM 2018" />
                </div>
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Input name="description" maxLength={300} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ano</Label>
                  <Input name="year" type="number" min={1900} max={2100} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <select
                    name="kind"
                    defaultValue="simples"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="simples">Simples (código → valor)</option>
                    <option value="cbhpm">CBHPM (porte → valor)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    CBHPM importa duas abas: <em>VALORES POR PORTE</em> e <em>CÓDIGOS</em> (com porte e nº de aux).
                  </p>
                </div>
                <Button type="submit" className="w-full">Criar</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-8">
        <Card className="shadow-card">
          <CardContent className="p-0">
            {tables.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                Nenhuma tabela. Crie a primeira.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {tables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/40 text-left"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        {t.name}
                        {t.year ? <span className="text-muted-foreground font-normal"> · {t.year}</span> : null}
                        <span className="ml-2 text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 uppercase tracking-wide">
                          {t.kind}
                        </span>
                      </p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTable(t.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};
export default ReferenceTables;
