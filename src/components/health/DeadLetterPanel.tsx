import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

type Row = {
  id: string;
  payment_id: string;
  company_name: string;
  attempts: number;
  last_error: string | null;
  last_job_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function DeadLetterPanel() {
  const { user, roles } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const canRelease =
    roles?.includes("admin") || roles?.includes("diretor") || roles?.includes("validador");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("analysis_dead_letter")
      .select("*")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[DeadLetterPanel] erro", error);
      toast({ title: "Falha ao carregar dead-letter", description: error.message, variant: "destructive" });
    }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const release = async (row: Row) => {
    if (!canRelease || !user) return;
    setReleasingId(row.id);
    try {
      const { error } = await supabase
        .from("analysis_dead_letter")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          resolution_note: "Liberado manualmente para reanálise",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
      toast({
        title: "Empresa liberada",
        description: `${row.company_name} pode ser reanalisada. Reaplique as regras pelo PaymentDetail.`,
      });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao liberar", description: msg, variant: "destructive" });
    } finally {
      setReleasingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">Dead-letter — empresas com 3+ falhas</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{rows.length}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma empresa em dead-letter. Todas as análises estão saudáveis.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/pagamentos/${row.payment_id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.company_name}
                    </Link>
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                      {row.attempts} tentativas
                    </span>
                  </div>
                  {row.last_error && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">Último erro:</span> {row.last_error}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Atualizado: {new Date(row.updated_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                {canRelease && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => release(row)}
                    disabled={releasingId === row.id}
                    className="h-8 gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {releasingId === row.id ? "Liberando…" : "Liberar"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
