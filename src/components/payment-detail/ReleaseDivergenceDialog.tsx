import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  hospitalId: string;
  brutoRegra: number;
  brutoPedido: number;
  onReleased?: () => void;
};

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ReleaseDivergenceDialog({
  open,
  onOpenChange,
  groupId,
  hospitalId,
  brutoRegra,
  brutoPedido,
  onReleased,
}: Props) {
  const { user, hasRole } = useAuth();
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  const canRelease = hasRole("diretor") || hasRole("admin");
  const diferenca = brutoPedido - brutoRegra;

  const submit = async () => {
    if (!user) return;
    if (justification.trim().length < 10) {
      toast.error("Justificativa precisa ter pelo menos 10 caracteres");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("payment_group_reconciliation_overrides").insert({
      group_id: groupId,
      hospital_id: hospitalId,
      bruto_regra_snapshot: brutoRegra,
      bruto_pedido_snapshot: brutoPedido,
      diferenca_snapshot: diferenca,
      justification: justification.trim(),
      approved_by: user.id,
    });
    setSaving(false);
    if (error) {
      toast.error("Falha ao registrar liberação", { description: error.message });
      return;
    }
    toast.success("Divergência liberada para aprovação");
    setJustification("");
    onOpenChange(false);
    onReleased?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Liberar divergência para aprovação</DialogTitle>
          <DialogDescription>
            Esta ação registra uma exceção auditada. O grupo só será desbloqueado para os valores
            exatos abaixo; qualquer reprocessamento que altere o bruto exige nova liberação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div>
            <div className="text-muted-foreground">Bruto pedido</div>
            <div className="font-medium">{fmt(brutoPedido)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Bruto regra</div>
            <div className="font-medium">{fmt(brutoRegra)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Diferença</div>
            <div className="font-semibold text-destructive">{fmt(diferenca)}</div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="justification">Justificativa (obrigatória)</Label>
          <Textarea
            id="justification"
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Ex.: divergência aceita pela diretoria — acordo retroativo com convênio X aprovado por e-mail em DD/MM."
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !canRelease}
            title={!canRelease ? "Apenas diretor ou admin podem liberar" : undefined}
          >
            {saving ? "Registrando..." : "Registrar liberação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
