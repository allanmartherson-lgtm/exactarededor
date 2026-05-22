import { useEffect, useState } from "react";
import { Bell, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { notificationStore, type AppNotification } from "@/lib/notificationStore";

function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>(() => notificationStore.get());
  useEffect(
    () => notificationStore.subscribe(() => setItems([...notificationStore.get()])),
    [],
  );
  return items;
}

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 30) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  return `há ${days}d`;
}

const KIND_ICON = {
  info: { Icon: Info, cls: "text-blue-500" },
  warning: { Icon: AlertTriangle, cls: "text-amber-500" },
  success: { Icon: CheckCircle2, cls: "text-emerald-500" },
} as const;

export function NotificationBell() {
  const items = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next && unread > 0) notificationStore.markAllRead();
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label={`Notificações${unread > 0 ? ` (${unread} não lidas)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none flex items-center justify-center px-1">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-[13px] font-medium">Notificações</p>
          {items.some((n) => !n.read) && (
            <button
              onClick={() => notificationStore.markAllRead()}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Marcar todas como lidas
            </button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              Nenhuma notificação nesta sessão
            </p>
          ) : (
            items.map((n) => {
              const { Icon, cls } = KIND_ICON[n.kind];
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/pagamentos/${n.paymentId}`);
                  }}
                  className={cn(
                    "w-full text-left flex gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/60 transition-colors",
                    !n.read && "bg-accent/40",
                  )}
                >
                  <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", cls)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-foreground truncate">{n.title}</p>
                    {n.description && (
                      <p className="text-[11.5px] text-muted-foreground line-clamp-2">{n.description}</p>
                    )}
                    <p className="text-[10.5px] text-muted-foreground mt-0.5">
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
