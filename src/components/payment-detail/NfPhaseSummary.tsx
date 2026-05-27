import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Clock, FileCheck2, AlertCircle, Send, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import type { GroupRow, InvoiceRow } from "@/hooks/usePaymentDetailData";

interface Props {
  groups: GroupRow[];
  invoices: InvoiceRow[];
}

/**
 * Resumo da fase de NF — substitui os cards de IA/Anomalias/Alertas
 * assistenciais quando o pagamento já foi aprovado pelo diretor.
 * Foca exclusivamente nos assuntos que o analista precisa para liberar
 * e acompanhar os pedidos de NF.
 */
export const NfPhaseSummary = ({ groups, invoices }: Props) => {
  const [emailsByCompany, setEmailsByCompany] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const companyIds = Array.from(
      new Set(groups.map((g) => g.company_id).filter(Boolean) as string[]),
    );
    if (companyIds.length === 0) return;
    let cancelled = false;
    supabase
      .from("companies")
      .select("id, invoice_emails")
      .in("id", companyIds)
      .then(({ data }) => {
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        (data ?? []).forEach((row: { id: string; invoice_emails: string[] | null }) => {
          map[row.id] = row.invoice_emails ?? [];
        });
        setEmailsByCompany(map);
      });
    return () => { cancelled = true; };
  }, [groups]);

  const stats = useMemo(() => {
    const aguardandoLiberacao = groups.filter((g) => g.status === "revisao_pos_aprovacao");
    const semEmail = aguardandoLiberacao.filter(
      (g) => !g.company_id || (emailsByCompany[g.company_id] ?? []).length === 0,
    );
    const enviados = groups.filter((g) => g.status === "pedido_nf_enviado");
    const recebidas = invoices.filter((i) => i.status === "recebida" || i.received_at);
    const conciliadas = invoices.filter((i) => i.status === "conciliada");
    const divergentes = invoices.filter((i) => i.status === "divergente");
    const questionadas: InvoiceRow[] = [];

    const now = Date.now();
    const diasAguardando = aguardandoLiberacao
      .map((g) => Math.floor((now - new Date(g.updated_at ?? g.created_at).getTime()) / 86400000))
      .filter((d) => Number.isFinite(d) && d >= 0);
    const maiorEspera = diasAguardando.length > 0 ? Math.max(...diasAguardando) : 0;

    const diasEnviado = enviados
      .map((g) => {
        const inv = invoices.find((i) => i.company_group_id === g.id);
        const sentAt = inv?.sent_at ? new Date(inv.sent_at).getTime() : new Date(g.updated_at ?? g.created_at).getTime();
        return Math.floor((now - sentAt) / 86400000);
      })
      .filter((d) => Number.isFinite(d) && d >= 0);
    const maiorEsperaNf = diasEnviado.length > 0 ? Math.max(...diasEnviado) : 0;

    const valorAguardando = aguardandoLiberacao.reduce(
      (s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0),
      0,
    );

    return {
      aguardandoLiberacao: aguardandoLiberacao.length,
      semEmail: semEmail.length,
      enviados: enviados.length,
      recebidas: recebidas.length,
      conciliadas: conciliadas.length,
      divergentes: divergentes.length,
      questionadas: questionadas.length,
      maiorEspera,
      maiorEsperaNf,
      valorAguardando,
    };
  }, [groups, invoices, emailsByCompany]);

  const tiles: Array<{
    icon: typeof Mail;
    label: string;
    value: string | number;
    sub?: string;
    tone: "default" | "warning" | "alert" | "success";
  }> = [
    {
      icon: Send,
      label: "Aguardando liberação de NF",
      value: stats.aguardandoLiberacao,
      sub: stats.valorAguardando > 0 ? formatCurrency(stats.valorAguardando) : undefined,
      tone: stats.aguardandoLiberacao > 0 ? "warning" : "default",
    },
    {
      icon: AlertCircle,
      label: "Empresas sem e-mail cadastrado",
      value: stats.semEmail,
      sub: stats.semEmail > 0 ? "Bloqueia envio automático" : "Todas com e-mail",
      tone: stats.semEmail > 0 ? "alert" : "success",
    },
    {
      icon: Hourglass,
      label: "Maior tempo aguardando liberação",
      value: stats.aguardandoLiberacao > 0 ? `${stats.maiorEspera}d` : "—",
      sub: stats.aguardandoLiberacao > 0 ? "desde aprovação" : undefined,
      tone: stats.maiorEspera > 5 ? "alert" : stats.maiorEspera > 2 ? "warning" : "default",
    },
    {
      icon: Clock,
      label: "Maior tempo aguardando NF",
      value: stats.enviados > 0 ? `${stats.maiorEsperaNf}d` : "—",
      sub: stats.enviados > 0 ? `${stats.enviados} pedido(s) enviado(s)` : undefined,
      tone: stats.maiorEsperaNf > 7 ? "alert" : stats.maiorEsperaNf > 3 ? "warning" : "default",
    },
    {
      icon: FileCheck2,
      label: "NFs recebidas",
      value: stats.recebidas,
      sub: stats.conciliadas > 0 ? `${stats.conciliadas} conciliada(s)` : undefined,
      tone: "default",
    },
    {
      icon: AlertCircle,
      label: "NFs com pendência",
      value: stats.divergentes + stats.questionadas,
      sub:
        stats.divergentes + stats.questionadas > 0
          ? `${stats.divergentes} divergente(s) · ${stats.questionadas} questionada(s)`
          : "Nenhuma pendência",
      tone: stats.divergentes + stats.questionadas > 0 ? "alert" : "success",
    },
  ];

  const toneClass = (tone: string) => {
    switch (tone) {
      case "alert":
        return "border-l-destructive";
      case "warning":
        return "border-l-amber-500";
      case "success":
        return "border-l-emerald-500";
      default:
        return "border-l-border";
    }
  };

  const valueClass = (tone: string) => {
    switch (tone) {
      case "alert":
        return "text-destructive";
      case "warning":
        return "text-amber-600 dark:text-amber-400";
      case "success":
        return "text-emerald-600 dark:text-emerald-400";
      default:
        return "text-foreground";
    }
  };

  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Pedido de Nota Fiscal
            </p>
            <p className="text-sm font-semibold text-foreground">
              Acompanhamento do ciclo de NF
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.label}
                className={`border-l-2 ${toneClass(t.tone)} pl-3 py-1.5 min-w-0`}
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  <span className="truncate">{t.label}</span>
                </div>
                <p className={`text-2xl font-semibold tabular-nums leading-tight ${valueClass(t.tone)}`}>
                  {t.value}
                </p>
                {t.sub && (
                  <p className="text-[10px] text-muted-foreground truncate">{t.sub}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
