import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Mail, Clock, FileCheck2, AlertCircle, Send, Hourglass,
  ShieldCheck, UserCheck, FileSignature, CheckCircle2, AlertTriangle,
  Banknote, Landmark, ScrollText, GitCompareArrows, MessageSquareWarning,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, type PaymentStatus } from "@/lib/status";
import type { GroupRow, InvoiceRow, PaymentRow } from "@/hooks/usePaymentDetailData";

type Tone = "default" | "warning" | "alert" | "success" | "info";

interface Tile {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  tone: Tone;
}

const toneBorder = (t: Tone) =>
  t === "alert" ? "border-l-destructive"
  : t === "warning" ? "border-l-amber-500"
  : t === "success" ? "border-l-emerald-500"
  : t === "info" ? "border-l-sky-500"
  : "border-l-border";

const toneText = (t: Tone) =>
  t === "alert" ? "text-destructive"
  : t === "warning" ? "text-amber-600 dark:text-amber-400"
  : t === "success" ? "text-emerald-600 dark:text-emerald-400"
  : t === "info" ? "text-sky-600 dark:text-sky-400"
  : "text-foreground";

const daysSince = (iso?: string | null) => {
  if (!iso) return 0;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : 0;
};

const PhaseShell = ({
  eyebrow, title, tiles,
}: { eyebrow: string; title: string; tiles: Tile[] }) => (
  <Card className="shadow-card">
    <CardContent className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {eyebrow}
          </p>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className={`border-l-2 ${toneBorder(t.tone)} pl-3 py-1.5 min-w-0`}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Icon className="h-3 w-3" />
                <span className="truncate">{t.label}</span>
              </div>
              <p className={`text-2xl font-semibold tabular-nums leading-tight ${toneText(t.tone)}`}>
                {t.value}
              </p>
              {t.sub && <p className="text-[10px] text-muted-foreground truncate">{t.sub}</p>}
            </div>
          );
        })}
      </div>
    </CardContent>
  </Card>
);

// ============== Fase: Validação ==============
const ValidationPanel = ({ groups }: { groups: GroupRow[] }) => {
  const stats = useMemo(() => {
    const pendentes = groups.filter((g) => g.status === "aguardando_validacao");
    const devolvidos = groups.filter((g) => g.status === "devolvido_analista");
    const valor = pendentes.reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0);
    const esperas = pendentes.map((g) => daysSince(g.updated_at ?? g.created_at));
    const maior = esperas.length ? Math.max(...esperas) : 0;
    const noPrazo = esperas.filter((d) => d <= 2).length;
    return { pendentes: pendentes.length, devolvidos: devolvidos.length, valor, maior, noPrazo };
  }, [groups]);

  const tiles: Tile[] = [
    { icon: UserCheck, label: "Grupos aguardando você", value: stats.pendentes,
      sub: stats.valor > 0 ? formatCurrency(stats.valor) : undefined,
      tone: stats.pendentes > 0 ? "warning" : "success" },
    { icon: Hourglass, label: "Maior tempo na fila", value: stats.pendentes ? `${stats.maior}d` : "—",
      sub: stats.pendentes ? "desde envio" : undefined,
      tone: stats.maior > 3 ? "alert" : stats.maior > 1 ? "warning" : "default" },
    { icon: CheckCircle2, label: "Dentro do SLA (2d)", value: `${stats.noPrazo}/${stats.pendentes || 0}`,
      tone: stats.pendentes && stats.noPrazo === stats.pendentes ? "success" : "warning" },
    { icon: MessageSquareWarning, label: "Devolvidos ao analista", value: stats.devolvidos,
      sub: stats.devolvidos > 0 ? "aguardando ajuste" : "nenhum",
      tone: stats.devolvidos > 0 ? "info" : "default" },
  ];

  return <PhaseShell eyebrow="Validação" title="O que precisa da sua atenção agora" tiles={tiles} />;
};

// ============== Fase: Aprovação ==============
const ApprovalPanel = ({ payment, groups }: { payment: PaymentRow; groups: GroupRow[] }) => {
  const stats = useMemo(() => {
    const aprovar = groups.filter((g) => g.status === "aguardando_aprovacao");
    const ressalva = groups.filter((g) => g.status === "aprovado_com_ressalva" || g.status === "aprovado_parcial");
    const revisao = groups.filter((g) => g.status === "revisao_pos_aprovacao" || g.status === "aprovado_em_revisao");
    const total = aprovar.reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0);
    const esperas = aprovar.map((g) => daysSince(g.updated_at ?? g.created_at));
    const maior = esperas.length ? Math.max(...esperas) : 0;
    return { aprovar: aprovar.length, ressalva: ressalva.length, revisao: revisao.length, total, maior };
  }, [groups]);

  const tiles: Tile[] = [
    { icon: ShieldCheck, label: "Grupos para aprovar", value: stats.aprovar,
      sub: stats.aprovar > 0 ? formatCurrency(stats.total) : "nenhum pendente",
      tone: stats.aprovar > 0 ? "warning" : "success" },
    { icon: Banknote, label: "Total a aprovar", value: formatCurrency(stats.total),
      sub: `competência ${payment.competence_month ?? "—"}`,
      tone: "default" },
    { icon: Hourglass, label: "Maior tempo aguardando", value: stats.aprovar ? `${stats.maior}d` : "—",
      tone: stats.maior > 3 ? "alert" : stats.maior > 1 ? "warning" : "default" },
    { icon: AlertTriangle, label: "Com ressalva / parcial", value: stats.ressalva,
      sub: stats.ressalva > 0 ? "exige revisão antes da NF" : undefined,
      tone: stats.ressalva > 0 ? "warning" : "default" },
    { icon: MessageSquareWarning, label: "Em revisão pós-aprovação", value: stats.revisao,
      tone: stats.revisao > 0 ? "info" : "default" },
  ];

  return <PhaseShell eyebrow="Aprovação da diretoria" title="Decisões pendentes do diretor" tiles={tiles} />;
};

// ============== Fase: Pedido de NF ==============
const NfRequestPanel = ({ groups, invoices }: { groups: GroupRow[]; invoices: InvoiceRow[] }) => {
  const [emailsByCompany, setEmailsByCompany] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const ids = Array.from(new Set(groups.map((g) => g.company_id).filter(Boolean) as string[]));
    if (!ids.length) return;
    let cancelled = false;
    supabase.from("companies").select("id, invoice_emails").in("id", ids).then(({ data }) => {
      if (cancelled) return;
      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r: { id: string; invoice_emails: string[] | null }) => {
        map[r.id] = r.invoice_emails ?? [];
      });
      setEmailsByCompany(map);
    });
    return () => { cancelled = true; };
  }, [groups]);

  const stats = useMemo(() => {
    const liberar = groups.filter((g) =>
      ["aprovado", "aprovado_com_ressalva", "aprovado_parcial", "revisao_pos_aprovacao"].includes(g.status as string),
    );
    const semEmail = liberar.filter((g) => !g.company_id || (emailsByCompany[g.company_id] ?? []).length === 0);
    const enviados = groups.filter((g) => g.status === "pedido_nf_enviado");
    const valor = liberar.reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0);
    const maiorLib = liberar.length ? Math.max(...liberar.map((g) => daysSince(g.updated_at ?? g.created_at))) : 0;
    const maiorNf = enviados.length ? Math.max(...enviados.map((g) => {
      const inv = invoices.find((i) => i.company_group_id === g.id);
      return daysSince(inv?.sent_at ?? g.updated_at ?? g.created_at);
    })) : 0;
    return { liberar: liberar.length, semEmail: semEmail.length, enviados: enviados.length, valor, maiorLib, maiorNf };
  }, [groups, invoices, emailsByCompany]);

  const tiles: Tile[] = [
    { icon: Send, label: "Aguardando liberação de NF", value: stats.liberar,
      sub: stats.valor > 0 ? formatCurrency(stats.valor) : undefined,
      tone: stats.liberar > 0 ? "warning" : "default" },
    { icon: Mail, label: "Empresas sem e-mail", value: stats.semEmail,
      sub: stats.semEmail > 0 ? "bloqueia envio automático" : "todas cadastradas",
      tone: stats.semEmail > 0 ? "alert" : "success" },
    { icon: Hourglass, label: "Maior tempo p/ liberar", value: stats.liberar ? `${stats.maiorLib}d` : "—",
      sub: stats.liberar ? "desde aprovação" : undefined,
      tone: stats.maiorLib > 5 ? "alert" : stats.maiorLib > 2 ? "warning" : "default" },
    { icon: Clock, label: "Maior tempo aguardando NF", value: stats.enviados ? `${stats.maiorNf}d` : "—",
      sub: stats.enviados ? `${stats.enviados} pedido(s) enviado(s)` : undefined,
      tone: stats.maiorNf > 7 ? "alert" : stats.maiorNf > 3 ? "warning" : "default" },
    { icon: FileSignature, label: "Pedidos já enviados", value: stats.enviados,
      tone: "info" },
  ];

  return <PhaseShell eyebrow="Pedido de Nota Fiscal" title="Ciclo de solicitação e envio" tiles={tiles} />;
};

// ============== Fase: Conciliação ==============
const ReconciliationPanel = ({ invoices }: { invoices: InvoiceRow[] }) => {
  const stats = useMemo(() => {
    const recebidas = invoices.filter((i) => i.status === "recebida" || i.received_at);
    const aguardando = invoices.filter((i) => i.status === "recebida" && !i.amount_reconciled);
    const divergentes = invoices.filter((i) => i.status === "divergente");
    const conciliadas = invoices.filter((i) => i.status === "conciliada");
    const questionadas = invoices.filter((i) => i.status === "questionada" as never);
    const maior = recebidas.length
      ? Math.max(...recebidas.map((i) => daysSince(i.received_at ?? i.created_at)))
      : 0;
    return {
      recebidas: recebidas.length, aguardando: aguardando.length,
      divergentes: divergentes.length, conciliadas: conciliadas.length,
      questionadas: questionadas.length, maior,
    };
  }, [invoices]);

  const tiles: Tile[] = [
    { icon: FileCheck2, label: "NFs recebidas", value: stats.recebidas,
      sub: `${stats.conciliadas} conciliada(s)`, tone: "default" },
    { icon: GitCompareArrows, label: "Aguardando conciliação", value: stats.aguardando,
      tone: stats.aguardando > 0 ? "warning" : "success" },
    { icon: AlertCircle, label: "Divergentes", value: stats.divergentes,
      sub: stats.divergentes > 0 ? "valor não bate" : undefined,
      tone: stats.divergentes > 0 ? "alert" : "default" },
    { icon: MessageSquareWarning, label: "Questionadas", value: stats.questionadas,
      tone: stats.questionadas > 0 ? "info" : "default" },
    { icon: Hourglass, label: "Maior tempo p/ conciliar", value: stats.recebidas ? `${stats.maior}d` : "—",
      tone: stats.maior > 5 ? "alert" : stats.maior > 2 ? "warning" : "default" },
    { icon: CheckCircle2, label: "Concluídas", value: `${stats.conciliadas}/${stats.recebidas || 0}`,
      tone: stats.recebidas && stats.conciliadas === stats.recebidas ? "success" : "default" },
  ];

  return <PhaseShell eyebrow="Conciliação" title="NF recebida × base MedPay" tiles={tiles} />;
};

// ============== Fase: Pagamento ==============
const PaymentPanel = ({ groups, invoices }: { groups: GroupRow[]; invoices: InvoiceRow[] }) => {
  const stats = useMemo(() => {
    const lancados = groups.filter((g) => g.status === "lancado");
    const pagos = groups.filter((g) => g.status === "pago");
    const totalPago = pagos.reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0);
    const totalLancado = lancados.reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0);
    const maiorLanc = lancados.length
      ? Math.max(...lancados.map((g) => daysSince(g.updated_at ?? g.created_at)))
      : 0;
    const semPagamento = invoices.filter((i) => i.status === "conciliada").length - pagos.length;
    return {
      lancados: lancados.length, pagos: pagos.length, totalPago, totalLancado,
      maiorLanc, semPagamento: Math.max(0, semPagamento),
    };
  }, [groups, invoices]);

  const tiles: Tile[] = [
    { icon: ScrollText, label: "Lançados", value: stats.lancados,
      sub: stats.totalLancado > 0 ? formatCurrency(stats.totalLancado) : undefined,
      tone: stats.lancados > 0 ? "info" : "default" },
    { icon: Landmark, label: "Pagos", value: stats.pagos,
      sub: stats.totalPago > 0 ? formatCurrency(stats.totalPago) : undefined,
      tone: stats.pagos > 0 ? "success" : "default" },
    { icon: Hourglass, label: "Maior tempo lançado sem pagar", value: stats.lancados ? `${stats.maiorLanc}d` : "—",
      tone: stats.maiorLanc > 7 ? "alert" : stats.maiorLanc > 3 ? "warning" : "default" },
    { icon: AlertCircle, label: "Conciliadas s/ lançamento", value: stats.semPagamento,
      tone: stats.semPagamento > 0 ? "warning" : "success" },
  ];

  return <PhaseShell eyebrow="Pagamento" title="Lançamento financeiro e quitação" tiles={tiles} />;
};

// ============== Resolvedor de fase ==============
export type Phase = "analise" | "validacao" | "aprovacao" | "pedido_nf" | "conciliacao" | "pagamento" | "encerrado";

export const resolvePhase = (status: PaymentStatus): Phase => {
  if (["pago"].includes(status)) return "pagamento";
  if (["lancado"].includes(status)) return "pagamento";
  if (["nf_recebida", "nf_questionada", "nf_divergente", "nf_conciliada", "em_questionamento"].includes(status)) return "conciliacao";
  if (["aprovado", "aprovado_com_ressalva", "aprovado_parcial", "revisao_pos_aprovacao", "pedido_nf_enviado"].includes(status)) return "pedido_nf";
  if (["aguardando_aprovacao", "aprovado_em_revisao"].includes(status)) return "aprovacao";
  if (["aguardando_validacao"].includes(status)) return "validacao";
  if (["rejeitado", "cancelado", "arquivado"].includes(status)) return "encerrado";
  return "analise";
};

interface PhaseSummaryProps {
  payment: PaymentRow;
  groups: GroupRow[];
  invoices: InvoiceRow[];
}

export const PhaseSummary = ({ payment, groups, invoices }: PhaseSummaryProps) => {
  const phase = resolvePhase(payment.status as PaymentStatus);
  if (phase === "validacao") return <ValidationPanel groups={groups} />;
  if (phase === "aprovacao") return <ApprovalPanel payment={payment} groups={groups} />;
  if (phase === "pedido_nf") return <NfRequestPanel groups={groups} invoices={invoices} />;
  if (phase === "conciliacao") return <ReconciliationPanel invoices={invoices} />;
  if (phase === "pagamento") return <PaymentPanel groups={groups} invoices={invoices} />;
  return null;
};
