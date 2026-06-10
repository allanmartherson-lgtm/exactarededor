import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { toast } from "sonner";

type Item = {
  id: string;
  batch_id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  procedure_date: string | null;
  doctor_name: string | null;
  doctor_crm: string | null;
  patient_name: string | null;
  valor_glosa: number;
  matched_company_id: string | null;
  matched_company_name: string | null;
  matched_payment_id: string | null;
  match_source: string | null;
};

type Group = {
  key: string;
  company_id: string;
  company_name: string;
  doctor_crm: string;
  doctor_name: string;
  items: Item[];
  total: number;
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ymdToLocalDate = (s: string): Date | null => {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  // Mantém o "dia" original quando possível (clamp ao último dia do mês alvo)
  const lastDayOfTarget = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), lastDayOfTarget));
  return r;
};

const fmtBR = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtComp = (d: Date) =>
  d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });

/** Divide o total em N parcelas em centavos, jogando o resíduo na última. */
function splitInstallments(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const rem = cents - base * n;
  return Array.from({ length: n }, (_, i) =>
    (base + (i === n - 1 ? rem : 0)) / 100,
  );
}



export default function PotentialDebtsPanel({
  reloadKey,
  onCreated,
}: {
  reloadKey?: number;
  onCreated?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modalGroup, setModalGroup] = useState<Group | null>(null);
  const [parcelas, setParcelas] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Pega itens vinculados que ainda não compõem nenhum débito.
    // Sem JOIN no PostgREST para "not exists" — buscamos os IDs já vinculados em
    // glosa_debt_items e filtramos client-side (volume é baixo neste painel).
    const [{ data: itemsRaw, error: e1 }, { data: linkedRaw, error: e2 }] =
      await Promise.all([
        (supabase as never as { from: (t: string) => { select: (q: string) => { eq: (k: string, v: string) => { not: (k: string, op: string, v: string | null) => { order: (k: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Item[] | null; error: { message: string } | null }> } } } } } }).from(
          "glosa_items",
        )
          .select(
            "id,batch_id,attendance_number,procedure_code,procedure_name,procedure_date,doctor_name,doctor_crm,patient_name,valor_glosa,matched_company_id,matched_company_name,matched_payment_id,match_source",
          )
          .eq("status", "vinculado")
          .not("matched_company_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000),
        (supabase as never as { from: (t: string) => { select: (q: string) => Promise<{ data: { glosa_item_id: string }[] | null; error: { message: string } | null }> } }).from(
          "glosa_debt_items",
        ).select("glosa_item_id"),
      ]);

    if (e1) {
      toast.error("Falha ao carregar débitos potenciais: " + e1.message);
      setGroups([]);
      setLoading(false);
      return;
    }
    if (e2) {
      toast.error("Falha ao carregar débitos existentes: " + e2.message);
      setGroups([]);
      setLoading(false);
      return;
    }

    const linkedSet = new Set((linkedRaw ?? []).map((r) => r.glosa_item_id));
    const items = (itemsRaw ?? []).filter((i) => !linkedSet.has(i.id));

    // Agrupa por (company_id, doctor_key)
    const map = new Map<string, Group>();
    for (const it of items) {
      const company_id = it.matched_company_id;
      if (!company_id) continue;
      const company_name = it.matched_company_name ?? "—";
      const doctor_crm = String(it.doctor_crm ?? "").trim();
      const doctor_name = String(it.doctor_name ?? "").trim();
      const doctorKey = doctor_crm || doctor_name;
      if (!doctorKey) continue;
      const key = `${company_id}::${doctorKey}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          company_id,
          company_name,
          doctor_crm,
          doctor_name,
          items: [],
          total: 0,
        };
        map.set(key, g);
      }
      g.items.push(it);
      g.total += Number(it.valor_glosa || 0);
    }
    const arr = Array.from(map.values()).sort((a, b) => b.total - a.total);
    setGroups(arr);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const totalGeral = useMemo(
    () => groups.reduce((acc, g) => acc + g.total, 0),
    [groups],
  );

  const openModal = (g: Group) => {
    setModalGroup(g);
    setParcelas(1);
    setStartDate("");
  };

  const confirmCreate = async () => {
    if (!modalGroup) return;
    if (parcelas < 1 || parcelas > 24) {
      toast.error("Parcelas devem estar entre 1 e 24.");
      return;
    }
    setBusy(true);
    const { data, error } = await (supabase as never as { rpc: (n: string, p: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string } | null }> }).rpc(
      "create_glosa_debt_with_items",
      {
        p_company_id: modalGroup.company_id,
        p_doctor_crm: modalGroup.doctor_crm || null,
        p_doctor_name: modalGroup.doctor_name,
        p_parcelas: parcelas,
        p_item_ids: modalGroup.items.map((i) => i.id),
      },
    );
    setBusy(false);
    if (error) {
      toast.error("Erro ao gerar débito: " + error.message);
      return;
    }
    toast.success(
      `Débito gerado em ${parcelas}× de ${brl(modalGroup.total / parcelas)}.`,
    );
    // Remove otimisticamente o grupo (e os itens dele) para evitar segundo
    // clique antes do reload terminar — defesa em profundidade junto com o
    // lock transacional no RPC.
    const removedKey = modalGroup.key;
    setGroups((prev) => prev.filter((g) => g.key !== removedKey));
    setModalGroup(null);
    void load();
    onCreated?.();
    void data;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Carregando débitos potenciais…
        </CardContent>
      </Card>
    );
  }
  if (groups.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                {groups.length}
              </Badge>
              Débitos potenciais — aguardando decisão do analista
            </div>
            <div className="text-sm font-normal text-muted-foreground">
              Total: <span className="font-semibold">{brl(totalGeral)}</span>
            </div>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Itens conciliados que ainda não viraram débito parcelado. O sistema
            não decide parcelamento sozinho — escolha caso a caso e confirme.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {groups.map((g) => {
            const open = !!expanded[g.key];
            return (
              <div
                key={g.key}
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    aria-label={open ? "Recolher itens" : "Expandir itens"}
                    onClick={() =>
                      setExpanded((s) => ({ ...s, [g.key]: !s[g.key] }))
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {open ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {g.company_name} ·{" "}
                      <span className="font-normal">
                        {g.doctor_name}
                        {g.doctor_crm ? ` (${g.doctor_crm})` : ""}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {g.items.length} glosa{g.items.length === 1 ? "" : "s"}{" "}
                      matched · Total {brl(g.total)}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openModal(g)}>
                    Gerar débito →
                  </Button>
                </div>
                {open && (
                  <div className="border-t border-border max-h-64 overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-medium">
                            Atendimento
                          </th>
                          <th className="text-left px-3 py-1.5 font-medium">
                            Procedimento
                          </th>
                          <th className="text-left px-3 py-1.5 font-medium">
                            Data
                          </th>
                          <th className="text-left px-3 py-1.5 font-medium">
                            Origem
                          </th>
                          <th className="text-right px-3 py-1.5 font-medium">
                            Valor glosa
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it) => (
                          <tr key={it.id} className="border-t border-border/60">
                            <td className="px-3 py-1.5">
                              {it.attendance_number ?? "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {it.procedure_code
                                ? `${it.procedure_code} — `
                                : ""}
                              {it.procedure_name ?? "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {it.procedure_date ?? "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              <Badge
                                variant="outline"
                                className="font-normal text-[10px]"
                              >
                                {it.match_source === "payment_item"
                                  ? "via pagamento"
                                  : "via cadastro"}
                              </Badge>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {brl(Number(it.valor_glosa))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog
        open={!!modalGroup}
        onOpenChange={(o) => {
          if (!o) setModalGroup(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={16} /> Gerar débito de glosa
            </DialogTitle>
            <DialogDescription>
              Confirme o parcelamento. Cada parcela será descontada nos próximos
              pagamentos da PJ.
            </DialogDescription>
          </DialogHeader>
          {modalGroup && (
            <div className="flex flex-col gap-4 py-2">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-semibold">{modalGroup.company_name}</div>
                <div className="text-muted-foreground">
                  {modalGroup.doctor_name}
                  {modalGroup.doctor_crm ? ` (${modalGroup.doctor_crm})` : ""}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {modalGroup.items.length} item
                  {modalGroup.items.length === 1 ? "" : "s"} · Total{" "}
                  <span className="font-semibold text-foreground">
                    {brl(modalGroup.total)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Parcelas (1–24)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    value={parcelas}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) {
                        setParcelas(Math.min(24, Math.max(1, n)));
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Início desconto
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </div>

              {(() => {
                const baseDate =
                  ymdToLocalDate(startDate) ??
                  (() => {
                    const t = new Date();
                    return new Date(t.getFullYear(), t.getMonth() + 1, 1);
                  })();
                const values = splitInstallments(modalGroup.total, parcelas);
                return (
                  <div className="rounded-md border border-border">
                    <div className="px-3 py-1.5 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                      <span>Prévia das parcelas</span>
                      <span>
                        {parcelas}× · {brl(modalGroup.total)}
                      </span>
                    </div>
                    <div className="max-h-44 overflow-auto">
                      <table className="w-full text-[12px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left px-3 py-1 font-medium w-10">#</th>
                            <th className="text-left px-3 py-1 font-medium">Competência</th>
                            <th className="text-left px-3 py-1 font-medium">Data estimada</th>
                            <th className="text-right px-3 py-1 font-medium">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {values.map((v, i) => {
                            const d = addMonths(baseDate, i);
                            return (
                              <tr key={i} className="border-t border-border/60">
                                <td className="px-3 py-1">{i + 1}</td>
                                <td className="px-3 py-1">{fmtComp(d)}</td>
                                <td className="px-3 py-1">{fmtBR(d)}</td>
                                <td className="px-3 py-1 text-right font-mono">
                                  {brl(v)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModalGroup(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={confirmCreate} disabled={busy}>
              {busy ? "Gerando…" : "Confirmar e gerar débito"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
