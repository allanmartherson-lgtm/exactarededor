import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";
import { dedupEmails } from "@/lib/email";
import type { GroupRow } from "@/hooks/usePaymentDetailData";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  /** Grupos elegíveis (status `revisao_pos_aprovacao`). */
  groups: GroupRow[];
  onSuccess?: () => void;
}

type EmailMap = Record<string, string[]>;

export const BulkReleaseInvoiceRequestDialog = ({
  open,
  onOpenChange,
  paymentId,
  groups,
  onSuccess,
}: Props) => {
  const [emailsByCompany, setEmailsByCompany] = useState<EmailMap>({});
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setProgress(null);
      return;
    }
    const companyIds = Array.from(
      new Set(groups.map((g) => g.company_id).filter(Boolean) as string[]),
    );
    if (companyIds.length === 0) {
      setEmailsByCompany({});
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setLoadingEmails(true);
    supabase
      .from("companies")
      .select("id, invoice_emails")
      .in("id", companyIds)
      .then(({ data }) => {
        if (cancelled) return;
        const map: EmailMap = {};
        (data ?? []).forEach((row: { id: string; invoice_emails: string[] | null }) => {
          map[row.id] = dedupEmails(row.invoice_emails ?? []);
        });
        setEmailsByCompany(map);
        // pré-seleciona todos com e-mail cadastrado
        const initial = new Set<string>();
        groups.forEach((g) => {
          if (g.company_id && (map[g.company_id]?.length ?? 0) > 0) initial.add(g.id);
        });
        setSelected(initial);
        setLoadingEmails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, groups]);

  const eligibleEmailsCount = useMemo(
    () =>
      groups.filter((g) => g.company_id && (emailsByCompany[g.company_id]?.length ?? 0) > 0).length,
    [groups, emailsByCompany],
  );

  const totalSelectedAmount = useMemo(
    () =>
      groups
        .filter((g) => selected.has(g.id))
        .reduce((s, g) => s + (Number(g.liquido_total ?? g.total_amount) || 0), 0),
    [groups, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    const next = new Set<string>();
    groups.forEach((g) => {
      if (g.company_id && (emailsByCompany[g.company_id]?.length ?? 0) > 0) next.add(g.id);
    });
    setSelected(next);
  };

  const submit = async () => {
    const targets = groups.filter((g) => selected.has(g.id));
    if (targets.length === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    // Resolve hospital_id do pagamento (NOT NULL em invoices; trigger valida divergência)
    const { data: pay } = await supabase.from("payments").select("hospital_id").eq("id", paymentId).single();
    const hospitalId = pay?.hospital_id;
    if (!hospitalId) {
      toast({ title: "Pagamento sem unidade vinculada", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const g = targets[i];
      const emails = (g.company_id && emailsByCompany[g.company_id]) || [];
      if (emails.length === 0) {
        fail++;
        setProgress({ done: i + 1, total: targets.length });
        continue;
      }
      try {
        const { error: invErr } = await supabase.from("invoices").insert({
          hospital_id: hospitalId,
          payment_id: paymentId,
          company_group_id: g.id,
          company_id: g.company_id ?? null,
          company_name: g.company_name,
          expected_amount: Number(g.liquido_total ?? g.total_amount) || 0,
          items_count: g.items_count ?? 0,
          recipient_email: emails[0],
          recipient_cc: emails.slice(1),
          status: "aguardando",
          request_message: message.trim() || null,
          sent_at: new Date().toISOString(),
        });
        if (invErr) throw invErr;
        const { error: grpErr } = await supabase
          .from("payment_company_groups")
          .update({ status: "pedido_nf_enviado", updated_at: new Date().toISOString() })
          .eq("id", g.id);
        if (grpErr) throw grpErr;
        ok++;
      } catch (e) {
        console.error("bulk release failed", g.company_name, e);
        fail++;
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setSubmitting(false);
    setProgress(null);
    if (ok > 0) {
      toast({
        title: `${ok} pedido(s) de NF enviado(s)`,
        description: fail > 0 ? `${fail} falharam — verifique os e-mails cadastrados.` : undefined,
      });
    } else {
      toast({ title: "Nenhum pedido enviado", variant: "destructive" });
    }
    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Liberar pedidos de NF em massa
          </DialogTitle>
          <DialogDescription>
            Selecione as empresas aprovadas pelo diretor para enviar o pedido de NF de uma vez.
            Apenas empresas com e-mail cadastrado podem ser selecionadas.
          </DialogDescription>
        </DialogHeader>


        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {loadingEmails ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando e-mails…
            </div>
          ) : groups.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Nenhuma empresa elegível.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={
                      selected.size > 0 && selected.size === eligibleEmailsCount
                        ? true
                        : selected.size > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) => toggleAll(v === true)}
                  />
                  <span className="font-medium">Selecionar todas com e-mail ({eligibleEmailsCount})</span>
                </label>
                <span className="text-muted-foreground">
                  {selected.size} selecionada(s) · {formatCurrency(totalSelectedAmount)}
                </span>
              </div>

              <div className="border rounded-md divide-y">
                {groups.map((g) => {
                  const emails = (g.company_id && emailsByCompany[g.company_id]) || [];
                  const hasEmail = emails.length > 0;
                  return (
                    <label
                      key={g.id}
                      className={`flex items-start gap-3 px-3 py-2.5 ${hasEmail ? "cursor-pointer hover:bg-muted/40" : "opacity-60 cursor-not-allowed"}`}
                    >
                      <Checkbox
                        checked={selected.has(g.id)}
                        disabled={!hasEmail}
                        onCheckedChange={() => hasEmail && toggle(g.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.company_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.items_count} itens · {formatCurrency(Number(g.liquido_total ?? g.total_amount ?? 0))}
                        </p>
                        {hasEmail ? (
                          <p className="text-[11px] text-muted-foreground truncate">
                            <CheckCircle2 className="inline h-3 w-3 text-success mr-1" />
                            {emails[0]}
                            {emails.length > 1 && ` (+${emails.length - 1} cc)`}
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Sem e-mail cadastrado — libere individualmente para preencher.
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Mensagem (opcional)</label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Mensagem aplicada a todos os pedidos…"
                  rows={3}
                />
              </div>

              {progress && (
                <p className="text-xs text-muted-foreground text-center">
                  Enviando {progress.done} de {progress.total}…
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || loadingEmails || selected.size === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
            Liberar {selected.size > 0 ? `${selected.size} pedido(s)` : "pedidos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
