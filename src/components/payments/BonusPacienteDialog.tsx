import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { DoctorCombobox, type DoctorOption } from "@/components/DoctorCombobox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import {
  parseBonusPacienteFile,
  type BonusParseResult,
} from "@/lib/parseBonusPacienteFile";
import { formatCurrency } from "@/lib/status";

type Mode = "existing" | "new";

interface OpenPayment {
  id: string;
  reference: string;
  status: string;
}

export function BonusPacienteDialog({
  open,
  onOpenChange,
  onSaved,
  lockedPayment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
  lockedPayment?: { id: string; reference: string } | null;
}) {
  const { user } = useAuth();
  const { hospital } = useHospital();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<BonusParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [doctor, setDoctor] = useState<DoctorOption | null>(null);
  const [mode, setMode] = useState<Mode>("existing");
  const [openPayments, setOpenPayments] = useState<OpenPayment[]>([]);
  const [targetPaymentId, setTargetPaymentId] = useState<string>("");
  const [newReference, setNewReference] = useState<string>("");
  const [busy, setBusy] = useState(false);


  const reset = () => {
    setFile(null);
    setParsed(null);
    setCompany(null);
    setDoctor(null);
    setMode("existing");
    setTargetPaymentId("");
    setNewReference("");
  };

  useEffect(() => {
    if (!open) {
      reset();
    } else if (lockedPayment) {
      setMode("existing");
      setTargetPaymentId(lockedPayment.id);
    }
  }, [open, lockedPayment?.id]);


  useEffect(() => {
    if (!open || !hospital?.id) return;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("id, reference, status")
        .eq("hospital_id", hospital.id)
        .not("status", "in", "(aprovado,pago,cancelado,arquivado)")
        .order("created_at", { ascending: false })
        .limit(50);
      setOpenPayments((data ?? []) as OpenPayment[]);
    })();
  }, [open, hospital?.id]);

  // Quando escolhe empresa, tenta puxar médico único da PJ
  useEffect(() => {
    if (!company?.id) return;
    (async () => {
      const { data } = await supabase
        .from("doctor_companies")
        .select("doctor_id, doctors!inner(id, full_name, active, crm, crm_uf)")
        .eq("company_id", company.id);
      const active = (data ?? []).filter((d: any) => d.doctors?.active);
      if (active.length === 1) {
        const d = active[0].doctors as any;
        setDoctor({ id: d.id, name: d.full_name, crm: d.crm ?? null, crm_uf: d.crm_uf ?? null });
      }
    })();
  }, [company?.id]);

  const handleFile = async (f: File) => {
    setFile(f);
    setParsing(true);
    setParsed(null);
    try {
      const result = await parseBonusPacienteFile(f);
      setParsed(result);
      if (!newReference) {
        setNewReference(f.name.replace(/\.xlsx?$/i, "").replace(/_/g, " "));
      }
    } catch (e: any) {
      toast.error(`Erro ao ler planilha: ${e?.message ?? e}`);
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const totalSum = useMemo(
    () => (parsed?.rows ?? []).reduce((s, r) => s + r.gross_amount, 0),
    [parsed],
  );

  const totalMismatch =
    parsed?.declared_total != null && Math.abs(parsed.declared_total - totalSum) > 0.01;

  const canSubmit =
    !!parsed &&
    parsed.rows.length > 0 &&
    !!company &&
    !!doctor &&
    (mode === "existing" ? !!targetPaymentId : newReference.trim().length >= 3);

  const submit = async () => {
    if (!canSubmit || !parsed || !company || !doctor || !hospital?.id || !user?.id) return;
    setBusy(true);
    try {
      let paymentId = targetPaymentId;

      if (mode === "new") {
        const insertPayload: any = {
          reference: newReference.trim(),
          status: "rascunho",
          payment_type: "bonus_paciente",
          payment_kind: "producao",
          hospital_id: hospital.id,
          created_by: user.id,
          total_amount: totalSum,
          items_count: parsed.rows.length,
        };
        const { data: created, error } = await supabase
          .from("payments")
          .insert(insertPayload)
          .select("id")
          .single();
        if (error) throw error;
        paymentId = created.id;
      }

      const itemsPayload: any[] = parsed.rows.map((r) => ({
        payment_id: paymentId,
        hospital_id: hospital.id,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        company_id: company.id,
        company_name: company.name,
        patient_name: r.patient_name,
        attendance_number: r.attendance_number,
        procedure_date: r.procedure_date,
        agreement_text: r.agreement_text,
        description: "Bônus por paciente",
        gross_amount: r.gross_amount,
        expected_amount: r.gross_amount,
        tipo_linha: "complemento_bonus",
        applied_calc_method: "bonus_paciente_passthrough",
        applied_rule_label: "Bônus por paciente (pass-through)",
        applied_at: new Date().toISOString(),
        ai_status: "aprovado",
        manual_entry: true,
        source: "manual",
        item_origin: "producao",
        raw_data: r.raw as any,
      }));

      const { error: itemsErr } = await supabase.from("payment_items").insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      // Recalibra totais do pagamento
      const { data: items } = await supabase
        .from("payment_items")
        .select("gross_amount")
        .eq("payment_id", paymentId);
      const totalAll = (items ?? []).reduce(
        (s, r: any) => s + Number(r.gross_amount ?? 0),
        0,
      );
      await supabase
        .from("payments")
        .update({ items_count: items?.length ?? 0, total_amount: totalAll })
        .eq("id", paymentId);

      toast.success(
        `${parsed.rows.length} item(ns) de bônus adicionados · ${formatCurrency(totalSum)}`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(48rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Bônus por paciente
          </DialogTitle>
          <DialogDescription>
            Para planilhas em que cada linha é um paciente atendido. O valor da planilha é o
            que será pago — sem cálculo de regra.
          </DialogDescription>
        </DialogHeader>

        {/* Upload */}
        <div className="space-y-2">
          <Label>Planilha (.xlsx)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              disabled={parsing || busy}
            />
            {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {file && parsed && (
            <div className="rounded-md border border-border/50 p-3 bg-muted/30 space-y-2">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium truncate">{file.name}</span>
                <Badge variant="secondary">{parsed.rows.length} linha(s)</Badge>
                <Badge variant="outline">{formatCurrency(totalSum)}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Colunas detectadas: paciente=
                <b>{parsed.detected_columns.patient ?? "—"}</b>, valor=
                <b>{parsed.detected_columns.value}</b>
                {parsed.detected_columns.doctor &&
                  `, profissional=${parsed.detected_columns.doctor}`}
                {parsed.detected_columns.agreement &&
                  `, convênio=${parsed.detected_columns.agreement}`}
              </div>
              {parsed.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-warning flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </div>
              ))}
              {totalMismatch && (
                <div className="text-[11px] text-warning flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Soma das linhas (
                  {formatCurrency(totalSum)}) difere do total declarado (
                  {formatCurrency(parsed.declared_total!)}).
                </div>
              )}
              {!totalMismatch && parsed.declared_total != null && (
                <div className="text-[11px] text-success flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Soma confere com o total da planilha.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Empresa + médico */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Empresa (PJ)</Label>
            <CompanyCombobox value={company} onChange={setCompany} placeholder="Buscar PJ..." />
          </div>
          <div className="space-y-1">
            <Label>Médico responsável</Label>
            <DoctorCombobox
              value={doctor}
              onChange={setDoctor}
              placeholder={company ? "Selecionar médico" : "Escolha a PJ primeiro"}
            />
            {company && doctor && (
              <p className="text-[11px] text-muted-foreground">
                Todas as {parsed?.rows.length ?? 0} linhas serão atribuídas a este médico.
              </p>
            )}
          </div>
        </div>

        {/* Destino */}
        {lockedPayment ? (
          <div className="rounded-md border border-border/50 p-3 bg-muted/30 text-sm">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Destino
            </div>
            <div className="font-medium">{lockedPayment.reference}</div>
            <div className="text-[11px] text-muted-foreground">
              Os itens serão somados a este pagamento.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Destino</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-md border border-border/50">
                <RadioGroupItem value="existing" id="bp-existing" className="mt-1" />
                <div className="flex-1 space-y-2">
                  <label htmlFor="bp-existing" className="text-sm font-medium cursor-pointer">
                    Adicionar a um pagamento em andamento
                  </label>
                  {mode === "existing" && (
                    <Select value={targetPaymentId} onValueChange={setTargetPaymentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar pagamento..." />
                      </SelectTrigger>
                      <SelectContent>
                        {openPayments.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            Nenhum pagamento em andamento.
                          </div>
                        )}
                        {openPayments.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.reference} · {p.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-md border border-border/50">
                <RadioGroupItem value="new" id="bp-new" className="mt-1" />
                <div className="flex-1 space-y-2">
                  <label htmlFor="bp-new" className="text-sm font-medium cursor-pointer">
                    Criar um novo pagamento (tipo "Bônus por paciente")
                  </label>
                  {mode === "new" && (
                    <Input
                      placeholder="Referência do pagamento"
                      value={newReference}
                      onChange={(e) => setNewReference(e.target.value)}
                    />
                  )}
                </div>
              </div>
            </RadioGroup>
          </div>
        )}

        {(lockedPayment || (mode === "existing" && targetPaymentId)) && (
          <Alert>
            <AlertTitle className="text-xs">Sem motor de regras</AlertTitle>
            <AlertDescription className="text-xs">
              Os itens entram já conciliados (expected = pago). Ficam visíveis na aba de itens
              do pagamento e somam ao total bruto.
            </AlertDescription>
          </Alert>
        )}


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Upload className="h-4 w-4 mr-2" /> Importar bônus
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
