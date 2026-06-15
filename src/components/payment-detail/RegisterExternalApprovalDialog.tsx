import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";
import type { GroupRow } from "@/hooks/usePaymentDetailData";

type Stage = "validation" | "approval";
type Source = "email" | "whatsapp" | "outro";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  groups: GroupRow[];
  /** Etapa que está sendo registrada: validação (supervisor) ou aprovação (diretor). */
  stage: Stage;
  /** Quem está operando o sistema agora (será gravado como registered_by + approved/validated_by). */
  registeredById: string;
  onDone: () => void | Promise<void>;
}

const ELIGIBLE_BY_STAGE: Record<Stage, Set<string>> = {
  validation: new Set(["aguardando_validacao"]),
  approval: new Set(["aguardando_aprovacao"]),
};

const STAGE_LABEL: Record<Stage, { title: string; role: string; targetStatus: string }> = {
  validation: {
    title: "Registrar validação externa",
    role: "supervisor",
    targetStatus: "aguardando_aprovacao",
  },
  approval: {
    title: "Registrar aprovação externa",
    role: "diretor",
    targetStatus: "revisao_pos_aprovacao",
  },
};

export function RegisterExternalApprovalDialog({
  open,
  onOpenChange,
  paymentId,
  groups,
  stage,
  registeredById,
  onDone,
}: Props) {
  const cfg = STAGE_LABEL[stage];
  const eligible = useMemo(
    () => groups.filter((g) => ELIGIBLE_BY_STAGE[stage].has(String(g.status))),
    [groups, stage],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((g) => g.id)));
  const [source, setSource] = useState<Source>("email");
  const [personName, setPersonName] = useState("");
  const [decisionDate, setDecisionDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-sincroniza seleção quando o dialog reabre
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setSelected(new Set(eligible.map((g) => g.id)));
      setNote("");
      setFile(null);
      setPersonName("");
      setSource("email");
      setDecisionDate(new Date().toISOString().slice(0, 10));
    }
    onOpenChange(v);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = async () => {
    if (selected.size === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    if (personName.trim().length < 3) {
      toast({
        title: `Informe o nome do ${cfg.role}`,
        description: `Quem aprovou externamente em nome de quem?`,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);

    // 1) Upload do anexo (opcional)
    let evidencePath: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `external-${stage}/${paymentId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("approval-pdfs")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) {
        setBusy(false);
        toast({ title: "Falha ao subir anexo", description: upErr.message, variant: "destructive" });
        return;
      }
      evidencePath = path;
    }

    // 2) Monta a nota completa (inclui a data da decisão)
    const fullNote = [
      `Data da decisão: ${decisionDate}`,
      note.trim() ? `Observação: ${note.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // 3) Chama o RPC correspondente
    const rpcName = stage === "approval" ? "register_external_approval" : "register_external_validation";
    const params =
      stage === "approval"
        ? {
            p_payment_id: paymentId,
            p_group_ids: Array.from(selected),
            p_registered_by: registeredById,
            p_director_name: personName.trim(),
            p_source: source,
            p_evidence_path: evidencePath,
            p_note: fullNote,
          }
        : {
            p_payment_id: paymentId,
            p_group_ids: Array.from(selected),
            p_registered_by: registeredById,
            p_supervisor_name: personName.trim(),
            p_source: source,
            p_evidence_path: evidencePath,
            p_note: fullNote,
          };

    const { error } = await supabase.rpc(rpcName as never, params as never);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao registrar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `${selected.size} empresa(s) registrada(s)`,
      description: `${stage === "approval" ? "Aprovação" : "Validação"} externa em nome de ${personName.trim()} (${source}).`,
    });
    onOpenChange(false);
    await onDone();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-primary" /> {cfg.title}
          </DialogTitle>
          <DialogDescription>
            Use somente como <strong>backup</strong> quando a decisão aconteceu fora do sistema
            (e-mail, WhatsApp, falha temporária). O caminho primário continua sendo a aprovação pelo
            próprio {cfg.role} dentro do sistema (clique direto ou magic link).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {eligible.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft/40 p-3 text-warning-text">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Nenhuma empresa neste lote está em <code>{Array.from(ELIGIBLE_BY_STAGE[stage]).join(", ")}</code>.
                Só é possível registrar {stage === "approval" ? "aprovação" : "validação"} externa quando a etapa estiver aberta.
              </span>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Empresas ({selected.size} selecionada{selected.size === 1 ? "" : "s"} de {eligible.length})
                </Label>
                <div className="mt-1 max-h-44 overflow-y-auto border rounded-md divide-y">
                  {eligible.map((g) => (
                    <label key={g.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                      <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.company_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Canal da decisão externa</Label>
                  <RadioGroup
                    value={source}
                    onValueChange={(v) => setSource(v as Source)}
                    className="mt-1 flex gap-3"
                  >
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <RadioGroupItem value="email" /> E-mail
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <RadioGroupItem value="whatsapp" /> WhatsApp
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <RadioGroupItem value="outro" /> Outro
                    </label>
                  </RadioGroup>
                </div>
                <div>
                  <Label className="text-xs">Data da decisão</Label>
                  <Input
                    type="date"
                    value={decisionDate}
                    onChange={(e) => setDecisionDate(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Nome do {cfg.role} que decidiu</Label>
                <Input
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder={`Ex: Dr. Fulano de Tal`}
                  className="text-base md:text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Registrado como decisor externo. Você (operador atual) fica gravado como quem registrou.
                </p>
              </div>

              <div>
                <Label className="text-xs">Anexo de prova (opcional)</Label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.eml,.msg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {file.name} ({(file.size / 1024).toFixed(0)} KB)
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs">Observação (opcional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Detalhes sobre a aprovação recebida fora do sistema…"
                  className="text-base md:text-sm"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || eligible.length === 0}>
            {busy
              ? "Registrando…"
              : stage === "approval"
                ? "Registrar aprovação"
                : "Registrar validação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
