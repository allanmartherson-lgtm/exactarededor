import { Button } from "@/components/ui/button";
import { MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  openCount: number;
  onClick: () => void;
  className?: string;
};

/**
 * Floating Action Button para abrir o painel de conversas do lote.
 * Visual alinhado ao Exacta: primary sólido, sombra elegante, badge contrastante.
 */
export function QuestionsFab({ openCount, onClick, className }: Props) {
  return (
    <div
      className={cn(
        "fixed z-40 bottom-4 right-4 sm:bottom-6 sm:right-6 print:hidden",
        className,
      )}
      style={{ position: "fixed" }}
    >
      <div className="relative">

      <Button
        type="button"
        onClick={onClick}
        size="lg"
        aria-label="Abrir conversas"
        title="Conversas"
        className={cn(
          "h-12 w-12 sm:h-14 sm:w-14 p-0 rounded-full shadow-elevated ring-1",
          // Cor distinta do Zeev (que usa primary/azul Rede D'Or):
          // tom escuro neutro para diferenciar claramente os dois FABs.
          "bg-foreground text-background hover:bg-foreground/90 ring-foreground/20",
        )}
      >
        <MessageCircleQuestion className="h-5 w-5 sm:h-6 sm:w-6" />
        {openCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-warning text-warning-foreground text-[11px] font-semibold">
            {openCount}
          </span>
        )}
      </Button>
      </div>
    </div>

  );
}
