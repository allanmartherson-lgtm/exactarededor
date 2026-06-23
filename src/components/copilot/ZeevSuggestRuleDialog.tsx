import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { useToast } from "@/hooks/use-toast";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkles } from "lucide-react";

export type ZeevSuggestRulePayload = {
  /** Pré-preenche: nome do médico (ou null se múltiplos). */
  doctor_name?: string | null;
  doctor_id?: string | null;
  /** Pré-preenche: código TUSS (ou null se múltiplos). */
  procedure_code?: string | null;
  procedure_description?: string | null;
  /** Ocorrências detectadas (ex.: 18× reprovado). */
  occurrences?: number;
  /** IDs dos itens da amostra que motivaram a sugestão. */
  sample_item_ids: string[];
  /** Contexto adicional (livre). */
  context?: Record<string, unknown>;
  /** Texto inicial da justificativa. */
  initialJustification?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  companyGroupId?: string | null;
  payload: ZeevSuggestRulePayload;
  onSubmitted?: () => void;
}

export function ZeevSuggestRuleDialog({
  open,
  onOpenChange,
  paymentId,
  companyGroupId,
  payload,
  onSubmitted,
}: Props) {
  const { user } = useAuth();
  const { hospital } = useHospital();
  const { toast } = useToast();

  const [doctorName, setDoctorName] = useState(payload.doctor_name ?? "");
  const [procedureCode, setProcedureCode] = useState(payload.procedure_code ?? "");
  const [procedureDescription, setProcedureDescription] = useState(
    payload.procedure_description ?? "",
  );
  const [justification, setJustification] = useState(payload.initialJustification ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDoctorName(payload.doctor_name ?? "");
      setProcedureCode(payload.procedure_code ?? "");
      setProcedureDescription(payload.procedure_description ?? "");
      setJustification(payload.initialJustification ?? "");
    }
  }, [open, payload]);

  const submit = async () => {
    if (!user?.id) {
      toast({ title: "Não autenticado", variant: "destructive" });
      return;
    }
    if (!hospital?.id) {
      toast({
        title: "Selecione uma unidade hospitalar",
        description: "Use o seletor de unidade no topo antes de sugerir uma regra.",
        variant: "destructive",
      });
      return;
    }
    if (justification.trim().length < 10) {
      toast({
        title: "Justificativa muito curta",
        description: "Descreva em pelo menos 10 caracteres por que essa regra é necessária.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("rule_suggestions").insert({
        hospital_id: hospital.id,
        payment_id: paymentId,
        company_group_id: companyGroupId ?? null,
        suggested_by: user.id,
        status: "pending",
        doctor_id: payload.doctor_id ?? null,
        doctor_name: doctorName.trim() || null,
        procedure_code: procedureCode.trim() || null,
        procedure_description: procedureDescription.trim() || null,
        sample_item_ids: payload.sample_item_ids,
        occurrences: payload.occurrences ?? payload.sample_item_ids.length,
        context: payload.context ?? {},
        justification: justification.trim(),
      } as never);
      if (error) throw error;

      toast({
        title: "Sugestão enviada ao diretor",
        description: "O diretor vai revisar e converter em regra se fizer sentido.",
      });
      onOpenChange(false);
      onSubmitted?.();
    } catch (e: any) {
      toast({
        title: "Falha ao enviar sugestão",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" />
            Sugerir nova regra ao diretor
          </DialogTitle>
          <DialogDescription>
            Zeev encaminha sua sugestão para a fila de revisão do diretor. Nenhuma regra
            é criada automaticamente — só o diretor/admin pode efetivar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {payload.occurrences ? (
              <Badge variant="outline">{payload.occurrences} ocorrências</Badge>
            ) : null}
            <Badge variant="outline">
              {payload.sample_item_ids.length} item(ns) de amostra
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="zeev-sug-doctor">Médico</Label>
              <Input
                id="zeev-sug-doctor"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="(múltiplos / opcional)"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zeev-sug-tuss">TUSS</Label>
              <Input
                id="zeev-sug-tuss"
                value={procedureCode}
                onChange={(e) => setProcedureCode(e.target.value)}
                placeholder="(múltiplos / opcional)"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zeev-sug-proc">Procedimento (opcional)</Label>
            <Input
              id="zeev-sug-proc"
              value={procedureDescription}
              onChange={(e) => setProcedureDescription(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zeev-sug-just">Justificativa</Label>
            <Textarea
              id="zeev-sug-just"
              rows={4}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Ex.: cirurgião principal nesse TUSS recebe 100% da tabela do convênio. Hoje cai sem regra e precisa ser tratado manualmente toda competência."
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              Quanto mais contexto, mais rápido o diretor consegue avaliar.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || justification.trim().length < 10}
            className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Enviar sugestão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
