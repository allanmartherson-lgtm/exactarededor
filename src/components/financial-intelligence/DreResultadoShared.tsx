import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, AlertCircle, ChevronRight, ExternalLink } from "lucide-react";

export type DreRow = {
  competencia: string;
  company_id: string;
  company_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  bruto: number;
  debitos: number;
  creditos: number;
  glosas: number;
  pool: number;
  liquido: number;
  payments_count: number;
};

export type OpenRow = {
  payment_id: string;
  reference: string;
  status: string;
  company_name: string | null;
  competencia: string;
  bruto: number;
  liquido: number;
  age_days: number;
  aging_bucket: string;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);

const bucketColor: Record<string, string> = {
  "0-15": "bg-green-100 text-green-800",
  "16-30": "bg-yellow-100 text-yellow-800",
  "31-60": "bg-orange-100 text-orange-800",
  "60+": "bg-red-100 text-red-800",
};

export function useDreData() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dre, setDre] = useState<DreRow[]>([]);
  const [open, setOpen] = useState<OpenRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [dreRes, openRes] = (await Promise.all([
      supabase.rpc("get_dre_consolidated" as never, {
        p_competencia_from: from || null,
        p_competencia_to: to || null,
        p_company_id: null,
        p_doctor_id: null,
      } as never),
      supabase.rpc("get_open_position" as never, { p_company_id: null } as never),
    ])) as unknown as [{ data: DreRow[] | null; error: unknown }, { data: OpenRow[] | null; error: unknown }];
    if (dreRes.error) console.error("get_dre_consolidated error", dreRes.error);
    if (openRes.error) console.error("get_open_position error", openRes.error);
    setDre(dreRes.error || !dreRes.data ? [] : dreRes.data);
    setOpen(openRes.error || !openRes.data ? [] : openRes.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { from, setFrom, to, setTo, dre, open, loading, load };
}

export function DreFilters({
  from,
  setFrom,
  to,
  setTo,
  loading,
  onReload,
}: {
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  loading: boolean;
  onReload: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filtros</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label>Competência de</Label>
          <Input
            type="month"
            value={from.slice(0, 7)}
            onChange={(e) => setFrom(e.target.value ? `${e.target.value}-01` : "")}
          />
        </div>
        <div>
          <Label>Competência até</Label>
          <Input
            type="month"
            value={to.slice(0, 7)}
            onChange={(e) => setTo(e.target.value ? `${e.target.value}-01` : "")}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={onReload} disabled={loading} className="w-full">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DreKpis({ dre, open }: { dre: DreRow[]; open: OpenRow[] }) {
  const totalBruto = dre.reduce((s, r) => s + Number(r.bruto), 0);
  const totalGlosas = dre.reduce((s, r) => s + Number(r.glosas), 0);
  const totalLiquido = dre.reduce((s, r) => s + Number(r.liquido), 0);
  const totalAberto = open.reduce((s, r) => s + Number(r.liquido), 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Bruto</CardTitle></CardHeader>
        <CardContent className="text-xl font-bold">{fmt(totalBruto)}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Glosas</CardTitle></CardHeader>
        <CardContent className="text-xl font-bold text-red-600">{fmt(totalGlosas)}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-green-600">Líquido</CardTitle></CardHeader>
        <CardContent className="text-xl font-bold text-green-600">{fmt(totalLiquido)}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-orange-600">Em aberto</CardTitle></CardHeader>
        <CardContent className="text-xl font-bold text-orange-600">{fmt(totalAberto)}</CardContent>
      </Card>
    </div>
  );
}

export function DreConsolidadoSection({ dre }: { dre: DreRow[] }) {
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<Array<{
    payment_id: string; reference: string; status: string; created_at: string;
    bruto: number; debitos: number; creditos: number; glosas: number; pool: number; liquido: number; items_count: number;
  }>>([]);

  const openDrill = async (row: DreRow) => {
    setDrillOpen(true);
    setDrillLoading(true);
    const label = [
      new Date(row.competencia).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }),
      row.company_name ?? "—",
      row.doctor_name ?? null,
    ].filter(Boolean).join(" · ");
    setDrillTitle(label);
    const { data, error } = await supabase.rpc("get_dre_drilldown" as never, {
      p_competencia: row.competencia,
      p_company_id: row.company_id,
      p_doctor_id: row.doctor_id,
    } as never);
    if (error) console.error("get_dre_drilldown error", error);
    if (!error && data) setDrillRows(data as unknown as typeof drillRows);
    else setDrillRows([]);
    setDrillLoading(false);
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competência</TableHead>
                <TableHead>PJ</TableHead>
                <TableHead>Médico</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Débitos</TableHead>
                <TableHead className="text-right">Créditos</TableHead>
                <TableHead className="text-right">Glosas</TableHead>
                <TableHead className="text-right">Pool</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dre.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Sem dados no período.</TableCell></TableRow>
              ) : dre.map((r, i) => (
                <TableRow key={i} onClick={() => openDrill(r)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-xs">{new Date(r.competencia).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}</TableCell>
                  <TableCell>{r.company_name ?? "—"}</TableCell>
                  <TableCell>{r.doctor_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(r.bruto)}</TableCell>
                  <TableCell className="text-right text-red-600">{fmt(r.debitos)}</TableCell>
                  <TableCell className="text-right text-green-600">{fmt(r.creditos)}</TableCell>
                  <TableCell className="text-right text-red-600">{fmt(r.glosas)}</TableCell>
                  <TableCell className="text-right">{fmt(r.pool)}</TableCell>
                  <TableCell className="text-right font-bold">
                    <span className="inline-flex items-center gap-1">{fmt(r.liquido)}<ChevronRight className="h-3 w-3 text-muted-foreground" /></span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Drill-down — {drillTitle}</DialogTitle>
          </DialogHeader>
          {drillLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : drillRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sem pagamentos para este recorte.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Glosas</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drillRows.map((d) => (
                  <TableRow key={d.payment_id}>
                    <TableCell className="font-mono text-xs">{d.reference}</TableCell>
                    <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                    <TableCell className="text-right">{d.items_count}</TableCell>
                    <TableCell className="text-right">{fmt(d.bruto)}</TableCell>
                    <TableCell className="text-right text-red-600">{fmt(d.glosas)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(d.liquido)}</TableCell>
                    <TableCell>
                      <Link to={`/pagamentos/${d.payment_id}`} className="text-primary inline-flex items-center gap-1 text-xs">
                        Abrir <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PosicaoAbertoSection({ open }: { open: OpenRow[] }) {
  const agingSummary = open.reduce<Record<string, { count: number; valor: number }>>((acc, r) => {
    if (!acc[r.aging_bucket]) acc[r.aging_bucket] = { count: 0, valor: 0 };
    acc[r.aging_bucket].count++;
    acc[r.aging_bucket].valor += Number(r.liquido);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {["0-15", "16-30", "31-60", "60+"].map((b) => (
          <Card key={b}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${bucketColor[b]}`}>{b} dias</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">{fmt(agingSummary[b]?.valor ?? 0)}</div>
              <div className="text-xs text-muted-foreground">{agingSummary[b]?.count ?? 0} pagamentos</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referência</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>PJ</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Idade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="inline h-4 w-4 mr-2" />Nenhum pagamento em aberto.
                </TableCell></TableRow>
              ) : open.slice(0, 100).map((r) => (
                <TableRow key={r.payment_id}>
                  <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell>{r.company_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(r.competencia).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(r.liquido)}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded text-xs ${bucketColor[r.aging_bucket]}`}>{r.age_days}d</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
