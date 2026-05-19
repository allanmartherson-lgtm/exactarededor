import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Mail, Loader2, Pencil, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";
import { tryAddEmail, dedupEmails, parseEmailList } from "@/lib/email";
import type { GroupRow } from "@/hooks/usePaymentDetailData";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  group: GroupRow | null;
  onSuccess?: () => void;
}

export const ReleaseInvoiceRequestDialog = ({ open, onOpenChange, paymentId, group, onSuccess }: Props) => {
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingEmails, setEditingEmails] = useState(false);

  useEffect(() => {
    if (!open || !group?.company_id) {
      setEmails([]);
      setEmailInput("");
      setMessage("");
      setEditingEmails(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("companies")
      .select("invoice_emails")
      .eq("id", group.company_id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const saved = dedupEmails((data?.invoice_emails as string[] | null) ?? []);
        setEmails(saved);
        setEditingEmails(saved.length === 0);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, group?.company_id]);

  const commitEmailInput = () => {
    if (!emailInput.trim()) return;
    const parsed = parseEmailList(emailInput);
    if (parsed.length === 0) {
      toast({ title: "E-mail inválido", variant: "destructive" });
      return;
    }
    let next = emails;
    for (const e of parsed) {
      const res = tryAddEmail(next, e);
      if (res.ok) next = res.emails;
    }
    setEmails(next);
    setEmailInput("");
  };

  const removeEmail = (e: string) => setEmails((prev) => prev.filter((x) => x !== e));

  const submit = async () => {
    if (!group) return;
    if (emails.length === 0) {
      toast({ title: "Informe ao menos um e-mail", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (group.company_id) {
        await supabase.from("companies").update({ invoice_emails: emails }).eq("id", group.company_id);
      }

      const { error: invErr } = await supabase.from("invoices").insert({
        payment_id: paymentId,
        company_group_id: group.id,
        company_id: group.company_id ?? null,
        company_name: group.company_name,
        expected_amount: Number(group.total_amount) || 0,
        items_count: group.items_count ?? 0,
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
        .eq("id", group.id);
      if (grpErr) throw grpErr;

      toast({ title: `Pedido de NF enviado para ${group.company_name}` });
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao enviar pedido", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const showEditor = editingEmails || emails.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Liberar pedido de NF
          </DialogTitle>
          {group && (
            <DialogDescription>
              <span className="font-medium text-foreground">{group.company_name}</span>
              {" · "}
              <span className="tabular-nums">{formatCurrency(group.total_amount)}</span>
              {" · "}
              <span>{group.items_count} item(ns)</span>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando e-mails…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">E-mails destinatários</label>
                {!showEditor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setEditingEmails(true)}
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Editar
                  </Button>
                )}
              </div>

              {showEditor ? (
                <>
                  {emails.length === 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Nenhum e-mail cadastrado para esta empresa. Adicione ao menos um e-mail para continuar.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 rounded-md border bg-background px-2 py-2 min-h-[42px]">
                    {emails.map((e) => (
                      <Badge key={e} variant="secondary" className="gap-1">
                        {e}
                        <button
                          type="button"
                          onClick={() => removeEmail(e)}
                          className="hover:text-destructive"
                          aria-label={`Remover ${e}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    <Input
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          commitEmailInput();
                        }
                      }}
                      onBlur={commitEmailInput}
                      placeholder={emails.length === 0 ? "ex.: financeiro@empresa.com" : "Adicionar…"}
                      className="h-7 flex-1 min-w-[160px] border-0 shadow-none focus-visible:ring-0 px-1"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    O primeiro e-mail é o destinatário principal; os demais entram em cópia. Estes e-mails serão salvos no cadastro da empresa.
                  </p>
                </>
              ) : (
                <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/30 px-2 py-2 min-h-[42px]">
                  {emails.map((e, i) => (
                    <Badge key={e} variant={i === 0 ? "default" : "secondary"}>
                      {e}
                      {i === 0 && <span className="ml-1 text-[10px] opacity-70">principal</span>}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Mensagem (opcional)</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ex.: NF deve mencionar competência X/2026…"
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || loading || emails.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
            Enviar pedido de NF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
