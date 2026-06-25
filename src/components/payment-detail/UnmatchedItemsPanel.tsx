import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Download,
  Link2,
  Plus,
  Loader2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Users,
} from "lucide-react";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { CopilotCard } from "@/components/copilot/CopilotCard";
import { DuplicateCheckBanner } from "@/components/copilot/DuplicateCheckBanner";
import { matchCompany } from "@/lib/parsePaymentFile";



interface UnmatchedGroup {
  raw_company_name: string;
  items_count: number;
  gross_total: number;
  sample_doctor: string | null;
  source_files: string[];
  best_score: number;
  suggestion_id: string | null;
  suggestion_name: string | null;
}

export function UnmatchedItemsPanel({
  paymentId,
  onChanged,
}: {
  paymentId: string;
  onChanged?: () => void;
}) {
  const [groups, setGroups] = useState<UnmatchedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState<UnmatchedGroup | null>(null);
  const [createOpen, setCreateOpen] = useState<UnmatchedGroup | null>(null);
  const [ignoreOpen, setIgnoreOpen] = useState<UnmatchedGroup | null>(null);
  const [picked, setPicked] = useState<CompanyOption | null>(null);
  const [learnAlias, setLearnAlias] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDoc, setNewDoc] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string; document: string | null }[]>([]);

  useEffect(() => {
    if (!createOpen) return;
    if (allCompanies.length > 0) return;
    (async () => {
      const { data } = await supabase
        .from("companies")
        .select("id,name,document")
        .order("name")
        .limit(500);
      setAllCompanies((data ?? []) as { id: string; name: string; document: string | null }[]);
    })();
  }, [createOpen, allCompanies.length]);


  const load = async () => {
    setLoading(true);

    // 1) Participantes do rateio deste pagamento — sugestões SÓ podem vir daqui.
    const { data: pcg } = await supabase
      .from("payment_company_groups")
      .select("company_id")
      .eq("payment_id", paymentId);
    const participantIds = Array.from(
      new Set((pcg ?? []).map((r: any) => r.company_id).filter(Boolean)),
    ) as string[];

    let participants: { id: string; name: string; aliases: string[] | null }[] = [];
    if (participantIds.length > 0) {
      const { data: comps } = await supabase
        .from("companies")
        .select("id,name,aliases")
        .in("id", participantIds);
      participants = (comps ?? []) as any[];
    }
    const participantSet = new Set(participants.map((c) => c.id));

    const all: any[] = [];
    let from = 0;
    const PAGE = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("payment_unmatched_items")
        .select(
          "raw_company_name, gross_amount, procedure_amount, doctor_name, source_file, match_score, match_suggestion_id, match_suggestion_name",
        )
        .eq("payment_id", paymentId)
        .eq("status", "pending")
        .range(from, from + PAGE - 1);
      if (error) break;
      all.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const map = new Map<string, UnmatchedGroup>();
    for (const it of all) {
      const key = (it.raw_company_name ?? "").trim() || "(sem nome)";
      const cur =
        map.get(key) ??
        ({
          raw_company_name: key,
          items_count: 0,
          gross_total: 0,
          sample_doctor: null,
          source_files: [],
          best_score: 0,
          suggestion_id: null,
          suggestion_name: null,
        } as UnmatchedGroup);
      cur.items_count++;
      const paidValue = Number(it.gross_amount ?? 0);
      const baseValue = Number(it.procedure_amount ?? 0);
      cur.gross_total += paidValue !== 0 ? paidValue : baseValue;
      if (!cur.sample_doctor) cur.sample_doctor = it.doctor_name ?? null;
      if (it.source_file && !cur.source_files.includes(it.source_file)) {
        cur.source_files.push(it.source_file);
      }
      // Só aceita a sugestão salva se a empresa sugerida faz parte do rateio.
      const score = Number(it.match_score ?? 0);
      if (
        it.match_suggestion_id &&
        participantSet.has(it.match_suggestion_id) &&
        score > cur.best_score
      ) {
        cur.best_score = score;
        cur.suggestion_id = it.match_suggestion_id;
        cur.suggestion_name = it.match_suggestion_name ?? null;
      }
      map.set(key, cur);
    }

    // 2) Para grupos sem sugestão válida, recomputa contra participantes do rateio.
    if (participants.length > 0) {
      const registry = participants.map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases ?? [],
        document: null as string | null,
      })) as any[];
      for (const g of map.values()) {
        if (g.suggestion_id) continue;
        const { company, score } = matchCompany(g.raw_company_name, registry);
        if (company && score >= 0.6) {
          g.suggestion_id = company.id;
          g.suggestion_name = company.name;
          g.best_score = score;
        }
      }
    }

    setGroups([...map.values()].sort((a, b) => b.gross_total - a.gross_total));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const totalItems = useMemo(() => groups.reduce((s, x) => s + x.items_count, 0), [groups]);
  const totalValue = useMemo(() => groups.reduce((s, x) => s + x.gross_total, 0), [groups]);

  const downloadCsv = () => {
    const header =
      "empresa_bruta;arquivo;qtd_itens;valor_bruto_total;sugestao;score;medico_amostra";
    const lines = groups.map(
      (g) =>
        `"${g.raw_company_name.replace(/"/g, '""')}";"${g.source_files.join(" | ").replace(/"/g, '""')}";${g.items_count};${g.gross_total
          .toFixed(2)
          .replace(".", ",")};"${(g.suggestion_name ?? "").replace(/"/g, '""')}";${g.best_score.toFixed(2).replace(".", ",")};"${(g.sample_doctor ?? "").replace(/"/g, '""')}"`,
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `itens-em-quarentena-${paymentId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doLink = async (g: UnmatchedGroup, companyId: string, companyName: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("link_unmatched_items_to_company", {
        _payment_id: paymentId,
        _raw_company_name: g.raw_company_name,
        _company_id: companyId,
        _learn_alias: learnAlias,
      });
      if (error) throw error;

      // Recalibra totais do payment
      const { data: items } = await supabase
        .from("payment_items")
        .select("gross_amount, procedure_amount")
        .eq("payment_id", paymentId);
      const total = (items ?? []).reduce((s, r: any) => {
        const paidValue = Number(r.gross_amount ?? 0);
        const baseValue = Number(r.procedure_amount ?? 0);
        return s + (paidValue !== 0 ? paidValue : baseValue);
      }, 0);
      await supabase
        .from("payments")
        .update({ items_count: items?.length ?? 0, total_amount: total })
        .eq("id", paymentId);

      toast.success(`${data ?? 0} item(ns) vinculados a ${companyName}. Disparando análise…`);

      await supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: paymentId, only_companies: [companyName] },
      });

      setLinkOpen(null);
      setCreateOpen(null);
      setPicked(null);
      setNewName("");
      setNewDoc("");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(`Erro ao vincular: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const linkToExisting = async (g: UnmatchedGroup) => {
    if (!picked) return;
    await doLink(g, picked.id, picked.name);
  };

  const createAndLink = async (g: UnmatchedGroup) => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    setBusy(true);
    try {
      const aliases = g.raw_company_name && g.raw_company_name !== name ? [g.raw_company_name] : [];
      const { data: created, error } = await supabase
        .from("companies")
        .insert({ name, document: newDoc.trim() || null, aliases })
        .select("id, name")
        .single();
      if (error) throw error;
      await doLink(g, created.id, created.name);
    } catch (e: any) {
      toast.error(`Erro ao criar empresa: ${e?.message ?? e}`);
      setBusy(false);
    }
  };

  const ignore = async (g: UnmatchedGroup) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("ignore_unmatched_items", {
        _payment_id: paymentId,
        _raw_company_name: g.raw_company_name,
        _reason: ignoreReason.trim() || null,
      });
      if (error) throw error;
      toast.success(`Grupo "${g.raw_company_name}" descartado.`);
      setIgnoreOpen(null);
      setIgnoreReason("");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const distributeByDoctor = async (g: UnmatchedGroup) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(
        "distribute_unmatched_items_by_doctor",
        { _payment_id: paymentId, _raw_company_name: g.raw_company_name },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const linked = Number(row?.linked ?? 0);
      const unresolved = Number(row?.unresolved ?? 0);

      // Recalibra totais do payment
      const { data: items } = await supabase
        .from("payment_items")
        .select("gross_amount, procedure_amount")
        .eq("payment_id", paymentId);
      const total = (items ?? []).reduce((s, r: any) => {
        const paidValue = Number(r.gross_amount ?? 0);
        const baseValue = Number(r.procedure_amount ?? 0);
        return s + (paidValue !== 0 ? paidValue : baseValue);
      }, 0);
      await supabase
        .from("payments")
        .update({ items_count: items?.length ?? 0, total_amount: total })
        .eq("id", paymentId);

      if (linked > 0) {
        toast.success(
          `${linked} item(ns) distribuídos entre PJs do pool. ${unresolved > 0 ? `${unresolved} sem vínculo médico→PJ permanecem pendentes.` : ""} Disparando análise…`,
        );
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: { payment_id: paymentId },
        });
      } else {
        toast.warning(
          `Nenhum item pôde ser distribuído. ${unresolved} item(ns) sem vínculo médico→PJ entre os participantes. Cadastre os vínculos em Médicos ou vincule manualmente.`,
        );
      }

      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(`Erro ao distribuir: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando itens em quarentena…
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) return null;

  return (
    <Card className="border-warning/60 bg-warning-soft/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <CardTitle className="text-base">Itens em quarentena (sem PJ vinculada)</CardTitle>
            <Badge variant="outline">
              {groups.length} grupo(s) · {totalItems} item(ns) · {formatCurrency(totalValue)}
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={downloadCsv}>
            <Download className="h-4 w-4 mr-2" /> Baixar CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Estes itens não foram vinculados a nenhuma empresa cadastrada na importação e ficaram
          isolados — o motor não os enxerga até serem resolvidos. Vincule a uma empresa existente,
          cadastre uma nova ou descarte. Após vincular, a análise é disparada só para a empresa
          afetada.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {groups.length >= 3 && (
          <CopilotCard
            task="summarize_inconsistencies"
            title="Resumo IA dos itens em quarentena"
            triggerLabel="Resumir padrões com IA"
            context={{
              inconsistencies: groups.map((g) => ({
                empresa_bruta: g.raw_company_name,
                items: g.items_count,
                valor: g.gross_total,
                medico_amostra: g.sample_doctor,
                melhor_score: g.best_score,
                sugestao_atual: g.suggestion_name,
              })),
            }}
          />
        )}

        {groups.map((g) => {
          const conf =
            g.best_score >= 0.92 ? "alta" : g.best_score >= 0.75 ? "média" : "baixa";
          return (
            <div
              key={g.raw_company_name}
              className="flex items-center justify-between gap-3 p-3 rounded-md border border-border/50 bg-card flex-wrap"
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate min-w-0 max-w-full">{g.raw_company_name}</span>
                  {g.suggestion_name && (
                    <Badge variant="secondary" className="gap-1 min-w-0 max-w-full">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="truncate">sugestão: {g.suggestion_name} · {(g.best_score * 100).toFixed(0)}% ({conf})</span>
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {g.items_count} item(ns) · {formatCurrency(g.gross_total)}
                  {g.sample_doctor && ` · ex.: ${g.sample_doctor}`}
                  {g.source_files.length > 0 && ` · arquivo: ${g.source_files.join(", ")}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">

                {g.suggestion_id && g.suggestion_name && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() =>
                      doLink(g, g.suggestion_id!, g.suggestion_name!)
                    }
                    disabled={busy}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1" /> Aceitar sugestão
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => distributeByDoctor(g)}
                  disabled={busy}
                  title="Lote de pool: distribui entre as PJs cadastradas no pool. Lote comum: usa o vínculo médico→PJ."
                >
                  <Users className="h-3.5 w-3.5 mr-1" /> Distribuir entre PJs do pool

                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPicked(null);
                    setLearnAlias(true);
                    setLinkOpen(g);
                  }}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" /> Vincular
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewName(g.raw_company_name === "(sem nome)" ? "" : g.raw_company_name);
                    setNewDoc("");
                    setCreateOpen(g);
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIgnoreReason("");
                    setIgnoreOpen(g);
                  }}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Descartar
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Vincular a empresa existente */}
      <Dialog open={!!linkOpen} onOpenChange={(o) => !o && setLinkOpen(null)}>
        <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 break-words leading-snug">Vincular "{linkOpen?.raw_company_name}" a empresa</DialogTitle>
          </DialogHeader>
          <CompanyCombobox value={picked} onChange={setPicked} placeholder="Buscar empresa..." />

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={learnAlias}
              onChange={(e) => setLearnAlias(e.target.checked)}
              className="rounded"
            />
            Salvar "{linkOpen?.raw_company_name}" como apelido para reconhecer em próximos uploads
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() => linkOpen && linkToExisting(linkOpen)}
              disabled={!picked || busy}
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Vincular e analisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cadastrar nova empresa */}
      <Dialog open={!!createOpen} onOpenChange={(o) => !o && setCreateOpen(null)}>
        <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 break-words leading-snug">Cadastrar nova empresa</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>CNPJ (opcional)</Label>
              <Input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              "{createOpen?.raw_company_name}" será gravado como apelido automaticamente.
            </p>
            {newName.trim().length >= 4 && (
              <DuplicateCheckBanner
                newEntity={{ name: newName, document: newDoc || null, type: "company" }}
                candidates={allCompanies.map((c) => ({ id: c.id, label: c.name, document: c.document }))}
              />
            )}

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => createOpen && createAndLink(createOpen)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar, vincular e analisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Descartar */}
      <Dialog open={!!ignoreOpen} onOpenChange={(o) => !o && setIgnoreOpen(null)}>
        <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 break-words leading-snug">Descartar "{ignoreOpen?.raw_company_name}"</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {ignoreOpen?.items_count} item(ns) ·{" "}
            {ignoreOpen ? formatCurrency(ignoreOpen.gross_total) : ""} serão marcados como
            ignorados e não entrarão na análise.
          </p>
          <div className="space-y-1">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder="Ex.: linha de totalização, cabeçalho residual, empresa fora do escopo…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreOpen(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => ignoreOpen && ignore(ignoreOpen)}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
