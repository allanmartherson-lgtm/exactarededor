import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DoctorCombobox, type DoctorOption } from "@/components/DoctorCombobox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Plus } from "lucide-react";

/**
 * Modal para inclusão manual de itens em um pagamento.
 *
 * Casos de uso:
 *  - Bônus que o motor não conseguiu aplicar automaticamente (ex.: atendimento
 *    só com auxiliar — exige inclusão manual do bônus do principal).
 *  - Pendências identificadas pelo analista: honorário que ficou de fora da
 *    base hospitalar e precisa ser pago neste lote.
 *
 * O analista escolhe ao salvar entre:
 *  - "Avulso aprovado": entra como `ai_status='aprovado'`, `expected_amount`
 *    igual ao valor digitado, sem diferença — equivale a um item que o
 *    motor já validou.
 *  - "Validar pelas regras": entra como `ai_status='pendente'` e será
 *    avaliado na próxima reanálise (o analista precisa rodar "Reaplicar
 *    regras" depois).
 *
 * Todos os itens criados aqui têm `source='manual'` e gravam o
 * `created_by_user_id` para auditoria.
 */

export type AddManualItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  companyId: string | null;
  companyName: string;
  onCreated?: () => void;
};

type Mode = "avulso" | "validar";

const DOCTOR_ROLES = [
  "Cirurgião Principal",
  "Primeiro Auxiliar",
  "Segundo Auxiliar",
  "Terceiro Auxiliar",
  "Instrumentador",
  "Anestesista",
  "Outro",
];

export function AddManualItemDialog({
  open,
  onOpenChange,
  paymentId,
  companyId,
  companyName,
  onCreated,
}: AddManualItemDialogProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [attendance, setAttendance] = useState("");
  const [patient, setPatient] = useState("");
  const [doctor, setDoctor] = useState<DoctorOption | null>(null);
  const [procedureDate, setProcedureDate] = useState("");
  const [accessRoute, setAccessRoute] = useState("");
  const [doctorRole, setDoctorRole] = useState<string>("Cirurgião Principal");
  const [quantity, setQuantity] = useState<string>("1");
  const [tuss, setTuss] = useState("");
  const [procedureName, setProcedureName] = useState("");
  const [sector, setSector] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("avulso");
  const [note, setNote] = useState("");

  const reset = () => {
    setAttendance(""); setPatient(""); setDoctor(null); setProcedureDate("");
    setAccessRoute(""); setDoctorRole("Cirurgião Principal"); setQuantity("1");
    setTuss(""); setProcedureName(""); setSector(""); setAmount(""); setMode("avulso"); setNote("");
  };

  const parsedAmount = (() => {
    const n = Number(String(amount).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  })();

  const valid =
    attendance.trim().length > 0 &&
    patient.trim().length > 0 &&
    !!doctor &&
    procedureDate.length > 0 &&
    tuss.replace(/\D/g, "").length >= 6 &&
    Number(quantity) > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const submit = async () => {
    if (!valid || !doctor) return;
    setSaving(true);
    try {
      const findings: Record<string, unknown> = {
        manual: true,
        manual_mode: mode,
        ...(note.trim() ? { ai_note: note.trim() } : {}),
      };
      if (mode === "avulso") {
        findings.calculation_explanation =
          `Inclusão manual aprovada pelo analista. Valor (${parsedAmount.toFixed(2)}) tratado como repasse final, sem validação automática.${note.trim() ? ` Justificativa: ${note.trim()}` : ""}`;
        findings.matched_rules = ["Inclusão manual"];
      } else {
        findings.calculation_explanation =
          `Item incluído manualmente para validação pelo motor. Rode "Reaplicar regras" para gerar o cálculo.${note.trim() ? ` Justificativa: ${note.trim()}` : ""}`;
      }

      const payload = {
        payment_id: paymentId,
        company_id: companyId,
        company_name: companyName,
        attendance_number: attendance.trim(),
        patient_name: patient.trim(),
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        doctor_role: doctorRole,
        procedure_date: procedureDate,
        access_route: accessRoute.trim() || null,
        procedure_code: tuss.replace(/\D/g, ""),
        procedure_name: procedureName.trim() || null,
        sector: sector.trim() || null,
        quantity: Number(quantity),
        gross_amount: parsedAmount,
        procedure_amount: parsedAmount,
        expected_amount: mode === "avulso" ? parsedAmount : null,
        ai_status: mode === "avulso" ? "aprovado" : "pendente",
        ai_findings: findings,
        source: "manual",
        item_origem: "inclusao_manual",
        tipo_linha: "honorario",
        created_by_user_id: user?.id ?? null,
        manual_note: note.trim() || null,
      };

      const { error } = await supabase.from("payment_items").insert(payload as any);
      if (error) throw error;

      toast.success(
        mode === "avulso"
          ? "Item manual incluído e aprovado."
          : "Item manual incluído. Rode \"Reaplicar regras\" para validar.",
      );
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (e: any) {
      console.error("[AddManualItemDialog] insert error", e);
      toast.error(e?.message ?? "Falha ao incluir item manual.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) { reset(); } onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Adicionar item manual
          </DialogTitle>
          <DialogDescription>
            Inclua um honorário avulso para <strong>{companyName}</strong>. Use quando o item não veio na base hospitalar (pendência identificada, bônus do principal em atendimento só com auxiliar etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="att">Nº Atendimento *</Label>
            <Input id="att" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder="ex.: 9144319" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pat">Paciente *</Label>
            <Input id="pat" value={patient} onChange={(e) => setPatient(e.target.value)} />
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Médico *</Label>
            <DoctorCombobox value={doctor} onChange={setDoctor} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="date">Data do procedimento *</Label>
            <Input id="date" type="date" value={procedureDate} onChange={(e) => setProcedureDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role">Função *</Label>
            <Select value={doctorRole} onValueChange={setDoctorRole}>
              <SelectTrigger id="role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCTOR_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tuss">TUSS *</Label>
            <Input id="tuss" value={tuss} onChange={(e) => setTuss(e.target.value)} placeholder="8 dígitos" inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proc">Descrição do procedimento</Label>
            <Input id="proc" value={procedureName} onChange={(e) => setProcedureName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc">Via de acesso</Label>
            <Input id="acc" value={accessRoute} onChange={(e) => setAccessRoute(e.target.value)} placeholder="opcional" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qty">Quantidade *</Label>
            <Input id="qty" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sec">Setor</Label>
            <Input id="sec" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="ex.: Centro Cirúrgico" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amt">Valor a pagar (R$) *</Label>
            <Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
          </div>

          <div className="md:col-span-2 space-y-2 pt-2 border-t">
            <Label>Como tratar este item</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="grid gap-2">
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                <RadioGroupItem value="avulso" id="m-avulso" className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium">Pagamento avulso aprovado</div>
                  <div className="text-xs text-muted-foreground">O valor digitado é final. Item entra como aprovado, sem diferença de regra.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                <RadioGroupItem value="validar" id="m-validar" className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium">Validar pelas regras</div>
                  <div className="text-xs text-muted-foreground">Entra como pendente. Rode "Reaplicar regras" depois para calcular o valor esperado e detectar divergência.</div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="md:col-span-2 space-y-1">
            <Label htmlFor="note">Justificativa / observação</Label>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explique por que este item está sendo incluído manualmente (recomendado)." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Incluir item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
