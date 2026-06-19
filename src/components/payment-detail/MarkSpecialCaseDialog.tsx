import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2 } from "lucide-react";

interface TypeRow { code: string; label: string; requires_justification: boolean }

interface Props {
  paymentId: string;
  /** Pré-preenche o atendimento (ex: vindo de um item). */
  defaultAttendance?: string;
  /** Marca apenas esse item específico (precedência sobre o atendimento). */
  itemId?: string | null;
  doctorId?: string | null;
  trigger?: React.ReactNode;
  onMarked?: () => void;
}

export function MarkSpecialCaseDialog({
  paymentId, defaultAttendance, itemId, doctorId, trigger, onMarked,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [typeCode, setTypeCode] = useState<string>("");
  const [attendance, setAttendance] = useState(defaultAttendance ?? "");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("special_case_types")
        .select("code, label, requires_justification")
        .eq("active", true)
        .order("label");
      setTypes((data as TypeRow[]) ?? []);
    })();
  }, [open]);

  useEffect(() => {
    if (defaultAttendance) setAttendance(defaultAttendance);
  }, [defaultAttendance]);

  const selectedType = types.find((t) => t.code === typeCode);
  const needsJustification = !!selectedType?.requires_justification;

  const submit = async () => {
    if (!attendance.trim() || !typeCode) {
      toast({ title: "Preencha atendimento e tipo", variant: "destructive" });
      return;
    }
    if (needsJustification && justification.trim().length < 5) {
      toast({ title: "Justificativa obrigatória (mín. 5 caracteres)", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mark-special-case", {
        body: {
          payment_id: paymentId,
          attendance_number: attendance.trim(),
          special_case_type_code: typeCode,
          item_id: itemId ?? null,
          doctor_id: doctorId ?? null,
          justification: justification.trim() || undefined,
        },
      });
      if (error) throw error;
      const status = (data as any)?.mark?.status;
      toast({
        title: status === "approved" ? "Caso especial aprovado" : "Caso especial enviado para aprovação",
        description: status === "approved"
          ? "Aplicado direto pela gestão médica."
          : "A gestão médica receberá para decisão.",
      });
      setOpen(false);
      setJustification("");
      onMarked?.();
    } catch (e: any) {
      toast({ title: "Falha ao marcar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Sparkles className="h-4 w-4 mr-1" /> Marcar caso especial
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar caso especial</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nº do atendimento</Label>
            <Input
              value={attendance}
              onChange={(e) => setAttendance(e.target.value)}
              placeholder="ex: 12345678"
              disabled={!!itemId}
            />
            {itemId && (
              <p className="text-xs text-muted-foreground mt-1">
                Marca apenas o item selecionado.
              </p>
            )}
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                ))}
                {types.length === 0 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">Cadastre tipos em /admin/tipos-caso-especial</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              Justificativa {needsJustification && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              placeholder="Quando aplicável, descreva o caso (ex: paciente oncológico em quimio…)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
