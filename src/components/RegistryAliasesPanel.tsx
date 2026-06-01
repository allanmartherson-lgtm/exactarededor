/**
 * Painel de gestão de aliases — usado dentro das páginas de cadastro
 * (Médicos, Convênios, Setores). Lê e escreve nas tabelas dedicadas
 * `doctor_aliases`, `convenio_aliases`, `sector_aliases` criadas pelo
 * fluxo de lookup estrito.
 *
 * Não confunde com `convenios.aliases` (array legado, ainda mantido pela
 * tela de import para retro-compatibilidade). Os dois pipelines convivem:
 * o resolver consulta primeiro a tabela dedicada e usa o array como fallback.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Loader2, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { normalize } from "@/lib/registryLookup";

type Kind = "doctor" | "convenio" | "sector";

interface Props {
  kind: Kind;
  canManage?: boolean;
}

type Row = {
  id: string;
  alias_text: string;
  alias_normalized: string | null;
  source: string | null;
  created_at: string;
  registry_key: string; // doctor_id | convenio_slug | sector_slug
  registry_label: string;
};

type RegistryOpt = { value: string; label: string };

const CONFIG = {
  doctor: {
    title: "Aliases de médicos",
    description:
      "Variações de nome usadas em planilhas (ex.: \"DR. JOÃO S.\", \"João Silva\") vinculadas ao cadastro oficial.",
    table: "doctor_aliases" as const,
    fk: "doctor_id" as const,
    registryTable: "doctors" as const,
    registryKey: "id" as const,
    registryLabel: "full_name" as const,
    selectExtra: "crm",
  },
  convenio: {
    title: "Aliases de convênios",
    description:
      "Variações encontradas em planilhas (ex.: \"BRADESCO\", \"Bradesco Saúde\") vinculadas ao convênio canônico.",
    table: "convenio_aliases" as const,
    fk: "convenio_slug" as const,
    registryTable: "convenios" as const,
    registryKey: "slug" as const,
    registryLabel: "name" as const,
    selectExtra: "",
  },
  sector: {
    title: "Aliases de setores",
    description:
      "Variações de setor da base do hospital (ex.: \"HEMODINAMICA\", \"HD\") vinculadas ao setor canônico.",
    table: "sector_aliases" as const,
    fk: "sector_slug" as const,
    registryTable: "sectors" as const,
    registryKey: "slug" as const,
    registryLabel: "name" as const,
    selectExtra: "",
  },
};

export function RegistryAliasesPanel({ kind, canManage = true }: Props) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [registry, setRegistry] = useState<RegistryOpt[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [registryQuery, setRegistryQuery] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const aliasSel = `id, alias_text, alias_normalized, source, created_at, ${cfg.fk}`;
    const [{ data: aliases, error: e1 }, { data: regs, error: e2 }] = await Promise.all([
      (supabase as any).from(cfg.table).select(aliasSel).order("created_at", { ascending: false }),
      (supabase as any)
        .from(cfg.registryTable)
        .select(`${cfg.registryKey}, ${cfg.registryLabel}${cfg.selectExtra ? ", " + cfg.selectExtra : ""}`)
        .eq("active", true)
        .order(cfg.registryLabel),
    ]);
    if (e1) toast({ title: "Erro ao carregar aliases", description: e1.message, variant: "destructive" });
    if (e2) toast({ title: "Erro ao carregar cadastro", description: e2.message, variant: "destructive" });

    const labelMap = new Map<string, string>();
    const opts: RegistryOpt[] = [];
    for (const r of regs ?? []) {
      const key = String((r as any)[cfg.registryKey]);
      const baseLabel = String((r as any)[cfg.registryLabel] ?? "");
      const extra = cfg.selectExtra ? (r as any)[cfg.selectExtra] : null;
      const label = extra ? `${baseLabel} — ${cfg.selectExtra.toUpperCase()} ${extra}` : baseLabel;
      labelMap.set(key, label);
      opts.push({ value: key, label });
    }
    setRegistry(opts);

    setRows(
      (aliases ?? []).map((a: any) => ({
        id: a.id,
        alias_text: a.alias_text,
        alias_normalized: a.alias_normalized,
        source: a.source,
        created_at: a.created_at,
        registry_key: a[cfg.fk],
        registry_label: labelMap.get(String(a[cfg.fk])) ?? "(cadastro removido)",
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (!q) return rows;
    return rows.filter(
      (r) => normalize(r.alias_text).includes(q) || normalize(r.registry_label).includes(q),
    );
  }, [rows, search]);

  const regCandidates = useMemo(() => {
    const q = normalize(registryQuery);
    if (!q) return registry.slice(0, 10);
    return registry.filter((o) => normalize(o.label).includes(q)).slice(0, 10);
  }, [registry, registryQuery]);

  const addAlias = async () => {
    if (!selectedKey || !aliasText.trim()) {
      toast({ title: "Preencha cadastro e alias", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = { alias_text: aliasText.trim(), source: "manual" };
      payload[cfg.fk] = selectedKey;
      const { error } = await (supabase as any).from(cfg.table).insert(payload);
      if (error) throw error;
      toast({ title: "Alias adicionado" });
      setAliasText("");
      setRegistryQuery("");
      setSelectedKey("");
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeAlias = async (id: string) => {
    if (!confirm("Remover este alias?")) return;
    const { error } = await (supabase as any).from(cfg.table).delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Alias removido" });
    await load();
  };

  const selectedLabel = registry.find((o) => o.value === selectedKey)?.label;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cfg.title}</CardTitle>
        <CardDescription>{cfg.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">Adicionar alias</div>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-9 pl-7"
                  placeholder="Buscar cadastro..."
                  value={selectedLabel ?? registryQuery}
                  onChange={(e) => {
                    setRegistryQuery(e.target.value);
                    setSelectedKey("");
                  }}
                />
                {!selectedKey && registryQuery && regCandidates.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow">
                    {regCandidates.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        className="block w-full text-left px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => {
                          setSelectedKey(c.value);
                          setRegistryQuery("");
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Input
                className="h-9"
                placeholder="Texto do alias (como aparece na planilha)"
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
              />
              <Button onClick={addAlias} disabled={saving || !selectedKey || !aliasText.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Adicionar</>}
              </Button>
            </div>
          </div>
        )}

        <Input
          placeholder="Buscar alias ou cadastro vinculado..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md h-9"
        />

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alias cadastrado.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {filtered.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{r.alias_text}</span>
                    <Badge variant={r.source === "auto" ? "outline" : "secondary"} className="text-[10px]">
                      {r.source ?? "manual"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">→ {r.registry_label}</p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="icon" onClick={() => removeAlias(r.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Total: {filtered.length} alias{filtered.length === 1 ? "" : "es"}
          {filtered.length !== rows.length ? ` (de ${rows.length})` : ""}.
        </p>
      </CardContent>
    </Card>
  );
}

export default RegistryAliasesPanel;
