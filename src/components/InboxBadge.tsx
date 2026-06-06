/**
 * Botão de inbox persistente no header.
 * Diferente do <NotificationBell/> (que é volátil/sessão), este reflete o
 * que está em internal_notifications e leva o usuário à página /notificacoes.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function InboxBadge() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = async () => {
    if (!user?.id) return;
    const { count: c } = await supabase
      .from("internal_notifications" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    setCount(c ?? 0);
  };

  useEffect(() => {
    if (!user?.id) return;
    void refresh();
    const ch = supabase
      .channel(`inbox-badge-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as { title?: string; body?: string; kind?: string };
            toast({
              title: n.title ?? "Nova notificação",
              description: n.body ?? undefined,
              variant: n.kind === "warning" || n.kind === "error" ? "destructive" : "default",
            });
          }
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user?.id]);

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative h-11 w-11 text-muted-foreground hover:text-foreground"
      aria-label={`Caixa de notificações${count > 0 ? ` (${count} não lidas)` : ""}`}
    >
      <Link to="/notificacoes">
        <Inbox className="h-[22px] w-[22px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none flex items-center justify-center px-1">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
