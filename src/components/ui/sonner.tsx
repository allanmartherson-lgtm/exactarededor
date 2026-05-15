import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:opacity-90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground hover:group-[.toast]:bg-primary/90 focus-visible:group-[.toast]:ring-2 focus-visible:group-[.toast]:ring-ring focus-visible:group-[.toast]:ring-offset-2",
          cancelButton:
            "group-[.toast]:bg-secondary group-[.toast]:text-secondary-foreground hover:group-[.toast]:bg-secondary/80",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border hover:group-[.toast]:bg-muted",
          error:
            "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
          success:
            "group-[.toaster]:bg-success group-[.toaster]:text-success-foreground group-[.toaster]:border-success",
          warning:
            "group-[.toaster]:bg-warning group-[.toaster]:text-warning-foreground group-[.toaster]:border-warning",
          info:
            "group-[.toaster]:bg-info group-[.toaster]:text-info-foreground group-[.toaster]:border-info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
