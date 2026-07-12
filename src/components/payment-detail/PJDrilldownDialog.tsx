import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import { toast } from "@/hooks/use-toast";
import { FileText, Layers, ListChecks } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  companyId: string;
  companyName: string;
};

type Invoice = {
  id: string;
  invoice_number: string | null;
  expected_amount: number;
  received_amount: number | null;
  status: string;
  sent_at: string | null;
  received_at: string | null;
};

type Application = {
  id: string;
  status: string;
  source: string;
  valor_aplicado: number;
  parcela_numero: number;
  applied_at: string;
  confirmed_at: string | null;
  reverted_at: string | null;
  postpone_reason: string | null;
  resolution_note: string | null;
  glosa_debt_id: string;
  doctor_name: string | null;
  doctor_crm: string | null;
  glosa_total: number | null;
  glosa_origem: string | null;
};

type Snapshot = {
  bruto: number;
  glosas: number;
  debitos: number;
  creditos: number;
  liquido: number;
} | null;

type GroupRow = {
  company_name: string;
  bruto_total: number;
  liquido_total: number;
  items_count: number | null;
};

const APP_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  confirmado: { label: "Confirmado", className: "border-success/60 text-success" },
  proposto: { label: "Proposto", className: "border-primary/60 text-primary" },
  pending_manual_resolution: { label: "Pendência manual", className: "border-warning/60 text-warning" },
  postponed: { label: "Postergado", className: "border-muted-foreground/40 text-muted-foreground" },
  partial: { label: "Parcial", className: "border-warning/60 text-warning" },
  revertido: { label: "Revertido", className: "border-destructive/60 text-destructive" },
};

const INV_STATUS_LABEL: Record<string, string> = {
  aguardando: "Aguardando",
  enviada: "Enviada",
  recebida: "Recebida",
  aprovada: "Aprovada",
  paga: "Paga",
  cancelada: "Cancelada",
};

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function PJDrilldownDialog({ open, onOpenChange, paymentId, companyId, companyName }: Props) {
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [group, setGroup] = useState<GroupRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [invRes, snapRes, grpRes, appsRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, invoice_number, expected_amount, received_amount, status, sent_at, received_at")
          .eq("payment_id", paymentId)
          .eq("company_id", companyId)
          .neq("status", "cancelada")
          .order("created_at", { ascending: true }),
        supabase
          .from("payment_company_financials")
          .select("bruto, glosas, debitos, creditos, liquido")
          .eq("payment_id", paymentId)
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("payment_company_groups")
          .select("company_name, bruto_total, liquido_total, items_count")
          .eq("payment_id", paymentId)
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("glosa_payment_applications")
          .select(
            "id, status, source, valor_aplicado, parcela_numero, applied_at, confirmed_at, reverted_at, postpone_reason, resolution_note, glosa_debt_id, glosa_debts(doctor_name, doctor_crm, total_debt, origem)"
          )
          .eq("payment_id", paymentId)
          .eq("company_id", companyId)
          .order("applied_at", { ascending: false }),
      ]);

      if (invRes.error) throw invRes.error;
      if (snapRes.error) throw snapRes.error;
      if (grpRes.error) throw grpRes.error;
      if (appsRes.error) throw appsRes.error;

      setInvoices(
        (invRes.data || []).map((i) => ({
          ...i,
          expected_amount: Number(i.expected_amount || 0),
          received_amount: i.received_amount === null ? null : Number(i.received_amount),
        })),
      );
      setSnapshot(
        snapRes.data
          ? {
              bruto: Number(snapRes.data.bruto || 0),
              glosas: Number(snapRes.data.glosas || 0),
              debitos: Number(snapRes.data.debitos || 0),
              creditos: Number(snapRes.data.creditos || 0),
              liquido: Number(snapRes.data.liquido || 0),
            }
          : null,
      );
      setGroup(
        grpRes.data
          ? {
              company_name: grpRes.data.company_name,
              bruto_total: Number(grpRes.data.bruto_total || 0),
              liquido_total: Number(grpRes.data.liquido_total || 0),
              items_count: grpRes.data.items_count,
            }
          : null,
      );
      setApps(
        (appsRes.data || []).map((a: any) => ({
          id: a.id,
          status: a.status,
          source: a.source,
          valor_aplicado: Number(a.valor_aplicado || 0),
          parcela_numero: a.parcela_numero,
          applied_at: a.applied_at,
          confirmed_at: a.confirmed_at,
          reverted_at: a.reverted_at,
          postpone_reason: a.postpone_reason,
          resolution_note: a.resolution_note,
          glosa_debt_id: a.glosa_debt_id,
          doctor_name: a.glosa_debts?.doctor_name ?? null,
          doctor_crm: a.glosa_debts?.doctor_crm ?? null,
          glosa_total: a.glosa_debts?.total_debt !== undefined ? Number(a.glosa_debts.total_debt) : null,
          glosa_origem: a.glosa_debts?.origem ?? null,
        })),
      );
    } catch (e: any) {
      console.error(e);
      toast({ title: "Falha ao carregar detalhamento", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId, companyId]);

  const totalApps = apps.reduce((a, b) => a + (b.status === "revertido" ? 0 : b.valor_aplicado), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1100px,96vw)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{companyName}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Detalhamento linha a linha do pedido de nota, snapshot financeiro e aplicações efetivamente lançadas neste lote.
          </p>
        </DialogHeader>

        <Tabs defaultValue="snapshot" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="snapshot" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Snapshot ({snapshot ? formatCurrency(snapshot.liquido) : "—"})
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Pedido de nota ({invoices.length})
            </TabsTrigger>
            <TabsTrigger value="apps" className="gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Aplicações ({apps.length})
            </TabsTrigger>
          </TabsList>

          {/* SNAPSHOT */}
          <TabsContent value="snapshot" className="flex-1 overflow-auto mt-3">
            {loading ? (
              <p className="text-sm text-muted-foreground p-4">Carregando…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Bruto</div>
                    <div className="font-semibold">{snapshot ? formatCurrency(snapshot.bruto) : "—"}</div>
                  </div>
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Glosas</div>
                    <div className="font-semibold text-destructive">
                      {snapshot ? formatCurrency(snapshot.glosas) : "—"}
                    </div>
                  </div>
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Débitos</div>
                    <div className="font-semibold">{snapshot ? formatCurrency(snapshot.debitos) : "—"}</div>
                  </div>
                  <div className="rounded border p-3">
                    <div className="text-xs text-muted-foreground">Créditos</div>
                    <div className="font-semibold text-success">
                      {snapshot ? formatCurrency(snapshot.creditos) : "—"}
                    </div>
                  </div>
                  <div className="rounded border p-3 bg-muted/40">
                    <div className="text-xs text-muted-foreground">Líquido</div>
                    <div className="font-semibold">{snapshot ? formatCurrency(snapshot.liquido) : "—"}</div>
                  </div>
                </div>

                <div className="rounded border p-3 text-sm">
                  <div className="font-semibold mb-2">Referência do grupo (produção)</div>
                  {group ? (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Bruto grupo</div>
                        <div>{formatCurrency(group.bruto_total)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Líquido grupo</div>
                        <div>{formatCurrency(group.liquido_total)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Itens no grupo</div>
                        <div>{group.items_count ?? "—"}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem grupo cadastrado para esta PJ no lote.</p>
                  )}
                </div>

                {snapshot && (
                  <div className="rounded border p-3 text-xs text-muted-foreground">
                    Fórmula do snapshot: <strong>Líquido = Bruto − Glosas − Débitos + Créditos</strong> ={" "}
                    {formatCurrency(snapshot.bruto)} − {formatCurrency(snapshot.glosas)} −{" "}
                    {formatCurrency(snapshot.debitos)} + {formatCurrency(snapshot.creditos)} ={" "}
                    <strong>{formatCurrency(snapshot.liquido)}</strong>
                    {Math.abs(snapshot.glosas - apps.filter((a) => a.status === "confirmado").reduce((s, a) => s + a.valor_aplicado, 0)) > 0.01 && (
                      <div className="text-warning mt-1">
                        ⚠ Glosas do snapshot ({formatCurrency(snapshot.glosas)}) ≠ soma das aplicações confirmadas (
                        {formatCurrency(
                          apps.filter((a) => a.status === "confirmado").reduce((s, a) => s + a.valor_aplicado, 0),
                        )}
                        ).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* INVOICES */}
          <TabsContent value="invoices" className="flex-1 overflow-auto mt-3">
            {loading ? (
              <p className="text-sm text-muted-foreground p-4">Carregando…</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">Nenhuma NF cadastrada para esta PJ.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 border-b">Nº NF</th>
                    <th className="p-2 border-b text-right">Esperado</th>
                    <th className="p-2 border-b text-right">Recebido</th>
                    <th className="p-2 border-b">Status</th>
                    <th className="p-2 border-b">Enviada em</th>
                    <th className="p-2 border-b">Recebida em</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const diverges =
                      i.received_amount !== null && Math.abs(i.received_amount - i.expected_amount) > 0.01;
                    return (
                      <tr key={i.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-mono">{i.invoice_number || "—"}</td>
                        <td className="p-2 text-right">{formatCurrency(i.expected_amount)}</td>
                        <td className={"p-2 text-right " + (diverges ? "text-warning font-semibold" : "")}>
                          {i.received_amount === null ? "—" : formatCurrency(i.received_amount)}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline">{INV_STATUS_LABEL[i.status] ?? i.status}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{fmtDate(i.sent_at)}</td>
                        <td className="p-2 text-muted-foreground">{fmtDate(i.received_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/60 font-semibold">
                  <tr>
                    <td className="p-2">TOTAL ({invoices.length})</td>
                    <td className="p-2 text-right">
                      {formatCurrency(invoices.reduce((a, i) => a + i.expected_amount, 0))}
                    </td>
                    <td className="p-2 text-right">
                      {formatCurrency(invoices.reduce((a, i) => a + (i.received_amount || 0), 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            )}
          </TabsContent>

          {/* APPLICATIONS */}
          <TabsContent value="apps" className="flex-1 overflow-auto mt-3">
            {loading ? (
              <p className="text-sm text-muted-foreground p-4">Carregando…</p>
            ) : apps.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">Nenhuma aplicação lançada para esta PJ neste lote.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 border-b">Médico</th>
                    <th className="p-2 border-b">CRM</th>
                    <th className="p-2 border-b">Origem glosa</th>
                    <th className="p-2 border-b text-right">Valor aplicado</th>
                    <th className="p-2 border-b text-right">Parcela</th>
                    <th className="p-2 border-b">Status</th>
                    <th className="p-2 border-b">Fonte</th>
                    <th className="p-2 border-b">Aplicado em</th>
                    <th className="p-2 border-b">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => {
                    const meta = APP_STATUS_LABEL[a.status] ?? { label: a.status, className: "" };
                    const obs = a.postpone_reason || a.resolution_note || "";
                    return (
                      <tr key={a.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-medium">{a.doctor_name || "—"}</td>
                        <td className="p-2 font-mono text-muted-foreground">{a.doctor_crm || "—"}</td>
                        <td className="p-2 text-muted-foreground">{a.glosa_origem || "—"}</td>
                        <td
                          className={
                            "p-2 text-right font-semibold " +
                            (a.status === "revertido" ? "line-through text-muted-foreground" : "text-destructive")
                          }
                        >
                          {formatCurrency(a.valor_aplicado)}
                        </td>
                        <td className="p-2 text-right">{a.parcela_numero}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={meta.className}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{a.source}</td>
                        <td className="p-2 text-muted-foreground">{fmtDate(a.applied_at)}</td>
                        <td className="p-2 text-muted-foreground max-w-[240px] truncate" title={obs}>
                          {obs || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/60 font-semibold">
                  <tr>
                    <td className="p-2" colSpan={3}>
                      TOTAL líquido (excl. revertidas)
                    </td>
                    <td className="p-2 text-right text-destructive">{formatCurrency(totalApps)}</td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
