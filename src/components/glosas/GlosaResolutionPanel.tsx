import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Debt = {
  id: string;
  doctor_crm: string | null;
  doctor_name: string;
  total_debt: number;
  resolution_status: string;
  resolution_reason: string | null;
  company_id: string | null;
  parcelas_default: number | null;
};

type Company = { id: string; name: string };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const reasonLabel = (r: string | null) => {
  switch (r) {
    case "sem_pj_vinculada": return "Médico sem PJ vinculada";
    case "multiplas_pjs": return "Médico com múltiplas PJs";
    case "crm_nao_encontrado": return "CRM não encontrado no cadastro";
    default: return r ?? "—";
  }
};

export default function GlosaResolutionPanel() {
  const [pendentes, setPendentes] = useState<Debt[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selections, setSelections] = useState<Record<string, { company_id?: string; parcelas: number }>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: ds }, { data: cs }] = await Promise.all([
      (supabase as any)
        .from("glosa_debts")
        .select("id, doctor_crm, doctor_name, total_debt, resolution_status, resolution_reason, company_id, parcelas_default")
        .eq("status", "ativo")
        .eq("resolution_status", "pendente_resolucao")
        .order("total_debt", { ascending: false }),
      supabase.from("companies").select("id, name").order("name"),
    ]);
    setPendentes(ds ?? []);
    setCompanies((cs ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resolve = async (debt: Debt) => {
    const sel = selections[debt.id];
    if (!sel?.company_id) {
      toast.error("Selecione a PJ para vincular.");
      return;
    }
    setBusyId(debt.id);
    const { error } = await (supabase as any).rpc("link_glosa_to_company", {
      _debt_id: debt.id,
      _company_id: sel.company_id,
      _parcelas: sel.parcelas ?? 12,
    });
    setBusyId(null);
    if (error) {
      toast.error("Erro ao vincular: " + error.message);
      return;
    }
    toast.success("Glosa vinculada à PJ.");
    load();
  };

  const retry = async (debt: Debt) => {
    setBusyId(debt.id);
    const { error } = await (supabase as any).rpc("resolve_glosa_to_company", { _debt_id: debt.id });
    setBusyId(null);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    load();
  };

  if (loading) return null;
  if (pendentes.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
          <Badge variant="outline" className="border-amber-500 text-amber-700">{pendentes.length}</Badge>
          Glosas pendentes de vínculo com PJ
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Glosa é por médico, mas o pagamento é PJ→PJ. Resolva o vínculo abaixo para que a parcela entre nos próximos lotes da empresa.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Médico</TableHead>
              <TableHead>CRM</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Vincular à PJ</TableHead>
              <TableHead>Parcelas</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendentes.map((d) => {
              const sel = selections[d.id] ?? { parcelas: d.parcelas_default ?? 12 };
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.doctor_name}</TableCell>
                  <TableCell className="text-xs">{d.doctor_crm ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{reasonLabel(d.resolution_reason)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{brl(Number(d.total_debt))}</TableCell>
                  <TableCell>
                    <Select
                      value={sel.company_id ?? ""}
                      onValueChange={(v) =>
                        setSelections((s) => ({ ...s, [d.id]: { ...sel, company_id: v } }))
                      }
                    >
                      <SelectTrigger className="w-64"><SelectValue placeholder="Escolher PJ…" /></SelectTrigger>
                      <SelectContent>
                        {companies.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min={1} max={60} className="w-20"
                      value={sel.parcelas}
                      onChange={(e) =>
                        setSelections((s) => ({ ...s, [d.id]: { ...sel, parcelas: Number(e.target.value) || 12 } }))
                      }
                    />
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" disabled={busyId === d.id} onClick={() => resolve(d)}>
                      Vincular
                    </Button>
                    {d.resolution_reason === "crm_nao_encontrado" && (
                      <Button size="sm" variant="ghost" disabled={busyId === d.id} onClick={() => retry(d)}>
                        Tentar de novo
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
