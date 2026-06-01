import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowRight, Building2, Search, Shield } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LogRow {
  id: string;
  user_id: string;
  user_email: string | null;
  old_hospital_id: string | null;
  new_hospital_id: string;
  old_hospital_name: string | null;
  new_hospital_name: string | null;
  user_agent: string | null;
  switched_at: string;
}

/**
 * Auditoria de troca de hospital — visível para admin/diretor.
 * Rastreia QUEM trocou, DE/PARA qual hospital e QUANDO.
 */
export default function HospitalSwitchLog() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("hospital_switch_log" as never)
        .select("*")
        .order("switched_at", { ascending: false })
        .limit(500);
      if (mounted) {
        if (error) console.error(error);
        setRows(((data ?? []) as unknown) as LogRow[]);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = rows.filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (r.user_email ?? "").toLowerCase().includes(q) ||
      (r.new_hospital_name ?? "").toLowerCase().includes(q) ||
      (r.old_hospital_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria de troca de hospital"
        description="Histórico de qual usuário acessou cada hospital, quando e a partir de qual estava antes."
        icon={Shield}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base">Trocas recentes</CardTitle>
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar por usuário ou hospital..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum registro de troca encontrado.
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-4 p-4 hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{r.user_email ?? r.user_id.slice(0, 8)}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {r.user_id.slice(0, 8)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {r.old_hospital_name ?? <span className="italic text-muted-foreground">—</span>}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-primary font-medium">
                        <Building2 className="h-3 w-3" />
                        {r.new_hospital_name ?? r.new_hospital_id.slice(0, 8)}
                      </span>
                    </div>
                    {r.user_agent && (
                      <p className="mt-1 text-[10px] text-muted-foreground truncate max-w-[600px]">
                        {r.user_agent}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    <div>{new Date(r.switched_at).toLocaleString("pt-BR")}</div>
                    <div className="mt-0.5 text-[10px]">
                      {formatDistanceToNow(new Date(r.switched_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
