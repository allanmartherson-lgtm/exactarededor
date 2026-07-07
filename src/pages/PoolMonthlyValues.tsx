import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Save, AlertTriangle, Paperclip, Download, X } from "lucide-react";
import { toast } from "sonner";

type Pool = { id: string; nome: string; hospital_id: string };
type Deduction = { id: string; descricao: string; tipo: string; valor_variavel: boolean };
type ValueRow = {
  id?: string;
  pool_deduction_id: string;
  competence_month: string; // YYYY-MM-01
  valor: number | null;
  observacao: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
};
type Run = { id: string; competence_month: string | null; invalidated_at: string | null; invalidated_reason: string | null };

const BUCKET = "pool-deduction-attachments";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Lista os últimos 12 meses + 3 futuros, como 'YYYY-MM-01'. */
function buildCompetenceList(): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setDate(1);
  for (let i = 12; i >= -3; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

const fmtCompetence = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
};

export default function PoolMonthlyValues() {
  const { id: poolId } = useParams<{ id: string }>();
  const [pool, setPool] = useState<Pool | null>(null);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [values, setValues] = useState<Record<string, ValueRow>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const competencies = useMemo(() => buildCompetenceList(), []);

  const cellKey = (dedId: string, comp: string) => `${dedId}|${comp}`;

  const load = async () => {
    if (!poolId) return;
    setLoading(true);
    const [pRes, dRes, vRes, rRes] = await Promise.all([
      supabase.from("pools").select("id, nome, hospital_id").eq("id", poolId).maybeSingle(),
      supabase.from("pool_deductions").select("id, descricao, tipo, valor_variavel").eq("pool_id", poolId).eq("valor_variavel", true).order("ordem"),
      supabase.from("pool_deduction_values").select("*").eq("pool_id", poolId),
      supabase.from("pool_calculation_runs").select("id, competence_month, invalidated_at, invalidated_reason").eq("pool_id", poolId),
    ]);
    setPool((pRes.data as any) ?? null);
    setDeductions((dRes.data as any) ?? []);
    const map: Record<string, ValueRow> = {};
    for (const v of (vRes.data as any[]) ?? []) {
      map[cellKey(v.pool_deduction_id, String(v.competence_month).slice(0, 10))] = v as ValueRow;
    }
    setValues(map);
    setRuns(((rRes.data as any[]) ?? []).filter((r) => r.competence_month));
    setLoading(false);
    setDirty(new Set());
  };

  useEffect(() => { load(); }, [poolId]);

  const runByCompetence = useMemo(() => {
    const m = new Map<string, Run>();
    for (const r of runs) if (r.competence_month) m.set(String(r.competence_month).slice(0, 10), r);
    return m;
  }, [runs]);

  const setCell = (dedId: string, comp: string, patch: Partial<ValueRow>) => {
    const k = cellKey(dedId, comp);
    setValues((prev) => ({
      ...prev,
      [k]: {
        ...(prev[k] ?? { pool_deduction_id: dedId, competence_month: comp, valor: null, observacao: null }),
        ...patch,
      },
    }));
    setDirty((prev) => new Set(prev).add(k));
  };

  const save = async () => {
    if (!poolId) return;
    if (!pool?.hospital_id) { toast.error("Pool sem hospital vinculado"); return; }
    const ups: any[] = [];
    for (const k of dirty) {
      const v = values[k];
      if (!v) continue;
      if (v.valor === null || Number.isNaN(Number(v.valor))) continue;
      ups.push({
        id: v.id,
        hospital_id: pool.hospital_id,
        pool_id: poolId,
        pool_deduction_id: v.pool_deduction_id,
        competence_month: v.competence_month,
        valor: Number(v.valor),
        observacao: v.observacao,
      });
    }
    if (!ups.length) { toast.info("Nada para salvar"); return; }
    const { error } = await supabase.from("pool_deduction_values").upsert(ups, {
      onConflict: "pool_deduction_id,competence_month",
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${ups.length} valor(es) salvo(s). Runs afetados foram marcados para recalcular.`);
    load();
  };

  const uploadAttachment = async (row: ValueRow | undefined, dedId: string, comp: string, file: File) => {
    if (!poolId) return;
    // garante que existe registro (precisa do id para vincular o arquivo de forma estável)
    let valueId = row?.id;
    if (!valueId) {
      if (!pool?.hospital_id) { toast.error("Pool sem hospital vinculado"); return; }
      const { data, error } = await supabase.from("pool_deduction_values").upsert({
        hospital_id: pool.hospital_id,
        pool_id: poolId,
        pool_deduction_id: dedId,
        competence_month: comp,
        valor: row?.valor ?? 0,
        observacao: row?.observacao ?? null,
      }, { onConflict: "pool_deduction_id,competence_month" }).select("id").maybeSingle();
      if (error || !data) { toast.error(error?.message || "Falha ao criar registro"); return; }
      valueId = data.id;
    }
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
    const path = `${poolId}/${dedId}/${comp}/${valueId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { toast.error(upErr.message); return; }
    const { data: userData } = await supabase.auth.getUser();
    const { error: updErr } = await supabase.from("pool_deduction_values").update({
      attachment_path: path,
      attachment_name: file.name,
      attachment_size: file.size,
      attachment_mime: file.type,
      attachment_uploaded_at: new Date().toISOString(),
      attachment_uploaded_by: userData.user?.id ?? null,
    }).eq("id", valueId);
    if (updErr) { toast.error(updErr.message); return; }
    toast.success("Anexo enviado");
    load();
  };

  const downloadAttachment = async (path: string, name: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data) { toast.error(error?.message || "Falha"); return; }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = name;
    a.target = "_blank";
    a.click();
  };

  const removeAttachment = async (row: ValueRow) => {
    if (!row.id || !row.attachment_path) return;
    if (!confirm("Remover anexo?")) return;
    await supabase.storage.from(BUCKET).remove([row.attachment_path]);
    const { error } = await supabase.from("pool_deduction_values").update({
      attachment_path: null, attachment_name: null, attachment_size: null,
      attachment_mime: null, attachment_uploaded_at: null, attachment_uploaded_by: null,
    }).eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Anexo removido");
    load();
  };

  if (loading) return <div className="p-6">Carregando…</div>;
  if (!pool) return <div className="p-6">Pool não encontrado.</div>;

  if (deductions.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title={`Valores mensais — ${pool.nome}`} description="Nenhuma dedução está marcada como 'valor variável'." />
        <Button asChild variant="outline"><Link to="/pools"><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Valores mensais — ${pool.nome}`}
        description="Cadastre o valor de cada dedução variável por competência. Alterações invalidam runs já calculados do mês."
      />

      <div className="flex justify-between gap-2">
        <Button asChild variant="outline"><Link to="/pools"><ArrowLeft className="w-4 h-4 mr-1" /> Voltar para pools</Link></Button>
        <Button onClick={save} disabled={dirty.size === 0}>
          <Save className="w-4 h-4 mr-1" /> Salvar {dirty.size > 0 ? `(${dirty.size})` : ""}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {deductions.length} dedução(ões) variável(is) · {competencies.length} competências
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Competência</TableHead>
                {deductions.map((d) => (
                  <TableHead key={d.id} className="min-w-[260px]">{d.descricao || d.tipo}</TableHead>
                ))}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...competencies].reverse().map((comp) => {
                const run = runByCompetence.get(comp);
                return (
                  <TableRow key={comp}>
                    <TableCell className="font-medium sticky left-0 bg-background">{fmtCompetence(comp)}</TableCell>
                    {deductions.map((d) => {
                      const v = values[cellKey(d.id, comp)];
                      const isDirty = dirty.has(cellKey(d.id, comp));
                      return (
                        <TableCell key={d.id} className={isDirty ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="R$"
                              value={v?.valor ?? ""}
                              onChange={(e) => setCell(d.id, comp, { valor: e.target.value === "" ? null : parseFloat(e.target.value) })}
                              className="h-8"
                            />
                            <Input
                              placeholder="Observação (ex: 12 plantões)"
                              value={v?.observacao ?? ""}
                              onChange={(e) => setCell(d.id, comp, { observacao: e.target.value || null })}
                              className="h-7 text-xs"
                            />
                            {v?.valor !== null && v?.valor !== undefined && (
                              <span className="text-xs text-muted-foreground">{brl(Number(v.valor))}</span>
                            )}
                            <div className="flex items-center gap-1">
                              {v?.attachment_path ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs flex-1 min-w-0"
                                    onClick={() => downloadAttachment(v.attachment_path!, v.attachment_name || "anexo")}
                                    title={v.attachment_name || ""}
                                  >
                                    <Download className="w-3 h-3 mr-1 shrink-0" />
                                    <span className="truncate">{v.attachment_name || "anexo"}</span>
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeAttachment(v)}>
                                    <X className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : (
                                <label className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-pointer hover:text-foreground">
                                  <Paperclip className="w-3 h-3" /> Anexar escala
                                  <input
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) uploadAttachment(v, d.id, comp, f);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {run?.invalidated_at ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="w-3 h-3" /> Recalcular
                        </Badge>
                      ) : run ? (
                        <Badge variant="default">Calculado</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
