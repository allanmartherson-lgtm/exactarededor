import { Gauge } from "lucide-react";
import { SurfaceCard, SurfaceCardHeader, bubbleStyle, type BubbleColor } from "@/components/shared/SurfacePrimitives";

type Level = "baixo" | "medio" | "alto" | "critico";

const LEVEL_COLOR: Record<Level, BubbleColor> = {
  baixo: "green",
  medio: "yellow",
  alto: "purple",
  critico: "red",
};
const LEVEL_LABEL: Record<Level, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
  critico: "Crítico",
};

interface CompanyProfile {
  company: string;
  historical_alert_rate: number;
  sample_items: number;
}

interface PreAnalysis {
  predictive_score: number | null;
  score_level: Level | null;
  company_profiles: CompanyProfile[];
  calculated_at?: string;
  sample_months?: number;
}

interface Payment {
  processing_diagnostics?: { pre_analysis?: PreAnalysis } | null;
}

interface Props {
  payment: { processing_diagnostics?: unknown } | null | undefined;
}

export function PreAnalysisScoreCard({ payment }: Props) {
  const diag = (payment?.processing_diagnostics ?? null) as { pre_analysis?: PreAnalysis } | null;
  const pre = diag && typeof diag === "object" ? diag.pre_analysis : undefined;
  if (!pre || pre.predictive_score == null) return null;

  const level: Level = (pre.score_level ?? "medio") as Level;
  const color = LEVEL_COLOR[level];
  const months = pre.sample_months ?? 6;
  const profiles = (pre.company_profiles ?? []).slice(0, 5);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Score Preditivo (pré-análise IA)"
        subtitle={`Calculado antes da análise IA, baseado em histórico de ${months} meses`}
        icon={Gauge}
        iconColor={color}
      />
      <div className="p-5 flex flex-col md:flex-row gap-5 md:items-center">
        <div className="flex items-center gap-4">
          <div
            style={{
              ...bubbleStyle(color),
              width: 72,
              height: 72,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
            aria-label={`Score preditivo ${pre.predictive_score}, nível ${LEVEL_LABEL[level]}`}
          >
            {pre.predictive_score}
          </div>
          <div>
            <span
              style={{
                ...bubbleStyle(color),
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Risco {LEVEL_LABEL[level]}
            </span>
            <p className="text-xs text-muted-foreground mt-2">
              Score 0–100. Quanto maior, mais provável que o lote contenha alertas/reprovações.
            </p>
          </div>
        </div>
        {profiles.length > 0 && (
          <div className="flex-1 border-l md:pl-5 md:border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Empresas neste lote
            </p>
            <ul className="space-y-1 text-sm">
              {profiles.map((p) => (
                <li key={p.company} className="flex items-center justify-between gap-3">
                  <span className="truncate" title={p.company}>{p.company}</span>
                  <span className="tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                    {Math.round(p.historical_alert_rate * 100)}% alerta · {p.sample_items} itens
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}
