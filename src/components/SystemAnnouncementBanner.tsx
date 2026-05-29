import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Info, AlertTriangle, AlertOctagon, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Announcement = {
  id: string;
  title: string | null;
  message: string;
  severity: "info" | "warning" | "critical" | "success";
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  dismissible: boolean;
};

const STORAGE_KEY = "medpay:dismissed-announcements";

function getDismissed(): string[] {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function setDismissed(ids: string[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

const SEVERITY_STYLES: Record<Announcement["severity"], { bg: string; icon: typeof Info }> = {
  info: { bg: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300", icon: Info },
  success: { bg: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300", icon: CheckCircle2 },
  warning: { bg: "bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300", icon: AlertTriangle },
  critical: { bg: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300", icon: AlertOctagon },
};

export function SystemAnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissedState] = useState<string[]>(getDismissed());

  useEffect(() => {
    let mounted = true;
    (async () => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("system_announcements" as never)
        .select("*")
        .eq("active", true)
        .lte("starts_at", nowIso)
        .order("created_at", { ascending: false });
      if (!mounted) return;
      const filtered = ((data as Announcement[] | null) ?? []).filter(
        (a) => !a.ends_at || new Date(a.ends_at) > new Date(),
      );
      setItems(filtered);
    })();
    return () => { mounted = false; };
  }, []);

  const visible = items.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1">
      {visible.map((a) => {
        const style = SEVERITY_STYLES[a.severity];
        const Icon = style.icon;
        return (
          <div
            key={a.id}
            className={cn(
              "flex items-start gap-3 border-b px-4 py-2 text-sm",
              style.bg,
            )}
            role="status"
          >
            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {a.title && <strong className="mr-2">{a.title}</strong>}
              <span>{a.message}</span>
            </div>
            {a.dismissible && (
              <button
                onClick={() => {
                  const next = [...dismissed, a.id];
                  setDismissedState(next);
                  setDismissed(next);
                }}
                className="opacity-60 hover:opacity-100"
                aria-label="Dispensar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
