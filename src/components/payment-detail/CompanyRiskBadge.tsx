import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCompanyRiskProfiles, riskLevel, type CompanyRiskProfile } from "@/lib/companyRiskProfile";

interface Props {
  companyName: string;
}

const STYLES: Record<ReturnType<typeof riskLevel>, string> = {
  verde: "border-[hsl(var(--success))]/30 bg-[hsl(var(--success-soft))] text-[hsl(var(--success))]",
  amarelo: "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning))]",
  vermelho: "border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive))]",
};

export function CompanyRiskBadge({ companyName }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CompanyRiskProfile | null>(null);

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

  if (loading) return <Skeleton className="h-4 w-[60px]" />;
  if (!profile || profile.totalItems < 10) return null;

  const level = riskLevel(profile.alertRate);
  const pct = Math.round(profile.alertRate * 100);
  const label =
    level === "verde"
      ? "✓ Baixo histórico de alertas"
      : level === "amarelo"
        ? `⚠ Histórico moderado (${pct}%)`
        : `⚠ Alto histórico de alertas (${pct}%)`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap cursor-help ${STYLES[level]}`}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Baseado em {profile.totalItems} itens históricos dos últimos {profile.sampleMonths} meses
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
