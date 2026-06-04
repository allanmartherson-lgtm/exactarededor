import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, EyeOff } from "lucide-react";

export interface HospitalRowLite {
  company: string;
  attendance: string;
  code: string;
  doctor: string;
  qty: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalRows: HospitalRowLite[];
  companyMapping: Record<string, string | null>;
  matchLevels: Record<string, "exact" | "high" | "medium" | null>;
  hospitalCompanies: string[];
  onConfirm: () => void;
}

export function PreReconciliationReport({
  open,
  onOpenChange,
  hospitalRows,
  companyMapping,
  matchLevels,
  hospitalCompanies,
  onConfirm,
}: Props) {
  const buckets = useMemo(() => {
    const unmatched: { company: string; rows: number; attendances: Set<string> }[] = [];
    const ignored: { company: string; rows: number; attendances: Set<string> }[] = [];
    const linkedConfirmed: string[] = [];
    const linkedPending: string[] = []; // sugestões medium não confirmadas

    for (const c of hospitalCompanies) {
      const mapped = companyMapping[c];
      const level = matchLevels[c];
      if (!mapped) {
        // distingue: explicitamente ignorado vs sem match auto
        const bucket = level === null && c in matchLevels ? unmatched : unmatched; // both fall into unmatched if no map
        // heurística: se nunca houve match (level=null) → unmatched; usuário pode escolher Ignorar e mantém level null
        // Sem flag explícita, contamos como unmatched.
        bucket.push({ company: c, rows: 0, attendances: new Set() });
      } else if (level === "medium") {
        linkedPending.push(c);
      } else {
        linkedConfirmed.push(c);
      }
    }

    // contabiliza linhas hospitalares por empresa não vinculada
    const byCompany = new Map<string, { rows: number; attendances: Set<string> }>();
    for (const r of hospitalRows) {
      const k = r.company;
      if (!byCompany.has(k)) byCompany.set(k, { rows: 0, attendances: new Set() });
      const e = byCompany.get(k)!;
      e.rows += 1;
      if (r.attendance) e.attendances.add(r.attendance);
    }
    for (const u of unmatched) {
      const e = byCompany.get(u.company);
      if (e) {
        u.rows = e.rows;
        u.attendances = e.attendances;
      }
    }

    const totalLostRows = unmatched.reduce((s, u) => s + u.rows, 0);
    const totalLostAttendances = new Set<string>();
    unmatched.forEach((u) => u.attendances.forEach((a) => totalLostAttendances.add(a)));

    return {
      unmatched,
      ignored,
      linkedConfirmed,
      linkedPending,
      totalLostRows,
      totalLostAttendances: totalLostAttendances.size,
    };
  }, [hospitalCompanies, companyMapping, matchLevels, hospitalRows]);

  const exportCsv = () => {
    const lines: string[] = ["status;empresa_hospital;linhas_planilha;atendimentos_unicos"];
    for (const u of buckets.unmatched) {
      lines.push(`sem_match;"${u.company.replace(/"/g, '""')}";${u.rows};${u.attendances.size}`);
    }
    for (const u of buckets.ignored) {
      lines.push(`ignorado;"${u.company.replace(/"/g, '""')}";${u.rows};${u.attendances.size}`);
    }
    for (const c of buckets.linkedPending) {
      lines.push(`sugestao_pendente;"${c.replace(/"/g, '""')}";;`);
    }
    for (const c of buckets.linkedConfirmed) {
      lines.push(`vinculado;"${c.replace(/"/g, '""')}";;`);
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio_pre_conciliacao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Relatório pré-conciliação
          </DialogTitle>
          <DialogDescription>
            Revise empresas que ficarão fora do cruzamento antes de processar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Totais */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-border rounded-lg p-3 bg-muted/30">
              <p className="text-[10px] uppercase text-muted-foreground">Vinculadas</p>
              <p className="text-xl font-bold text-success">{buckets.linkedConfirmed.length}</p>
            </div>
            <div className="border border-warning/30 rounded-lg p-3 bg-warning/5">
              <p className="text-[10px] uppercase text-muted-foreground">Sugestões pendentes</p>
              <p className="text-xl font-bold text-warning-foreground">{buckets.linkedPending.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">não entram</p>
            </div>
            <div className="border border-destructive/30 rounded-lg p-3 bg-destructive/5">
              <p className="text-[10px] uppercase text-muted-foreground">Sem match / Ignoradas</p>
              <p className="text-xl font-bold text-destructive">{buckets.unmatched.length + buckets.ignored.length}</p>
            </div>
          </div>

          <div className="border border-destructive/30 rounded-lg p-3 bg-destructive/5">
            <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5" />
              Itens hospitalares que ficarão fora do cruzamento
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              <strong className="text-foreground">{buckets.totalLostRows}</strong> linha(s) da planilha hospitalar ·{" "}
              <strong className="text-foreground">{buckets.totalLostAttendances}</strong> atendimento(s) único(s).
              Estes itens não serão comparados com o Exacta — não gerarão "divergente" nem "só hospital".
            </p>
          </div>

          {buckets.unmatched.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1.5">Empresas do hospital sem empresa Exacta vinculada</p>
              <div className="border border-border rounded-lg max-h-[200px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Empresa hospital</th>
                      <th className="text-right px-2 py-1.5 font-medium">Linhas</th>
                      <th className="text-right px-2 py-1.5 font-medium">Atendimentos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.unmatched
                      .sort((a, b) => b.rows - a.rows)
                      .map((u) => (
                        <tr key={u.company} className="border-t border-border">
                          <td className="px-2 py-1.5 truncate max-w-[360px]" title={u.company}>
                            {u.company}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{u.rows}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{u.attendances.size}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {buckets.linkedPending.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1.5 text-warning-foreground">
                Sugestões pendentes (clique em "Confirmar" antes para incluir)
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-[120px] overflow-y-auto">
                {buckets.linkedPending.map((c) => (
                  <li key={c} className="truncate" title={c}>• {c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Voltar e ajustar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Confirmar e conciliar mesmo assim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
