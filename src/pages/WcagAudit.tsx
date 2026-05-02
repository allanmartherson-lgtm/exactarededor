import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

type Violation = {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: { html: string; target: string[]; failureSummary: string }[];
};

type RouteResult = {
  route: string;
  theme: "light" | "dark";
  contrastViolations: Violation[];
  totalViolations: number;
};

const ROUTES = [
  "/",
  "/pagamentos",
  "/notas-fiscais",
  "/regras",
  "/empresas",
  "/centros-de-custo",
  "/usuarios",
  "/auditoria",
];

async function loadAxe(): Promise<any> {
  if ((window as any).axe) return (window as any).axe;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Falha ao carregar axe-core"));
    document.head.appendChild(s);
  });
  return (window as any).axe;
}

export default function WcagAudit() {
  const { setTheme } = useTheme();
  const [results, setResults] = useState<RouteResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");

  const run = async () => {
    setRunning(true);
    setResults([]);
    const axe = await loadAxe();
    const all: RouteResult[] = [];

    for (const theme of ["light", "dark"] as const) {
      setTheme(theme);
      await new Promise((r) => setTimeout(r, 200));

      for (const route of ROUTES) {
        setProgress(`${theme} – ${route}`);
        // Navega via history para não recarregar
        window.history.pushState({}, "", route);
        window.dispatchEvent(new PopStateEvent("popstate"));
        await new Promise((r) => setTimeout(r, 800));

        try {
          const res = await axe.run(document, {
            runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            resultTypes: ["violations"],
          });
          const contrast = res.violations.filter((v: any) =>
            v.id.includes("contrast") || v.id === "color-contrast"
          );
          all.push({
            route,
            theme,
            contrastViolations: contrast,
            totalViolations: res.violations.length,
          });
        } catch (e) {
          console.error(`axe falhou em ${route}`, e);
        }
      }
    }

    // Volta pra esta página
    window.history.pushState({}, "", "/wcag-audit");
    window.dispatchEvent(new PopStateEvent("popstate"));
    setResults(all);
    setRunning(false);
    setProgress("");
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = {
    light: results.filter((r) => r.theme === "light"),
    dark: results.filter((r) => r.theme === "dark"),
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Auditoria WCAG (axe-core)</h1>
        <p className="text-sm text-muted-foreground">
          Roda em todas as rotas principais nos modos claro e escuro. Foca em violações de contraste.
        </p>
      </header>

      {running && (
        <div className="rounded-md border bg-muted p-4 text-sm">
          Executando… {progress}
        </div>
      )}

      {!running && results.length > 0 && (
        <button
          onClick={() => void run()}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm"
        >
          Rodar novamente
        </button>
      )}

      {(["light", "dark"] as const).map((theme) => (
        <section key={theme} className="space-y-3">
          <h2 className="text-lg font-semibold capitalize">Tema {theme}</h2>
          {grouped[theme].length === 0 && !running && (
            <p className="text-sm text-muted-foreground">Sem dados.</p>
          )}
          {grouped[theme].map((r) => (
            <div key={`${theme}-${r.route}`} className="rounded-lg border p-4">
              <div className="flex justify-between items-center mb-2">
                <code className="text-sm font-mono">{r.route}</code>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    r.contrastViolations.length === 0
                      ? "bg-success-soft text-success"
                      : "bg-destructive-soft text-destructive"
                  }`}
                >
                  {r.contrastViolations.length} contraste · {r.totalViolations} total
                </span>
              </div>
              {r.contrastViolations.length > 0 && (
                <ul className="space-y-2 text-xs">
                  {r.contrastViolations.map((v) => (
                    <li key={v.id} className="border-l-2 border-destructive pl-2">
                      <strong>{v.id}</strong> ({v.impact}) — {v.help}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted-foreground">
                          {v.nodes.length} elemento(s)
                        </summary>
                        <ul className="mt-1 space-y-1 pl-3">
                          {v.nodes.slice(0, 5).map((n, i) => (
                            <li key={i} className="font-mono text-[11px] text-muted-foreground break-all">
                              <div className="text-foreground">{n.target.join(" ")}</div>
                              <div className="opacity-70">{n.failureSummary}</div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}