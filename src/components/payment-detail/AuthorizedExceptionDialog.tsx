import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { recordAudit, buildDiff } from "@/lib/audit";

/**
 * Dialog para marcar / remover "Exceção autorizada" em um item cuja regra
 * vencedora é de **Exclusão / não pagar** com `allows_authorized_exception = true`.
 *
 * Quando marcada, o motor (server) re-roteia o item para a próxima regra
 * calculável específica; se não houver, vira alerta para validação manual.
 * Tudo é registrado em auditoria.
 */

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "vip_anestesia", label: "VIP / Anestesia autorizada" },
  { value: "acordo_pontual", label: "Acordo pontual" },
  { value: "diretoria", label: "Autorização da diretoria" },
  { value: "particular_negociado", label: "Particular negociado" },
  { value: "outro", label: "Outro" },
];

export type AuthorizedExceptionDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  paymentId: string;
  current: {
    authorized_exception?: boolean | null;
    exception_reason?: string | null;
    exception_authorizer?: string | null;
    exception_note?: string | null;
    exception_attachment_path?: string | null;
  };
  onSaved: () => void;
};

export function AuthorizedExceptionDialog({
  open,
  onOpenChange,
  itemId,
  paymentId,
  current,
  onSaved,
}: AuthorizedExceptionDialogProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState(current.exception_reason ?? "");
  const [authorizer, setAuthorizer] = useState(current.exception_authorizer ?? "");
  const [note, setNote] = useState(current.exception_note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(current.exception_reason ?? "");
      setAuthorizer(current.exception_authorizer ?? "");
      setNote(current.exception_note ?? "");
      setFile(null);
    }
  }, [open, current.exception_reason, current.exception_authorizer, current.exception_note]);

  const isAlreadyMarked = !!current.authorized_exception;

  const save = async () => {
    if (!reason) return toast({ title: "Informe o motivo da exceção", variant: "destructive" });
    if (!authorizer.trim()) return toast({ title: "Informe o autorizador", variant: "destructive" });
    if (!note.trim()) return toast({ title: "Observação obrigatória", variant: "destructive" });
    setBusy(true);
    try {
      let attachmentPath: string | null = current.exception_attachment_path ?? null;
      if (file) {
        const path = `${paymentId}/exceptions/${itemId}-${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("payment-files")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachmentPath = path;
      }
      const payload = {
        authorized_exception: true,
        exception_reason: reason,
        exception_authorizer: authorizer.trim(),
        exception_note: note.trim(),
        exception_attachment_path: attachmentPath,
        exception_marked_by: user?.id ?? null,
        exception_marked_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("payment_items").update(payload).eq("id", itemId);
      if (error) throw error;
      await recordAudit({
        entityType: "payment",
        entityId: paymentId,
        action: "update",
        actorId: user!.id,
        diff: buildDiff(
          {
            authorized_exception: !!current.authorized_exception,
            exception_reason: current.exception_reason ?? null,
            exception_authorizer: current.exception_authorizer ?? null,
            exception_note: current.exception_note ?? null,
          },
          {
            authorized_exception: true,
            exception_reason: reason,
            exception_authorizer: authorizer.trim(),
            exception_note: note.trim(),
            item_id: itemId,
          },
        ),
      });
      toast({ title: "Exceção autorizada registrada" });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha ao salvar", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("payment_items")
        .update({
          authorized_exception: false,
          exception_reason: null,
          exception_authorizer: null,
          exception_note: null,
          exception_attachment_path: null,
          exception_marked_by: null,
          exception_marked_at: null,
        })
        .eq("id", itemId);
      if (error) throw error;
      await recordAudit({
        entityType: "payment",
        entityId: paymentId,
        action: "update",
        actorId: user!.id,
        diff: { exception_removed: { before: true, after: false } },
      });
      toast({ title: "Exceção removida" });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Exceção autorizada</DialogTitle>
          <DialogDescription>
            A regra de exclusão admite exceção. Ao marcar, o motor reprocessa este item
            usando a próxima regra calculável específica; se não houver, fica como
            alerta para validação manual. Tudo é registrado em auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo da exceção *</Label>
            <Select value={reason || "__none"} onValueChange={(v) => setReason(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Autorizador *</Label>
            <Input
              value={authorizer}
              onChange={(e) => setAuthorizer(e.target.value)}
              placeholder="Nome de quem autorizou"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observação *</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Justificativa detalhada da exceção"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Anexo (opcional)</Label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {current.exception_attachment_path && !file && (
              <p className="text-[11px] text-muted-foreground truncate">
                Anexo atual: {current.exception_attachment_path.split("/").pop()}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          {isAlreadyMarked && (
            <Button variant="outline" onClick={remove} disabled={busy}>
              Remover exceção
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy}>
            {isAlreadyMarked ? "Atualizar" : "Marcar exceção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}