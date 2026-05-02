import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatCompetence, formatDateOnly, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentStatus, type ItemAiStatus, TONE_CLASSES } from "@/lib/status";
import { ArrowLeft, Ban, CalendarDays, CheckCircle2, FileDown, GitCompare, History, Mail, MessageSquarePlus, RotateCcw, ShieldCheck, Sparkles, Trash2, XCircle } from "lucide-react";

const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted", aprovado: "success", alerta: "warning", reprovado: "destructive",
};

const truncate = (s: string, max = 220) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

type RuleLite = { id: string; name: string; rule_text: string; description: string | null };
const RuleTooltipContent = ({
  rules,
  fallbackNames,
}: {
  rules: RuleLite[];
  fallbackNames: string[];
}) => {
  const blocks = rules.length
    ? rules.map((r) => ({
        name: r.name,
        text: truncate((r.rule_text ?? "").trim(), 220),
        desc: r.description ? truncate(r.description.trim(), 140) : "",
      }))
    : fallbackNames.map((n) => ({ name: n, text: "", desc: "" }));

  return (
    <div className="space-y-2 text-xs leading-snug">
      {blocks.map((b, i) => (
        <div key={i} className={i > 0 ? "border-t border-border/40 pt-2" : ""}>
          <div className="font-semibold">{truncate(b.name, 80)}</div>
          {b.text && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{b.text}</p>}
          {b.desc && <p className="mt-0.5 italic text-muted-foreground/80">{b.desc}</p>}
        </div>
      ))}
    </div>
  );
};

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [payment, setPayment] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [obs, setObs] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [rulesIndex, setRulesIndex] = useState<Record<string, { id: string; name: string; rule_text: string; description: string | null }>>({});
  const [rulesByName, setRulesByName] = useState<Record<string, { id: string; name: string; rule_text: string; description: string | null }>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: it }, { data: o }, { data: pr }] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).single(),
      supabase.from("payment_items").select("*").eq("payment_id", id).order("created_at"),
      supabase.from("payment_observations").select("*").eq("payment_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,full_name,email"),
    ]);
    setPayment(p); setItems(it ?? []); setObs(o ?? []);
    const map: Record<string, string> = {};
    (pr ?? []).forEach((x: any) => { map[x.id] = x.full_name || x.email; });
    setProfiles(map);
    // Carrega regras citadas pela IA (por id e por nome) para mostrar resumo + link
    const ids = Array.from(new Set((it ?? []).flatMap((x: any) => x.ai_findings?.matched_rule_ids ?? []))).filter(Boolean) as string[];
    const names = Array.from(new Set((it ?? []).flatMap((x: any) => x.ai_findings?.matched_rules ?? []))).filter(Boolean) as string[];
    const [byIdRes, byNameRes] = await Promise.all([
      ids.length ? supabase.from("rules").select("id,name,rule_text,description").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      names.length ? supabase.from("rules").select("id,name,rule_text,description").in("name", names) : Promise.resolve({ data: [] as any[] }),
    ]);
    const idx: Record<string, any> = {};
    (byIdRes.data ?? []).forEach((r: any) => { idx[r.id] = r; });
    (byNameRes.data ?? []).forEach((r: any) => { idx[r.id] = r; });
    const nameIdx: Record<string, any> = {};
    Object.values(idx).forEach((r: any) => { nameIdx[String(r.name).trim().toLowerCase()] = r; });
    setRulesIndex(idx);
    setRulesByName(nameIdx);
  }, [id]);

  useEffect(() => { document.title = "Pagamento | MedPay"; load(); }, [load]);

  const transition = async (newStatus: PaymentStatus, authorType: "validador" | "diretor" | "analista", message: string) => {
    if (!id || !payment) return;
    setBusy(true);
    const updates: any = { status: newStatus };
    if (authorType === "validador" && newStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id; updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && newStatus === "aprovado") {
      updates.approved_by = user!.id; updates.approved_at = new Date().toISOString();
    }
    await supabase.from("payments").update(updates).eq("id", id);
    await supabase.from("payment_observations").insert({
      payment_id: id, author_type: authorType, author_id: user!.id, message, status_from: payment.status, status_to: newStatus,
    });
    await load();
    setComment("");
    setBusy(false);
    toast({ title: "Status atualizado", description: message });
  };

  const requireComment = (cb: () => void) => {
    if (!comment.trim()) { toast({ title: "Adicione uma observação", variant: "destructive" }); return; }
    cb();
  };

  const generatePdf = async () => {
    if (!payment) return;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Validação de Pagamento Médico", 14, 18);
    doc.setFontSize(10);
    doc.text(`Referência: ${payment.reference}`, 14, 28);
    doc.text(`Status: ${payment.status}`, 14, 34);
    doc.text(`Total: ${formatCurrency(payment.total_amount)}`, 14, 40);
    doc.text(`Aprovado por: ${profiles[payment.approved_by] ?? "—"} em ${formatDate(payment.approved_at)}`, 14, 46);
    autoTable(doc, {
      startY: 54,
      head: [["Médico", "Doc", "Descrição", "Valor", "IA"]],
      body: items.map((i) => [i.doctor_name, i.doctor_document ?? "", i.description ?? "", formatCurrency(i.gross_amount), i.ai_status]),
    });
    const blob = doc.output("blob");
    const path = `${payment.id}/aprovacao.pdf`;
    await supabase.storage.from("approval-pdfs").upload(path, blob, { upsert: true, contentType: "application/pdf" });
    await supabase.from("payments").update({ approval_pdf_path: path }).eq("id", payment.id);
    doc.save(`aprovacao-${payment.reference}.pdf`);
    toast({ title: "PDF gerado" });
  };

  const sendInvoiceRequest = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("send-invoice-request", { body: { payment_id: id } });
    setBusy(false);
    // Erro de validação (CNPJ inválido) chega no body com status 422
    const payload = (data ?? {}) as any;
    if (payload?.error === "cnpj_invalido") {
      const detail = (payload.invalid ?? []).slice(0, 3).map((x: any) =>
        `• ${x.company_name ?? x.doctor_name}: ${x.reason}`
      ).join("\n");
      const more = (payload.invalid?.length ?? 0) > 3 ? `\n…e mais ${payload.invalid.length - 3} item(ns).` : "";
      toast({
        title: "Envio bloqueado: CNPJ inválido",
        description: `${payload.message}\n${detail}${more}`,
        variant: "destructive",
      });
      return;
    }
    if (error || payload?.error) {
      toast({ title: "Erro", description: payload?.message ?? error?.message ?? "Falha ao enviar.", variant: "destructive" });
      return;
    }
    const n = payload?.invoices_created ?? 0;
    toast({ title: "Pedido(s) de NF enviado(s)", description: `${n} destinatário(s) notificado(s) com resumo validado.` });
    load();
  };

  if (!payment) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalista = hasRole("analista") || hasRole("admin");
  const canValidate = isValidador && payment.status === "aguardando_validacao";
  const canApprove = isDiretor && payment.status === "aguardando_aprovacao";
  const canResend = isAnalista && (payment.status === "devolvido_analista");
  const canRequestNf = isDiretor && payment.status === "aprovado";
  const isOwner = payment.created_by === user?.id;
  const editableStatuses: PaymentStatus[] = ["rascunho", "em_analise_ia", "aguardando_validacao", "devolvido_analista", "cancelado"];
  const canCancel = (isOwner || isDiretor) && payment.status !== "cancelado" && editableStatuses.includes(payment.status as PaymentStatus);
  const canDelete = (isOwner || isDiretor) && editableStatuses.includes(payment.status as PaymentStatus);

  const cancelPayment = async () => {
    if (!id) return;
    setBusy(true);
    await supabase.from("payments").update({ status: "cancelado" }).eq("id", id);
    await supabase.from("payment_observations").insert({
      payment_id: id, author_type: isOwner ? "analista" : "diretor", author_id: user!.id,
      message: "Lote cancelado pelo responsável.", status_from: payment.status, status_to: "cancelado",
    });
    setBusy(false);
    toast({ title: "Lote cancelado" });
    load();
  };

  const deletePayment = async () => {
    if (!id) return;
    setBusy(true);
    await supabase.from("payment_items").delete().eq("payment_id", id);
    await supabase.from("payment_observations").delete().eq("payment_id", id);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    setBusy(false);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Lote excluído" });
    navigate("/pagamentos");
  };

  // Resumo objetivo a partir dos itens
  const counts = items.reduce(
    (acc, it) => {
      const s = (it.ai_status as ItemAiStatus) ?? "pendente";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0 } as Record<ItemAiStatus, number>,
  );
  const topAlerts: { item: any; alerts: string[] }[] = items
    .filter((it) => it.ai_findings?.alerts?.length)
    .slice(0, 6)
    .map((it) => ({ item: it, alerts: it.ai_findings.alerts as string[] }));

  return (
    <>
      <PageHeader
        title={payment.reference}
        description={payment.description ?? `${items.length} itens · ${formatCurrency(payment.total_amount)}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm"><Link to="/pagamentos"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
            <StatusBadge status={payment.status} />
          </>
        }
      />
      <div className="p-8 space-y-6">
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Competência:</span>
              <span className="font-medium capitalize">{formatCompetence(payment.competence_months?.length ? payment.competence_months : payment.competence_month)}</span>
            </div>
            <div><span className="text-muted-foreground">Previsão pgto:</span> <span className="font-medium">{formatDateOnly(payment.payment_due_date)}</span></div>
            {payment.payment_type && <div><span className="text-muted-foreground">Tipo:</span> <span className="font-medium">{PAYMENT_TYPE_LABELS[payment.payment_type as keyof typeof PAYMENT_TYPE_LABELS]}</span></div>}
            {payment.payment_kind && <div><span className="text-muted-foreground">Categoria:</span> <span className="font-medium">{PAYMENT_KIND_LABELS[payment.payment_kind as keyof typeof PAYMENT_KIND_LABELS]}</span></div>}
            {payment.cost_center_code && <div><span className="text-muted-foreground">Centro de custos:</span> <span className="font-mono text-xs font-medium">{payment.cost_center_code}</span></div>}
            <div className="ml-auto flex gap-2">
              {canCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={busy}><Ban className="h-4 w-4 mr-1" /> Cancelar</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancelar este lote?</AlertDialogTitle>
                      <AlertDialogDescription>O lote ficará marcado como cancelado e sairá do fluxo. Use esta opção se anexou os arquivos errados.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Voltar</AlertDialogCancel>
                      <AlertDialogAction onClick={cancelPayment}>Confirmar cancelamento</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={busy}><Trash2 className="h-4 w-4 mr-1" /> Excluir</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir este lote?</AlertDialogTitle>
                      <AlertDialogDescription>Esta ação remove o lote, todos os itens e o histórico. Não pode ser desfeita. Use para refazer o anexo a partir do zero em <strong>Nova base</strong>.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Voltar</AlertDialogCancel>
                      <AlertDialogAction onClick={deletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir definitivamente</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        </Card>

        {(payment.ai_summary || items.some((i) => i.ai_status && i.ai_status !== "pendente")) && (
          <Card className="shadow-card border-info/30 bg-info-soft/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" /> Parecer da IA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${TONE_CLASSES.success}`}>✓ {counts.aprovado} aprovados</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${TONE_CLASSES.warning}`}>⚠ {counts.alerta} a validar</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${TONE_CLASSES.destructive}`}>✕ {counts.reprovado} possível erro</span>
                {counts.pendente > 0 && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${TONE_CLASSES.muted}`}>• {counts.pendente} pendentes</span>
                )}
              </div>
              {topAlerts.length > 0 && (
                <ul className="text-sm space-y-1">
                  {topAlerts.map(({ item, alerts }, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span><span className="font-medium">{item.doctor_name}</span> — {alerts[0]}{alerts.length > 1 && <span className="text-muted-foreground"> (+{alerts.length - 1})</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
              {payment.ai_summary && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Resumo detalhado</summary>
                  <p className="mt-2 whitespace-pre-wrap">{payment.ai_summary}</p>
                </details>
              )}
            </CardContent>
          </Card>
        )}

          <Card className="shadow-card">
            <CardHeader><CardTitle className="text-base">Itens ({items.length})</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <TooltipProvider delayDuration={150}>
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Atend.</th>
                    <th className="px-3 py-2">Paciente</th>
                    <th className="px-3 py-2">Convênio</th>
                    <th className="px-3 py-2">Médico / Função</th>
                    <th className="px-3 py-2">TUSS</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">IA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((it) => {
                    const raw = (it.raw_data ?? {}) as Record<string, any>;
                    const paciente = raw["Paciente"] ?? raw["paciente"] ?? "—";
                    const convenio = raw["Convênio"] ?? raw["Convenio"] ?? raw["convenio"] ?? "—";
                    const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
                    const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
                    // Resolve regras por id (preferencial) e por nome (fallback) para manter o link sempre clicável
                    const seen = new Set<string>();
                    const matchedRuleObjs: RuleLite[] = [];
                    matchedIds.forEach((rid) => {
                      const r = rulesIndex[rid];
                      if (r && !seen.has(r.id)) { seen.add(r.id); matchedRuleObjs.push(r); }
                    });
                    matchedNames.forEach((nm) => {
                      const r = rulesByName[String(nm).trim().toLowerCase()];
                      if (r && !seen.has(r.id)) { seen.add(r.id); matchedRuleObjs.push(r); }
                    });
                    const hasRule = matchedRuleObjs.length > 0 || matchedNames.length > 0;
                    const firstRule = matchedRuleObjs[0] ?? null;
                    const firstRuleLabel = firstRule?.name ?? matchedNames[0] ?? null;
                    const tooltipNode = hasRule ? (
                      <RuleTooltipContent rules={matchedRuleObjs} fallbackNames={matchedNames} />
                    ) : null;
                    return (
                      <tr key={it.id} className="align-top">
                        <td className="px-3 py-3 text-xs font-mono text-muted-foreground">{it.attendance_number ?? "—"}</td>
                        <td className="px-3 py-3">{paciente}</td>
                        <td className="px-3 py-3 text-muted-foreground">{convenio}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium">{it.doctor_name}</div>
                          <div className="text-xs text-muted-foreground">{it.doctor_role ?? "—"}</div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">{it.procedure_code ?? "—"}</td>
                        <td className="px-3 py-3 max-w-[260px]">
                          <div>{it.description ?? "—"}</div>
                          {it.ai_findings?.alerts?.length > 0 && (
                            <ul className="mt-1 text-xs text-warning-foreground space-y-0.5">
                              {it.ai_findings.alerts.map((a: string, i: number) => <li key={i}>⚠ {a}</li>)}
                            </ul>
                          )}
                          {it.ai_findings?.calculation_explanation && (
                            <div className="mt-1 text-xs text-muted-foreground italic">{it.ai_findings.calculation_explanation}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{it.quantity ?? "—"}</td>
                        <td className="px-3 py-3 text-right">
                          {(() => {
                            const totalRules = matchedRuleObjs.length || matchedNames.length;
                            const extra = Math.max(0, totalRules - 1);
                            const valueEl = firstRule?.id ? (
                              <Link
                                to={`/regras?rule=${firstRule.id}`}
                                className="tabular-nums font-medium text-primary hover:underline underline decoration-dotted decoration-primary/50"
                              >
                                {formatCurrency(it.gross_amount)}
                              </Link>
                            ) : (
                              <span className={`tabular-nums font-medium ${tooltipNode ? "underline decoration-dotted decoration-muted-foreground/50 cursor-help" : ""}`}>
                                {formatCurrency(it.gross_amount)}
                              </span>
                            );
                            return (
                              <>
                                <div className="flex items-center justify-end gap-1.5">
                                  {tooltipNode ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
                                      <TooltipContent side="left" className="max-w-xs">{tooltipNode}</TooltipContent>
                                    </Tooltip>
                                  ) : valueEl}
                                  {extra > 0 && (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition"
                                          title={`${totalRules} regras aplicadas`}
                                        >
                                          +{extra}
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent side="left" align="end" className="w-80 p-0">
                                        <div className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          {totalRules} regras aplicadas
                                        </div>
                                        <ul className="max-h-72 overflow-y-auto divide-y divide-border/60">
                                          {(matchedRuleObjs.length ? matchedRuleObjs : matchedNames.map((n) => ({ id: "", name: n, rule_text: "", description: null }))).map((r, i) => (
                                            <li key={i} className="px-3 py-2 text-xs">
                                              {r.id ? (
                                                <Link to={`/regras?rule=${r.id}`} className="font-medium text-primary hover:underline">
                                                  {truncate(r.name, 80)}
                                                </Link>
                                              ) : (
                                                <span className="font-medium">{truncate(r.name, 80)}</span>
                                              )}
                                              {r.rule_text && (
                                                <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground leading-snug">
                                                  {truncate(r.rule_text.trim(), 180)}
                                                </p>
                                              )}
                                              {r.description && (
                                                <p className="mt-0.5 italic text-muted-foreground/80 leading-snug">
                                                  {truncate(r.description.trim(), 120)}
                                                </p>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      </PopoverContent>
                                    </Popover>
                                  )}
                                </div>
                                {firstRuleLabel && (
                                  firstRule?.id ? (
                                    <Link to={`/regras?rule=${firstRule.id}`} className="block text-[11px] text-primary hover:underline truncate max-w-[180px] ml-auto">
                                      {firstRuleLabel}
                                    </Link>
                                  ) : (
                                    <span className="block text-[11px] text-muted-foreground truncate max-w-[180px] ml-auto">
                                      {firstRuleLabel}
                                    </span>
                                  )
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${TONE_CLASSES[itemToneMap[it.ai_status as ItemAiStatus]]}`}>{it.ai_status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </TooltipProvider>
            </CardContent>
          </Card>

          {(canValidate || canApprove || canResend) && (
            <Card className="shadow-card border-primary/20">
              <CardHeader><CardTitle className="text-base">Ação necessária</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Sua observação (obrigatória para devolver/aprovar)..." rows={3} />
                <div className="flex flex-wrap gap-2">
                  {canValidate && <>
                    <Button onClick={() => requireComment(() => transition("aguardando_aprovacao", "validador", `Validado: ${comment}`))} disabled={busy}>
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Validar e enviar ao Diretor
                    </Button>
                    <Button variant="outline" onClick={() => requireComment(() => transition("devolvido_analista", "validador", `Devolvido ao analista: ${comment}`))} disabled={busy}>
                      <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao analista
                    </Button>
                  </>}
                  {canApprove && <>
                    <Button onClick={() => requireComment(() => transition("aprovado", "diretor", `Aprovado: ${comment}`))} disabled={busy}>
                      <ShieldCheck className="h-4 w-4 mr-2" /> Aprovar
                    </Button>
                    <Button variant="outline" onClick={() => requireComment(() => transition("devolvido_validador", "diretor", `Devolvido ao validador: ${comment}`))} disabled={busy}>
                      <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao validador
                    </Button>
                    <Button variant="destructive" onClick={() => requireComment(() => transition("rejeitado", "diretor", `Rejeitado: ${comment}`))} disabled={busy}>
                      <XCircle className="h-4 w-4 mr-2" /> Rejeitar
                    </Button>
                  </>}
                  {canResend && <Button onClick={() => requireComment(() => transition("aguardando_validacao", "analista", `Reenviado: ${comment}`))} disabled={busy}>Reenviar para validação</Button>}
                </div>
              </CardContent>
            </Card>
          )}

          {payment.status === "aprovado" && isDiretor && (
            <Card className="shadow-card border-success/30">
              <CardHeader><CardTitle className="text-base">Pós-aprovação</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={generatePdf}><FileDown className="h-4 w-4 mr-2" /> Gerar PDF</Button>
                {canRequestNf && <Button onClick={sendInvoiceRequest} disabled={busy}><Mail className="h-4 w-4 mr-2" /> Enviar pedido de NF</Button>}
              </CardContent>
            </Card>
          )}

        <Card className="shadow-card">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/40 transition"
          >
            <div>
              <CardTitle className="text-base">Histórico de observações</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{obs.length} {obs.length === 1 ? "registro" : "registros"}</p>
            </div>
            {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {historyOpen && (
            <div className="border-t border-border divide-y divide-border max-h-[600px] overflow-y-auto">
              {obs.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">Sem observações</p>
              ) : obs.map((o) => (
                <div key={o.id} className="px-6 py-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span className="font-medium uppercase tracking-wide">{o.author_type}{o.author_id && ` · ${profiles[o.author_id] ?? ""}`}</span>
                    <span>{formatDate(o.created_at)}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{o.message}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
};

export default PaymentDetail;