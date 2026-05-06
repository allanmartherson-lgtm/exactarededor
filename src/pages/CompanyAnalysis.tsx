import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { recordObservation } from "@/lib/observations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ItemsDataGrid } from "@/components/payment-detail/ItemsDataGrid";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Building2, AlertTriangle, ShieldAlert, MessageSquarePlus, Sparkles, Filter, RefreshCcw, Send, RotateCcw } from "lucide-react";
import { resolveResendTarget } from "@/lib/paymentFlow";
import {
  formatCurrency,
  TONE_CLASSES,
  type ItemAiStatus,
  type PaymentStatus,
} from "@/lib/status";
import { effectiveItemAiStatus } from "@/lib/paymentFlow";
import type {
  PaymentRow,
  PaymentItemRow,
  ObservationRow,
  GroupRow,
  AiVersionRow,
  AiFindings,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

/**
 * Tela dedicada de análise por empresa dentro de um lote.
 * Foco: ambiente de trabalho — itens essenciais, divergências em destaque,
 * comentários por item e por empresa.
 */
export default function CompanyAnalysis() {
  const { id, groupId } = useParams<{ id: string; groupId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [items, setItems] = useState<PaymentItemRow[]>([]);
  const [obs, setObs] = useState<ObservationRow[]>([]);
  const [aiVersions, setAiVersions] = useState<AiVersionRow[]>([]);
  const [rulesIndex, setRulesIndex] = useState<Record<string, RuleLite>>({});
  const [rulesByName, setRulesByName] = useState<Record<string, RuleLite>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);

  useEffect(() => {
    document.title = "Análise da empresa | MedPay Approval";
  }, []);

  const load = async () => {
    if (!id || !groupId) return;
    setLoading(true);
    const [{ data: p }, { data: g }] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).single(),
      supabase.from("payment_company_groups").select("*").eq("id", groupId).single(),
    ]);
    setPayment(p ?? null);
    setGroup(g ?? null);
    if (g) {
      const companyName = (g.company_name ?? "").trim().toLowerCase();
      const [{ data: it }, { data: o }, { data: vs }] = await Promise.all([
        supabase
          .from("payment_items")
          .select("*")
          .eq("payment_id", id)
          .order("created_at"),
        supabase
          .from("payment_observations")
          .select("*")
          .eq("payment_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("ai_analysis_versions")
          .select("*")
          .eq("payment_id", id)
          .order("version", { ascending: false }),
      ]);
      const filtered = ((it ?? []) as unknown as PaymentItemRow[]).filter(
        (x) => (x.company_name ?? "Sem empresa").trim().toLowerCase() === companyName,
      );
      setItems(filtered);
      setObs((o ?? []) as ObservationRow[]);
      setAiVersions((vs ?? []) as unknown as AiVersionRow[]);

      // Carrega regras citadas pela IA p/ alimentar o ItemsDataGrid
      const ids = Array.from(new Set(filtered.flatMap((x) => x.ai_findings?.matched_rule_ids ?? []))).filter(Boolean) as string[];
      const names = Array.from(new Set(filtered.flatMap((x) => x.ai_findings?.matched_rules ?? []))).filter(Boolean) as string[];
      const [byIdRes, byNameRes] = await Promise.all([
        ids.length
          ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception").in("id", ids)
          : Promise.resolve({ data: [] as RuleLite[] }),
        names.length
          ? supabase.from("rules").select("id,name,rule_text,description,calculation_type,exclusion_reason,allows_authorized_exception").in("name", names)
          : Promise.resolve({ data: [] as RuleLite[] }),
      ]);
      const idx: Record<string, RuleLite> = {};
      (byIdRes.data ?? []).forEach((r) => { idx[(r as RuleLite).id] = r as RuleLite; });
      (byNameRes.data ?? []).forEach((r) => { idx[(r as RuleLite).id] = r as RuleLite; });
      const nameIdx: Record<string, RuleLite> = {};
      Object.values(idx).forEach((r) => { nameIdx[String(r.name).trim().toLowerCase()] = r; });
      setRulesIndex(idx);
      setRulesByName(nameIdx);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, groupId]);

  const gStatus = (group?.status ?? "em_analise_ia") as PaymentStatus;

  const counts = useMemo(() => {
    const c = { aprovado: 0, pendente: 0, alerta: 0, reprovado: 0, alertasTotal: 0, criticosTotal: 0 };
    for (const it of items) {
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : (eff as ItemAiStatus);
      c[bucket] = (c[bucket] ?? 0) + 1;
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (alerts.length > 0) {
        if (it.ai_status === "reprovado") c.criticosTotal += alerts.length;
        else c.alertasTotal += alerts.length;
      }
    }
    return c;
  }, [items, gStatus]);

  const divergentes = useMemo(
    () =>
      items.filter((it) => {
        const alerts = (it.ai_findings?.alerts ?? []) as string[];
        return alerts.length > 0 || it.ai_status === "alerta" || it.ai_status === "reprovado";
      }),
    [items],
  );

  const itemsForAnalysis = useMemo(() => {
    if (showAllInAnalysis) return items;
    // Por padrão: mostra primeiro divergentes; oculta itens "limpos".
    return divergentes;
  }, [items, divergentes, showAllInAnalysis]);

  const groupComments = useMemo(
    () => obs.filter((o) => !o.item_id),
    [obs],
  );
  const itemComments = (itemId: string) => obs.filter((o) => o.item_id === itemId);

  const myAuthorType: "analista" | "validador" | "diretor" = "analista";

  const addItemComment = async (itemId: string) => {
    const text = (itemDraft[itemId] ?? "").trim();
    if (!text || !id) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      item_id: itemId,
      author_type: myAuthorType,
      author_id: user!.id,
      message: text,
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setItemDraft((m) => ({ ...m, [itemId]: "" }));
    load();
  };

  const addGroupComment = async () => {
    const text = groupDraft.trim();
    if (!text || !id || !group) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] ${text}`,
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setGroupDraft("");
    load();
  };

  // Ações de fluxo (paridade com o popup de análise por empresa).
  const reanalyzeGroup = async () => {
    if (!id || !group) return;
    setReanalyzing(true);
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: group.company_name },
      });
      if (error) throw error;
      await recordObservation({
        payment_id: id,
        author_type: myAuthorType,
        author_id: user!.id,
        message: `[${group.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
        status_from: group.status,
        status_to: group.status,
      });
      toast.success("Regras reaplicadas");
      load();
    } catch (e) {
      toast.error("Falha ao reaplicar regras", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setReanalyzing(false);
    }
  };

  const sendForValidation = async () => {
    if (!id || !group) return;
    if (!(group.status === "revisao_analista" || group.status === "devolvido_analista")) return;
    setBusy(true);
    const target = resolveResendTarget(obs, group.company_name);
    const next = target?.nextStatus ?? "aguardando_validacao";
    const { error } = await supabase
      .from("payment_company_groups")
      .update({ status: next })
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Erro ao enviar", { description: error.message });
    }
    const text = groupDraft.trim();
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: target
        ? `[${group.company_name}] Reencaminhado ao ${target.role} pelo analista${text ? `: ${text}` : ""}.`
        : `[${group.company_name}] Enviado para validação pelo analista${text ? `: ${text}` : ""}.`,
      status_from: group.status,
      status_to: next,
    });
    setGroupDraft("");
    setBusy(false);
    toast.success(target ? `Reencaminhado ao ${target.role}` : "Enviado para validação");
    load();
  };

  const returnToAnalyst = async () => {
    if (!id || !group) return;
    const text = groupDraft.trim();
    if (!text) return toast.error("Observação obrigatória", { description: "Descreva o motivo da devolução." });
    setBusy(true);
    const { error } = await supabase
      .from("payment_company_groups")
      .update({ status: "devolvido_analista" })
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Erro ao devolver", { description: error.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Devolvido ao analista: ${text}`,
      status_from: group.status,
      status_to: "devolvido_analista",
    });
    setGroupDraft("");
    setBusy(false);
    toast.success("Devolvido ao analista");
    load();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Carregando análise…" />
      </div>
    );
  }

  if (!payment || !group) {
    return (
      <div className="space-y-4">
        <PageHeader title="Empresa não encontrada" />
        <Button variant="outline" onClick={() => navigate(`/pagamentos/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
        </Button>
      </div>
    );
  }

  const canAct = gStatus === "revisao_analista" || gStatus === "devolvido_analista";
  const returner = gStatus === "devolvido_analista" ? resolveResendTarget(obs, group.company_name)?.role ?? null : null;

  return (
    <div className="space-y-4 pb-32">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/pagamentos/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
          </Link>
        </Button>
        <StatusBadge status={gStatus} />
      </div>

      {/* TOPO */}
      <Card className="shadow-card">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-tight truncate">{group.company_name}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lote: <span className="font-medium text-foreground">{payment.reference}</span>
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Itens" value={String(group.items_count ?? items.length)} />
            <Stat label="Valor total" value={formatCurrency(Number(group.total_amount ?? 0))} mono />
            <Stat
              label="Alertas"
              value={String(counts.alertasTotal)}
              tone={counts.alertasTotal > 0 ? "warning" : "muted"}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <Stat
              label="Críticos"
              value={String(counts.criticosTotal)}
              tone={counts.criticosTotal > 0 ? "destructive" : "muted"}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* ABAS */}
      <Tabs defaultValue="analise" className="space-y-3">
        <TabsList>
          <TabsTrigger value="analise">Análise</TabsTrigger>
          <TabsTrigger value="divergencias">
            Divergências
            {divergentes.length > 0 && (
              <Badge variant="secondary" className="ml-2">{divergentes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ia">Detalhe IA</TabsTrigger>
        </TabsList>

        {/* ABA 1 — Análise */}
        <TabsContent value="analise" className="space-y-3">
          <Card className="shadow-card">
            <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Itens</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {showAllInAnalysis
                    ? `Exibindo ${items.length} itens.`
                    : `Exibindo ${itemsForAnalysis.length} itens com observação. Itens sem problema estão ocultos.`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAllInAnalysis((v) => !v)}
                className="shrink-0"
              >
                <Filter className="h-3.5 w-3.5 mr-1" />
                {showAllInAnalysis ? "Ocultar itens limpos" : "Mostrar todos"}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <ItemsDataGrid
                items={itemsForAnalysis}
                groupStatus={gStatus}
                rulesIndex={rulesIndex}
                rulesByName={rulesByName}
                observations={obs}
                storageKey="companyAnalysisPage"
              />
            </CardContent>
          </Card>

          {/* Comentário geral da empresa */}
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                Comentário geral da empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                placeholder="Anote uma observação para esta empresa…"
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={addGroupComment} disabled={busy || !groupDraft.trim()}>
                  Adicionar comentário
                </Button>
              </div>
              {groupComments.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {groupComments.slice(0, 5).map((o) => (
                    <li key={o.id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      <div className="text-muted-foreground mb-0.5">
                        {o.author_type} · {new Date(o.created_at).toLocaleString("pt-BR")}
                      </div>
                      <div className="whitespace-pre-wrap">{o.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2 — Divergências */}
        <TabsContent value="divergencias" className="space-y-3">
          {divergentes.length === 0 ? (
            <Card className="shadow-card">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma divergência identificada para esta empresa.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {divergentes.map((it) => (
                <DivergenceCard
                  key={it.id}
                  it={it}
                  comments={itemComments(it.id)}
                  draft={itemDraft[it.id] ?? ""}
                  onDraftChange={(v) => setItemDraft((m) => ({ ...m, [it.id]: v }))}
                  onAdd={() => addItemComment(it.id)}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ABA 3 — Detalhe IA */}
        <TabsContent value="ia" className="space-y-3">
          <AiDetail items={items} versions={aiVersions} />
        </TabsContent>
      </Tabs>

      {/* Footer sticky com ações de fluxo */}
      {canAct && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
          <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row md:items-start gap-2">
            <Textarea
              rows={2}
              value={groupDraft}
              onChange={(e) => setGroupDraft(e.target.value)}
              placeholder="Observação para esta empresa (obrigatória para devolver)..."
              className="md:flex-1 text-xs"
            />
            <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
              <Button variant="outline" size="sm" onClick={reanalyzeGroup} disabled={busy || reanalyzing}>
                <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzing && "animate-spin")} />
                {reanalyzing ? "Reaplicando..." : "Reaplicar regras"}
              </Button>
              <Button variant="outline" size="sm" onClick={returnToAnalyst} disabled={busy}>
                <RotateCcw className="h-4 w-4 mr-2" /> Devolver para analista
              </Button>
              <Button size="sm" onClick={sendForValidation} disabled={busy}>
                <Send className="h-4 w-4 mr-2" />
                {returner ? `Reencaminhar ao ${returner}` : "Enviar para validação"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "muted" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning-foreground"
      : "text-foreground";
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-base font-semibold mt-0.5", mono && "tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

// ItemsTable foi substituída por <ItemsDataGrid /> compartilhado.

function DivergenceCard({
  it,
  comments,
  draft,
  onDraftChange,
  onAdd,
  busy,
}: {
  it: PaymentItemRow;
  comments: ObservationRow[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
  const isCritico = it.ai_status === "reprovado";
  const expected = it.ai_findings?.expected_amount;
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const paciente =
    (it.patient_name as string | null) ??
    ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
    "—";
  return (
    <Card
      className={cn(
        "shadow-card border-l-4",
        isCritico ? "border-l-destructive" : "border-l-warning",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isCritico ? (
                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{paciente}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground truncate">{it.doctor_name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {it.procedure_code && (
                <span>
                  TUSS: <span className="font-mono text-foreground">{it.procedure_code}</span>
                </span>
              )}
              {it.attendance_number && (
                <span>
                  Atend.: <span className="font-mono text-foreground">{it.attendance_number}</span>
                </span>
              )}
              <span>
                Valor: <span className="tabular-nums text-foreground">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
              </span>
              {expected != null && (
                <span>
                  Esperado: <span className="tabular-nums text-foreground">{formatCurrency(Number(expected))}</span>
                </span>
              )}
            </div>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[10px] shrink-0",
              isCritico ? TONE_CLASSES.destructive : TONE_CLASSES.warning,
            )}
          >
            {isCritico ? "Crítico" : "Alerta"}
          </span>
        </div>

        {alerts.length > 0 && (
          <ul className="space-y-1 text-xs">
            {alerts.map((a, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span className="whitespace-pre-wrap">{a}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Comentários por item */}
        {comments.length > 0 && (
          <ul className="space-y-1.5">
            {comments.slice(0, 3).map((o) => (
              <li key={o.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <div className="text-muted-foreground text-[10px] mb-0.5">
                  {o.author_type} · {new Date(o.created_at).toLocaleString("pt-BR")}
                </div>
                <div className="whitespace-pre-wrap">{o.message}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Textarea
            placeholder="Comentar este item…"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={2}
            className="flex-1"
          />
          <Button size="sm" onClick={onAdd} disabled={busy || !draft.trim()} className="self-end">
            Comentar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AiDetail({ items, versions }: { items: PaymentItemRow[]; versions: AiVersionRow[] }) {
  const withExplanation = items.filter((it) => {
    const f = it.ai_findings as AiFindings | null;
    return (
      (f?.calculation_explanation && f.calculation_explanation.trim().length > 0) ||
      (f?.matched_rules && f.matched_rules.length > 0)
    );
  });
  if (withExplanation.length === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma explicação de regra disponível para esta empresa.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {withExplanation.map((it) => {
        const f = it.ai_findings as AiFindings;
        const lastVersion = versions.find((v) => v.item_id === it.id);
        const raw = (it.raw_data ?? {}) as Record<string, unknown>;
        const paciente =
          (it.patient_name as string | null) ??
          ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
          "—";
        return (
          <Card key={it.id} className="shadow-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-info" />
                <span className="text-sm font-medium truncate">{paciente}</span>
                <span className="text-xs text-muted-foreground">· {it.doctor_name}</span>
                {lastVersion && (
                  <span className="text-[10px] text-muted-foreground ml-auto">v{lastVersion.version}</span>
                )}
              </div>
              {f.matched_rules && f.matched_rules.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Regras aplicadas:{" "}
                  <span className="text-foreground">{f.matched_rules.join(", ")}</span>
                </div>
              )}
              {f.calculation_explanation && (
                <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">
                  {f.calculation_explanation}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}