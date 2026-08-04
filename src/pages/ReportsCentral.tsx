import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { supabase } from "@/integrations/supabase/client";
import { logExport, printHtml, type ExportFormat } from "@/lib/exportLog";
import { toast } from "@/hooks/use-toast";
import {
  FileBarChart,
  Eye,
  Download,
  Printer,
  Search,
  BarChart2,
  Scale,
  
  ClipboardList,
  ShieldX,
  Activity,
  TrendingDown,
  TrendingUp,
  History,
  Split,
  LineChart,
} from "lucide-react";

type Role = "analista" | "validador" | "diretor" | "admin";

interface ReportSpec {
  key: string;
  label: string;
  description: string;
  route: string;
  category: "KPIs" | "Intervenções" | "Financeiro" | "Operação";
  icon: any;
  roles: Role[];
  /** Loader que retorna linhas + colunas para CSV/PDF. Opcional — sem ele, só Visualizar/Imprimir tela. */
  load?: (ctx: { hospitalId: string | null }) => Promise<{ columns: string[]; rows: Array<Record<string, any>> }>;
}

const fmtCell = (v: any) =>
  v === null || v === undefined
    ? ""
    : typeof v === "object"
    ? JSON.stringify(v)
    : String(v);

const toCsv = (columns: string[], rows: Array<Record<string, any>>) => {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = columns.map(esc).join(",");
  const body = rows.map((r) => columns.map((c) => esc(fmtCell(r[c]))).join(",")).join("\n");
  return `${head}\n${body}`;
};

const escHtml = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toHtmlTable = (columns: string[], rows: Array<Record<string, any>>) => {
  const head = `<tr>${columns.map((c) => `<th>${escHtml(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${escHtml(fmtCell(r[c]))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
};

const download = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/** Catálogo de relatórios disponíveis na Central. */
const REPORTS: ReportSpec[] = [
  {
    key: "kpis",
    label: "KPIs",
    description: "Indicadores gerais do hospital (volumes, valores e eficiência).",
    route: "/kpis",
    category: "KPIs",
    icon: BarChart2,
    roles: ["analista", "validador", "diretor", "admin"],
  },
  {
    key: "intervention-adjustments",
    label: "Ajustes por intervenção",
    description: "Economia gerada por todos os eventos que alteraram valores de pagamento.",
    route: "/relatorios/ajustes-intervencao",
    category: "Intervenções",
    icon: Scale,
    roles: ["diretor", "admin", "validador"],
  },
  {
    key: "intervention-audit",
    label: "Auditoria de intervenções",
    description: "Eventos detalhados (ajuste, cancelamento empresa/item) que alimentam o KPI.",
    route: "/relatorios/auditoria-intervencao",
    category: "Intervenções",
    icon: ClipboardList,
    roles: ["diretor", "admin", "validador"],
  },
  {
    key: "cancelled-payments",
    label: "Pagamentos cancelados",
    description: "Histórico de pagamentos e empresas cancelados no período.",
    route: "/relatorios/pagamentos-cancelados",
    category: "Operação",
    icon: ShieldX,
    roles: ["diretor", "admin", "validador", "analista"],
  },
  {
    key: "process-health",
    label: "Saúde do Processo",
    description: "Indicadores operacionais e produtividade.",
    route: "/saude-processo",
    category: "Operação",
    icon: Activity,
    roles: ["diretor", "admin"],
  },
  {
    key: "aging",
    label: "Contas a Pagar (Aging)",
    description: "Janela de vencimentos e composição de saldo a pagar.",
    route: "/recebiveis",
    category: "Financeiro",
    icon: TrendingDown,
    roles: ["diretor", "admin", "analista", "validador"],
  },
  {
    key: "financial-intelligence",
    label: "Inteligência Financeira",
    description: "DRE consolidado e visão financeira do hospital.",
    route: "/inteligencia-financeira",
    category: "Financeiro",
    icon: TrendingUp,
    roles: ["analista", "validador", "diretor", "admin"],
  },
  {
    key: "payment-evolution",
    label: "Evolução de Pagamentos por CC",
    description: "Série temporal e comparação mês a mês por centro de custo, com drill-down até o lote.",
    route: "/relatorios/evolucao-pagamentos",
    category: "Financeiro",
    icon: LineChart,
    roles: ["diretor", "admin", "analista", "validador"],
  },
  {
    key: "payments-by-specialty",
    label: "Pagamentos por especialidade / PJ",
    description: "Bruto e líquido por especialidade (cadastro do médico), grupo de análise, médico ou PJ.",
    route: "/relatorios/pagamentos-por-especialidade",
    category: "Financeiro",
    icon: LineChart,
    roles: ["diretor", "admin", "analista", "validador", "gestao_medica"],
  },
  {
    key: "pools",
    label: "Pools de rateio",
    description: "Distribuição de pools e participantes.",
    route: "/pools",
    category: "Financeiro",
    icon: Split,
    roles: ["diretor", "admin"],
    load: async ({ hospitalId }) => {
      const q = supabase.from("pools").select("id,name,kind,active,created_at");
      const { data, error } = hospitalId ? await q.eq("hospital_id", hospitalId) : await q;
      if (error) throw error;
      return {
        columns: ["id", "name", "kind", "active", "created_at"],
        rows: (data ?? []) as any,
      };
    },
  },
  {
    key: "audit-log",
    label: "Auditoria do sistema",
    description: "Log de ações sensíveis (admin / diretor).",
    route: "/auditoria",
    category: "Operação",
    icon: History,
    roles: ["diretor", "admin"],
  },
];

const CATEGORIES = ["KPIs", "Intervenções", "Financeiro", "Operação"] as const;

const ReportsCentral = () => {
  const navigate = useNavigate();
  const { roles: userRoles } = useAuth();
  const { hospital: currentHospital } = useHospital();
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const visible = useMemo(() => {
    const roles = (userRoles ?? []) as string[];
    return REPORTS.filter((r) => r.roles.some((rr) => roles.includes(rr))).filter((r) =>
      query.trim()
        ? r.label.toLowerCase().includes(query.toLowerCase()) ||
          r.description.toLowerCase().includes(query.toLowerCase())
        : true,
    );
  }, [userRoles, query]);

  const handleView = async (r: ReportSpec) => {
    await logExport({
      reportKey: r.key,
      reportLabel: r.label,
      format: "view",
      hospitalId: currentHospital?.id ?? null,
    });
    navigate(r.route);
  };

  const handleDownload = async (r: ReportSpec, format: Extract<ExportFormat, "csv" | "pdf" | "print">) => {
    if (!r.load) {
      // Sem loader local — encaminha para a tela do relatório.
      toast({
        title: "Disponível na tela do relatório",
        description: `Abrindo "${r.label}" — use o botão de exportação nativo.`,
      });
      await logExport({
        reportKey: r.key,
        reportLabel: r.label,
        format: "view",
        hospitalId: currentHospital?.id ?? null,
      });
      navigate(r.route);
      return;
    }
    try {
      setBusyKey(`${r.key}:${format}`);
      const { columns, rows } = await r.load({ hospitalId: currentHospital?.id ?? null });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

      if (format === "csv") {
        download(`${r.key}_${stamp}.csv`, toCsv(columns, rows), "text/csv;charset=utf-8");
      } else {
        // PDF e PRINT compartilham o mesmo HTML formatado; o navegador imprime/salva.
        const html = `<h1>${escHtml(r.label)}</h1>
<div class="meta">${escHtml(new Date().toLocaleString("pt-BR"))} · ${rows.length} linha(s) · Hospital: ${escHtml(
          currentHospital?.name ?? "—",
        )}</div>${toHtmlTable(columns, rows)}`;
        printHtml(r.label, html);
      }

      await logExport({
        reportKey: r.key,
        reportLabel: r.label,
        format,
        hospitalId: currentHospital?.id ?? null,
        rowCount: rows.length,
      });
      toast({ title: "Exportação concluída", description: `${r.label} — ${rows.length} linhas.` });
    } catch (e: any) {
      toast({
        title: "Falha ao exportar",
        description: e?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Central de Relatórios"
        description="Acesse, baixe ou imprima todos os relatórios do sistema em um só lugar."
        icon={FileBarChart}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/relatorios/auditoria-exportacoes")}>
            <History className="h-4 w-4 mr-1" /> Auditoria de exportações
          </Button>
        }
      />

      <div className="px-6">
        <div className="relative max-w-md">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar relatório..."
            className="pl-8"
          />
        </div>
      </div>

      <div className="px-6 space-y-6">
        {CATEGORIES.map((cat) => {
          const items = visible.filter((r) => r.category === cat);
          if (items.length === 0) return null;
          return (
            <section key={cat} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{cat}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((r) => {
                  const Icon = r.icon;
                  return (
                    <Card key={r.key} className="flex flex-col">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                              <Icon className="h-4 w-4" />
                            </span>
                            <CardTitle className="text-base">{r.label}</CardTitle>
                          </div>
                          {!r.load && (
                            <Badge variant="secondary" className="text-[10px]">
                              tela
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-1">{r.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="mt-auto pt-2">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="default" onClick={() => handleView(r)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Visualizar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey === `${r.key}:csv`}
                            onClick={() => handleDownload(r, "csv")}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> CSV
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey === `${r.key}:pdf`}
                            onClick={() => handleDownload(r, "pdf")}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyKey === `${r.key}:print`}
                            onClick={() => handleDownload(r, "print")}
                          >
                            <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum relatório encontrado.</p>
        )}
      </div>
    </div>
  );
};

export default ReportsCentral;
