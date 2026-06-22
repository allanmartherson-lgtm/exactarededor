import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeroProcessCardProps {
  /** Big primary value already formatted, e.g. "R$ 1.917.832" */
  primaryValue: string;
  /** Label above the big number, e.g. "Em processamento" */
  primaryLabel: string;
  /** Small caption under the big number, e.g. "valor pendente · junho 2026" */
  primaryHint?: string;
  /** Optional deep link from the hero (chevron in the corner) */
  primaryTo?: string;

  /** 3 mini-stats rendered as semi-transparent pills inside the card */
  pills: Array<{
    label: string;
    value: string;
    hint?: string;
    to?: string;
  }>;

  className?: string;
}

/**
 * HeroProcessCard — card-herói azul sólido estilo Apple (#0071E3).
 *
 * - Número gigante branco (display, tracking apertado, tabular-nums)
 * - 3 mini-stats em pills semi-transparentes (bg-white/15)
 * - Sem dependência de dados: o consumidor já formata os valores
 *
 * Pensado para o topo do Dashboard. Mantém o azul Apple restrito a 1 ponto
 * focal por tela (princípio: azul = ação/destaque, nunca decoração).
 */
export function HeroProcessCard({
  primaryValue,
  primaryLabel,
  primaryHint,
  primaryTo,
  pills,
  className,
}: HeroProcessCardProps) {
  const HeroWrapper: React.ElementType = primaryTo ? Link : "div";
  const heroProps = primaryTo ? { to: primaryTo } : {};

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] bg-primary text-primary-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,113,227,0.45)]",
        className,
      )}
    >
      {/* subtle radial sheen — depth without competing with the number */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 55%)",
        }}
      />

      <div className="relative p-6 md:p-8">
        {/* Cabeçalho do hero */}
        <HeroWrapper
          {...heroProps}
          className={cn(
            "group block",
            primaryTo && "cursor-pointer",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70">
                {primaryLabel}
              </p>
              <p
                className="mt-2 text-white font-semibold leading-none"
                style={{
                  fontSize: "clamp(40px, 5vw, 56px)",
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {primaryValue}
              </p>
              {primaryHint && (
                <p className="mt-3 text-[13px] text-white/75">{primaryHint}</p>
              )}
            </div>

            {primaryTo && (
              <span
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full",
                  "bg-white/15 text-white transition-colors group-hover:bg-white/25",
                )}
                aria-hidden
              >
                <ArrowUpRight size={16} strokeWidth={2.25} />
              </span>
            )}
          </div>
        </HeroWrapper>

        {/* Pills semi-transparentes */}
        {pills.length > 0 && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {pills.map((p) => {
              const PillWrapper: React.ElementType = p.to ? Link : "div";
              const pillProps = p.to ? { to: p.to } : {};
              return (
                <PillWrapper
                  key={p.label}
                  {...pillProps}
                  className={cn(
                    "rounded-[12px] bg-white/12 px-4 py-3 text-left backdrop-blur-sm",
                    "border border-white/15 transition-colors",
                    p.to && "hover:bg-white/20",
                  )}
                >
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/70">
                    {p.label}
                  </p>
                  <p
                    className="mt-1 text-white font-semibold"
                    style={{
                      fontSize: 18,
                      letterSpacing: "-0.01em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {p.value}
                  </p>
                  {p.hint && (
                    <p className="mt-0.5 text-[11.5px] text-white/65">{p.hint}</p>
                  )}
                </PillWrapper>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
