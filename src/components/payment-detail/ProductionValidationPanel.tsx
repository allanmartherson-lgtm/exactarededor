import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Minus, ChevronDown, ChevronUp, Building2 } from "lucide-react";

interface Feedback {
  id: string;
  kind: string;
  exclusion_reason: string | null;
  exclusion_detail: string | null;
  patient_name: string | null;
  procedure_date: string | null;
  attendance_number: string | null;
  convenio: string | null;
  doctor_name: string | null;
  description: string | null;
  status: string;
  payment_item_id: string | null;
}

interface Validation {
  id: string;
  company_name: string;
  status: string;
  sent_at: string;
  expires_at: string;
  confirmed_at: string | null;
  notes: string | null;
  feedbacks: Feedback[];
}

interface Props {
  paymentId: string;
  currentUserId: string;
  onChanged: () => void;
}

const KIND_LABEL: Record<string, string> = {
  exclusao: "Exclusão",
  ausencia: "Ausência",
  observacao: "Observação",
};
const KIND_COLOR: Record<string, string> = {
  exclusao: "bg-destructive/10 text-destructive border-destructive/30",
  ausencia: "bg-warning-soft text-warning-text border-warning/30",
  observacao: "bg-info-soft text-info border-info/30",
};
const EXCLUSION_REASON_LABEL: Record<string, string> = {
  outra_via: "Outra via",
  particular: "Particular",
  associacao: "Associação",
  outro: "Outro",
};

export function ProductionValidationPanel({ paymentId, currentUserId, onChanged }: Props) {
  const [validations, setValidations] = useState<Validation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data: vals } = await supabase
      .from("production_validations")
      .select("id, company_name, status, sent_at, expires_at, confirmed_at, notes")
      .eq("payment_id", paymentId)
      .order("sent_at", { ascending: false });
    if (!vals?.length) { setValidations([]); return; }

    const { data: fbs } = await supabase
      .from("production_validation_feedbacks")
      .select("*")
      .in("validation_id", vals.map(v => v.id));

    setValidations(vals.map(v => ({
      ...v,
      feedbacks: ((fbs ?? []) as any[]).filter(f => f.validation_id === v.id) as Feedback[],
    })));
  };

  useEffect(() => { load(); }, [paymentId]);

  if (validations.length === 0) return null;

  const resolve = async (feedbackId: string, newStatus: "aceito" | "rejeitado" | "ignorado") => {
    setBusy(feedbackId);
    const { error } = await supabase.from("production_validation_feedbacks")
      .update({ status: newStatus, resolved_by: currentUserId, resolved_at: new Date().toISOString() })
      .eq("id", feedbackId);
    setBusy(null);
    if (error) { toast({ title: "Erro ao resolver feedback", variant: "destructive" }); return; }
    toast({ title: "Feedback resolvido" });
    load();
    onChanged();
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const openCount = validations.reduce((s, v) =>
    s + v.feedbacks.filter(f => f.status === "aberto").length, 0);
  const allExpired = validations.every(v => v.status === "expirado");
  const [sectionOpen, setSectionOpen] = useState(!allExpired || openCount > 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setSectionOpen(o => !o)}
        className="w-full flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Validações da empresa</span>
        <Badge variant="outline" className="text-[10px]">
          {validations.length}
        </Badge>
        {openCount > 0 && (
          <Badge variant="outline" className="bg-warning-soft text-warning-text border-warning/30 text-[10px]">
            {openCount} pendente{openCount > 1 ? "s" : ""}
          </Badge>
        )}
        {allExpired && openCount === 0 && (
          <span className="text-[10px] text-muted-foreground">(todas expiradas)</span>
        )}
        <span className="ml-auto">
          {sectionOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </span>
      </button>

      {sectionOpen && validations.map(v => {

        const isExpanded = expanded.has(v.id);
        const pendentes = v.feedbacks.filter(f => f.status === "aberto").length;
        return (
          <div key={v.id} className="rounded-lg border bg-card">
            <button type="button" onClick={() => toggleExpand(v.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{v.company_name}</span>
                <Badge variant="outline" className={
                  v.status === "confirmado" ? "bg-success-soft text-success border-success/30" :
                  v.status === "com_ressalva" ? "bg-warning-soft text-warning-text border-warning/30" :
                  v.status === "expirado" ? "bg-muted text-muted-foreground" :
                  "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300"
                }>
                  {v.status === "aguardando" ? "Aguardando" : v.status === "confirmado" ? "Confirmado" : v.status === "com_ressalva" ? "Com ressalva" : "Expirado"}
                </Badge>
                {pendentes > 0 && (
                  <span className="text-[10px] font-semibold text-warning-text">{pendentes} pendente{pendentes > 1 ? "s" : ""}</span>
                )}
              </div>
              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
            </button>

            {isExpanded && (
              <div className="border-t px-4 pb-3 pt-2 space-y-2">
                {v.notes && (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">{v.notes}</p>
                )}
                {v.feedbacks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum feedback enviado ainda.</p>
                ) : (
                  v.feedbacks.map(f => (
                    <div key={f.id} className={`rounded-md border px-3 py-2 text-xs space-y-1 ${KIND_COLOR[f.kind] ?? ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{KIND_LABEL[f.kind] ?? f.kind}</span>
                        {f.status !== "aberto" && (
                          <span className="text-[10px] uppercase tracking-wide opacity-70">{f.status}</span>
                        )}
                      </div>
                      {f.kind === "exclusao" && (
                        <p>Motivo: <strong>{EXCLUSION_REASON_LABEL[f.exclusion_reason ?? ""] ?? f.exclusion_reason}</strong>
                          {f.exclusion_detail && ` — ${f.exclusion_detail}`}</p>
                      )}
                      {f.kind === "ausencia" && (
                        <div className="space-y-0.5">
                          {f.patient_name && <p>Paciente: <strong>{f.patient_name}</strong></p>}
                          {f.doctor_name && <p>Médico: <strong>{f.doctor_name}</strong></p>}
                          {f.procedure_date && <p>Data: <strong>{f.procedure_date}</strong></p>}
                          {f.convenio && <p>Convênio: <strong>{f.convenio}</strong></p>}
                          {f.description && <p>Descrição: <strong>{f.description}</strong></p>}
                          {f.attendance_number && <p>Atendimento: <strong>{f.attendance_number}</strong></p>}
                        </div>
                      )}
                      {f.kind === "observacao" && f.description && <p>{f.description}</p>}
                      {f.status === "aberto" && (
                        <div className="flex gap-1.5 pt-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] border-success/40 text-success hover:bg-success-soft"
                            disabled={busy === f.id} onClick={() => resolve(f.id, "aceito")}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Aceitar
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={busy === f.id} onClick={() => resolve(f.id, "rejeitado")}>
                            <XCircle className="h-3 w-3 mr-1" /> Rejeitar
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px]"
                            disabled={busy === f.id} onClick={() => resolve(f.id, "ignorado")}>
                            <Minus className="h-3 w-3 mr-1" /> Ignorar
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
