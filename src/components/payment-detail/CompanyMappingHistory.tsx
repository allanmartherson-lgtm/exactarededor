import { useEffect, useMemo, useState } from "react";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { fetchMappingHistory, type MappingHistoryRow } from "@/lib/companyMappingAudit";
import { formatDateTimeBR } from "@/lib/dateUtils";

interface Props {
  paymentId: string;
  /** Mapa de companyId → nome para resolver labels (esperar loteCompanies). */
  companyIdToName?: Record<string, string>;
  /** Renderiza apenas o resumo agrupado (último estado por chave). */
  defaultOpen?: boolean;
}

export function CompanyMappingHistory({ paymentId, companyIdToName, defaultOpen = false }: Props) {
  const [rows, setRows] = useState<MappingHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!paymentId) return;
    setLoading(true);
    fetchMappingHistory(paymentId)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [paymentId]);

  const grouped = useMemo(() => {
    const m = new Map<string, MappingHistoryRow[]>();
    for (const r of rows) {
      const arr = m.get(r.hospital_company_norm) ?? [];
      arr.push(r);
      m.set(r.hospital_company_norm, arr);
    }
    return Array.from(m.values()).sort(
      (a, b) => new Date(b[0].changed_at).getTime() - new Date(a[0].changed_at).getTime(),
    );
  }, [rows]);

  const labelFor = (id: string | null) => {
    if (!id) return "— Ignorar —";
    return companyIdToName?.[id] ?? id.slice(0, 8) + "…";
  };

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando histórico de vínculos…
      </div>
    );
  }
  if (rows.length === 0) return null;

  const totalChanges = rows.length;
  const keysCount = grouped.length;

  return (
    <div className="border border-border rounded-lg bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground"
      >
        <span className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          Histórico de vínculos empresa→Exacta
          <span className="text-muted-foreground font-normal">
            ({keysCount} empresa(s) · {totalChanges} alteração(ões))
          </span>
        </span>
        <span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 max-h-[300px] overflow-y-auto">
          {grouped.map((group) => {
            const head = group[0];
            return (
              <div key={head.hospital_company_norm} className="border-l-2 border-border pl-3">
                <p className="text-xs font-semibold truncate" title={head.hospital_company_raw}>
                  {head.hospital_company_raw}
                </p>
                <ul className="mt-1 space-y-1">
                  {group.map((r) => (
                    <li key={r.id} className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-foreground">v{r.version}</span>
                      <span>·</span>
                      <span>{formatDateTimeBR(r.changed_at)}</span>
                      <span>·</span>
                      <span className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px]">{r.decision}</span>
                      {r.previous_exacta_company_id !== r.exacta_company_id && (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground line-through">
                            {labelFor(r.previous_exacta_company_id)}
                          </span>
                          <ArrowRight className="h-3 w-3" />
                          <span className="text-foreground font-medium">{labelFor(r.exacta_company_id)}</span>
                        </span>
                      )}
                      {r.reason && <span className="italic">— {r.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
