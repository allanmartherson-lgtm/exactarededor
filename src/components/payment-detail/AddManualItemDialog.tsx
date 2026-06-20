import { useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, Loader2, Plus } from "lucide-react";

/**
 * Modal para inclusão manual de itens em um pagamento.
 *
 * Tipos suportados (campo "Tipo de lançamento"):
 *  - honorario: procedimento padrão — exige TUSS + Função
 *  - bonus / complemento / pendencia_anterior / outros: lançamentos extras
 *    onde TUSS e Função são opcionais. Setor segue obrigatório em todos.
 *
 * Validações adicionais:
 *  - Setor é selecionado da tabela `sectors` (cadastro estadual).
 *  - Via de acesso vira dropdown com opções padronizadas.
 *  - Médico → consulta `doctor_companies` para alertar (não bloquear) se o
 *    médico não estiver vinculado à empresa do pagamento.
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
type LancType = "honorario" | "bonus" | "complemento" | "outros";

const LANC_TYPES: { value: LancType; label: string; hint: string }[] = [
  { value: "honorario", label: "Honorário (procedimento)", hint: "Lançamento padrão — TUSS e função obrigatórios." },
  { value: "bonus", label: "Bônus", hint: "Bônus do principal (atendimento só com auxiliar) ou bônus avulso." },
  { value: "complemento", label: "Complemento", hint: "Complementação de honorário já pago em outro lote ou competência anterior." },
  { value: "outros", label: "Outros", hint: "Outros lançamentos avulsos." },
];

const DOCTOR_ROLES = [
  "Cirurgião Principal",
  "Primeiro Auxiliar",
  "Segundo Auxiliar",
  "Terceiro Auxiliar",
  "Instrumentador",
  "Anestesista",
  "Outro",
];

const ACCESS_ROUTES = [
  "Única ou Principal",
  "Mesma Via de Acesso",
  "Vias de Acesso Diferentes",
];

type SectorOption = { slug: string; name: string };

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

  const [lancType, setLancType] = useState<LancType>("honorario");
  const [attendance, setAttendance] = useState("");
  const [patient, setPatient] = useState("");
  const [doctor, setDoctor] = useState<DoctorOption | null>(null);
  const [doctorLinked, setDoctorLinked] = useState<boolean | null>(null);
  const [procedureDate, setProcedureDate] = useState("");
  const [accessRoute, setAccessRoute] = useState<string>("none");
  const [doctorRole, setDoctorRole] = useState<string>("Cirurgião Principal");
  const [quantity, setQuantity] = useState<string>("1");
  const [tuss, setTuss] = useState("");
  const [procedureName, setProcedureName] = useState("");
  const [sectorSlug, setSectorSlug] = useState<string>("");
  const [sectors, setSectors] = useState<SectorOption[]>([]);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("avulso");
  const [note, setNote] = useState("");

  const isProcedure = lancType === "honorario";

  // Carregar setores ativos do cadastro
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data, error } = await supabase
        .from("sectors")
        .select("slug,name")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        console.error("[AddManualItemDialog] sectors load", error);
        return;
      }
      setSectors((data ?? []) as SectorOption[]);
    })();
  }, [open]);

  // Verificar vínculo médico ↔ empresa
  useEffect(() => {
    if (!doctor?.id || !companyId) { setDoctorLinked(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("doctor_companies")
        .select("id")
        .eq("doctor_id", doctor.id)
        .eq("company_id", companyId)
        .limit(1);
      if (cancelled) return;
      if (error) { setDoctorLinked(null); return; }
      setDoctorLinked((data?.length ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [doctor?.id, companyId]);

  const reset = () => {
    setLancType("honorario");
    setAttendance(""); setPatient(""); setDoctor(null); setDoctorLinked(null);
    setProcedureDate(""); setAccessRoute("none");
    setDoctorRole("Cirurgião Principal"); setQuantity("1");
    setTuss(""); setProcedureName(""); setSectorSlug(""); setAmount("");
    setMode("avulso"); setNote("");
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
    sectorSlug.length > 0 &&
    Number(quantity) > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    (!isProcedure || tuss.replace(/\D/g, "").length >= 6);

  const selectedSector = sectors.find((s) => s.slug === sectorSlug);

  const submit = async () => {
    if (!valid || !doctor) return;
    setSaving(true);
    try {
      const findings: Record<string, unknown> = {
        manual: true,
        manual_mode: mode,
        manual_type: lancType,
        ...(doctorLinked === false ? { doctor_not_linked_to_company: true } : {}),
        ...(note.trim() ? { ai_note: note.trim() } : {}),
      };
      if (mode === "avulso") {
        findings.calculation_explanation =
          `Inclusão manual aprovada pelo analista (${lancType}). Valor (${parsedAmount.toFixed(2)}) tratado como repasse final, sem validação automática.${note.trim() ? ` Justificativa: ${note.trim()}` : ""}`;
        findings.matched_rules = [`Inclusão manual — ${lancType}`];
      } else {
        findings.calculation_explanation =
          `Item incluído manualmente (${lancType}) para validação pelo motor. Rode "Reaplicar regras" para gerar o cálculo.${note.trim() ? ` Justificativa: ${note.trim()}` : ""}`;
      }

      // tipo_linha: usa nomes existentes quando possível
      const tipoLinha =
        lancType === "honorario" ? "honorario" :
        lancType === "bonus" ? "complemento_bonus" :
        lancType === "complemento" ? "complemento" :
        "outros";

      const payload: any = {
        payment_id: paymentId,
        company_id: companyId,
        company_name: companyName,
        attendance_number: attendance.trim(),
        patient_name: patient.trim(),
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        doctor_role: isProcedure ? doctorRole : (doctorRole || null),
        procedure_date: procedureDate,
        access_route: accessRoute && accessRoute !== "none" ? accessRoute : null,
        procedure_code: isProcedure ? tuss.replace(/\D/g, "") : (tuss.replace(/\D/g, "") || null),
        procedure_name: procedureName.trim() || null,
        sector: selectedSector?.name ?? null,
        sector_slug: sectorSlug,
        quantity: Number(quantity),
        gross_amount: parsedAmount,
        procedure_amount: parsedAmount,
        expected_amount: mode === "avulso" ? parsedAmount : null,
        ai_status: mode === "avulso" ? "aprovado" : "pendente",
        ai_findings: findings,
        source: "manual",
        item_origem: "inclusao_manual",
        manual_entry: true,
        tipo_linha: tipoLinha,
        created_by_user_id: user?.id ?? null,
        manual_note: note.trim() || null,
      };

      const { error } = await supabase.from("payment_items").insert(payload);
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

  const currentType = LANC_TYPES.find((t) => t.value === lancType)!;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) { reset(); } onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[min(95vw,768px)] sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words">
            <Plus className="h-4 w-4 shrink-0" /> <span className="break-words">Adicionar item manual</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Inclua um lançamento avulso para <strong className="break-words">{companyName}</strong>. Use quando o item não veio na base hospitalar (pendência, bônus do principal, complemento etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
          {/* Tipo de lançamento */}
          <div className="md:col-span-2 space-y-1 rounded-md border bg-muted/20 p-3">
            <Label htmlFor="lanc-type">Tipo de lançamento *</Label>
            <Select value={lancType} onValueChange={(v) => setLancType(v as LancType)}>
              <SelectTrigger id="lanc-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{currentType.hint}</p>
          </div>

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
            {doctor && doctorLinked === false && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{doctor.name}</strong> não está vinculado à empresa <strong>{companyName}</strong>.
                  Confirme o vínculo no cadastro antes de pagar — repasse depende do doctor_companies.
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="date">Data do procedimento *</Label>
            <Input id="date" type="date" value={procedureDate} onChange={(e) => setProcedureDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role">Função {isProcedure ? "*" : "(opcional)"}</Label>
            <Select value={doctorRole} onValueChange={setDoctorRole}>
              <SelectTrigger id="role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCTOR_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tuss">TUSS {isProcedure ? "*" : "(opcional)"}</Label>
            <Input id="tuss" value={tuss} onChange={(e) => setTuss(e.target.value)} placeholder={isProcedure ? "8 dígitos" : "opcional"} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proc">Descrição do procedimento</Label>
            <Input id="proc" value={procedureName} onChange={(e) => setProcedureName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="acc">Via de acesso</Label>
            <Select value={accessRoute} onValueChange={setAccessRoute}>
              <SelectTrigger id="acc"><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Não se aplica —</SelectItem>
                {ACCESS_ROUTES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qty">Quantidade *</Label>
            <Input id="qty" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sec">Setor *</Label>
            <Select value={sectorSlug} onValueChange={setSectorSlug}>
              <SelectTrigger id="sec"><SelectValue placeholder="Selecione o setor do cadastro" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {sectors.map((s) => <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
