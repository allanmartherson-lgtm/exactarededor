// Gestão da tabela CBHPM por hospital: upload XLSX (full-replace) + busca.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Upload, Loader2, ListChecks, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";

interface CbhpmRow {
  id?: string;
  codigo: string;
  descricao: string;
  porte: string | null;
  valor_base: number;
  porte_anestesico: string | null;
  auxiliar_qtd: number | null;
  incidencia: number | null;
}

const COL_MAP: Record<string, keyof CbhpmRow> = {
  "Código": "codigo",
  "Codigo": "codigo",
  "Descrição": "descricao",
  "Descricao": "descricao",
  "Porte": "porte",
  "Valor Base": "valor_base",
  "Porte Anestésico": "porte_anestesico",
  "Porte Anestesico": "porte_anestesico",
  "Qtd Auxiliar": "auxiliar_qtd",
  "Auxiliar Qtd": "auxiliar_qtd",
  "Incidência": "incidencia",
  "Incidencia": "incidencia",
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseRow(
  row: Record<string, unknown>,
  hospitalId: string,
): (CbhpmRow & { hospital_id: string }) | null {
  const out: Partial<CbhpmRow> & { hospital_id: string } = { hospital_id: hospitalId };
  for (const [label, field] of Object.entries(COL_MAP)) {
    if (!(label in row)) continue;
    const raw = row[label];
    if (field === "valor_base" || field === "incidencia") {
      const n = toNumber(raw);
      (out as Record<string, unknown>)[field] = n ?? (field === "valor_base" ? 0 : 1);
    } else if (field === "auxiliar_qtd") {
      const n = toNumber(raw);
      out.auxiliar_qtd = n !== null ? Math.round(n) : 0;
    } else {
      const s = String(raw ?? "").trim();
      (out as Record<string, unknown>)[field] = s || null;
    }
  }
  if (!out.codigo || !out.descricao) return null;
  if (out.valor_base === undefined) out.valor_base = 0;
  return out as CbhpmRow & { hospital_id: string };
}

export function CbhpmTabelaCard() {
  const hospitalId = useEnforcedHospitalId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<CbhpmRow[]>([]);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    if (!hospitalId) {
      setCount(null);
      setItems([]);
      return;
    }
    const [{ count: c }, { data }] = await Promise.all([
      supabase
        .from("cbhpm_tabela" as unknown as never)
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId),
      supabase
        .from("cbhpm_tabela" as unknown as never)
        .select("id,codigo,descricao,porte,valor_base,porte_anestesico,auxiliar_qtd,incidencia")
        .eq("hospital_id", hospitalId)
        .order("descricao", { ascending: true })
        .limit(5000),
    ]);
    setCount(c ?? 0);
    setItems((data ?? []) as CbhpmRow[]);
  }, [hospitalId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleFile = useCallback(async (file: File) => {
    if (!hospitalId) {
      toast.error("Selecione um hospital ativo antes de importar.");
      return;
    }
    setBusy(true);
    setProgress(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      const mapped: Array<CbhpmRow & { hospital_id: string }> = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const m = parseRow(r, hospitalId);
        if (!m) continue;
        if (seen.has(m.codigo)) continue; // uniq por codigo (constraint)
        seen.add(m.codigo);
        mapped.push(m);
      }
      if (mapped.length === 0) {
        throw new Error("Nenhuma linha válida (verifique colunas Código e Descrição).");
      }
      const { error: delErr } = await supabase
        .from("cbhpm_tabela" as unknown as never)
        .delete()
        .eq("hospital_id", hospitalId);
      if (delErr) throw delErr;

      const CHUNK = 500;
      let done = 0;
      setProgress({ done, total: mapped.length });
      for (let i = 0; i < mapped.length; i += CHUNK) {
        const slice = mapped.slice(i, i + CHUNK);
        const { error: insErr } = await supabase
          .from("cbhpm_tabela" as unknown as never)
          .insert(slice as never);
        if (insErr) throw insErr;
        done += slice.length;
        setProgress({ done, total: mapped.length });
      }
      toast.success(`CBHPM: ${mapped.length} procedimentos importados.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar CBHPM.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [hospitalId, refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((r) =>
        r.codigo.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q))
      .slice(0, 100);
  }, [items, search]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-primary" />
          Tabela CBHPM
        </CardTitle>
        <Badge variant="secondary">
          {count === null ? "—" : `${count.toLocaleString("pt-BR")} procedimentos`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Upload substitui toda a base CBHPM deste hospital. Colunas esperadas:
          Código, Descrição, Porte, Valor Base, Porte Anestésico, Qtd Auxiliar, Incidência.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || !hospitalId}
          className="w-full sm:w-auto"
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {progress ? `Importando ${progress.done}/${progress.total}` : "Processando..."}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Atualizar tabela CBHPM
            </>
          )}
        </Button>

        {count !== null && count > 0 && (
          <div className="space-y-2 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por código ou descrição..."
                className="pl-8"
              />
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-16">Porte</TableHead>
                    <TableHead className="w-32 text-right">Valor Base</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        Nenhum procedimento encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => (
                      <TableRow key={r.id ?? r.codigo}>
                        <TableCell className="font-mono text-xs">{r.codigo}</TableCell>
                        <TableCell className="text-sm">{r.descricao}</TableCell>
                        <TableCell className="text-sm">{r.porte ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {r.valor_base.toLocaleString("pt-BR", {
                            style: "currency", currency: "BRL",
                          })}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {items.length > filtered.length && (
              <p className="text-xs text-muted-foreground">
                Mostrando {filtered.length} de {items.length}. Refine a busca para ver mais.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
