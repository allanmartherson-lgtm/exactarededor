/**
 * Editor de itens de um lote MANUAL.
 *
 * Mesa onde o analista lança uma linha por médico/empresa com valor final,
 * anexa a planilha-fonte que originou o valor e opcionalmente descreve a
 * composição em rubricas. Cada linha vira um payment_items com
 * is_manual_entry=true, gross_amount = valor informado, applied_calc_method
 * = 'manual_entry'. O motor de regras NÃO roda — itens já chegam validados.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { useItemTypes } from "@/hooks/useItemTypes";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { DoctorCombobox, type DoctorOption } from "@/components/DoctorCombobox";
import ManualCompositionDialog, {
  type CompositionRow,
} from "@/components/payment-detail/ManualCompositionDialog";
import { runSaveAll, runFinalize } from "@/lib/manualPaymentSave";
import {
  ArrowLeft,
  CheckCircle2,
  FileEdit,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/financialStats";
import { useSpecialties } from "@/hooks/useSpecialties";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";

type DraftRow = {
  /** local key; quando salvo recebe id real do banco em `dbId` */
  key: string;
  dbId?: string;
  company: CompanyOption | null;
  doctor: DoctorOption | null;
  itemTypeId: string | null;
  specialty: string;
  attendance: string;
  patient: string;
  amount: number;
  /** Texto livre por linha — descrição do tipo de pagamento, contexto,
   *  origem do valor. Persistido em `payment_items.manual_note`. */
  observation: string;
  composition: CompositionRow[] | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  dirty: boolean;
};

const newDraft = (): DraftRow => ({
  key: `draft_${Math.random().toString(36).slice(2)}`,
  company: null,
  doctor: null,
  itemTypeId: null,
  specialty: "",
  attendance: "",
  patient: "",
  amount: 0,
  observation: "",
  composition: null,
  attachmentPath: null,
  attachmentName: null,
  dirty: true,
});

export default function ManualPaymentEntry() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hospital } = useHospital();
  // Subtipo da LINHA = item_types (Parecer/Visita/Cirurgia/...). Modelos de
  // pagamento do lote (Plantao/Remessa/Producao/Valor fixo) NAO entram aqui.
  const { list: itemTypes } = useItemTypes({ onlyActive: true });
  // Lista unificada usada apenas para rotular linhas antigas gravadas com id
  // de payment_model (dados legados) — nunca para popular as opcoes novas.
  const { list: unifiedTypes } = usePaymentTypes({ onlyActive: false });
  const { specialties: COMMON_SPECIALTIES } = useSpecialties();

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<any>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [defaultTypeId, setDefaultTypeId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [compositionFor, setCompositionFor] = useState<string | null>(null);
  const [generalAttPath, setGeneralAttPath] = useState<string | null>(null);
  const [generalAttName, setGeneralAttName] = useState<string | null>(null);
  const [uploadingGeneral, setUploadingGeneral] = useState(false);

  // Opções do dropdown: apenas item_types ativos. Se a linha já estava salva
  // com um id fora desse catálogo (legado com payment_model), mantém o rótulo
  // antigo como opção extra para não quebrar dados existentes.
  const subtypeOptionsFor = (currentId: string | null) => {
    const base = itemTypes.map((t) => ({ id: t.id, label: t.label }));
    if (currentId && !base.some((t) => t.id === currentId)) {
      const legacy = unifiedTypes.find((t) => t.id === currentId);
      base.push({ id: currentId, label: legacy?.label ?? "Tipo legado" });
    }
    return base;
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data: p } = await supabase.from("payments").select("*").eq("id", id).single();
    setPayment(p);
    // O modelo de pagamento do lote NÃO é subtipo de item: o default da
    // linha fica vazio e o analista escolhe entre os item_types.
    setDefaultTypeId(null);
    setGeneralAttPath((p as any)?.manual_general_attachment_path ?? null);
    setGeneralAttName((p as any)?.manual_general_attachment_name ?? null);

    const { data: items } = await supabase
      .from("payment_items")
      .select(
        "id,company_id,company_name,doctor_id,doctor_name,item_type_id,specialty,attendance_number,patient_name,gross_amount,manual_note,manual_composition,manual_source_attachment_path",
      )
      .eq("payment_id", id)
      .eq("is_manual_entry", true)
      .order("created_at");

    const loaded: DraftRow[] = (items ?? []).map((it: any) => ({
      key: it.id,
      dbId: it.id,
      company: it.company_id
        ? { id: it.company_id, name: it.company_name ?? "", document: null }
        : null,
      doctor: it.doctor_id
        ? { id: it.doctor_id, name: it.doctor_name ?? "", crm: null, crm_uf: null }
        : null,
      itemTypeId: it.item_type_id ?? null,
      specialty: it.specialty ?? "",
      attendance: it.attendance_number ?? "",
      patient: it.patient_name ?? "",
      amount: Number(it.gross_amount) || 0,
      observation: it.manual_note ?? "",
      composition: (it.manual_composition as CompositionRow[] | null) ?? null,
      attachmentPath: it.manual_source_attachment_path ?? null,
      attachmentName: it.manual_source_attachment_path
        ? it.manual_source_attachment_path.split("/").pop() ?? null
        : null,
      dirty: false,
    }));
    setRows(loaded.length ? loaded : [newDraft()]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const total = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0), [rows]);
  const dirtyCount = rows.filter((r) => r.dirty).length;
  const validCount = rows.filter((r) => r.company && r.amount > 0).length;

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  };

  // Quando o analista escolhe um médico, se a linha ainda não tem
  // especialidade preenchida e o cadastro do médico tem UMA única
  // especialidade vinculada, sugerimos ela automaticamente (Zeev nível médico).
  // Se houver várias, deixa em branco para o analista decidir.
  const handleDoctorChange = async (rowKey: string, doctor: DraftRow["doctor"]) => {
    const current = rows.find((r) => r.key === rowKey);
    const keepSpecialty = current?.specialty && current.specialty.length > 0;
    updateRow(rowKey, { doctor });
    if (!doctor?.id || keepSpecialty) return;
    const { data } = await supabase
      .from("doctors")
      .select("specialties")
      .eq("id", doctor.id)
      .maybeSingle();
    const list = Array.isArray(data?.specialties) ? (data!.specialties as string[]) : [];
    const unique = Array.from(new Set(list.map((s) => String(s ?? "").trim()).filter(Boolean)));
    if (unique.length === 1) {
      setRows((prev) => prev.map((r) => (r.key === rowKey && !r.specialty ? { ...r, specialty: unique[0], dirty: true } : r)));
    }
  };

  const addRow = () => setRows((prev) => [...prev, { ...newDraft(), itemTypeId: defaultTypeId }]);
  const duplicateRow = (key: string) =>
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const src = prev[idx];
      const dup: DraftRow = {
        ...src,
        key: `draft_${Math.random().toString(36).slice(2)}`,
        dbId: undefined,
        attachmentPath: null,
        attachmentName: null,
        dirty: true,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });

  const removeRow = async (row: DraftRow) => {
    if (row.dbId) {
      const { error } = await supabase.from("payment_items").delete().eq("id", row.dbId);
      if (error) {
        toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
        return;
      }
    }
    setRows((prev) => (prev.length === 1 ? [newDraft()] : prev.filter((r) => r.key !== row.key)));
    await recomputeTotal();
  };

  const handleUpload = async (row: DraftRow, file: File) => {
    if (!hospital?.id || !id) return;
    const ext = file.name.split(".").pop() ?? "bin";
    const objectKey = `${hospital.id}/${id}/${row.key}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("payment-manual-sources")
      .upload(objectKey, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      toast({ title: "Falha no upload", description: error.message, variant: "destructive" });
      return;
    }
    updateRow(row.key, { attachmentPath: objectKey, attachmentName: file.name });
    toast({ title: "Arquivo anexado" });
  };

  const buildPayload = (row: DraftRow) => ({
    payment_id: id!,
    hospital_id: hospital!.id,
    is_manual_entry: true,
    manual_entered_by: user!.id,
    manual_entered_at: new Date().toISOString(),
    manual_composition: row.composition as any,
    manual_source_attachment_path: row.attachmentPath,
    manual_note: row.observation?.trim() || null,
    company_id: row.company?.id ?? null,
    company_name: row.company?.name ?? null,
    doctor_id: row.doctor?.id ?? null,
    // Modo manual: médico é opcional (ex.: fisio/PJ pura). payment_items.doctor_name
    // é NOT NULL no banco, então usamos empresa como fallback para preservar
    // rastreabilidade sem quebrar o constraint.
    doctor_name: row.doctor?.name ?? row.company?.name ?? "—",
    item_type_id: row.itemTypeId ?? defaultTypeId,
    specialty: row.specialty || null,
    attendance_number: row.attendance || null,
    patient_name: row.patient || null,
    gross_amount: Number(row.amount) || 0,
    expected_amount: Number(row.amount) || 0,
    applied_calc_method: null,
    ai_status: "acatado",
    procedure_date: payment?.competence_month ?? null,
  });

  const handleGeneralUpload = async (file: File) => {
    if (!hospital?.id || !id) return;
    setUploadingGeneral(true);
    const ext = file.name.split(".").pop() ?? "bin";
    const objectKey = `${hospital.id}/${id}/_general/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("payment-manual-sources")
      .upload(objectKey, file, { upsert: true, contentType: file.type || undefined });
    if (upErr) {
      setUploadingGeneral(false);
      toast({ title: "Falha no upload", description: upErr.message, variant: "destructive" });
      return;
    }
    const { error: pErr } = await supabase
      .from("payments")
      .update({
        manual_general_attachment_path: objectKey,
        manual_general_attachment_name: file.name,
      } as any)
      .eq("id", id);
    setUploadingGeneral(false);
    if (pErr) {
      toast({ title: "Erro ao registrar anexo", description: pErr.message, variant: "destructive" });
      return;
    }
    setGeneralAttPath(objectKey);
    setGeneralAttName(file.name);
    toast({ title: "Anexo do lote salvo" });
  };

  const removeGeneralAttachment = async () => {
    if (!id) return;
    const { error } = await supabase
      .from("payments")
      .update({
        manual_general_attachment_path: null,
        manual_general_attachment_name: null,
      } as any)
      .eq("id", id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    setGeneralAttPath(null);
    setGeneralAttName(null);
  };

  const openGeneralAttachment = async () => {
    if (!generalAttPath) return;
    const { data } = await supabase.storage
      .from("payment-manual-sources")
      .createSignedUrl(generalAttPath, 60 * 10);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };


  const saveRow = async (row: DraftRow): Promise<string | null> => {
    if (!row.company || row.amount <= 0) return null;
    const payload = buildPayload(row);
    if (row.dbId) {
      const { error } = await supabase.from("payment_items").update(payload as any).eq("id", row.dbId);
      if (error) {
        toast({ title: `Erro ao salvar linha`, description: error.message, variant: "destructive" });
        return null;
      }
      return row.dbId;
    }
    const { data, error } = await supabase
      .from("payment_items")
      .insert(payload as any)
      .select("id")
      .single();
    if (error || !data) {
      toast({ title: `Erro ao salvar linha`, description: error?.message, variant: "destructive" });
      return null;
    }
    return data.id;
  };

  const recomputeTotal = async () => {
    if (!id) return;
    const { data } = await supabase
      .from("payment_items")
      .select("gross_amount, specialty")
      .eq("payment_id", id)
      .eq("is_manual_entry", true);
    const sum = (data ?? []).reduce((a, b: any) => a + (Number(b.gross_amount) || 0), 0);
    const count = (data ?? []).length;
    // Agrega especialidades lançadas manualmente para alimentar payments.specialties
    // (consumido pelo template de e-mail de pedido de NF, que monta "Produção de …").
    const specialtiesSet = new Set<string>();
    for (const it of data ?? []) {
      const s = String((it as any).specialty ?? "").trim();
      if (s) specialtiesSet.add(s);
    }
    await supabase
      .from("payments")
      .update({
        total_amount: sum,
        items_count: count,
        specialties: Array.from(specialtiesSet),
      } as any)
      .eq("id", id);
  };

  const saveAll = async (): Promise<{ saved: number; failed: number; skipped: number }> => {
    setSavingAll(true);
    type DraftWithValid = DraftRow & { valid: boolean };
    const result = await runSaveAll<DraftWithValid>(
      rows.map((r) => ({ ...r, valid: !!r.company && r.amount > 0 })),
      (r) => saveRow(r),
    );
    setRows(result.rows.map(({ valid: _v, ...rest }) => rest as DraftRow));
    await recomputeTotal();
    setSavingAll(false);
    const { saved, failed, skipped } = result;
    if (failed === 0 && saved > 0) {
      toast({ title: `${saved} ${saved === 1 ? "item salvo" : "itens salvos"}` });
    } else if (failed > 0 && saved > 0) {
      toast({
        title: `${saved} salvo(s), ${failed} com erro`,
        description: "Veja as mensagens de erro acima.",
        variant: "destructive",
      });
    } else if (failed > 0) {
      toast({
        title: `Falha ao salvar (${failed})`,
        description: "Nenhuma linha foi gravada. Veja o erro acima.",
        variant: "destructive",
      });
    } else if (skipped > 0) {
      toast({
        title: "Nada para salvar",
        description: "Preencha empresa e valor antes de salvar.",
      });
    }
    return { saved, failed, skipped };
  };


  const finalize = async () => {
    if (!id) return;
    setFinalizing(true);
    type DraftWithValid = DraftRow & { valid: boolean };
    const outcome = await runFinalize<DraftWithValid>(
      rows.map((r) => ({ ...r, valid: !!r.company && r.amount > 0 })),
      (r) => saveRow(r),
      async (_status) => {
        // payments.status é derivado de payment_company_groups pelo trigger
        // recompute_payment_status_from_groups — UPDATE direto é bloqueado.
        // Usamos a RPC autoritativa que move os grupos do lote em uma
        // única transação (mesma usada pelo PaymentDetail).
        const { data: gs, error: gErr } = await supabase
          .from("payment_company_groups")
          .select("id")
          .eq("payment_id", id);
        if (gErr) return { error: gErr.message };
        const groupIds = (gs ?? []).map((g: any) => g.id);
        if (groupIds.length === 0) {
          return { error: "Lote sem empresas para encaminhar." };
        }
        const { error } = await supabase.rpc("bulk_send_groups_to_validation", {
          _payment_id: id,
          _group_ids: groupIds,
        });
        return { error: error?.message ?? null };
      },
    );
    if (outcome.kind !== "no_valid_rows") {
      setRows(outcome.rows.map(({ valid: _v, ...rest }) => rest as DraftRow));
      await recomputeTotal();
    }
    setFinalizing(false);

    if (outcome.kind === "no_valid_rows") {
      toast({
        title: "Nenhum item válido",
        description: "Preencha pelo menos uma linha com empresa e valor.",
        variant: "destructive",
      });
      return;
    }
    if (outcome.kind === "blocked_by_save_failure") {
      toast({
        title: "Encaminhamento bloqueado",
        description: `${outcome.save.failed} linha(s) com erro. Corrija antes de encaminhar.`,
        variant: "destructive",
      });
      return;
    }
    if (outcome.kind === "status_update_failed") {
      toast({ title: "Erro ao encaminhar", description: outcome.error, variant: "destructive" });
      return;
    }
    toast({ title: "Lote encaminhado para validação" });
    navigate(`/pagamentos/${id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!payment || payment.analysis_mode !== "manual") {
    return (
      <div className="space-y-4">
        <PageHeader title="Lançamento manual" />
        <Alert variant="destructive">
          <AlertTitle>Lote inválido</AlertTitle>
          <AlertDescription>
            Este lote não está marcado como lançamento manual. Volte para o detalhe do pagamento.
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate(`/pagamentos/${id}`)}>Ir para o pagamento</Button>
      </div>
    );
  }

  const editingComposition = rows.find((r) => r.key === compositionFor) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Lançamento manual — ${payment.reference}`}
        description="Uma linha por médico ou empresa. Informe valor, anexe a planilha-fonte e (opcional) descreva a composição. O motor não calcula."
        icon={FileEdit}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/pagamentos/${id}`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Detalhe
            </Button>
            <Button variant="outline" size="sm" onClick={saveAll} disabled={savingAll || dirtyCount === 0}>
              {savingAll ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Salvar {dirtyCount ? `(${dirtyCount})` : ""}
            </Button>
            <Button size="sm" onClick={finalize} disabled={finalizing || validCount === 0}>
              {finalizing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Encaminhar p/ validação
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Itens" value={String(rows.length)} tone="info" icon={<FileEdit className="h-4 w-4" />} />
        <Metric label="Válidos" value={String(validCount)} tone={validCount ? "success" : "muted"} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Metric label="Não salvos" value={String(dirtyCount)} tone={dirtyCount ? "warning" : "muted"} icon={<Save className="h-4 w-4" />} />
        <Metric label="Total" value={formatBRL(total)} mono tone="success" icon={<Paperclip className="h-4 w-4" />} />
      </div>


      {/* Anexo geral do lote — opcional. Cobre quando uma única planilha
          comprova todas as linhas (caso comum em nefrologia, coordenação). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            Anexo do lote (opcional)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground mb-2">
            Use quando uma única planilha/PDF cobre todas as linhas. Anexos por linha continuam disponíveis abaixo.
          </p>
          {generalAttPath ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 max-w-[320px]"
                onClick={openGeneralAttachment}
                title={generalAttName ?? generalAttPath}
              >
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate">{generalAttName ?? "anexo do lote"}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={removeGeneralAttachment}
              >
                <X className="h-3 w-3 mr-1" /> Remover
              </Button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer rounded-md border border-dashed border-border px-3 h-8 hover:bg-muted/50 w-fit">
              {uploadingGeneral ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3 shrink-0" />
              )}
              <span className="text-muted-foreground">
                {uploadingGeneral ? "Enviando…" : "Anexar planilha do lote"}
              </span>
              <input
                type="file"
                className="hidden"
                accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleGeneralUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-border/50">
          <CardTitle className="text-base">Itens</CardTitle>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar linha
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-340px)] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur supports-[backdrop-filter]:bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[19%] text-xs uppercase tracking-wide">Empresa *</TableHead>
                  <TableHead className="w-[18%] text-xs uppercase tracking-wide">Médico</TableHead>
                  <TableHead className="w-[12%] text-xs uppercase tracking-wide">Tipo</TableHead>
                  <TableHead className="w-[13%] text-xs uppercase tracking-wide">Especialidade</TableHead>
                  <TableHead className="w-[8%] text-xs uppercase tracking-wide">Atend.</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Paciente</TableHead>
                  <TableHead className="w-[10%] text-right text-xs uppercase tracking-wide">Valor (R$) *</TableHead>
                  <TableHead className="w-[90px] text-right text-xs uppercase tracking-wide">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const valid = !!r.company && r.amount > 0;
                  return (
                    <Fragment key={r.key}>
                      {/* Linha 1 — campos estruturais */}
                      <TableRow className="align-top border-b-0 hover:bg-muted/30">
                        <TableCell className="py-2.5">
                          <CompanyCombobox
                            value={r.company}
                            onChange={(c) => updateRow(r.key, { company: c, doctor: null })}
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <DoctorCombobox
                            value={r.doctor}
                            onChange={(d) => { void handleDoctorChange(r.key, d); }}
                            filterCompanyId={r.company?.id ?? null}
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Select
                            value={r.itemTypeId ?? defaultTypeId ?? ""}
                            onValueChange={(v) => updateRow(r.key, { itemTypeId: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              {subtypeOptionsFor(r.itemTypeId).map((pt) => (
                                <SelectItem key={pt.id} value={pt.id}>
                                  {pt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Select
                            value={r.specialty || "__none__"}
                            onValueChange={(v) =>
                              updateRow(r.key, { specialty: v === "__none__" ? "" : v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                              <SelectItem value="__none__">—</SelectItem>
                              {COMMON_SPECIALTIES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Input
                            value={r.attendance}
                            onChange={(e) => updateRow(r.key, { attendance: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Input
                            value={r.patient}
                            onChange={(e) => updateRow(r.key, { patient: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <CurrencyInput
                            value={r.amount || null}
                            onChange={(v) => updateRow(r.key, { amount: Number(v) || 0 })}
                            className="text-right font-medium tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex flex-col items-end gap-1.5">
                            {r.dirty ? (
                              <Badge variant="outline" className={cn("text-[10px]", TONE_CLASSES.warning)}>
                                não salvo
                              </Badge>
                            ) : valid ? (
                              <Badge variant="outline" className={cn("text-[10px] gap-1", TONE_CLASSES.success)}>
                                <CheckCircle2 className="h-3 w-3" /> ok
                              </Badge>
                            ) : (
                              <Badge variant="outline" className={cn("text-[10px]", TONE_CLASSES.muted)}>
                                rascunho
                              </Badge>
                            )}
                            <div className="flex items-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => duplicateRow(r.key)}
                                title="Duplicar linha"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeRow(r)}
                                title="Excluir linha"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                      {/* Linha 2 — observação + fonte/composição (largura cheia) */}
                      <TableRow className="hover:bg-muted/30 border-b-4 border-border/40">
                        <TableCell colSpan={5} className="pt-0 pb-3">
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground pt-2 w-20 shrink-0">
                              Observação
                            </span>
                            <Textarea
                              value={r.observation}
                              onChange={(e) => updateRow(r.key, { observation: e.target.value })}
                              placeholder="Ex.: plantão fechado de domingo · rateio coordenação · referência da planilha"
                              rows={2}
                              className="resize-none min-h-[60px]"
                            />
                          </div>
                        </TableCell>
                        <TableCell colSpan={3} className="pt-0 pb-3">
                          <div className="flex items-start gap-3">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground pt-2 w-16 shrink-0">
                              Fonte
                            </span>
                            <div className="flex flex-1 flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer rounded-md border border-dashed border-input bg-background px-3 h-9 hover:bg-muted/50">
                                <Upload className="h-3.5 w-3.5 shrink-0" />
                                {r.attachmentName ? (
                                  <span className="truncate max-w-[160px]" title={r.attachmentName}>
                                    {r.attachmentName}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Anexar</span>
                                )}
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleUpload(r, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-9 px-2.5 text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => setCompositionFor(r.key)}
                              >
                                <Sparkles className="h-3.5 w-3.5 mr-1" />
                                {r.composition && r.composition.length > 0
                                  ? `Composição (${r.composition.length})`
                                  : "Composição"}
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>

            </Table>
          </div>
        </CardContent>
      </Card>


      {editingComposition && (
        <ManualCompositionDialog
          open={!!compositionFor}
          onOpenChange={(o) => !o && setCompositionFor(null)}
          itemTotal={editingComposition.amount}
          initial={editingComposition.composition}
          onSave={(c) => updateRow(editingComposition.key, { composition: c })}
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  mono,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  const tones: Record<NonNullable<typeof tone>, string> = {
    muted: "bg-muted text-muted-foreground",
    info: "bg-info-soft text-info",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning-text",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-card">
      <div className="flex items-start gap-3 px-3 py-3">
        {icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0", tones[tone])}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
          <div className={cn("mt-1 text-lg sm:text-xl font-semibold leading-tight break-words text-foreground", mono && "tabular-nums")}>{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

