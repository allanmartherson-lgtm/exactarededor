/**
 * Editor de itens de um lote MANUAL.
 *
 * Mesa onde o analista lança uma linha por médico/empresa com valor final,
 * anexa a planilha-fonte que originou o valor e opcionalmente descreve a
 * composição em rubricas. Cada linha vira um payment_items com
 * is_manual_entry=true, gross_amount = valor informado, applied_calc_method
 * = 'manual_entry'. O motor de regras NÃO roda — itens já chegam validados.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { COMMON_SPECIALTIES } from "@/lib/specialties";
import { cn } from "@/lib/utils";

type DraftRow = {
  /** local key; quando salvo recebe id real do banco em `dbId` */
  key: string;
  dbId?: string;
  company: CompanyOption | null;
  doctor: DoctorOption | null;
  paymentTypeId: string | null;
  specialty: string;
  attendance: string;
  patient: string;
  amount: number;
  composition: CompositionRow[] | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  dirty: boolean;
};

const newDraft = (): DraftRow => ({
  key: `draft_${Math.random().toString(36).slice(2)}`,
  company: null,
  doctor: null,
  paymentTypeId: null,
  specialty: "",
  attendance: "",
  patient: "",
  amount: 0,
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
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<any>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [defaultTypeId, setDefaultTypeId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [compositionFor, setCompositionFor] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data: p } = await supabase.from("payments").select("*").eq("id", id).single();
    setPayment(p);
    setDefaultTypeId((p as any)?.payment_type_id ?? null);

    const { data: items } = await supabase
      .from("payment_items")
      .select(
        "id,company_id,company_name,doctor_id,doctor_name,payment_type_id,specialty,attendance_number,patient_name,gross_amount,manual_composition,manual_source_attachment_path",
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
      paymentTypeId: it.payment_type_id ?? null,
      specialty: it.specialty ?? "",
      attendance: it.attendance_number ?? "",
      patient: it.patient_name ?? "",
      amount: Number(it.gross_amount) || 0,
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

  const addRow = () => setRows((prev) => [...prev, { ...newDraft(), paymentTypeId: defaultTypeId }]);
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
    company_id: row.company?.id ?? null,
    company_name: row.company?.name ?? null,
    doctor_id: row.doctor?.id ?? null,
    doctor_name: row.doctor?.name ?? null,
    payment_type_id: row.paymentTypeId ?? defaultTypeId,
    specialty: row.specialty || null,
    attendance_number: row.attendance || null,
    patient_name: row.patient || null,
    gross_amount: Number(row.amount) || 0,
    expected_amount: Number(row.amount) || 0,
    applied_calc_method: "manual_entry",
    ai_status: "acatado",
    procedure_date: payment?.competence_month ?? null,
  });

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
      .select("gross_amount")
      .eq("payment_id", id)
      .eq("is_manual_entry", true);
    const sum = (data ?? []).reduce((a, b: any) => a + (Number(b.gross_amount) || 0), 0);
    const count = (data ?? []).length;
    await supabase
      .from("payments")
      .update({ total_amount: sum, items_count: count } as any)
      .eq("id", id);
  };

  const saveAll = async () => {
    setSavingAll(true);
    const updated: DraftRow[] = [];
    for (const r of rows) {
      if (!r.dirty) {
        updated.push(r);
        continue;
      }
      if (!r.company || r.amount <= 0) {
        updated.push(r);
        continue;
      }
      const id2 = await saveRow(r);
      if (id2) updated.push({ ...r, dbId: id2, key: id2, dirty: false });
      else updated.push(r);
    }
    setRows(updated);
    await recomputeTotal();
    setSavingAll(false);
    toast({ title: "Itens salvos" });
  };

  const finalize = async () => {
    if (!id) return;
    if (validCount === 0) {
      toast({
        title: "Nenhum item válido",
        description: "Preencha pelo menos uma linha com empresa e valor.",
        variant: "destructive",
      });
      return;
    }
    setFinalizing(true);
    await saveAll();
    // Encaminha para validação (mesma esteira dos demais lotes).
    const { error } = await supabase
      .from("payments")
      .update({ status: "em_validacao" as any } as any)
      .eq("id", id);
    setFinalizing(false);
    if (error) {
      toast({ title: "Erro ao encaminhar", description: error.message, variant: "destructive" });
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
        <Metric label="Itens" value={String(rows.length)} />
        <Metric label="Válidos" value={String(validCount)} tone={validCount ? "success" : "muted"} />
        <Metric
          label="Não salvos"
          value={String(dirtyCount)}
          tone={dirtyCount ? "warning" : "muted"}
        />
        <Metric label="Total" value={formatBRL(total)} tone="success" />
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Itens</CardTitle>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar linha
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
                <tr>
                  <th className="py-2 px-3 text-left w-[20%]">Empresa *</th>
                  <th className="py-2 px-3 text-left w-[18%]">Médico</th>
                  <th className="py-2 px-3 text-left w-[14%]">Tipo</th>
                  <th className="py-2 px-3 text-left w-[12%]">Especialidade</th>
                  <th className="py-2 px-3 text-left">Atend.</th>
                  <th className="py-2 px-3 text-left">Paciente</th>
                  <th className="py-2 px-3 text-right w-[10%]">Valor (R$) *</th>
                  <th className="py-2 px-3 text-left w-[14%]">Fonte / Composição</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const valid = !!r.company && r.amount > 0;
                  return (
                    <tr key={r.key} className={cn("border-b last:border-0 align-top", r.dirty && "bg-amber-50/40 dark:bg-amber-950/10")}>
                      <td className="py-2 px-3">
                        <CompanyCombobox
                          value={r.company}
                          onChange={(c) => updateRow(r.key, { company: c, doctor: null })}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <DoctorCombobox
                          value={r.doctor}
                          onChange={(d) => updateRow(r.key, { doctor: d })}
                          filterCompanyId={r.company?.id ?? null}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Select
                          value={r.paymentTypeId ?? defaultTypeId ?? ""}
                          onValueChange={(v) => updateRow(r.key, { paymentTypeId: v })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentTypes.map((pt) => (
                              <SelectItem key={pt.id} value={pt.id}>
                                {pt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-3">
                        <Select
                          value={r.specialty || "__none__"}
                          onValueChange={(v) =>
                            updateRow(r.key, { specialty: v === "__none__" ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-9">
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
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          value={r.attendance}
                          onChange={(e) => updateRow(r.key, { attendance: e.target.value })}
                          className="h-9"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          value={r.patient}
                          onChange={(e) => updateRow(r.key, { patient: e.target.value })}
                          className="h-9"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={r.amount || ""}
                          onChange={(e) =>
                            updateRow(r.key, { amount: Number(e.target.value) || 0 })
                          }
                          className="h-9 text-right font-medium"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-1.5">
                          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer rounded-md border border-dashed border-border px-2 py-1 hover:bg-muted/50">
                            <Upload className="h-3.5 w-3.5" />
                            {r.attachmentName ? (
                              <span className="truncate max-w-[140px]" title={r.attachmentName}>
                                {r.attachmentName}
                              </span>
                            ) : (
                              <span>Anexar fonte</span>
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
                            className="h-7 px-2 justify-start text-xs"
                            onClick={() => setCompositionFor(r.key)}
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                            {r.composition && r.composition.length > 0
                              ? `Composição (${r.composition.length})`
                              : "Composição"}
                          </Button>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col items-end gap-1">
                          {valid && !r.dirty && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> ok
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        tone === "success" && "bg-success-soft border-success/20",
        tone === "warning" && "bg-warning-soft border-warning/30",
        tone === "muted" && "bg-muted/20",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
