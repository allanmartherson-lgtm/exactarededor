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
import { Plus, Trash2, Upload, ChevronRight, ArrowLeft, Sparkles, Wand2 } from "lucide-react";
import * as XLSX from "xlsx";
import { ImportWizard, type ImportProfile } from "@/components/ImportWizard";

type RefKind = "simples" | "cbhpm" | "tabela_propria" | "lista_codigos" | "pacote_combinacao";
type RefPurpose = "calculo" | "classificacao" | "exclusao" | "sem_acordo";
type RefTable = {
  id: string; name: string; description: string | null; year: number | null;
  kind: RefKind; purpose: RefPurpose;
  exclusion_severity: "bloqueio" | "aviso" | "info"; active: boolean;
  valid_from: string | null; valid_until: string | null; notes: string | null;
  package_only_main_surgeon: boolean;
  package_apply_auxiliaries: boolean;
  package_apply_particular: boolean;
  package_apply_intl_insurance: boolean;
  created_at: string;
};

const PURPOSE_LABEL: Record<RefPurpose, string> = {
  calculo: "Cálculo",
  classificacao: "Classificação",
  exclusao: "Exclusão / expurgo",
  sem_acordo: "Sem acordo (usar valor do convênio)",
};
const KIND_LABEL: Record<RefKind, string> = {
  simples: "Simples (código → valor)",
  cbhpm: "CBHPM (porte → valor)",
  tabela_propria: "Tabela própria",
  lista_codigos: "Lista de códigos",
  pacote_combinacao: "Pacote fixo (combinação de códigos)",
};
type RefItem = {
  id: string; code: string; description: string | null; amount: number | null;
  port: string | null; port_multiplier: number | null; aux_count: number | null;
  package_id: string | null; tuss_codes: string[] | null; package_amount: number | null; notes: string | null;
};
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
  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  const wizardProfile: ImportProfile | null = selected
    ? {
        entity: "reference_table_items",
        fixedContext: { reference_table_id: selected.id },
        fields:
          selected.kind === "lista_codigos"
            ? [
                { key: "code", label: "Código", required: true, uniqueKey: true, aliases: ["codigo", "cod", "tuss"] },
                { key: "description", label: "Descrição", aliases: ["descricao", "procedimento", "nome"] },
              ]
            : selected.kind === "pacote_combinacao"
              ? [
                  { key: "package_id", label: "ID do pacote", required: true, aliases: ["pacote_id", "pacote", "package", "id"] },
                  { key: "tuss_codes", label: "Códigos TUSS", required: true, type: "array", aliases: ["codigos_tuss", "codigos", "tuss", "codes"] },
                  { key: "description", label: "Descrição", aliases: ["descricao", "procedimento"] },
                  { key: "package_amount", label: "Valor do pacote", required: true, type: "number", aliases: ["valor_pacote", "valor", "amount", "preco"] },
                  { key: "notes", label: "Observação", aliases: ["observacao", "obs", "notes"] },
                ]
              : [
                  { key: "code", label: "Código", required: true, uniqueKey: true, aliases: ["codigo", "cod", "tuss"] },
                  { key: "description", label: "Descrição", aliases: ["descricao", "procedimento", "nome"] },
                  {
                    key: "amount",
                    label: "Valor",
                    // Apenas finalidade "calculo" exige valor. Exclusão e Sem acordo ignoram.
                    required: selected.purpose !== "exclusao" && selected.purpose !== "sem_acordo",
                    type: "number",
                    aliases: ["valor", "preco", "preço", "amount"],
                  },
                ],
      }
    : null;

  const loadTables = () =>
    supabase.from("reference_tables").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setTables((data ?? []) as RefTable[]));
  const loadItems = async (id: string) => {
    const PAGE = 1000;
    let from = 0;
    const all: RefItem[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("reference_table_items")
        .select("*")
        .eq("reference_table_id", id)
        .order("code")
        .range(from, from + PAGE - 1);
      if (error) break;
      const batch = (data ?? []) as RefItem[];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    setItems(all);
  };
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
    const purpose = String(f.get("purpose") || "calculo") as RefPurpose;
    const { error } = await supabase.from("reference_tables").insert({
      name: String(f.get("name")),
      description: String(f.get("description")) || null,
      year: f.get("year") ? Number(f.get("year")) : null,
      kind: String(f.get("kind") || "simples") as RefKind,
      purpose,
      exclusion_severity: purpose === "exclusao" ? String(f.get("exclusion_severity") || "bloqueio") : "bloqueio",
      valid_from: String(f.get("valid_from") || "") || null,
      valid_until: String(f.get("valid_until") || "") || null,
      notes: String(f.get("notes") || "") || null,
      package_only_main_surgeon: f.get("package_only_main_surgeon") === "on",
      package_apply_auxiliaries: f.get("package_apply_auxiliaries") === "on",
      package_apply_particular: f.get("package_apply_particular") === "on",
      package_apply_intl_insurance: f.get("package_apply_intl_insurance") === "on",
      active: true,
      created_by: user!.id,
    } as any);
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

  const addManualCodes = async () => {
    if (!selected) return;
    // Aceita códigos separados por vírgula, ponto-e-vírgula, espaço ou nova linha. Opcional "código - descrição".
    const lines = manualText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast({ title: "Informe ao menos um código", variant: "destructive" });
      return;
    }
    const parsed = lines.map((ln) => {
      const m = ln.match(/^([^\s\-–—|\t]+)[\s\-–—|\t]+(.+)$/);
      const code = (m ? m[1] : ln).trim();
      const description = m ? m[2].trim() : null;
      return { code, description };
    });
    const existing = new Set(items.map((i) => i.code));
    const toInsert = parsed
      .filter((p) => p.code && !existing.has(p.code))
      .map((p) => ({
        reference_table_id: selected.id,
        code: p.code,
        description: p.description,
      }));
    if (toInsert.length === 0) {
      toast({ title: "Nada a adicionar", description: "Todos os códigos já estão na tabela." });
      return;
    }
    setManualSaving(true);
    const { error } = await supabase.from("reference_table_items").insert(toInsert as any);
    setManualSaving(false);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: `${toInsert.length} código(s) adicionado(s)` });
    setManualText("");
    setManualOpen(false);
    loadItems(selected.id);
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
                const explicitPortValue = pKey ? String(row[pKey] ?? "").trim() : "";
                const portValue = explicitPortValue || entries.find(([, value]) => /^\d+[A-C]$/i.test(String(value).trim()))?.[1];
                const explicitAmount = vKey ? parseNumber(row[vKey]) : null;
                const amountValue = explicitAmount ?? entries.map(([, value]) => parseNumber(value)).find((value) => value != null && value > 1);
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
    const q = search.trim().toLowerCase();
    const filteredItems = q
      ? items.filter(
          (it) =>
            it.code.toLowerCase().includes(q) ||
            (it.description ?? "").toLowerCase().includes(q) ||
            (it.port ?? "").toLowerCase().includes(q),
        )
      : items;
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
              {!isCbhpm && (
                <>
                  <Button variant="outline" onClick={() => setManualOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Adicionar manualmente
                  </Button>
                  <Button variant="outline" onClick={() => setWizardOpen(true)}>
                    <Wand2 className="h-4 w-4 mr-2" /> Importar com assistente
                  </Button>
                </>
              )}
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
                <Button asChild disabled={importing} variant={isCbhpm ? "default" : "ghost"}>
                  <span><Upload className="h-4 w-4 mr-2" /> {importing ? "Importando..." : isCbhpm ? "Importar planilha(s)" : "Importar direto"}</span>
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
                <div className="flex items-center gap-3 flex-wrap">
                  <span>
                    Códigos ({filteredItems.length}
                    {q ? ` de ${items.length}` : ""})
                    {filteredItems.length > 200 ? " · mostrando 200 primeiros" : ""}
                  </span>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por código, descrição ou porte…"
                    className="h-8 ml-auto w-full sm:w-72"
                  />
                </div>
              </div>
              {filteredItems.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                  {items.length === 0 ? "Nenhum item. Importe uma planilha." : "Nenhum resultado para a busca."}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filteredItems.slice(0, 200).map((it) => {
                    const isPkg = selected.kind === "pacote_combinacao";
                    return (
                      <div key={it.id} className="px-6 py-3 flex items-start gap-4 hover:bg-muted/20 transition-colors">
                        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center">
                          <span className="font-mono text-xs sm:text-sm text-muted-foreground sm:col-span-2 break-all">
                            {isPkg ? (it.package_id ?? it.code) : it.code}
                          </span>
                          <span className="text-sm font-medium sm:col-span-5 break-words whitespace-normal">
                            {it.description ?? "—"}
                          </span>
                          
                          {isCbhpm ? (
                            <div className="sm:col-span-4 flex items-center gap-2 flex-wrap sm:justify-end">
                              <span className="text-[10px] sm:text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono whitespace-nowrap">
                                {it.port
                                  ? it.port_multiplier && it.port_multiplier !== 1
                                    ? `${it.port_multiplier.toLocaleString("pt-BR")} × ${it.port}`
                                    : it.port
                                  : "—"}
                              </span>
                              <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
                                {it.aux_count != null ? `${it.aux_count} aux` : "—"}
                              </span>
                            </div>
                          ) : isPkg ? (
                            <div className="sm:col-span-4 flex flex-col sm:items-end gap-1">
                              <span className="text-[10px] sm:text-xs font-mono text-muted-foreground break-all line-clamp-2">
                                {(it.tuss_codes ?? []).join(" + ") || "—"}
                              </span>
                              <span className="text-sm font-semibold">{formatCurrency(it.package_amount ?? 0)}</span>
                            </div>
                          ) : (
                            <div className="sm:col-span-4 flex sm:justify-end">
                              <span className="text-sm font-semibold">{formatCurrency(it.amount ?? 0)}</span>
                            </div>
                          )}
                        </div>
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => removeItem(it.id)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        {wizardProfile && (
          <ImportWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            title={`Importar para ${selected.name}`}
            profile={wizardProfile}
            onComplete={() => loadItems(selected.id)}
          />
        )}
        <Dialog open={manualOpen} onOpenChange={setManualOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar códigos manualmente</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Um código por linha (ou separados por vírgula). Opcional: <code>código - descrição</code>.
              </p>
              <textarea
                className="w-full min-h-[160px] rounded-md border border-input bg-background p-2 text-sm font-mono"
                placeholder={"30729220\n30731119 - Reparação ligamentar"}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setManualOpen(false)}>Cancelar</Button>
                <Button onClick={addManualCodes} disabled={manualSaving}>
                  {manualSaving ? "Salvando..." : "Adicionar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
            <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col">
              <DialogHeader className="p-6 pb-2">
                <DialogTitle>Nova tabela de referência</DialogTitle>
              </DialogHeader>
              <form onSubmit={createTable} className="flex-1 overflow-y-auto p-6 pt-2 space-y-4 box-border min-w-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Nome</Label>
                  <Input name="name" required maxLength={100} placeholder="Ex: CBHPM 2018" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Descrição</Label>
                  <Input name="description" maxLength={300} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ano</Label>
                  <Input name="year" type="number" min={1900} max={2100} />
                </div>
                <div className="space-y-1.5">
                  <Label>Finalidade</Label>
                  <select
                    name="purpose"
                    defaultValue="calculo"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    onChange={(e) => {
                      const sev = document.getElementById("rt-sev-wrap");
                      if (sev) sev.style.display = e.target.value === "exclusao" ? "" : "none";
                    }}
                  >
                    <option value="calculo">Cálculo (calcula valor esperado)</option>
                    <option value="classificacao">Classificação (categoriza códigos)</option>
                    <option value="exclusao">Exclusão / expurgo (não pagar)</option>
                    <option value="sem_acordo">Sem acordo (usar valor do convênio)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Não misture códigos pagáveis e não pagáveis na mesma finalidade.
                  </p>
                </div>
                <div id="rt-sev-wrap" className="space-y-1.5" style={{ display: "none" }}>
                  <Label>Severidade da exclusão</Label>
                  <select
                    name="exclusion_severity"
                    defaultValue="bloqueio"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="bloqueio">Bloqueio (reprovado, R$ 0)</option>
                    <option value="aviso">Aviso (alerta, R$ 0)</option>
                    <option value="info">Informativo (apenas registra)</option>
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Tipo estrutural</Label>
                  <select
                    name="kind"
                    defaultValue="simples"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    onChange={(e) => {
                      const pkg = document.getElementById("rt-pkg-wrap");
                      if (pkg) pkg.style.display = e.target.value === "pacote_combinacao" ? "" : "none";
                    }}
                  >
                    <option value="simples">Simples (código → valor)</option>
                    <option value="cbhpm">CBHPM (porte → valor)</option>
                    <option value="tabela_propria">Tabela própria (código → valor, layout livre)</option>
                    <option value="lista_codigos">Lista de códigos (sem valor)</option>
                    <option value="pacote_combinacao">Pacote fixo (combinação de códigos)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    <strong>CBHPM</strong>: importa abas de portes e códigos.{" "}
                    <strong>Simples / Tabela própria</strong>: planilha com colunas <em>código, descrição, valor</em>.{" "}
                    <strong>Lista de códigos</strong>: apenas <em>código</em> (e descrição opcional).{" "}
                    <strong>Pacote fixo</strong>: <em>pacote_id, códigos_tuss, descrição, valor_pacote</em> — quando os códigos do atendimento baterem com a combinação, o esperado é o valor do pacote.
                  </p>
                </div>
                <div id="rt-pkg-wrap" className="space-y-2 rounded-md border border-border p-3 md:col-span-2" style={{ display: "none" }}>
                  <div className="text-sm font-medium">Configuração do pacote</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="package_only_main_surgeon" /> Aplica somente ao cirurgião principal
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="package_apply_auxiliaries" defaultChecked /> Aplica a auxiliares
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="package_apply_particular" defaultChecked /> Aplica a convênio particular
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="package_apply_intl_insurance" defaultChecked /> Aplica a seguradora internacional
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 md:col-span-2">
                  <div className="space-y-1.5">
                    <Label>Vigência início</Label>
                    <Input name="valid_from" type="date" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Vigência fim</Label>
                    <Input name="valid_until" type="date" />
                  </div>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Observações</Label>
                </div>
                <div className="pt-4">
                  <Button type="submit" className="w-full md:col-span-2">Criar</Button>
                </div>
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
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/40 text-left transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="font-medium text-sm">
                        {t.name}
                        {t.year ? <span className="text-muted-foreground font-normal"> · {t.year}</span> : null}
                        <span className="ml-2 text-xs rounded-full border border-border bg-muted/60 px-2 py-0.5">
                          {KIND_LABEL[t.kind] ?? t.kind}
                        </span>
                        <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${t.purpose === "exclusao" ? "bg-destructive/10 text-destructive border border-destructive/30" : t.purpose === "classificacao" ? "bg-info-soft text-info border border-info/30" : t.purpose === "sem_acordo" ? "bg-warning/10 text-warning border border-warning/30" : "bg-success/10 text-success border border-success/30"}`}>
                          {PURPOSE_LABEL[t.purpose ?? "calculo"]}
                        </span>
                        {t.active === false && (
                          <span className="ml-2 text-xs rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">inativa</span>
                        )}
                        {(t.valid_from || t.valid_until) && (
                          <span className="ml-2 text-xs text-muted-foreground font-normal">
                            vigência {t.valid_from ?? "—"} → {t.valid_until ?? "—"}
                          </span>
                        )}
                      </p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      )}
                      {t.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">{t.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await supabase.from("reference_tables").update({ active: !t.active } as any).eq("id", t.id);
                          loadTables();
                        }}
                      >
                        {t.active === false ? "Ativar" : "Desativar"}
                      </Button>
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
