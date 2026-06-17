import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHospital } from "@/contexts/HospitalContext";

type Row = {
  group_id: string;
  payment_id: string | null;
  company_id: string | null;
  status: string | null;
  bruto_pedido_total: number;
  bruto_regra_total: number;
  diferenca: number;
  diferenca_pct: number | null;
  itens_total: number | null;
  itens_sem_regra: number | null;
  itens_divergentes: number | null;
  company_name?: string | null;
  payment_reference?: string | null;
  released?: boolean;
};

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function BlockingDivergencesTab() {
  const navigate = useNavigate();
  const { currentHospital } = useHospital();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [thresholds, setThresholds] = useState({ block_pct: 0.5, block_abs: 1.0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: cfg } = await supabase
        .from("system_configurations")
        .select("value")
        .eq("key", "divergence_thresholds")
        .maybeSingle();
      const v = (cfg?.value ?? {}) as Record<string, unknown>;
      const t = {
        block_pct: Number(v.group_block_pct ?? 0.5),
        block_abs: Number(v.group_block_abs ?? 1.0),
      };
      if (!cancelled) setThresholds(t);

      let q = supabase
        .from("vw_group_rule_totals")
        .select("*")
        .limit(500);
      if (currentHospital?.id) q = q.eq("hospital_id", currentHospital.id);
      const { data } = await q;
      const all = ((data ?? []) as Row[]).filter((r) => {
        const diff = Math.abs(Number(r.diferenca ?? 0));
        const pct = Math.abs(Number(r.diferenca_pct ?? 0));
        return diff > t.block_abs && pct > t.block_pct;
      });

      const groupIds = all.map((r) => r.group_id);
      const paymentIds = Array.from(new Set(all.map((r) => r.payment_id).filter(Boolean))) as string[];
      const companyIds = Array.from(new Set(all.map((r) => r.company_id).filter(Boolean))) as string[];

      const [{ data: payments }, { data: companies }, { data: overrides }] = await Promise.all([
        paymentIds.length
          ? supabase.from("payments").select("id,reference").in("id", paymentIds)
          : Promise.resolve({ data: [] as { id: string; reference: string | null }[] }),
        companyIds.length
          ? supabase.from("companies").select("id,nome").in("id", companyIds)
          : Promise.resolve({ data: [] as { id: string; nome: string | null }[] }),
        groupIds.length
          ? supabase
              .from("payment_group_reconciliation_overrides")
              .select("group_id,bruto_regra_snapshot,bruto_pedido_snapshot")
              .in("group_id", groupIds)
          : Promise.resolve({ data: [] as { group_id: string; bruto_regra_snapshot: number; bruto_pedido_snapshot: number }[] }),
      ]);

      const refMap = new Map((payments ?? []).map((p) => [p.id, p.reference]));
      const nameMap = new Map((companies ?? []).map((c) => [c.id, c.nome]));
      const ovMap = new Map<string, Array<{ r: number; p: number }>>();
      for (const o of (overrides ?? []) as { group_id: string; bruto_regra_snapshot: number; bruto_pedido_snapshot: number }[]) {
        const arr = ovMap.get(o.group_id) ?? [];
        arr.push({ r: Number(o.bruto_regra_snapshot), p: Number(o.bruto_pedido_snapshot) });
        ovMap.set(o.group_id, arr);
      }

      const enriched = all.map((r) => ({
        ...r,
        payment_reference: r.payment_id ? refMap.get(r.payment_id) ?? null : null,
        company_name: r.company_id ? nameMap.get(r.company_id) ?? null : null,
        released: (ovMap.get(r.group_id) ?? []).some(
          (o) =>
            Math.abs(o.r - Number(r.bruto_regra_total ?? 0)) < 0.01 &&
            Math.abs(o.p - Number(r.bruto_pedido_total ?? 0)) < 0.01,
        ),
      }));

      if (!cancelled) {
        setRows(enriched);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentHospital?.id]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (r.company_name ?? "").toLowerCase().includes(s) ||
      (r.payment_reference ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Grupos cujo bruto do pedido difere do bruto calculado pela regra acima da tolerância
        ({thresholds.block_pct}% ou {fmt(thresholds.block_abs)}). Liberações com justificativa
        aparecem como "Liberado".
      </p>
      <Input
        placeholder="Buscar por empresa ou nº do pagamento…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="md:max-w-sm"
      />

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pagamento</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead className="text-right">Bruto pedido</TableHead>
              <TableHead className="text-right">Bruto regra</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Sem regra</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  Nenhuma divergência bloqueante encontrada.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filtered.map((r) => (
                <TableRow
                  key={r.group_id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => r.payment_id && navigate(`/pagamentos/${r.payment_id}`)}
                >
                  <TableCell className="font-medium">{r.payment_reference ?? "—"}</TableCell>
                  <TableCell>{r.company_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(Number(r.bruto_pedido_total))}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(Number(r.bruto_regra_total))}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">
                    {fmt(Number(r.diferenca))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(r.diferenca_pct ?? 0).toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.itens_sem_regra ?? 0}</TableCell>
                  <TableCell>
                    {r.released ? (
                      <Badge className="gap-1 bg-amber-600 hover:bg-amber-600">
                        <ShieldCheck className="h-3 w-3" /> Liberado
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Bloqueado
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
