import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";

/**
 * Página manual de auditoria de overflow horizontal.
 *
 * Renderiza cada rota dentro de um <iframe> nas larguras alvo e mede
 * `documentElement.scrollWidth` vs `clientWidth`. Se houver overflow,
 * marca a combinação como falha e mostra os elementos que estouram.
 *
 * Uso: navegar para /diagnostico/overflow.
 */

const VIEWPORTS = [
  { label: "Mobile S", width: 320, height: 568 },
  { label: "Mobile M", width: 375, height: 812 },
  { label: "Mobile L", width: 414, height: 896 },
  { label: "Tablet", width: 768, height: 1024 },
  { label: "Laptop", width: 1280, height: 720 },
  { label: "Desktop", width: 1536, height: 864 },
  { label: "Full HD", width: 1920, height: 1080 },
];

const DEFAULT_ROUTES = [
  "/",
  "/pagamentos",
  "/notas-fiscais",
  "/kpis",
  "/empresas",
  "/medicos",
  "/centros-de-custo",
  "/regras",
  "/tabelas",
  "/usuarios",
  "/auditoria",
];

type Result = {
  route: string;
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
  overflow: boolean;
  offenders: string[];
  status: "pending" | "ok" | "fail" | "error";
  error?: string;
};

const offenderSelector = (doc: Document, viewportWidth: number): string[] => {
  const out: string[] = [];
  const all = doc.body.querySelectorAll<HTMLElement>("*");
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    if (r.right > viewportWidth + 1 && r.width > 0) {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string"
        ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
        : "";
      out.push(`${el.tagName.toLowerCase()}${id}${cls} (right=${Math.round(r.right)})`);
      if (out.length >= 5) break;
    }
  }
  return out;
};

const Cell = ({
  result,
  onMeasured,
}: {
  result: Result;
  onMeasured: (r: Result) => void;
}) => {
  const ref = useRef<HTMLIFrameElement>(null);

  const handleLoad = () => {
    const iframe = ref.current;
    if (!iframe) return;
    try {
      // Same-origin: o iframe carrega a própria preview.
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) throw new Error("iframe doc indisponível");
      // Aguarda 1 frame para garantir layout final.
      win.requestAnimationFrame(() => {
        const sw = doc.documentElement.scrollWidth;
        const cw = doc.documentElement.clientWidth;
        const overflow = sw > cw + 1;
        onMeasured({
          ...result,
          scrollWidth: sw,
          clientWidth: cw,
          overflow,
          offenders: overflow ? offenderSelector(doc, cw) : [],
          status: overflow ? "fail" : "ok",
        });
      });
    } catch (e: any) {
      onMeasured({
        ...result,
        status: "error",
        error: e?.message ?? "erro ao medir",
      });
    }
  };

  return (
    <div className="rounded-md border border-border overflow-hidden bg-muted/20">
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] bg-muted/50">
        <span className="font-mono">{result.width}×{result.height}</span>
        {result.status === "ok" && (
          <Badge variant="outline" className="text-success-foreground border-success/40 bg-success/10">
            <CheckCircle2 className="h-3 w-3 mr-1" /> sem overflow
          </Badge>
        )}
        {result.status === "fail" && (
          <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/10">
            <XCircle className="h-3 w-3 mr-1" /> overflow {result.scrollWidth - result.clientWidth}px
          </Badge>
        )}
        {result.status === "error" && (
          <Badge variant="outline" className="text-warning-foreground border-warning/40 bg-warning/10">
            erro
          </Badge>
        )}
        {result.status === "pending" && (
          <Badge variant="outline">medindo…</Badge>
        )}
      </div>
      <iframe
        ref={ref}
        title={`${result.route} @ ${result.width}`}
        src={result.route}
        onLoad={handleLoad}
        style={{
          width: result.width,
          height: 220,
          border: 0,
          display: "block",
          // Escala visual para caber no grid sem afetar a medição (medimos no doc real).
          transform: result.width > 520 ? `scale(${520 / result.width})` : undefined,
          transformOrigin: "top left",
        }}
      />
      {result.status === "fail" && result.offenders.length > 0 && (
        <ul className="px-2 py-1 text-[10px] font-mono text-destructive bg-destructive/5 border-t border-destructive/20 max-h-24 overflow-auto">
          {result.offenders.map((o, i) => (
            <li key={i} className="truncate" title={o}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

const OverflowAudit = () => {
  const [routesText, setRoutesText] = useState(DEFAULT_ROUTES.join("\n"));
  const [runId, setRunId] = useState(0);
  const routes = useMemo(
    () => routesText.split("\n").map((r) => r.trim()).filter(Boolean),
    [routesText],
  );
  const initial = useMemo<Result[]>(
    () =>
      routes.flatMap((route) =>
        VIEWPORTS.map((v) => ({
          route,
          width: v.width,
          height: v.height,
          scrollWidth: 0,
          clientWidth: 0,
          overflow: false,
          offenders: [],
          status: "pending" as const,
        })),
      ),
    [routes, runId],
  );
  const [results, setResults] = useState<Result[]>(initial);
  useEffect(() => setResults(initial), [initial]);

  const update = (r: Result) =>
    setResults((prev) =>
      prev.map((x) => (x.route === r.route && x.width === r.width ? r : x)),
    );

  const totals = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria de overflow horizontal</h1>
          <p className="text-sm text-muted-foreground">
            Renderiza cada rota em iframes nas larguras alvo e checa
            <code className="mx-1">scrollWidth &gt; clientWidth</code>.
            Combinações em vermelho têm scroll horizontal indevido.
          </p>
        </div>
        <Button onClick={() => setRunId((n) => n + 1)} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" /> Re-executar
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Rotas testadas (uma por linha)</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={routesText}
            onChange={(e) => setRoutesText(e.target.value)}
            className="hidden"
          />
          <textarea
            value={routesText}
            onChange={(e) => setRoutesText(e.target.value)}
            className="w-full font-mono text-xs border border-border rounded-md p-2 bg-background min-h-[120px]"
          />
          <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
            <span>OK: <strong className="text-success-foreground">{totals.ok ?? 0}</strong></span>
            <span>· Falhas: <strong className="text-destructive">{totals.fail ?? 0}</strong></span>
            <span>· Pendentes: <strong>{totals.pending ?? 0}</strong></span>
            {totals.error ? <span>· Erros: <strong className="text-warning-foreground">{totals.error}</strong></span> : null}
          </div>
        </CardContent>
      </Card>

      {routes.map((route) => {
        const rowResults = results.filter((r) => r.route === route);
        const failed = rowResults.some((r) => r.status === "fail");
        return (
          <Card key={route} className={failed ? "border-destructive/40" : undefined}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                {failed ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-success-foreground" />
                )}
                {route}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {rowResults.map((r) => (
                  <Cell key={`${route}-${r.width}-${runId}`} result={r} onMeasured={update} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default OverflowAudit;
