import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, Building2 } from "lucide-react";

interface CloneRuleToHospitalDialogProps {
  open: boolean;
  ruleId: string | null;
  ruleName: string | null;
  ruleHospitalId: string | null;
  onClose: () => void;
  onCloned?: (newRuleId: string, targetHospitalId: string) => void;
}

export function CloneRuleToHospitalDialog({
  open, ruleId, ruleName, ruleHospitalId, onClose, onCloned,
}: CloneRuleToHospitalDialogProps) {
  const { availableHospitals } = useHospital();
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const candidates = availableHospitals.filter((h) => h.active && h.id !== ruleHospitalId);

  useEffect(() => {
    if (open) {
      setTarget(candidates[0]?.id ?? "");
      setNewName(ruleName ? `${ruleName}` : "");
    }
  }, [open, ruleName]); // eslint-disable-line react-hooks/exhaustive-deps

  const clone = async () => {
    if (!ruleId || !target) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("clone_rule_to_hospital", {
        _rule_id: ruleId,
        _target_hospital_id: target,
        _new_name: newName.trim() || null,
      });
      if (error) throw error;
      const { recomputeDoctorSpecificExclusions } = await import("@/lib/recomputeDoctorSpecificExclusions");
      await recomputeDoctorSpecificExclusions();
      const targetHosp = candidates.find((h) => h.id === target);
      toast({ title: "Regra clonada", description: `Clonada para ${targetHosp?.name ?? "hospital destino"}.` });
      onCloned?.(String(data), target);
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao clonar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Clonar regra para outro hospital
          </DialogTitle>
          <DialogDescription>
            Cria uma cópia independente desta regra (e seus cálculos) no hospital escolhido.
            Após clonar, as regras evoluem separadamente — alterações em uma não afetam a outra.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Hospital de destino</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {candidates.length === 0 ? (
                  <SelectItem value="__none__" disabled>Nenhum outro hospital disponível</SelectItem>
                ) : candidates.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name} <span className="text-muted-foreground text-xs">({h.state_uf})</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome no destino (opcional)</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={ruleName ?? ""} />
            <p className="text-[11px] text-muted-foreground">Deixe em branco para manter o mesmo nome.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={clone} disabled={saving || !target || candidates.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Clonar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
