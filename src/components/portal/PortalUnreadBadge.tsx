/**
 * Badge no header que soma `unread_for_internal` de todas as `company_threads`
 * que o usuário interno consegue ver (admin/analista/validador/diretor).
 *
 * - Carrega inicial via SELECT agregado.
 * - Realtime: assina UPDATE em `company_threads` para refletir incrementos.
 * - Clique navega para `/conversas`.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MessageCircle } from "lucide-react";

export function PortalUnreadBadge() {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);

  const refresh = async () => {
    const { data } = await supabase
      .from("company_threads" as never)
      .select("unread_for_internal")
      .eq("status", "aberta");
    const rows = (data ?? []) as Array<{ unread_for_internal: number }>;
    const total = rows.reduce((s, r) => s + (r.unread_for_internal ?? 0), 0);
    setCount(total);
  };

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel("portal-unread-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_threads" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => navigate("/conversas")}
          aria-label={`Conversas do portal${count > 0 ? ` (${count} não lidas)` : ""}`}
          className="relative size-8 grid place-items-center rounded-md border border-border/60 bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="size-4" strokeWidth={1.7} />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none flex items-center justify-center px-1">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>Conversas do portal</TooltipContent>
    </Tooltip>
  );
}
