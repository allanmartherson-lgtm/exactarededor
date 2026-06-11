import { Accessibility, Sun, Moon, Contrast, Type } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTheme, type FontScale } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const SCALES: { id: FontScale; label: string; sub: string }[] = [
  { id: "compact", label: "A", sub: "90%" },
  { id: "normal",  label: "A", sub: "100%" },
  { id: "large",   label: "A", sub: "115%" },
  { id: "xlarge",  label: "A", sub: "130%" },
];

/**
 * Menu único de acessibilidade — tema, escala tipográfica e alto contraste.
 * Substitui os antigos ThemeToggle + ContrastToggle e espelha o padrão usado
 * no projeto "Gestão do Centro Cirúrgico".
 */
export function AccessibilityMenu() {
  const { theme, setTheme, fontScale, setFontScale, highContrast, setHighContrast } = useTheme();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Acessibilidade e aparência"
          title="Acessibilidade e aparência"
          className="size-8 grid place-items-center rounded-md border border-border/60 bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Accessibility className="size-4" strokeWidth={1.7} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 p-3 space-y-4">
        {/* Tema */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Tema</Label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setTheme("light")}
              aria-pressed={theme === "light"}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                theme === "light"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 hover:bg-muted/60",
              )}
            >
              <Sun className="size-3.5" strokeWidth={1.7} />
              Claro
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              aria-pressed={theme === "dark"}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                theme === "dark"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 hover:bg-muted/60",
              )}
            >
              <Moon className="size-3.5" strokeWidth={1.7} />
              Escuro
            </button>
          </div>
        </div>

        {/* Tamanho da fonte */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Type className="size-3.5" strokeWidth={1.7} />
            Tamanho da fonte
          </Label>
          <div className="grid grid-cols-4 gap-1.5">
            {SCALES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFontScale(s.id)}
                aria-pressed={fontScale === s.id}
                aria-label={`Fonte ${s.sub}`}
                className={cn(
                  "flex flex-col items-center justify-center rounded-md border py-1.5 transition-colors",
                  fontScale === s.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 hover:bg-muted/60 text-foreground",
                )}
              >
                <span
                  style={{ fontSize: `${10 + i * 2}px`, lineHeight: 1 }}
                  className="font-semibold"
                >
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Ajusta toda a interface — textos, cards, gráficos e espaçamentos.
          </p>
        </div>

        {/* Alto contraste */}
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Contrast className="size-3.5 text-muted-foreground" strokeWidth={1.7} />
            <div className="min-w-0">
              <div className="text-xs font-medium">Alto contraste</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                Reforça textos e bordas
              </div>
            </div>
          </div>
          <Switch checked={highContrast} onCheckedChange={setHighContrast} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
