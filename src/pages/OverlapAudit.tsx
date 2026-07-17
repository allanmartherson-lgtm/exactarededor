/**
 * Painel de auditoria de sobreposição assistencial.
 *
 * Consulta autônoma sobre payment_items do hospital ativo: identifica
 * mesmo paciente + mesmo dia + ≥2 especialidades distintas em lançamentos
 * de visita/parecer. Não depende da regra ter rodado no lote.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { MultiSelectPopover, type MultiSelectOption } from "@/components/ui/MultiSelectPopover";
import { toast } from "sonner";
import {
  Download, PlayCircle, ExternalLink,
} from "lucide-react";
import {
  useOverlapAudit,
  type OverlapAuditResult,
  type OverlapItemScope,
  type SpecialtyMode,
} from "@/hooks/useOverlapAudit";
import { exportOverlapAuditExcel } from "@/lib/overlapAuditReport";
import { formatCurrency } from "@/lib/status";

// Especialidades sugeridas para exclusão. Analista pode adicionar outras
// digitando (mas mantemos uma lista fixa útil no dropdown).
const COMMON_SPECS: MultiSelectOption[] = [
  { value: "infectologia", label: "Infectologia" },
  { value: "clinica medica", label: "Clínica Médica" },
  { value: "medicina intensiva", label: "Medicina Intensiva" },
  { value: "cuidados paliativos", label: "Cuidados Paliativos" },
  { value: "anestesiologia", label: "Anestesiologia" },
];

const today = () => new Date().toISOString().slice(0, 10);
const nDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export default function OverlapAudit() {
  const [start, setStart] = useState(nDaysAgo(90));
  const [end, setEnd] = useState(today());
  const [itemScope, setItemScope] = useState<OverlapItemScope>("both");
  const [minDistinct, setMinDistinct] = useState(2);
  const [specialtyMode, setSpecialtyMode] = useState<SpecialtyMode>("primary");
  const [excludedSpecs, setExcludedSpecs] = useState<string[]>(["infectologia"]);
  const [data, setData] = useState<OverlapAuditResult | null>(null);
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);

  const audit = useOverlapAudit();

  const run = () => {
    if (start > end) {
      toast.error("Data inicial não pode ser posterior à final.");
      return;
    }
    audit.mutate(
      { start, end, itemScope, minDistinct, specialtyMode, excludedSpecs },
      {
        onSuccess: (res) => {
          setData(res);
          if (res.totals.patients === 0) {
            toast.info("Nenhuma sobreposição encontrada na janela.");
          } else {
            toast.success(
              `${res.totals.patients} paciente(s) com sobreposição em ${res.totals.days} dia(s).`,
            );
          }
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`Falha ao consultar: ${msg}`);
        },
      },
    );
  };

  const handleExport = () => {
    if (!data) return;
    exportOverlapAuditExcel(data);
  };

  const patientDrill = useMemo(() => {
    if (!data || !expandedPatient) return [];
    return data.by_attendance.filter(
      (a) => (a.patient_name ?? "").trim() === expandedPatient.trim(),
    );
  }, [data, expandedPatient]);

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6 space-y-6">
      <PageHeader
        title="Sobreposição assistencial"
        description="Auditoria autônoma de mesmo paciente + mesmo dia + ≥2 especialidades em visitas ou pareceres."
      />

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros da busca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label>Início</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fim</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tipo de item</Label>
              <Select value={itemScope} onValueChange={(v) => setItemScope(v as OverlapItemScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Visita + Parecer</SelectItem>
                  <SelectItem value="visita">Somente Visita</SelectItem>
                  <SelectItem value="parecer">Somente Parecer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mín. especialidades distintas</Label>
              <Input
                type="number"
                min={2}
                max={6}
                value={minDistinct}
                onChange={(e) => setMinDistinct(Math.max(2, Number(e.target.value) || 2))}
              />
            </div>
            <div className="space-y-1">
              <Label>Especialidade a considerar</Label>
              <Select value={specialtyMode} onValueChange={(v) => setSpecialtyMode(v as SpecialtyMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Principal (1ª do médico)</SelectItem>
                  <SelectItem value="any">Qualquer especialidade</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Especialidades a ignorar</Label>
              <MultiSelectPopover
                options={COMMON_SPECS}
                values={excludedSpecs}
                onChange={setExcludedSpecs}
                placeholder="Nenhuma"
                allLabel={
                  excludedSpecs.length === 0
                    ? "Nenhuma"
                    : `${excludedSpecs.length} selecionada(s)`
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!data || audit.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar Excel
            </Button>
            <Button onClick={run} disabled={audit.isPending}>
              <PlayCircle className="w-4 h-4 mr-2" />
              {audit.isPending ? "Buscando…" : "Rodar auditoria"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {audit.isPending && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}
      {data && !audit.isPending && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Pacientes" value={String(data.totals.patients)} />
          <KpiCard label="Dias" value={String(data.totals.days)} />
          <KpiCard label="Atendimentos" value={String(data.totals.attendances)} />
          <KpiCard label="Lançamentos" value={String(data.totals.items)} />
        </div>
      )}

      {/* Card 1 — combinações */}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Combinações de especialidades ({data.by_specialty_combo.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.by_specialty_combo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma combinação encontrada.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Combinação</TableHead>
                      <TableHead className="text-right">Pacientes</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead className="text-right">Atendimentos</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead>Último dia</TableHead>
                      <TableHead>Exemplos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_specialty_combo.map((r) => {
                      const combo = r.combo_label ?? "—";
                      const isMesma = combo.includes(" + ")
                        ? combo.split(" + ").length !==
                          new Set(combo.split(" + ").map((s) => s.trim())).size
                        : false;
                      return (
                        <TableRow key={r.combo_key}>
                          <TableCell className="font-medium">
                            {combo}
                            {isMesma && (
                              <Badge className="ml-2" variant="secondary">
                                Mesma especialidade
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{r.patients}</TableCell>
                          <TableCell className="text-right">{r.days}</TableCell>
                          <TableCell className="text-right">{r.attendances}</TableCell>
                          <TableCell className="text-right">{r.items}</TableCell>
                          <TableCell>{fmtDate(r.last_day)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                            {(r.sample_attendances ?? []).slice(0, 5).join(", ")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card 2 — pacientes */}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Pacientes com mais dias em sobreposição ({data.by_patient.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.by_patient.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem pacientes na janela.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead className="text-right">Atendimentos</TableHead>
                      <TableHead>Especialidades</TableHead>
                      <TableHead>Último dia</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_patient.map((p) => {
                      const isOpen = expandedPatient === p.patient_name;
                      return (
                        <>
                          <TableRow key={p.patient_key}>
                            <TableCell className="font-medium">{p.patient_name}</TableCell>
                            <TableCell className="text-right">{p.days}</TableCell>
                            <TableCell className="text-right">{p.attendances}</TableCell>
                            <TableCell className="text-xs">
                              {(p.specialties ?? []).map((s) => (
                                <Badge key={s} variant="outline" className="mr-1 mb-1">{s}</Badge>
                              ))}
                            </TableCell>
                            <TableCell>{fmtDate(p.last_day)}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setExpandedPatient(isOpen ? null : p.patient_name)
                                }
                              >
                                {isOpen ? "Ocultar" : "Ver dias"}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {isOpen && patientDrill.length > 0 && (
                            <TableRow key={`${p.patient_key}-drill`}>
                              <TableCell colSpan={6} className="bg-muted/30">
                                <div className="p-2 space-y-2">
                                  {patientDrill.map((d, idx) => (
                                    <div key={idx} className="flex flex-wrap gap-2 text-xs items-center">
                                      <Badge variant="secondary">{fmtDate(d.pdate)}</Badge>
                                      <span className="text-muted-foreground">Atendimentos:</span>
                                      <span>{(d.attendances ?? []).join(", ") || "—"}</span>
                                      <span className="text-muted-foreground">| Médicos:</span>
                                      <span>{(d.doctors ?? []).join(", ")}</span>
                                      <span className="text-muted-foreground">| Especialidades:</span>
                                      <span>{(d.specialties ?? []).join(" + ")}</span>
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card 3 — atendimentos */}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Atendimentos com sobreposição no mesmo dia ({data.by_attendance.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.by_attendance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum atendimento encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Atendimentos</TableHead>
                      <TableHead>Médicos</TableHead>
                      <TableHead>Especialidades</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead className="text-right">Valor pago</TableHead>
                      <TableHead>Lotes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_attendance.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDate(r.pdate)}</TableCell>
                        <TableCell className="font-medium">{r.patient_name}</TableCell>
                        <TableCell className="text-xs">
                          {(r.attendances ?? []).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(r.doctors ?? []).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(r.specialties ?? []).join(" + ")}
                        </TableCell>
                        <TableCell className="text-right">{r.items}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(r.total_gross ?? 0))}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {(r.payment_ids ?? []).slice(0, 3).map((pid) => (
                              <Link
                                key={pid}
                                to={`/pagamentos/${pid}`}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Lote
                              </Link>
                            ))}
                            {(r.payment_ids ?? []).length > 3 && (
                              <span className="text-muted-foreground">
                                +{(r.payment_ids ?? []).length - 3}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!data && !audit.isPending && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Ajuste os filtros e clique em <strong>Rodar auditoria</strong> para começar.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
