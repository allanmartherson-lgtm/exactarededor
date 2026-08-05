// Detalhe do Cadastro de Acordo — visão read-only com as ações de cada papel
// (supervisor, diretor por hospital e analista) e linha do tempo do fluxo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgreementAttachmentsPanel } from "@/components/relacionamento/AgreementAttachmentsPanel";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  CircleDashed,
  Circle,
  XCircle,
  FileDown,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  AGREEMENT_HOSPITAL_STATUS_LABEL,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_VARIANT,
  PAYMENT_TABLE_BASE_LABEL,
  buildAgreementTimeline,
  buildSupervisorChecklist,
  type AgreementEventRow,
  type AgreementFlowFields,
  type AgreementHospitalRow,
  type AgreementRegistration,
} from "@/lib/agreementRegistrations";
import { generateAndStoreAgreementPdf, openStoredAgreementPdf } from "@/lib/agreementPdf";

type FullAgreement = AgreementRegistration & Partial<AgreementFlowFields>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreement: FullAgreement | null;
  companyName?: string;
  onChanged: () => void;
  /** Reabre o wizard editável para o Setor de Contratos corrigir o acordo. */
  onEdit?: (agreement: FullAgreement) => void;
}

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR") : null;
const yn = (b: boolean | null | undefined) => (b ? "Sim" : "Não");

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value || "—"}</p>
    </div>
  );
}

export function AgreementDetailDialog({
  open,
  onOpenChange,
  agreement,
  companyName,
  onChanged,
  onEdit,
}: Props) {
  const { hasRole, user } = useAuth();
  const { hospital, availableHospitals, switchHospital } = useHospital();
  const navigate = useNavigate();

  const [hospitals, setHospitals] = useState<AgreementHospitalRow[]>([]);
  const [events, setEvents] = useState<AgreementEventRow[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [directorNotes, setDirectorNotes] = useState<Record<string, string>>({});

  const isSupervisor = hasRole("gestao_medica") || hasRole("admin");
  const isDirector = hasRole("diretor") || hasRole("admin");
  const isAnalyst = hasRole("analista") || hasRole("admin");

  const hospitalNames = useMemo(() => {
    const m = new Map<string, string>();
    availableHospitals.forEach((h) => m.set(h.id, h.name));
    return m;
  }, [availableHospitals]);

  const load = useCallback(async () => {
    if (!agreement) return;
    setLoading(true);
    const [{ data, error }, { data: evs, error: evErr }] = await Promise.all([
      supabase
        .from("agreement_registration_hospitals")
        .select("*")
        .eq("agreement_id", agreement.id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("agreement_registration_events")
        .select("*")
        .eq("agreement_id", agreement.id)
        .order("created_at", { ascending: true }),
    ]);
    if (error) toast.error("Falha ao carregar hospitais do acordo", { description: error.message });
    if (evErr) toast.error("Falha ao carregar o histórico do acordo", { description: evErr.message });
    setHospitals((data ?? []) as unknown as AgreementHospitalRow[]);
    setEvents((evs ?? []) as unknown as AgreementEventRow[]);

    // Nomes dos diretores/autores para exibir na rejeição e no histórico
    const ids = Array.from(
      new Set(
        [
          ...(data ?? []).map((r) => (r as { director_id: string | null }).director_id),
          ...(evs ?? []).map((r) => (r as { actor_id: string | null }).actor_id),
        ].filter((v): v is string => !!v),
      ),
    );
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p) => {
        const row = p as { id: string; full_name: string | null; email: string | null };
        map[row.id] = row.full_name || row.email || row.id;
      });
      setUserNames(map);
    } else {
      setUserNames({});
    }
    setLoading(false);
  }, [agreement]);

  useEffect(() => {
    if (!open) return;
    setSupervisorNotes("");
    setChecked({});
    setDirectorNotes({});
    void load();
  }, [open, load]);

  const checklist = useMemo(
    () => (agreement ? buildSupervisorChecklist(agreement, hospitals) : []),
    [agreement, hospitals],
  );
  const timeline = useMemo(
    () => (agreement ? buildAgreementTimeline(agreement, hospitals, events, hospitalNames) : []),
    [agreement, hospitals, events, hospitalNames],
  );
  const rejectedRows = useMemo(
    () => hospitals.filter((h) => h.status === "rejeitado"),
    [hospitals],
  );
  const blockingIssues = checklist.filter((c) => c.required && !c.ok);
  const allConfirmed = checklist.every((c) => checked[c.key]);

  if (!agreement) return null;

  const refresh = async () => {
    await load();
    onChanged();
  };

  const validateAndSend = async () => {
    if (blockingIssues.length > 0) {
      toast.error("Acordo incompleto", {
        description: `${blockingIssues.length} item(ns) obrigatório(s) pendente(s).`,
      });
      return;
    }
    setBusy(true);
    const { data: updated, error } = await supabase
      .from("agreement_registrations")
      .update({
        status: "aguardando_diretor",
        supervisor_id: user?.id ?? null,
        supervisor_validated_at: new Date().toISOString(),
        supervisor_notes: supervisorNotes.trim() || null,
      })
      .eq("id", agreement.id)
      .select("id");
    setBusy(false);
    if (error) return toast.error("Falha ao encaminhar", { description: error.message });
    if (!updated || updated.length === 0)
      return toast.error("Sem permissão para encaminhar este acordo");
    toast.success("Enviado para aprovação dos diretores");
    await refresh();
  };

  const returnToContracts = async () => {
    if (!supervisorNotes.trim()) {
      toast.error("Descreva o motivo da devolução");
      return;
    }
    setBusy(true);
    const { data: updated, error } = await supabase
      .from("agreement_registrations")
      .update({
        status: "rascunho",
        supervisor_id: user?.id ?? null,
        supervisor_notes: supervisorNotes.trim(),
        supervisor_validated_at: null,
      })
      .eq("id", agreement.id)
      .select("id");
    setBusy(false);
    if (error) return toast.error("Falha ao devolver", { description: error.message });
    if (!updated || updated.length === 0)
      return toast.error("Sem permissão para devolver este acordo");
    toast.success("Devolvido para Contratos");
    await refresh();
  };

  // Reabertura do ciclo: o Contratos corrige os dados no wizard e o acordo
  // volta para o supervisor. A limpeza das decisões e o log ficam na RPC.
  const canResubmit =
    agreement.status === "rejeitado" &&
    (agreement.filled_by === user?.id || isAnalyst || isSupervisor || hasRole("admin"));

  const correctAndResubmit = () => {
    if (!onEdit) {
      toast.error("Edição indisponível nesta tela");
      return;
    }
    onEdit(agreement);
    onOpenChange(false);
  };

  const decideHospital = async (row: AgreementHospitalRow, approve: boolean) => {
    const note = (directorNotes[row.id] ?? "").trim();
    if (!approve && !note) {
      toast.error("Informe o motivo da rejeição");
      return;
    }
    setBusy(true);
    const { data: updated, error } = await supabase
      .from("agreement_registration_hospitals")
      .update({
        status: approve ? "aprovado" : "rejeitado",
        director_id: user?.id ?? null,
        director_approved_at: new Date().toISOString(),
        director_notes: approve ? note || null : null,
        rejection_reason: approve ? null : note,
      })
      .eq("id", row.id)
      .select("id");
    setBusy(false);
    if (error) return toast.error("Falha ao registrar decisão", { description: error.message });
    if (!updated || updated.length === 0)
      return toast.error("Sem permissão para decidir sobre este hospital");
    toast.success(approve ? "Hospital aprovado" : "Acordo rejeitado");
    await refresh();
  };

  // O cadastro da regra acontece na tela de Regras, no hospital de destino —
  // por isso exigimos a troca de unidade antes de navegar (escopo multi-tenant).
  const registerRule = async (row: AgreementHospitalRow) => {
    if (hospital?.id !== row.hospital_id) {
      const target = hospitalNames.get(row.hospital_id);
      if (!target) {
        toast.error("Sem acesso a este hospital", {
          description: "Peça acesso à unidade de destino para cadastrar a regra.",
        });
        return;
      }
      await switchHospital(row.hospital_id);
      toast.info(`Unidade alterada para ${target}`);
    }
    navigate(`/regras?tab=pagamento&acordo=${agreement.id}&acordoHospital=${row.id}`);
    onOpenChange(false);
  };

  const handlePdf = async () => {
    setBusy(true);
    try {
      if (agreement.pdf_url) {
        await openStoredAgreementPdf(agreement.pdf_url);
      } else {
        const path = await generateAndStoreAgreementPdf(agreement, hospitals);
        await openStoredAgreementPdf(path);
        onChanged();
      }
    } catch (e: unknown) {
      toast.error("Falha ao gerar o PDF", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
      });
    } finally {
      setBusy(false);
    }
  };

  const canSeePdf = agreement.status === "aprovado" || agreement.status === "cadastrado";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{agreement.code}</span>
            <span>{companyName ?? "Clínica não informada"}</span>
            <Badge variant={AGREEMENT_STATUS_VARIANT[agreement.status] ?? "secondary"}>
              {AGREEMENT_STATUS_LABEL[agreement.status] ?? agreement.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Linha do tempo */}
          <div className="rounded-lg border border-border p-3">
            <ol className="grid gap-3 md:grid-cols-4">
              {timeline.map((t) => {
                const Icon =
                  t.state === "done"
                    ? CheckCircle2
                    : t.state === "error"
                      ? XCircle
                      : t.state === "current"
                        ? CircleDashed
                        : Circle;
                const color =
                  t.state === "done"
                    ? "text-emerald-600"
                    : t.state === "error"
                      ? "text-destructive"
                      : t.state === "current"
                        ? "text-primary"
                        : "text-muted-foreground";
                return (
                  <li key={t.key} className="flex gap-2">
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight">{t.label}</p>
                      {fmtDateTime(t.at) && (
                        <p className="text-[11px] text-muted-foreground">{fmtDateTime(t.at)}</p>
                      )}
                      {t.detail && (
                        <p className="text-[11px] text-muted-foreground break-words">{t.detail}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Resumo read-only */}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field
              label="Vigência"
              value={`${fmtDate(agreement.effective_from)} — ${fmtDate(agreement.effective_to)}`}
            />
            <Field
              label="Tabela base"
              value={
                agreement.payment_table_base
                  ? PAYMENT_TABLE_BASE_LABEL[agreement.payment_table_base] ?? agreement.payment_table_base
                  : "—"
              }
            />
            <Field
              label="Percentual"
              value={agreement.payment_percentage != null ? `${agreement.payment_percentage}%` : "—"}
            />
            <Field label="Todos os convênios" value={yn(agreement.applies_to_all_convenios)} />
            <Field label="Todos os médicos" value={yn(agreement.applies_to_all_doctors)} />
            <Field label="Inclui auxiliares" value={yn(agreement.includes_auxiliary)} />
            <Field label="Via de acesso" value={yn(agreement.includes_access_route)} />
            <Field
              label="Glosa"
              value={agreement.has_glosa ? agreement.glosa_conditions ?? "Sim" : "Não"}
            />
            <Field
              label="Urgência"
              value={
                agreement.urgency_differentiation
                  ? `Sim ${agreement.urgency_addition_pct ?? 0}%`
                  : "Não"
              }
            />
            <Field
              label="Fim de semana/feriado"
              value={
                agreement.weekend_holiday_addition
                  ? `Sim ${agreement.weekend_holiday_addition_pct ?? 0}%`
                  : "Não"
              }
            />
            <Field label="Valores fixos" value={yn(agreement.has_fixed_values)} />
            <Field label="Itens extras" value={String(agreement.extra_items.length)} />
          </div>

          {(agreement.exclusions_notes || agreement.free_notes) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {agreement.exclusions_notes && (
                <Field label="Exclusões" value={agreement.exclusions_notes} />
              )}
              {agreement.free_notes && <Field label="Observações" value={agreement.free_notes} />}
            </div>
          )}

          <Separator />

          {/* Tabelas de referência anexadas pelo Contratos — consulta na validação e no cadastro da regra */}
          <AgreementAttachmentsPanel agreementId={agreement.id} readOnly />

          <Separator />


          <div className="space-y-2">
            <p className="text-sm font-semibold">Hospitais de destino</p>
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : hospitals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum hospital vinculado.</p>
            ) : (
              hospitals.map((row) => {
                const canDecide =
                  isDirector &&
                  agreement.status === "aguardando_diretor" &&
                  row.status === "aguardando_diretor";
                const canRegister =
                  isAnalyst && agreement.status === "aprovado" && row.status === "aprovado" && !row.linked_rule_id;
                return (
                  <div key={row.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {hospitalNames.get(row.hospital_id) ?? row.hospital_id}
                        </span>
                        {row.is_primary && (
                          <Badge variant="secondary" className="text-[10px]">
                            Origem
                          </Badge>
                        )}
                        <Badge
                          variant={
                            row.status === "aprovado"
                              ? "default"
                              : row.status === "rejeitado"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {AGREEMENT_HOSPITAL_STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
                        {row.linked_rule_id && (
                          <Badge variant="secondary" className="text-[10px]">
                            Regra cadastrada
                          </Badge>
                        )}
                      </div>
                      {canRegister && (
                        <Button type="button" size="sm" onClick={() => void registerRule(row)} disabled={busy}>
                          Cadastrar regra
                        </Button>
                      )}
                    </div>

                    {row.rejection_reason && (
                      <p className="text-xs text-destructive">Motivo: {row.rejection_reason}</p>
                    )}
                    {row.director_notes && (
                      <p className="text-xs text-muted-foreground">Notas: {row.director_notes}</p>
                    )}

                    {canDecide && (
                      <div className="space-y-2">
                        <Textarea
                          value={directorNotes[row.id] ?? ""}
                          onChange={(e) =>
                            setDirectorNotes((p) => ({ ...p, [row.id]: e.target.value }))
                          }
                          placeholder="Observações (obrigatório em caso de rejeição)"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void decideHospital(row, true)}
                            disabled={busy}
                          >
                            Aprovar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => void decideHospital(row, false)}
                            disabled={busy}
                          >
                            Rejeitar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Ações do supervisor */}
          {isSupervisor && agreement.status === "aguardando_supervisor" && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-semibold">Checklist do supervisor</p>
                <div className="space-y-1.5">
                  {checklist.map((c) => (
                    <label key={c.key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!checked[c.key]}
                        onCheckedChange={(v) => setChecked((p) => ({ ...p, [c.key]: v === true }))}
                      />
                      <span className={c.ok ? "" : "text-muted-foreground"}>
                        {c.label}
                        {!c.ok && (
                          <span
                            className={`ml-2 text-xs ${c.required ? "text-destructive" : "text-amber-600"}`}
                          >
                            {c.required ? "pendente (bloqueia)" : "pendente"}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {blockingIssues.length > 0 && (
                  <p className="flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {blockingIssues.length} item(ns) obrigatório(s) faltando no acordo — devolva para
                    Contratos.
                  </p>
                )}
                <Textarea
                  value={supervisorNotes}
                  onChange={(e) => setSupervisorNotes(e.target.value)}
                  placeholder="Observações do supervisor (obrigatório para devolver)"
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void validateAndSend()}
                    disabled={busy || blockingIssues.length > 0 || !allConfirmed}
                  >
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Validar e enviar para Diretores
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void returnToContracts()}
                    disabled={busy}
                  >
                    Devolver para Contratos
                  </Button>
                </div>
                {!allConfirmed && blockingIssues.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Marque todos os itens do checklist para liberar o envio.
                  </p>
                )}
              </div>
            </>
          )}

          {canSeePdf && (
            <>
              <Separator />
              <Button type="button" variant="outline" onClick={() => void handlePdf()} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4 mr-2" />
                )}
                {agreement.pdf_url ? "Abrir PDF do acordo" : "Gerar PDF do acordo"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
