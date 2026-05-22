import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SurfaceCard, SurfaceCardHeader, bubbleStyle } from "@/components/shared/SurfacePrimitives";
import { detectDoctorSectorAnomalies, type DoctorSectorAnomaly } from "@/lib/doctorAnomalyDetection";

interface Props {
  paymentId: string;
}

export function DoctorAnomalyAlerts({ paymentId }: Props) {
  const [anomalies, setAnomalies] = useState<DoctorSectorAnomaly[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectDoctorSectorAnomalies(paymentId).then((res) => {
      if (!cancelled) setAnomalies(res);
    });
    return () => { cancelled = true; };
  }, [paymentId]);

  if (!anomalies || anomalies.length === 0) return null;

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Anomalias comportamentais detectadas"
        subtitle="Médicos atuando em setor diferente do histórico dominante"
        icon={AlertTriangle}
        iconColor="red"
        countPill={anomalies.length}
      />
      <ul className="p-4 space-y-2.5">
        {anomalies.map((a) => (
          <li key={a.doctorName} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate" title={a.doctorName}>{a.doctorName}</p>
              <p className="text-xs text-muted-foreground">
                Historicamente em <span className="font-semibold capitalize">{a.historicalSector}</span>{" "}
                ({Math.round(a.historicalShare * 100)}% de {a.historicalItems} itens) — neste lote{" "}
                <span className="font-semibold capitalize">{Math.round(a.currentShare * 100)}% em {a.currentSector}</span>{" "}
                ({a.currentItems} itens).
              </p>
            </div>
            <span
              style={{
                ...bubbleStyle("red"),
                fontSize: 10,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                letterSpacing: "0.04em",
              }}
            >
              +{Math.round(a.deviation * 100)}% desvio
            </span>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
