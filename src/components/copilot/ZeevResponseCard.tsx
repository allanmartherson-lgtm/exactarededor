import { BookOpen, Zap, Info, Lightbulb, FileText, Settings, Users, Building2, Wallet, ListChecks, ArrowRight, Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Contrato do cartão devolvido pelo zeev-executor quando action='answer'.
export type ZeevCard = {
  icon?: "book" | "zap" | "info" | "lightbulb" | "file" | "settings" | "users" | "building" | "wallet" | "checklist";
  title: string;
  intro?: string;
  sections: Array<{
    title?: string;
    body?: string;
    steps?: string[];
    tips?: string[];
  }>;
  shortcuts?: Array<{ label: string; keys: string }>;
  actions?: Array<{ label: string; kind: "navigate"; url: string }>;
};

// Mapa restrito de ícones — evita bundle de todo o lucide e mantém o visual coerente.
const ICON_MAP = {
  book: BookOpen,
  zap: Zap,
  info: Info,
  lightbulb: Lightbulb,
  file: FileText,
  settings: Settings,
  users: Users,
  building: Building2,
  wallet: Wallet,
  checklist: ListChecks,
} as const;

interface Props {
  card: ZeevCard;
  onNavigate: (url: string) => void;
}

export function ZeevResponseCard({ card, onNavigate }: Props) {
  const Icon = ICON_MAP[card.icon ?? "book"];

  return (
    <div className="flex-1 min-w-0 rounded-xl border border-primary/25 bg-card overflow-hidden">
      {/* Cabeçalho — ícone + título */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/60 bg-primary-soft/40">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground leading-tight">{card.title}</div>
          {card.intro && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-snug">{card.intro}</p>
          )}
        </div>
      </div>

      {/* Seções */}
      <div className="p-3 space-y-3">
        {card.sections.map((s, i) => (
          <section key={i} className="space-y-1.5">
            {s.title && (
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-primary">{s.title}</h4>
            )}
            {s.body && (
              <p className="text-[12.5px] text-foreground leading-snug whitespace-pre-wrap">{s.body}</p>
            )}
            {s.steps && s.steps.length > 0 && (
              // Timeline vertical — cada passo com um marcador numerado.
              <ol className="relative ml-1.5 space-y-2 border-l border-border pl-3.5">
                {s.steps.map((step, idx) => (
                  <li key={idx} className="relative text-[12.5px] leading-snug text-foreground">
                    <span
                      className={cn(
                        "absolute -left-[19px] top-[1px] flex h-[18px] w-[18px] items-center justify-center rounded-full",
                        "bg-primary text-primary-foreground text-[10px] font-bold shadow-sm",
                      )}
                    >
                      {idx + 1}
                    </span>
                    <span className="whitespace-pre-wrap">{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {s.tips && s.tips.length > 0 && (
              <ul className="mt-1 space-y-1 rounded-md bg-muted/50 px-2.5 py-1.5">
                {s.tips.map((tip, ti) => (
                  <li key={ti} className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground leading-snug">
                    <Lightbulb className="h-3 w-3 shrink-0 mt-[2px] text-amber-500" />
                    <span className="whitespace-pre-wrap">{tip}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {/* Atalhos */}
        {card.shortcuts && card.shortcuts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {card.shortcuts.map((sc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
              >
                <Command className="h-2.5 w-2.5" />
                <span className="font-medium text-foreground">{sc.keys}</span>
                <span>· {sc.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Rodapé com CTAs de navegação */}
      {card.actions && card.actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2">
          {card.actions.slice(0, 3).map((a, i) => (
            <Button
              key={i}
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-primary/40 text-primary hover:bg-primary-soft"
              onClick={() => onNavigate(a.url)}
            >
              {a.label}
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
