/**
 * Caixa de notificações internas do usuário.
 *
 * Lista persistente (sobrevive entre sessões) das notificações que o sistema
 * enviou ao usuário logado: aprovações/rejeições de comunicados, alertas, etc.
 * O sino no header é volátil; esta página é o histórico real.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Bell, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Notif = {
  id: string;
  user_id: string;
  kind: "info" | "success" | "warning" | "error" | string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const KIND_ICON: Record<string, { Icon: typeof Bell; cls: string }> = {
  info: { Icon: Info, cls: "text-info" },
  success: { Icon: CheckCircle2, cls: "text-success" },
  warning: { Icon: AlertTriangle, cls: "text-warning-text" },
  error: { Icon: AlertTriangle, cls: "text-destructive" },
};

export default function NotificationsInbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("internal_notifications" as never)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar notificações", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      setItems((data ?? []) as unknown as Notif[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    if (!user?.id) return;
    const ch = supabase
      .channel(`inbox-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_notifications", filter: `user_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    const { error } = await supabase.rpc("mark_notification_read", { _id: id });
    if (error) {
      toast({ title: "Falha ao marcar como lida", description: error.message, variant: "destructive" });
      void load();
    }
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    const { error } = await supabase.rpc("mark_all_notifications_read");
    if (error) {
      toast({ title: "Falha ao marcar todas", description: error.message, variant: "destructive" });
      void load();
    }
  };

  const filtered = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.read_at) : items),
    [items, filter],
  );
  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Caixa de notificações"
        icon={Bell as never}
        description="Histórico completo dos avisos enviados a você pelo sistema."
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void markAll()}>
              Marcar todas como lidas ({unreadCount})
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-2">
        <Button
          variant={filter === "unread" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("unread")}
        >
          Não lidas {unreadCount > 0 && <Badge variant="secondary" className="ml-2">{unreadCount}</Badge>}
        </Button>
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          Todas ({items.length})
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full mt-2" />
            </div>
          ))}

        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-[13px]">
            {filter === "unread" ? "Nada de novo por aqui. ✨" : "Sem notificações."}
          </div>
        )}

        {!loading &&
          filtered.map((n) => {
            const { Icon, cls } = KIND_ICON[n.kind] ?? KIND_ICON.info;
            const isUnread = !n.read_at;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex gap-3 p-4 transition-colors",
                  isUnread && "bg-accent/30",
                )}
              >
                <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", cls)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground">{n.title}</p>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {format(new Date(n.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  {n.body && (
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                      {n.body}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    {n.link && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (isUnread) void markRead(n.id);
                          navigate(n.link!);
                        }}
                      >
                        Abrir
                      </Button>
                    )}
                    {isUnread && (
                      <Button size="sm" variant="ghost" onClick={() => void markRead(n.id)}>
                        Marcar como lida
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
