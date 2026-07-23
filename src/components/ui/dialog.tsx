import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export type DialogTone = "brand" | "success" | "warning" | "destructive" | "info";

// Faixa superior colorida por tom. Sinaliza a natureza do modal sem exigir
// mudança nos call sites (default = brand).
const toneAccent: Record<DialogTone, string> = {
  brand: "bg-[image:var(--gradient-brand)]",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { tone?: DialogTone }
>(({ className, children, tone = "brand", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)] max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] translate-x-[-50%] translate-y-[-50%] gap-3 sm:gap-4 overflow-y-auto overflow-x-hidden overscroll-contain border bg-background p-4 sm:p-6 shadow-elevated duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg",
        className,
      )}
      {...props}
      onPointerDownOutside={(e) => {
        props.onPointerDownOutside?.(e);
        if (!e.defaultPrevented) e.preventDefault();
      }}
      onInteractOutside={(e) => {
        props.onInteractOutside?.(e);
        if (!e.defaultPrevented) e.preventDefault();
      }}
    >
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-lg", toneAccent[tone])}
      />
      {children}
      {/* Botão fechar: vermelho por padrão (convenção universal),
          ícone-only 36x36 com borda destacada — não colide com ações
          no topo do modal e fica imediatamente identificável. */}
      <DialogPrimitive.Close
        aria-label="Fechar"
        title="Fechar (Esc)"
        className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2 disabled:pointer-events-none"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left pr-12", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2 sm:space-x-0", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base sm:text-lg font-semibold leading-tight tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground leading-relaxed", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
