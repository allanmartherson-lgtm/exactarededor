import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Network, Upload, Loader2, Search, AlertCircle } from "lucide-react";

interface CostCenter {
  id: string;
  code_p12: string;
  code_p10: string | null;
  code_pai: string | null;
  level1: string | null;
  level2: string | null;
  level3: string | null;
  level4: string | null;
  level5: string | null;
  status: string | null;
  active: boolean;
  imported_at: string;
}

const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");
const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) for (const rk of Object.keys(row)) if (norm(rk) === norm(k)) return row[rk];
  for (const k of keys) for (const rk of Object.keys(row)) if (norm(rk).includes(norm(k))) return row[rk];
  return undefined;
};
const toStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
const isUnblocked = (status: string | null): boolean => {
  if (!status) return false;
  const n = status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return n === "nao bloqueado";
};

const CostCenters = () => {
  const { user, roles } = useAuth();
  const canManage = roles.includes("admin") || roles.includes("diretor");
  const [items, setItems] = useState<CostCenter[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => { document.title = "Centros de custo | MedPay"; load(); }, []);

  const load = async () => {
    const { data } = await supabase
      .from("cost_centers")
      .select("*")
      .order("code_p12")
      .limit(2000);
    setItems((data ?? []) as CostCenter[]);
  };

  const onImport = async (file: File) => {
    if (!canManage) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const rows = json
        .map((r) => ({
          code_p12: toStr(pick(r, ["COD_P12", "cod p12"])),
          code_p10: toStr(pick(r, ["COD_P10", "cod p10"])),
          code_pai: toStr(pick(r, ["COD_PAI", "cod pai"])),
          level1: toStr(pick(r, ["CENTRO_N1", "centro n1"])),
          level2: toStr(pick(r, ["CENTRO_N2"])),
          level3: toStr(pick(r, ["CENTRO_N3"])),
          level4: toStr(pick(r, ["CENTRO_N4"])),
          level5: toStr(pick(r, ["CENTRO_N5"])),
          status: toStr(pick(r, ["STATUS_MSIGA", "status"])),
        }))
        .filter((r) => r.code_p12 && isUnblocked(r.status));

      if (rows.length === 0) {
        toast({ title: "Nenhuma linha 'Não Bloqueado' encontrada", variant: "destructive" });
        setImporting(false);
        return;
      }

      // Carrega códigos atuais ativos para detectar removidos
      const { data: existing } = await supabase
        .from("cost_centers")
        .select("code_p12, active")
        .limit(20000);
      const existingMap = new Map((existing ?? []).map((e: any) => [e.code_p12, e.active]));
      const incomingCodes = new Set(rows.map((r) => r.code_p12!));

      // Upsert em lotes de 500
      const payload = rows.map((r) => ({
        ...r,
        active: true,
        imported_at: new Date().toISOString(),
        imported_by: user!.id,
      }));
      const chunkSize = 500;
      let upserted = 0;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);
        const { error } = await supabase.from("cost_centers").upsert(chunk, { onConflict: "code_p12" });
        if (error) throw error;
        upserted += chunk.length;
      }

      // Marcar como inativos os que sumiram
      const toDeactivate: string[] = [];
      for (const [code, active] of existingMap.entries()) {
        if (active && !incomingCodes.has(code)) toDeactivate.push(code);
      }
      if (toDeactivate.length) {
        await supabase
          .from("cost_centers")
          .update({ active: false })
          .in("code_p12", toDeactivate);
      }

      const created = rows.filter((r) => !existingMap.has(r.code_p12!)).length;
      const updated = upserted - created;
      toast({
        title: "Importação concluída",
        description: `${created} criados · ${updated} atualizados · ${toDeactivate.length} desativados`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Erro na importação", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = norm(search);
    return items
      .filter((it) => showInactive || it.active)
      .filter((it) => {
        if (!q) return true;
        return [it.code_p12, it.code_p10, it.level1, it.level2, it.level3, it.level4, it.level5]
          .some((v) => v && norm(v).includes(q));
      })
      .slice(0, 500);
  }, [items, search, showInactive]);

  const totals = useMemo(() => ({
    total: items.length,
    active: items.filter((i) => i.active).length,
  }), [items]);

  return (
    <>
      <PageHeader
        title="Centros de custo"
        description="Catálogo importado da controladoria (P12). Apenas centros com status 'Não Bloqueado' são considerados."
      />
      <div className="p-8 space-y-6">
        {canManage && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Importar planilha da controladoria</CardTitle>
              <CardDescription>
                Esperado: colunas <code>COD_P12</code>, <code>COD_P10</code>, <code>COD_PAI</code>, <code>CENTRO_N1..N5</code> e <code>STATUS_MSIGA</code>. Linhas bloqueadas são descartadas. Centros que sumirem são marcados como inativos (não excluídos).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="block border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary-soft/30 transition-colors">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
                />
                {importing ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Processando…
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm font-medium">Clique para enviar a base P12</p>
                    <p className="text-xs text-muted-foreground mt-1">Excel (.xlsx)</p>
                  </>
                )}
              </label>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Network className="h-4 w-4" /> Catálogo</CardTitle>
              <CardDescription>
                {totals.active} ativos · {totals.total} no total
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={showInactive ? "secondary" : "outline"} size="sm" onClick={() => setShowInactive((s) => !s)}>
                {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                placeholder="Buscar por código P12, gerência, setor, área…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {items.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Nenhum centro de custos cadastrado. {canManage && "Importe a planilha P12 acima."}
              </div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">P12</th>
                      <th className="text-left px-3 py-2 font-medium">Diretoria</th>
                      <th className="text-left px-3 py-2 font-medium">Gerência</th>
                      <th className="text-left px-3 py-2 font-medium">Setor</th>
                      <th className="text-left px-3 py-2 font-medium">Sub-área</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((it) => (
                      <tr key={it.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{it.code_p12}</td>
                        <td className="px-3 py-2">{it.level2}</td>
                        <td className="px-3 py-2">{it.level3}</td>
                        <td className="px-3 py-2">{it.level4}</td>
                        <td className="px-3 py-2 font-medium">{it.level5}</td>
                        <td className="px-3 py-2">
                          {it.active ? (
                            <Badge variant="outline" className="text-success border-success/30 bg-success-soft">Ativo</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 500 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Mostrando os primeiros 500 — refine a busca para ver mais.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default CostCenters;