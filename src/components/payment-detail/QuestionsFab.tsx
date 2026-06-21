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
        className={cn(
          "h-12 w-12 sm:h-14 sm:w-auto sm:pl-5 sm:pr-6 rounded-full shadow-elevated gap-2 ring-1 ring-primary/20 p-0 sm:p-0",
          "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        <MessageCircleQuestion className="h-5 w-5" />
        <span className="font-medium hidden sm:inline">Conversas</span>
        {openCount > 0 && (
          <span className="absolute -top-1 -right-1 sm:static sm:ml-1 inline-flex items-center justify-center min-w-[20px] h-[20px] sm:min-w-[22px] sm:h-[22px] px-1.5 rounded-full bg-warning text-warning-foreground text-[11px] font-semibold">
            {openCount}
          </span>
        )}
      </Button>
      </div>
    </div>

  );
}
