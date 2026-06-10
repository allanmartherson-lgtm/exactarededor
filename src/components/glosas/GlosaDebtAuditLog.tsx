import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, History } from "lucide-react";

type LogRow = {
  id: string;
  entity_id: string;
  created_at: string;
  actor_id: string | null;
  company_id: string | null;
  company_name: string | null;
  diff: {
    doctor_crm?: string | null;
    doctor_name?: string;
    parcelas?: number;
    total?: number;
    item_count?: number;
    glosa_item_ids?: string[];
  } | null;
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function GlosaDebtAuditLog({ reloadKey }: { reloadKey?: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (
      supabase as never as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => {
                order: (
                  k: string,
                  o: { ascending: boolean },
                ) => {
                  limit: (
                    n: number,
                  ) => Promise<{ data: LogRow[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      }
    )
      .from("audit_log")
      .select("id,entity_id,created_at,actor_id,company_id,company_name,diff")
      .eq("entity_type", "glosa_debt")
      .eq("action", "create_manual")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setRows([]);
      setLoading(false);
      return;
    }
    const list = data ?? [];
    setRows(list);
    const userIds = Array.from(
      new Set(list.map((r) => r.actor_id).filter((x): x is string => !!x)),
    );
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const m: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; full_name: string | null }) => {
        if (p.full_name) m[p.id] = p.full_name;
      });
      setActors(m);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load, reloadKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <History size={14} className="text-muted-foreground" />
            Auditoria — débitos gerados manualmente
            {rows.length > 0 && (
              <Badge variant="outline" className="font-normal">
                {rows.length}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Ocultar" : "Mostrar"}
          </Button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-1">
          {loading && (
            <div className="text-sm text-muted-foreground py-3">Carregando…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-sm text-muted-foreground py-3">
              Nenhum débito gerado manualmente ainda.
            </div>
          )}
          {!loading &&
            rows.map((r) => {
              const isOpen = !!expanded[r.id];
              const d = r.diff ?? {};
              return (
                <div
                  key={r.id}
                  className="rounded-md border border-border bg-card"
                >
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() =>
                      setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))
                    }
                  >
                    {isOpen ? (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground truncate">
                        <span className="font-medium">
                          {r.company_name ?? "—"}
                        </span>
                        {" · "}
                        {d.doctor_name ?? "—"}
                        {d.doctor_crm ? ` (${d.doctor_crm})` : ""}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(r.created_at)} ·{" "}
                        {r.actor_id ? actors[r.actor_id] ?? "usuário" : "sistema"}{" "}
                        · {d.item_count ?? 0} item
                        {(d.item_count ?? 0) === 1 ? "" : "s"} · {d.parcelas ?? 0}×
                      </div>
                    </div>
                    <div className="text-[12px] font-mono text-foreground">
                      {brl(Number(d.total ?? 0))}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground space-y-1">
                      <div>
                        <span className="text-foreground">débito:</span>{" "}
                        <code className="text-[11px]">{r.entity_id}</code>
                      </div>
                      <div>
                        <span className="text-foreground">empresa:</span>{" "}
                        <code className="text-[11px]">
                          {r.company_id ?? "—"}
                        </code>
                      </div>
                      <div>
                        <span className="text-foreground">glosa_item_ids:</span>
                        <div className="mt-1 max-h-32 overflow-auto rounded border border-border/60 bg-muted/30 p-2 font-mono text-[10.5px] leading-snug break-all">
                          {(d.glosa_item_ids ?? []).join(", ") || "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </CardContent>
      )}
    </Card>
  );
}
