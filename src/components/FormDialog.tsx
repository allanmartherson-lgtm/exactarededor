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
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "full";
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
          "w-[95vw] max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col",
          maxWidthClasses[maxWidth],
          className
        )}
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4 box-border min-w-0">
          {children}
        </div>

        {footer && (
          <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
