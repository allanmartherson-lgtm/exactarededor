/**
 * Detalhe de uma pendência + chat vinculado.
 *
 * - Carrega a pendência pelo :id.
 * - Se `thread_id` for nulo, cria uma `company_threads` (scope='pendencia') e
 *   atualiza a pendência. Isso permite analista responder mesmo sem chat prévio.
 * - Permite mudar status, atribuir a mim e marcar como resolvida.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { ListChecksIcon } from "@/config/icons/navIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanyThreadChat } from "@/components/portal/CompanyThreadChat";
import { DoctorPendenciaChat } from "@/components/portal/DoctorPendenciaChat";
import { NotificationHistoryPanel } from "@/components/pendencias/NotificationHistoryPanel";
import { PendenciaAttachmentsPanel } from "@/components/pendencias/PendenciaAttachmentsPanel";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { UserCheck, CheckCircle2 } from "lucide-react";

type PendStatus = "aberta" | "em_analise" | "respondida" | "resolvida" | "cancelada";

type Pendencia = {
  id: string;
  company_id: string;
  created_by_user_id: string | null;
  created_by_name: string;
  patient_name: string;
  event_date: string;
  event_type: string;
  attendance_number: string | null;
  agreement_name: string;
  doctor_name: string;
  doctor_id: string | null;
  opened_by: "empresa" | "medico";
  subject: string;
  description: string;
  status: PendStatus;
  priority: "baixa" | "normal" | "alta";
  assigned_to: string | null;
  payment_id: string | null;
  thread_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

const STATUS_LABEL: Record<PendStatus, string> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  respondida: "Respondida",
  resolvida: "Resolvida",
  cancelada: "Cancelada",
};

export default function PendenciaDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [pend, setPend] = useState<Pendencia | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [creatorName, setCreatorName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("pendencias" as never)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const p = data as unknown as Pendencia | null;
    setPend(p);
    if (p?.company_id) {
      const { data: c } = await supabase
        .from("companies")
        .select("name")
        .eq("id", p.company_id)
        .maybeSingle();
      setCompanyName((c?.name as string) ?? "");
    }
    if (p?.created_by_user_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", p.created_by_user_id)
        .maybeSingle();
      const name = (prof?.full_name as string | null) || "";
      setCreatorName(name || p.created_by_name);
    } else {
      setCreatorName(p?.created_by_name ?? "");
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [id]);

  // Cria thread se não existir.
  const ensureThread = async () => {
    if (!pend || pend.thread_id || creatingThread || !user) return;
    // Pendência aberta pelo médico nunca cria thread de empresa — a conversa
    // vive em doctor_messages e é renderizada pelo DoctorPendenciaChat.
    if (pend.opened_by === "medico") return;
    setCreatingThread(true);
    const { data, error } = await supabase
      .from("company_threads" as never)
      .insert({
        company_id: pend.company_id,
        scope: "pendencia",
        source: "pendencia",
        subject: pend.subject.slice(0, 200),
        created_by_type: "analista",
        created_by_user_id: user.id,
        status: "aberta",
      } as never)
      .select("id")
      .single();
    if (error) {
      setError(`Falha ao iniciar conversa: ${error.message}`);
      setCreatingThread(false);
      return;
    }
    const threadId = (data as { id: string }).id;
    await supabase
      .from("pendencias" as never)
      .update({ thread_id: threadId } as never)
      .eq("id", pend.id);
    setPend({ ...pend, thread_id: threadId });
    setCreatingThread(false);
  };

  const updatePend = async (patch: Partial<Pendencia>) => {
    if (!pend) return;
    const { error } = await supabase
      .from("pendencias" as never)
      .update(patch as never)
      .eq("id", pend.id);
    if (error) {
      setError(error.message);
      return;
    }
    setPend({ ...pend, ...patch });
  };

  const assignToMe = async () => {
    if (!user) return;
    await updatePend({
      assigned_to: user.id,
      status: pend?.status === "aberta" ? "em_analise" : pend?.status,
    });
  };

  const markResolved = async () => {
    await updatePend({
      status: "resolvida",
      resolved_at: new Date().toISOString(),
    });
  };

  const headerActions = useMemo(() => {
    if (!pend) return null;
    const isMine = pend.assigned_to && pend.assigned_to === user?.id;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={pend.status}
          onValueChange={(v) => void updatePend({ status: v as PendStatus })}
        >
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as PendStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isMine && (
          <Button variant="outline" size="sm" onClick={() => void assignToMe()} className="gap-1.5">
            <UserCheck className="h-3.5 w-3.5" />
            Atribuir a mim
          </Button>
        )}
        {pend.status !== "resolvida" && (
          <Button size="sm" onClick={() => void markResolved()} className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Marcar resolvida
          </Button>
        )}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pend, user?.id]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Pendência" icon={ListChecksIcon as never} backFallback="/pendencias" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !pend) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Pendência" icon={ListChecksIcon as never} backFallback="/pendencias" />
        <p className="text-destructive text-sm">
          {error ?? "Pendência não encontrada."}{" "}
          <Link to="/pendencias" className="underline">Voltar</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={pend.subject}
        icon={ListChecksIcon as never}
        backFallback="/pendencias"
        description={`${companyName || "Empresa"} · aberta em ${format(new Date(pend.created_at), "dd/MM/yy HH:mm", { locale: ptBR })} por ${creatorName || pend.created_by_name}`}
        actions={headerActions}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,2fr)] gap-4">
        {/* Painel de info */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-foreground">Detalhes do evento</h2>
            <Info label="Paciente" value={pend.patient_name} />
            <Info label="Médico" value={pend.doctor_name} />
            <Info label="Convênio" value={pend.agreement_name} />
            <Info
              label="Evento"
              value={`${pend.event_type} — ${format(new Date(pend.event_date), "dd/MM/yyyy", { locale: ptBR })}`}
            />
            {pend.attendance_number && (
              <Info label="Atendimento" value={pend.attendance_number} />
            )}
            <Info
              label="Prioridade"
              value={
                <Badge variant={pend.priority === "alta" ? "destructive" : "secondary"}>
                  {pend.priority === "alta" ? "Alta" : pend.priority === "baixa" ? "Baixa" : "Normal"}
                </Badge>
              }
            />
            <Info
              label="Status"
              value={<Badge variant="outline">{STATUS_LABEL[pend.status]}</Badge>}
            />
            {pend.payment_id && (
              <Info
                label="Lote vinculado"
                value={
                  <Link to={`/pagamentos/${pend.payment_id}`} className="text-primary underline">
                    Abrir lote
                  </Link>
                }
              />
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-[13px] font-semibold text-foreground mb-2">Descrição</h2>
            <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
              {pend.description}
            </p>
          </div>

          <NotificationHistoryPanel pendenciaId={pend.id} />
        </div>

        {/* Chat — médico ou empresa, conforme origem da pendência */}
        <div className="flex flex-col min-h-[60vh]">
          {pend.opened_by === "medico" && pend.doctor_id ? (
            <DoctorPendenciaChat
              pendenciaId={pend.id}
              doctorId={pend.doctor_id}
              doctorName={pend.doctor_name}
              className="flex-1"
            />
          ) : pend.thread_id ? (
            <CompanyThreadChat
              threadId={pend.thread_id}
              companyId={pend.company_id}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 border border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-muted-foreground max-w-md">
                Esta pendência ainda não tem conversa vinculada. Inicie um chat
                com a empresa para começar a interagir sobre este ticket.
              </p>
              <Button onClick={() => void ensureThread()} disabled={creatingThread}>
                {creatingThread ? "Iniciando…" : "Iniciar conversa"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] text-foreground text-right">{value}</span>
    </div>
  );
}
