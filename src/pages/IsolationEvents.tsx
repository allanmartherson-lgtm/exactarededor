// Monitor de isolamento entre hospitais — tentativas bloqueadas capturadas em audit_log.
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type IsolationEvent = {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  hospital_id: string | null;
  company_id: string | null;
  company_name: string | null;
  diff: unknown;
};

interface Props {
  embedded?: boolean;
}

export default function IsolationEvents({ embedded }: Props) {
  const [events, setEvents] = useState<IsolationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      setError(null);
      // RPC valida papel de admin/diretor no servidor
      const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: IsolationEvent[] | null; error: { message: string } | null }>)(
        "get_isolation_events",
        { _days: days, _limit: 500 },
      );
      if (cancel) return;
      if (error) setError(error.message);
      else setEvents(data ?? []);
      setLoading(false);
    }
    void load();
    return () => {
      cancel = true;
    };
  }, [days]);

  const body = (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Período:</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-3 py-1 text-sm"
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
        <span className="text-sm text-muted-foreground ml-4">
          {loading ? "Carregando..." : `${events.length} evento(s)`}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Nenhuma tentativa de cruzamento entre hospitais registrada no período. ✅
        </div>
      )}

      {events.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr>
                <th className="px-3 py-2">Data/Hora</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Entidade</th>
                <th className="px-3 py-2">Hospital</th>
                <th className="px-3 py-2">Ator</th>
                <th className="px-3 py-2">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(ev.created_at).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 font-medium">{ev.action}</td>
                  <td className="px-3 py-2">{ev.entity_type ?? "—"}{ev.entity_id ? ` (${String(ev.entity_id).slice(0, 8)})` : ""}</td>
                  <td className="px-3 py-2">{ev.hospital_id ? String(ev.hospital_id).slice(0, 8) : "—"}</td>
                  <td className="px-3 py-2">{ev.actor_id ? String(ev.actor_id).slice(0, 8) : "—"}</td>
                  <td className="px-3 py-2 max-w-md truncate text-muted-foreground">
                    {ev.diff ? JSON.stringify(ev.diff) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        title="Monitor de isolamento"
        description="Tentativas bloqueadas de cruzamento de dados entre hospitais (RLS e triggers de escopo)."
        icon={ShieldAlert}
      />
      {body}
    </div>
  );
}
