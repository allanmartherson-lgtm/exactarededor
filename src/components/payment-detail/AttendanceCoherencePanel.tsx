import { useMemo } from "react";
import { AlertTriangle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { PaymentItemRow } from "@/lib/payments";

interface Props {
  attendanceNumber: string;
  currentItemId: string;
  items: PaymentItemRow[];
}

export function AttendanceCoherencePanel({ attendanceNumber, currentItemId, items }: Props) {
  const related = useMemo(
    () =>
      items.filter(
        (i) => (i.attendance_number ?? "").trim() === attendanceNumber.trim()
      ),
    [items, attendanceNumber]
  );

  if (related.length <= 1) return null;

  const principals = related.filter(
    (i) => ((i as any).doctor_role ?? "").toLowerCase().includes("cirurgiao_principal")
  );

  const anesthesia = related.find((i) =>
    ((i as any).doctor_role ?? "").toLowerCase().includes("anest")
  );
  const surgery = related.find((i) =>
    ((i as any).doctor_role ?? "").toLowerCase().includes("cirurg")
  );

  const alerts: string[] = [];
  if (principals.length >= 2)
    alerts.push("⚠ Dois cirurgiões principais no mesmo atendimento");
  if (
    anesthesia &&
    surgery &&
    Number(surgery.gross_amount ?? 0) > 0 &&
    Number(anesthesia.gross_amount ?? 0) > Number(surgery.gross_amount ?? 0) * 0.5
  )
    alerts.push("⚠ Anestesia muito alta em relação à cirurgia");

  const info: string[] = [];
  if (related.length > 5) info.push(`Este atendimento tem ${related.length} itens.`);

  return (
    <div className="mt-4 p-3 rounded-md border border-info/20 bg-info-soft/10">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1">
        <Users className="h-3 w-3" /> Coerência do Atendimento (#{attendanceNumber})
      </p>

      {alerts.length > 0 && (
        <div className="mb-2 space-y-1">
          {alerts.map((a) => (
            <div
              key={a}
              className="flex items-start gap-1.5 text-[11px] rounded border border-warning/30 bg-warning-soft/20 px-2 py-1 text-warning-foreground"
            >
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {info.length > 0 && (
        <p className="text-[10px] text-muted-foreground mb-2">{info.join(" ")}</p>
      )}

      <ul className="space-y-1">
        {related.map((r) => {
          const role = ((r as any).doctor_role ?? "—") as string;
          const proc = (r as any).procedure_name ?? (r as any).description ?? "—";
          const status = (r as any).ai_status ?? "—";
          return (
            <li
              key={r.id}
              className={cn(
                "flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded border border-border/40",
                r.id === currentItemId ? "bg-primary/10" : "bg-background"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium">{r.doctor_name ?? "—"}</span>{" "}
                  <span className="text-muted-foreground">· {role}</span>
                </p>
                <p className="truncate text-muted-foreground">{proc}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="tabular-nums font-medium">
                  {formatCurrency(Number(r.gross_amount ?? 0))}
                </p>
                <p className="text-[9px] uppercase text-muted-foreground">{status}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
