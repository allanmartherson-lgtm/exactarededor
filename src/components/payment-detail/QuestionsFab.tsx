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
        "fixed z-40 bottom-6 right-6 print:hidden",
        className,
      )}
    >
      <Button
        type="button"
        onClick={onClick}
        size="lg"
        className={cn(
          "h-14 pl-5 pr-6 rounded-full shadow-elevated gap-2 ring-1 ring-primary/20",
          "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        <MessageCircleQuestion className="h-5 w-5" />
        <span className="font-medium">Conversas</span>
        {openCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-warning text-warning-foreground text-[11px] font-semibold">
            {openCount}
          </span>
        )}
      </Button>
    </div>
  );
}
