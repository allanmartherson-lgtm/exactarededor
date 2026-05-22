import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { SurfaceCard, SurfaceCardHeader, bubbleStyle, type BubbleColor } from "@/components/shared/SurfacePrimitives";
import { fetchCompanyRiskProfiles, riskLevel, type CompanyRiskProfile as Profile } from "@/lib/companyRiskProfile";
import { Skeleton } from "@/components/ui/skeleton";

const LEVEL_COLOR: Record<ReturnType<typeof riskLevel>, BubbleColor> = {
  verde: "green",
  amarelo: "yellow",
  vermelho: "red",
};
const LEVEL_LABEL: Record<ReturnType<typeof riskLevel>, string> = {
  verde: "Baixo risco",
  amarelo: "Risco moderado",
  vermelho: "Alto risco",
};

interface Props {
  companyName: string;
}

export function CompanyRiskProfileCard({ companyName }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCompanyRiskProfiles([companyName])
      .then((map) => {
        if (cancelled) return;
        setProfile(map.get(companyName) ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyName]);

  return (
    <SurfaceCard style={{ padding: 14 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold truncate" title={companyName}>{companyName}</span>
          </div>
          {loading && <Skeleton className="h-4 w-40" />}
          {!loading && profile && profile.totalItems < 10 && (
            <p className="text-xs text-muted-foreground">Histórico insuficiente ({profile.totalItems} itens)</p>
          )}
          {!loading && profile && profile.totalItems >= 10 && (
            <>
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{Math.round(profile.alertRate * 100)}%</span>{" "}
                <span className="text-muted-foreground">dos itens em alerta nos últimos {profile.sampleMonths} meses</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                baseado em {profile.totalItems} itens históricos
              </p>
            </>
          )}
        </div>
        {!loading && profile && profile.totalItems >= 10 && (() => {
          const level = riskLevel(profile.alertRate);
          return (
            <span
              style={{
                ...bubbleStyle(LEVEL_COLOR[level]),
                fontSize: 10,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              {LEVEL_LABEL[level]}
            </span>
          );
        })()}
      </div>
    </SurfaceCard>
  );
}

interface ListProps {
  companyNames: string[];
}

export function CompanyRiskProfileList({ companyNames }: ListProps) {
  const unique = Array.from(new Set(companyNames.map((n) => (n ?? "").trim()).filter(Boolean)));
  if (unique.length === 0) return null;
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Perfil de risco histórico das empresas"
        subtitle="Baseado em pagamentos analisados nos últimos 6 meses"
        icon={Building2}
        iconColor="purple"
      />
      <div className="p-4 grid gap-2 sm:grid-cols-2">
        {unique.map((name) => (
          <CompanyRiskProfileCard key={name} companyName={name} />
        ))}
      </div>
    </SurfaceCard>
  );
}
