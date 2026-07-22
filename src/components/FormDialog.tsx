import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";
  maxHeight?: string;
  className?: string;
}

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-[88rem]",
  "full": "max-w-[98vw]",
};

export const FormDialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = "4xl",
  className,
}: FormDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Altura automática: cresce até o teto do viewport definido no primitive.
          // Sem flex/max-h próprios — o scroll fica no primitive, evitando "cascas"
          // vazias que espremem conteúdo curto.
          "w-[95vw] p-0 gap-0",
          maxWidthClasses[maxWidth],
          className,
        )}
      >
        {/* Header ganha fundo em gradient suave da marca CURA para tirar o
            aspecto flat/cinza e reforçar identidade Rede D'Or. */}
        <DialogHeader className="p-4 sm:p-6 pb-3 sm:pb-4 sticky top-0 z-10 bg-[image:var(--gradient-soft)] border-b border-primary/15">
          <DialogTitle className="text-primary-dark">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="px-4 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 min-w-0">
          {children}
        </div>

        {footer && (
          <DialogFooter className="p-4 sm:p-6 pt-3 sm:pt-4 border-t border-primary/10 bg-muted/30 sticky bottom-0">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
