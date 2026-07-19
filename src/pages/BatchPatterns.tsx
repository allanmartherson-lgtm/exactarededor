/**
 * Cadastro de Padrões de Lote (payment_batch_patterns)
 * -----------------------------------------------------
 * Padrão = "assinatura recorrente" de um tipo de lote de pagamento (ex.
 * "HDF · Centro Cirúrgico · Empresas Prioridades"). Alimenta a seção
 * "Composição do mês" na aba Tendência e Projeção — em vez de o motor
 * agrupar por regex textual do nome do lote, agora agrupa por padrão
 * cadastrado ou alias reconhecido.
 *
 * Também permite VINCULAR lotes órfãos manualmente (`payments.batch_pattern_id`)
 * quando o texto do lote não bater com nenhum alias.
 *
 * Acessos: admin/diretor/analista do hospital ativo (RLS já aplica).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEnforcedHospitalId } from "@/contexts/HospitalContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Power, Link2, LayoutList, X } from "lucide-react";
import { formatCurrency } from "@/lib/status";

type BatchPattern = {
  id: string;
  hospital_id: string;
  code: string;
  label: string;
  aliases: string[];
  expected_setor: string | null;
  expected_convenio_group: string | null;
  avg_bruto: number | null;
  months_seen: number;
  last_seen_month: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type OrphanPayment = {
  id: string;
  reference: string | null;
  competence_month: string | null;
  bruto_total: number | null;
};

const slugify = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const fmtMonth = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${MONTHS[Number(m) - 1] ?? "?"}/${y?.slice(2) ?? "??"}`;
};

type Props = { embedded?: boolean };

export default function BatchPatterns({ embedded = false }: Props) {
  const hospitalId = useEnforcedHospitalId();
  const [patterns, setPatterns] = useState<BatchPattern[]>([]);
  const [orphans, setOrphans] = useState<OrphanPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<BatchPattern | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkOrphan, setLinkOrphan] = useState<OrphanPayment | null>(null);

  type Suggestion = {
    suggested_label: string;
    months_seen: number;
    avg_bruto: number | null;
    distinct_references: string[];
    payment_ids: string[];
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const runSuggest = async () => {
    if (!hospitalId) return;
    setSuggestLoading(true);
    setSelectedSuggestions(new Set());
    const { data, error } = await supabase.rpc("suggest_batch_patterns" as never, { p_history_months: 6 } as never);
    if (error) toast({ title: "Falha ao analisar histórico", description: error.message, variant: "destructive" });
    else setSuggestions(((data ?? []) as unknown) as Suggestion[]);
    setSuggestLoading(false);
  };

  const approveSelected = async () => {
    if (!hospitalId || selectedSuggestions.size === 0) return;
    const toCreate = suggestions.filter((s) => selectedSuggestions.has(s.suggested_label));
    let ok = 0; let fail = 0;
    for (const s of toCreate) {
      const code = slugify(s.suggested_label);
      const { data: created, error } = await supabase.from("payment_batch_patterns" as never)
        .insert({
          hospital_id: hospitalId,
          code,
          label: s.suggested_label,
          aliases: Array.from(new Set(s.distinct_references)),
          active: true,
        } as never)
        .select("id")
        .single();
      if (error || !created) { fail++; continue; }
      const patternId = (created as { id: string }).id;
      const { error: linkErr } = await supabase.from("payments")
        .update({ batch_pattern_id: patternId } as never)
        .in("id", s.payment_ids);
      if (linkErr) fail++; else ok++;
    }
    toast({ title: `${ok} padrão(ões) criado(s)`, description: fail > 0 ? `${fail} falha(s)` : undefined });
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    void load();
  };

  const load = async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [pRes, oRes] = await Promise.all([
      supabase.from("payment_batch_patterns" as never)
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("label"),
      supabase.from("payments")
        .select("id, reference, competence_month, bruto_total")
        .eq("hospital_id", hospitalId)
        .is("batch_pattern_id", null)
        .not("status", "in", "(rascunho,cancelado,rejeitado)")
        .gte("competence_month", new Date(new Date().setMonth(new Date().getMonth() - 4)).toISOString().slice(0, 10))
        .order("competence_month", { ascending: false })
        .limit(200),
    ]);
    if (pRes.error) toast({ title: "Falha ao carregar padrões", description: pRes.error.message, variant: "destructive" });
    else setPatterns(((pRes.data ?? []) as unknown) as BatchPattern[]);
    if (oRes.error) toast({ title: "Falha ao carregar lotes órfãos", description: oRes.error.message, variant: "destructive" });
    else setOrphans((oRes.data ?? []) as OrphanPayment[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hospitalId]);

  const visiblePatterns = useMemo(
    () => patterns.filter((p) => showInactive || p.active),
    [patterns, showInactive],
  );

  const linkedOrphans = new Set<string>();
  const orphanCount = orphans.filter((o) => !linkedOrphans.has(o.id)).length;

  const content = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="secondary" className="gap-1"><LayoutList className="h-3.5 w-3.5" /> {visiblePatterns.length} padrão(ões)</Badge>
          <Badge variant="outline" className="gap-1">{orphanCount} lote(s) sem padrão nos últimos 4 meses</Badge>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Mostrar inativos
          </label>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!hospitalId}>
          <Plus className="h-4 w-4 mr-1" /> Novo padrão
        </Button>
      </div>

      {/* Lista de padrões */}
      <section className="rounded-lg border bg-card">
        <header className="px-4 py-3 border-b flex items-center gap-2">
          <h3 className="text-sm font-semibold">Padrões cadastrados</h3>
        </header>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : visiblePatterns.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            Nenhum padrão cadastrado ainda. Crie um padrão a partir de um lote típico ou vincule um lote órfão abaixo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="px-4 py-2">Rótulo</th>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Aliases</th>
                  <th className="px-4 py-2 text-right">Média bruto</th>
                  <th className="px-4 py-2 text-center">Meses</th>
                  <th className="px-4 py-2">Último</th>
                  <th className="px-4 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiblePatterns.map((p) => (
                  <tr key={p.id} className={`border-t ${p.active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-2 font-medium">{p.label}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.code}</td>
                    <td className="px-4 py-2 text-xs">
                      <div className="flex flex-wrap gap-1 max-w-[420px]">
                        {(p.aliases ?? []).slice(0, 3).map((a, i) => (
                          <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] truncate max-w-[180px]">{a}</span>
                        ))}
                        {(p.aliases?.length ?? 0) > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{(p.aliases?.length ?? 0) - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.avg_bruto != null ? formatCurrency(Number(p.avg_bruto)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-center">{p.months_seen}</td>
                    <td className="px-4 py-2">{fmtMonth(p.last_seen_month)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={p.active ? "Inativar" : "Reativar"}
                          onClick={async () => {
                            const { error } = await supabase.from("payment_batch_patterns" as never)
                              .update({ active: !p.active } as never)
                              .eq("id", p.id);
                            if (error) toast({ title: "Falha", description: error.message, variant: "destructive" });
                            else { toast({ title: p.active ? "Padrão inativado" : "Padrão reativado" }); void load(); }
                          }}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sugestões automáticas */}
      <section className="rounded-lg border bg-card">
        <header className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Sugestões a partir do histórico</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Varre os lotes dos últimos 6 meses e propõe padrões recorrentes (≥ 2 meses) ainda não cadastrados.
            </p>
          </div>
          <div className="flex gap-2">
            {suggestions.length > 0 && (
              <Button size="sm" onClick={approveSelected} disabled={selectedSuggestions.size === 0}>
                Aprovar {selectedSuggestions.size} selecionado(s)
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={runSuggest} disabled={suggestLoading || !hospitalId}>
              {suggestLoading ? "Analisando…" : "Analisar histórico"}
            </Button>
          </div>
        </header>
        {suggestions.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {suggestLoading ? "Analisando lotes…" : "Nenhuma sugestão carregada. Clique em \"Analisar histórico\"."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Rótulo sugerido</th>
                  <th className="px-3 py-2">Variações vistas</th>
                  <th className="px-3 py-2 text-center">Meses</th>
                  <th className="px-3 py-2 text-right">Média bruto</th>
                  <th className="px-3 py-2 text-center">Lotes</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const checked = selectedSuggestions.has(s.suggested_label);
                  return (
                    <tr key={s.suggested_label} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedSuggestions);
                            if (e.target.checked) next.add(s.suggested_label); else next.delete(s.suggested_label);
                            setSelectedSuggestions(next);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{s.suggested_label}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap gap-1 max-w-[420px]">
                          {s.distinct_references.slice(0, 3).map((r, i) => (
                            <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] truncate max-w-[220px]">{r}</span>
                          ))}
                          {s.distinct_references.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{s.distinct_references.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">{s.months_seen}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.avg_bruto != null ? formatCurrency(Number(s.avg_bruto)) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">{s.payment_ids.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Órfãos */}
      <section className="rounded-lg border bg-card">
        <header className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Lotes sem padrão (últimos 4 meses)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lotes que não bateram com nenhum alias. Vincule manualmente para eles entrarem na composição do mês.
          </p>
        </header>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : orphans.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Todos os lotes recentes já estão associados a um padrão.</div>
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Referência</th>
                  <th className="px-4 py-2">Competência</th>
                  <th className="px-4 py-2 text-right">Bruto</th>
                  <th className="px-4 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="px-4 py-2">{o.reference ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">{fmtMonth(o.competence_month?.slice(0, 7) ?? null)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(Number(o.bruto_total ?? 0))}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setLinkOrphan(o)}>
                        <Link2 className="h-3.5 w-3.5 mr-1" /> Vincular
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Diálogo criar/editar */}
      <PatternDialog
        open={creating || !!editing}
        initial={editing}
        hospitalId={hospitalId}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); void load(); }}
      />

      {/* Diálogo vincular órfão */}
      <LinkOrphanDialog
        open={!!linkOrphan}
        orphan={linkOrphan}
        patterns={patterns.filter((p) => p.active)}
        onClose={() => setLinkOrphan(null)}
        onSaved={() => { setLinkOrphan(null); void load(); }}
      />
    </div>
  );

  if (embedded) return content;
  return (
    <div>
      <PageHeader
        title="Padrões de Lote"
        description="Cadastro de assinaturas recorrentes de lotes para reconhecimento na composição do mês."
        icon={LayoutList}
      />
      <div className="p-4 md:p-6">{content}</div>
    </div>
  );
}

// ------------- Diálogos -------------

function PatternDialog({
  open, initial, hospitalId, onClose, onSaved,
}: {
  open: boolean;
  initial: BatchPattern | null;
  hospitalId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState("");
  const [expectedSetor, setExpectedSetor] = useState("");
  const [expectedGroup, setExpectedGroup] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? "");
    setCode(initial?.code ?? "");
    setCodeManuallyEdited(!!initial);
    setAliases(initial?.aliases ?? []);
    setAliasInput("");
    setExpectedSetor(initial?.expected_setor ?? "");
    setExpectedGroup(initial?.expected_convenio_group ?? "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  const addAlias = () => {
    const v = aliasInput.trim();
    if (!v) return;
    if (aliases.some((a) => a.toLowerCase() === v.toLowerCase())) { setAliasInput(""); return; }
    setAliases([...aliases, v]);
    setAliasInput("");
  };

  const save = async () => {
    if (!hospitalId) return;
    const finalLabel = label.trim();
    const finalCode = (code.trim() || slugify(finalLabel)).slice(0, 80);
    if (!finalLabel || !finalCode) {
      toast({ title: "Preencha rótulo e código", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      label: finalLabel,
      code: finalCode,
      aliases,
      expected_setor: expectedSetor.trim() || null,
      expected_convenio_group: expectedGroup.trim() || null,
      notes: notes.trim() || null,
    };
    const { error } = initial
      ? await supabase.from("payment_batch_patterns" as never).update(payload as never).eq("id", initial.id)
      : await supabase.from("payment_batch_patterns" as never).insert(payload as never);
    setSaving(false);
    if (error) {
      toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: initial ? "Padrão atualizado" : "Padrão criado" });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar padrão" : "Novo padrão"}</DialogTitle>
          <DialogDescription>
            Rótulo humano + apelidos (variações de nome que o sistema deve reconhecer como este padrão).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Rótulo *</Label>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!codeManuallyEdited) setCode(slugify(e.target.value));
              }}
              placeholder="Ex.: HDF · Centro Cirúrgico · Empresas Prioridades"
            />
          </div>
          <div>
            <Label>Código estável *</Label>
            <Input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeManuallyEdited(true); }}
              placeholder="hdf-cc-empresas-prioridades"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label>Aliases (variações do nome do lote)</Label>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                placeholder='Ex.: "HDF - Centro Cirúrgico e Hemodinâmica - Empresas Prioridades"'
              />
              <Button type="button" variant="secondary" onClick={addAlias}>Adicionar</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {aliases.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                  {a}
                  <button
                    type="button"
                    onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {aliases.length === 0 && <span className="text-xs text-muted-foreground">Sem aliases ainda.</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Setor esperado (informacional)</Label>
              <Input value={expectedSetor} onChange={(e) => setExpectedSetor(e.target.value)} placeholder="Ex.: centro_cirurgico" />
            </div>
            <div>
              <Label className="text-xs">Grupo de convênio</Label>
              <Input value={expectedGroup} onChange={(e) => setExpectedGroup(e.target.value)} placeholder="Ex.: prioridades" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkOrphanDialog({
  open, orphan, patterns, onClose, onSaved,
}: {
  open: boolean;
  orphan: OrphanPayment | null;
  patterns: BatchPattern[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [learnAlias, setLearnAlias] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setSelected(""); setLearnAlias(true); } }, [open]);

  const link = async () => {
    if (!orphan || !selected) return;
    setSaving(true);
    const { error: linkErr } = await supabase.from("payments")
      .update({ batch_pattern_id: selected } as never)
      .eq("id", orphan.id);
    if (linkErr) {
      setSaving(false);
      toast({ title: "Falha ao vincular", description: linkErr.message, variant: "destructive" });
      return;
    }
    if (learnAlias && orphan.reference) {
      const target = patterns.find((p) => p.id === selected);
      const already = (target?.aliases ?? []).some((a) => a.toLowerCase() === orphan.reference!.toLowerCase());
      if (target && !already) {
        const nextAliases = [...(target.aliases ?? []), orphan.reference];
        await supabase.from("payment_batch_patterns" as never)
          .update({ aliases: nextAliases } as never)
          .eq("id", target.id);
      }
    }
    setSaving(false);
    toast({ title: "Lote vinculado", description: learnAlias ? "Alias aprendido — próximos lotes com nome parecido serão reconhecidos." : undefined });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular lote a um padrão</DialogTitle>
          <DialogDescription>
            <span className="block font-medium text-foreground">{orphan?.reference ?? "—"}</span>
            <span className="text-xs">{fmtMonth(orphan?.competence_month?.slice(0, 7) ?? null)} · {formatCurrency(Number(orphan?.bruto_total ?? 0))}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger><SelectValue placeholder="Escolha o padrão…" /></SelectTrigger>
            <SelectContent>
              {patterns.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={learnAlias} onCheckedChange={setLearnAlias} />
            Aprender esta referência como alias do padrão
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={link} disabled={saving || !selected}>{saving ? "Vinculando…" : "Vincular"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
