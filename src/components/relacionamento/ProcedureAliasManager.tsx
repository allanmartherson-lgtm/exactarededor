// Gerenciador de aliases de procedimento — vincula nomes do Aurum
// (ds_procedimento) a nomes canônicos do Exacta (procedure_name do item
// principal), para que o Simulador consiga casar mesmo com grafias distintas.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Search, Trash2, Link2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";

// Normalizador (mesma regra do Simulador — lowercase, sem acento, alfanum + espaço).
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface AliasRow {
  id: string;
  alias_text: string;
  canonical_name: string;
  created_at: string;
}

interface SemMatchRow {
  nome: string;
  normalizado: string;
}

// Combobox simples: input filtra a lista, click seleciona. Cada candidato
// carrega uma marca de origem (pagamento vs. catálogo CBHPM) para o usuário
// entender de onde vem a sugestão.
function CanonicalPicker({
  candidates,
  originMap,
  onPick,
  disabled,
}: {
  candidates: string[];
  originMap: Map<string, Set<string>>;
  onPick: (name: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return candidates.slice(0, 30);
    return candidates.filter((c) => norm(c).includes(nq)).slice(0, 30);
  }, [q, candidates]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-xs"
          placeholder="Digite para buscar procedimento Exacta ou CBHPM..."
          value={q}
          disabled={disabled}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {filtered.map((c) => {
            const origens = originMap.get(norm(c)) ?? new Set<string>();
            return (
              <button
                key={c}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent focus:bg-accent focus:outline-none flex items-center justify-between gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(c);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="truncate">{c}</span>
                <span className="shrink-0 flex gap-1">
                  {origens.has("pagamento") && (
                    <Badge variant="secondary" className="text-[10px] py-0 h-4">pago</Badge>
                  )}
                  {origens.has("cbhpm") && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4">CBHPM</Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {open && q && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
          Nenhum procedimento Exacta/CBHPM encontrado.
        </div>
      )}
    </div>
  );
}


export function ProcedureAliasManager() {
  const hospitalId = useEnforcedHospitalId();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [aurumNames, setAurumNames] = useState<string[]>([]);
  const [exactaNames, setExactaNames] = useState<string[]>([]);
  const [exactaOriginMap, setExactaOriginMap] = useState<Map<string, Set<string>>>(new Map());
  const [aliases, setAliases] = useState<AliasRow[]>([]);

  // Carrega tudo em paralelo.
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [aurumRes, exactaRes, aliasRes] = await Promise.all([
          fetchAllPaginated<{ ds_procedimento: string | null }>((from, to) =>
            supabase
              .from("aurum_margem_procedimento" as never)
              .select("ds_procedimento")
              .eq("hospital_id", hospitalId)
              .range(from, to) as never,
          )
            .then((rows) => ({ rows, error: null as unknown }))
            .catch((error) => ({ rows: [] as { ds_procedimento: string | null }[], error })),
          // RPC agregada no banco (DISTINCT). Substitui a paginação em massa de
          // payment_items com OR ilike, que estourava statement_timeout (57014).
          (
            supabase.rpc as unknown as (
              name: string,
              args: Record<string, unknown>,
            ) => Promise<{ data: { procedure_name: string | null }[] | null; error: unknown }>
          )("get_exacta_principal_procedure_names", { p_hospital_id: hospitalId }),
          fetchAllPaginated<AliasRow>((from, to) =>
            supabase
              .from("procedure_aliases" as never)
              .select("id, alias_text, canonical_name, created_at")
              .eq("hospital_id", hospitalId)
              .range(from, to) as never,
          )
            .then((rows) => ({ rows, error: null as unknown }))
            .catch((error) => ({ rows: [] as AliasRow[], error })),
        ]);
        const aurumRows = aurumRes.rows;
        const exactaRows = (exactaRes.data ?? []) as { procedure_name: string | null; origem: string | null }[];
        const aliasRows = aliasRes.rows;
        const firstError =
          (aurumRes as { error: unknown }).error ??
          (exactaRes as { error: unknown }).error ??
          (aliasRes as { error: unknown }).error;
        if (firstError) {
          const msg =
            firstError instanceof Error
              ? firstError.message
              : typeof firstError === "object" && firstError && "message" in firstError
                ? String((firstError as { message: unknown }).message)
                : String(firstError);
          toast.error(`Falha ao carregar parte dos dados: ${msg}`);
        }
        if (cancelled) return;

        const aurumSet = new Map<string, string>(); // normalizado → nome original
        for (const r of aurumRows) {
          const nome = (r.ds_procedimento ?? "").trim();
          if (!nome) continue;
          const n = norm(nome);
          if (!n) continue;
          if (!aurumSet.has(n)) aurumSet.set(n, nome);
        }
        const exactaSet = new Map<string, string>();
        const originMap = new Map<string, Set<string>>();
        for (const r of exactaRows) {
          const nome = (r.procedure_name ?? "").trim();
          if (!nome) continue;
          const n = norm(nome);
          if (!n) continue;
          if (!exactaSet.has(n)) exactaSet.set(n, nome);
          const set = originMap.get(n) ?? new Set<string>();
          if (r.origem) set.add(r.origem);
          originMap.set(n, set);
        }

        setAurumNames(Array.from(aurumSet.values()).sort((a, b) => a.localeCompare(b, "pt-BR")));
        setExactaNames(Array.from(exactaSet.values()).sort((a, b) => a.localeCompare(b, "pt-BR")));
        setExactaOriginMap(originMap);
        setAliases(aliasRows);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Falha ao carregar dados: ${msg}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  // Calcula os "sem match": procedimentos Aurum que não têm match direto
  // no Exacta (normalizado) nem alias cadastrado.
  const semMatch: SemMatchRow[] = useMemo(() => {
    const exactaNormSet = new Set(exactaNames.map(norm));
    const aliasNormSet = new Set(aliases.map((a) => norm(a.alias_text)));
    const out: SemMatchRow[] = [];
    for (const nome of aurumNames) {
      const n = norm(nome);
      if (exactaNormSet.has(n)) continue;
      if (aliasNormSet.has(n)) continue;
      out.push({ nome, normalizado: n });
    }
    return out;
  }, [aurumNames, exactaNames, aliases]);

  const totalAurum = aurumNames.length;
  const vinculados = totalAurum - semMatch.length;

  const salvarAlias = async (nomeAurum: string, nomeExacta: string) => {
    setSaving(nomeAurum);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id ?? null;
      const { data, error } = await supabase
        .from("procedure_aliases" as never)
        .insert({
          hospital_id: hospitalId,
          alias_text: nomeAurum,
          alias_normalized: norm(nomeAurum),
          canonical_name: nomeExacta,
          source: "manual",
          created_by: userId,
        } as never)
        .select("id, alias_text, canonical_name, created_at")
        .single();
      if (error) throw error;
      setAliases((prev) => [data as unknown as AliasRow, ...prev]);
      toast.success(`Alias criado: "${nomeAurum}" → "${nomeExacta}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao salvar alias: ${msg}`);
    } finally {
      setSaving(null);
    }
  };

  const removerAlias = async (id: string) => {
    try {
      const { error } = await supabase
        .from("procedure_aliases" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
      setAliases((prev) => prev.filter((a) => a.id !== id));
      toast.success("Alias removido.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao remover: ${msg}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando aliases...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI de cobertura */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-sm">
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          {vinculados} de {totalAurum} procedimentos Aurum vinculados
        </Badge>
        {semMatch.length > 0 && (
          <Badge variant="outline" className="text-sm">
            {semMatch.length} sem match
          </Badge>
        )}
      </div>

      {/* Sem match */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Procedimentos Aurum sem match no Exacta
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {semMatch.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Todos os procedimentos Aurum estão vinculados. 🎉
            </div>
          ) : (
            <div className="overflow-auto max-h-[520px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-1/2">Procedimento Aurum</TableHead>
                    <TableHead>Vincular a (Exacta)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {semMatch.map((r) => (
                    <TableRow key={r.normalizado}>
                      <TableCell className="align-top text-xs">{r.nome}</TableCell>
                      <TableCell className="align-top">
                        <CanonicalPicker
                          candidates={exactaNames}
                          originMap={exactaOriginMap}
                          disabled={saving === r.nome}
                          onPick={(nomeExacta) => void salvarAlias(r.nome, nomeExacta)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aliases cadastrados */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aliases cadastrados ({aliases.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {aliases.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Nenhum alias cadastrado ainda.
            </div>
          ) : (
            <div className="overflow-auto max-h-[420px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Nome Aurum</TableHead>
                    <TableHead>Vinculado a</TableHead>
                    <TableHead className="w-40">Criado em</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aliases.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.alias_text}</TableCell>
                      <TableCell className="text-xs">{a.canonical_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover alias?</AlertDialogTitle>
                              <AlertDialogDescription>
                                O vínculo "{a.alias_text}" → "{a.canonical_name}" será removido.
                                O procedimento voltará a aparecer como "sem match" no Simulador.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void removerAlias(a.id)}>
                                Remover
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
