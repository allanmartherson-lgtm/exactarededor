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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { COMMON_SPECIALTIES } from "@/lib/specialties";

export type PendingSpecialtyRow = {
  /** Identificador estável (ex.: `${bucketId}|${idxNaBucket}` ou attendance_number). */
  rowKey: string;
  attendance_number: string | null;
  doctor_name: string | null;
  patient_name: string | null;
  procedure_date: string | null;
};

export type SpecialtyOverrides = Record<string, string>;

export function SpecialtyResolutionModal({
  open,
  onOpenChange,
  rows,
  initialOverrides,
  suggestionsByDoctor,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PendingSpecialtyRow[];
  initialOverrides?: SpecialtyOverrides;
  /** Especialidades cadastradas do médico (normalizado) — mostradas como chips de atalho. */
  suggestionsByDoctor?: Record<string, string[]>;
  onConfirm: (overrides: SpecialtyOverrides) => void;
}) {

  const [overrides, setOverrides] = useState<SpecialtyOverrides>({});
  const [filter, setFilter] = useState("");
  const [bulkSpecialty, setBulkSpecialty] = useState<string>("");

  useEffect(() => {
    if (open) {
      setOverrides({ ...(initialOverrides ?? {}) });
      setFilter("");
      setBulkSpecialty("");
    }
  }, [open, initialOverrides]);

  const filteredRows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        (r.doctor_name ?? "").toLowerCase().includes(f) ||
        (r.attendance_number ?? "").toLowerCase().includes(f) ||
        (r.patient_name ?? "").toLowerCase().includes(f),
    );
  }, [rows, filter]);

  const doctorGroups = useMemo(() => {
    const groups = new Map<string, PendingSpecialtyRow[]>();
    for (const r of rows) {
      const k = r.doctor_name ?? "(sem médico)";
      const list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const totalResolved = Object.values(overrides).filter(Boolean).length;
  const totalPending = rows.length - totalResolved;
  const canConfirm = totalPending === 0;

  const applyBulkToDoctor = (doctor: string, specialty: string) => {
    if (!specialty) return;
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if ((r.doctor_name ?? "(sem médico)") === doctor) {
          next[r.rowKey] = specialty;
        }
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Informe a especialidade dos atendimentos
          </DialogTitle>
          <DialogDescription>
            Em confecção de Parecer, a especialidade é obrigatória — o motor usa ela para decidir se cada
            atendimento é Parecer (1º contato) ou Visita (subsequentes da mesma especialidade).
            <span className="block mt-1">
              <strong>{totalPending}</strong> item(ns) ainda sem especialidade · <strong>{totalResolved}</strong> resolvido(s).
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-hidden flex-1 flex flex-col">
          {doctorGroups.length > 1 && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-medium">Aplicar especialidade em massa por médico</div>
              <div className="flex items-center gap-2">
                <Select value={bulkSpecialty} onValueChange={setBulkSpecialty}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Escolha uma especialidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_SPECIALTIES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-1">
                {doctorGroups.map(([doctor, list]) => (
                  <Button
                    key={doctor}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={!bulkSpecialty}
                    onClick={() => applyBulkToDoctor(doctor, bulkSpecialty)}
                  >
                    Aplicar a {doctor} ({list.length})
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Input
            placeholder="Filtrar por médico, paciente ou atendimento…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 text-sm"
          />

          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">Atend.</th>
                  <th className="px-2 py-1.5 font-medium">Médico</th>
                  <th className="px-2 py-1.5 font-medium">Paciente</th>
                  <th className="px-2 py-1.5 font-medium w-64">Especialidade</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const v = overrides[r.rowKey] ?? "";
                  return (
                    <tr key={r.rowKey} className="border-t">
                      <td className="px-2 py-1 align-top">{r.attendance_number ?? "—"}</td>
                      <td className="px-2 py-1 align-top">{r.doctor_name ?? "—"}</td>
                      <td className="px-2 py-1 align-top truncate max-w-[160px]">{r.patient_name ?? "—"}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          <Select
                            value={v}
                            onValueChange={(val) =>
                              setOverrides((prev) => ({ ...prev, [r.rowKey]: val }))
                            }
                          >
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue placeholder="Selecione…" />
                            </SelectTrigger>
                            <SelectContent>
                              {COMMON_SPECIALTIES.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {v && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">Nenhum item.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Badge variant={canConfirm ? "default" : "outline"}>
            {totalResolved}/{rows.length} resolvidos
          </Badge>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(overrides);
              onOpenChange(false);
            }}
          >
            Confirmar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
