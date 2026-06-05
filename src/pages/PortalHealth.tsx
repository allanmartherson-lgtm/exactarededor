/**
 * Painel "Saúde dos Portais"
 *
 * Mostra todos os vínculos de portal (médico/empresa) com seu estado:
 *  - ok           → usuário, alvo e ativo
 *  - orphan_user  → sem auth.users (perdeu o login, reseed/exclusão)
 *  - orphan_target → médico/empresa apagado
 *  - inactive     → vínculo desativado manualmente
 *
 * Botão "Auto-reparar" chama a RPC `repair_portal_links()` que religa
 * por e-mail qualquer órfão cujo auth.users tenha sido recriado.
 *
 * Fonte: view public.portal_links_health (camada 1 da blindagem).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldOff, UserX } from "lucide-react";

type Row = {
  id: string;
  portal_type: "doctor" | "company";
  email: string | null;
  active: boolean;
  link_health: "ok" | "orphan_user" | "orphan_target" | "inactive";
  target_id: string | null;
  target_name: string | null;
  user_id: string | null;
  created_at: string;
  accepted_at: string | null;
};

const HEALTH_LABEL: Record<Row["link_health"], { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ok: { label: "OK", tone: "bg-emerald-500/15 text-emerald-700", icon: CheckCircle2 },
  orphan_user: { label: "Sem usuário", tone: "bg-destructive/15 text-destructive", icon: UserX },
  orphan_target: { label: "Sem cadastro", tone: "bg-amber-500/15 text-amber-700", icon: AlertTriangle },
  inactive: { label: "Inativo", tone: "bg-muted text-muted-foreground", icon: ShieldOff },
};

export default function PortalHealth() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("portal_links_health" as never)
      .select("*")
      .order("link_health", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as unknown as Row[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const s = { total: rows.length, ok: 0, orphan_user: 0, orphan_target: 0, inactive: 0 };
    rows.forEach((r) => {
      s[r.link_health]++;
    });
    return s;
  }, [rows]);

  const problems = rows.filter((r) => r.link_health !== "ok");

  const repair = async () => {
    setRepairing(true);
    const { data, error } = await supabase.rpc("repair_portal_links" as never);
    setRepairing(false);
    if (error) {
      toast({ title: "Falha no reparo", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { doctor_fixed: number; company_fixed: number; doctor_remaining: number; company_remaining: number };
    toast({
      title: "Reparo concluído",
      description: `Religados: ${r.doctor_fixed} médico(s) + ${r.company_fixed} empresa(s). Restam ${r.doctor_remaining + r.company_remaining} sem auto-correção.`,
    });
    void load();
  };

  const filter = (type: Row["portal_type"]) => problems.filter((r) => r.portal_type === type);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde dos Portais"
        description="Monitora vínculos de médico e empresa com o sistema de login. Atualizações de dados nunca devem deixar usuários sem acesso — esta tela detecta e repara."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button onClick={repair} disabled={repairing || stats.orphan_user === 0}>
              {repairing ? "Reparando..." : "Auto-reparar órfãos"}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="OK" value={stats.ok} tone="text-emerald-600" />
        <StatCard label="Sem usuário" value={stats.orphan_user} tone="text-destructive" />
        <StatCard label="Sem cadastro" value={stats.orphan_target} tone="text-amber-600" />
        <StatCard label="Inativos" value={stats.inactive} tone="text-muted-foreground" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vínculos com problema</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="doctor">
            <TabsList>
              <TabsTrigger value="doctor">Médicos ({filter("doctor").length})</TabsTrigger>
              <TabsTrigger value="company">Empresas ({filter("company").length})</TabsTrigger>
            </TabsList>
            <TabsContent value="doctor">
              <ProblemTable rows={filter("doctor")} loading={loading} />
            </TabsContent>
            <TabsContent value="company">
              <ProblemTable rows={filter("company")} loading={loading} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ProblemTable({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) return <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>;
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        Nenhum vínculo com problema.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Estado</TableHead>
          <TableHead>E-mail</TableHead>
          <TableHead>Vinculado a</TableHead>
          <TableHead>Criado em</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const meta = HEALTH_LABEL[r.link_health];
          const Icon = meta.icon;
          return (
            <TableRow key={r.id}>
              <TableCell>
                <Badge variant="outline" className={meta.tone}>
                  <Icon className="h-3 w-3 mr-1" />
                  {meta.label}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.email ?? "—"}</TableCell>
              <TableCell>{r.target_name ?? <span className="text-muted-foreground italic">cadastro apagado</span>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString("pt-BR")}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
