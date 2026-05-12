import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

const RELOAD_FLAG_KEY = "medpay-chunk-error-reloaded";

/**
 * Detecta falhas de carregamento de módulos dinâmicos (code-splitting).
 * Padrões cobertos:
 * - Vite: "Failed to fetch dynamically imported module"
 * - Webpack/Rollup: "Loading chunk N failed"
 * - Network/CORS: "error loading dynamically imported module"
 */
function isDynamicImportError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (err as { message?: string } | null)?.message ?? "";
  if (!msg) return false;
  return (
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /loading chunk \d+ failed/i.test(msg) ||
    /importing a module script failed/i.test(msg)
  );
}

/**
 * ErrorBoundary global — captura tanto erros de renderização (React) quanto
 * falhas assíncronas de importação dinâmica (chunks/code-splitting), evitando
 * a tela em branco quando uma rota lazy não consegue carregar.
 *
 * Quando detecta erro de chunk pela 1ª vez, faz reload automático (cenário
 * típico após deploy: o HTML aponta para um hash de chunk que não existe
 * mais). Se mesmo após o reload o erro reaparecer, mostra a tela amigável.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      isChunkError: isDynamicImportError(error),
    };
  }

  componentDidMount() {
    window.addEventListener("unhandledrejection", this.handleRejection);
    window.addEventListener("error", this.handleWindowError);
  }

  componentWillUnmount() {
    window.removeEventListener("unhandledrejection", this.handleRejection);
    window.removeEventListener("error", this.handleWindowError);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info);
    this.maybeAutoReload(error);
  }

  private handleRejection = (event: PromiseRejectionEvent) => {
    if (!isDynamicImportError(event.reason)) return;
    event.preventDefault();
    const err =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason ?? "Falha ao carregar módulo"));
    console.error("[ErrorBoundary] Dynamic import rejection:", err);
    this.setState({ hasError: true, error: err, isChunkError: true });
    this.maybeAutoReload(err);
  };

  private handleWindowError = (event: ErrorEvent) => {
    if (!isDynamicImportError(event.error ?? event.message)) return;
    event.preventDefault();
    const err =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || "Falha ao carregar módulo");
    console.error("[ErrorBoundary] Dynamic import error:", err);
    this.setState({ hasError: true, error: err, isChunkError: true });
    this.maybeAutoReload(err);
  };

  /**
   * Em erro de chunk (geralmente deploy novo invalidou o hash antigo), tenta
   * 1 reload automático. Se o flag já estiver setado, não recarrega de novo
   * para evitar loop — mostra a tela amigável.
   */
  private maybeAutoReload(error: Error) {
    if (!isDynamicImportError(error)) return;
    try {
      const already = sessionStorage.getItem(RELOAD_FLAG_KEY);
      if (already) return;
      sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
      window.location.reload();
    } catch {
      // Se sessionStorage falhar, segue exibindo o fallback sem reload.
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  reload = () => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const { isChunkError, error } = this.state;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            {isChunkError ? (
              <RefreshCw className="w-7 h-7 text-destructive" aria-hidden />
            ) : (
              <AlertTriangle className="w-7 h-7 text-destructive" aria-hidden />
            )}
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-foreground">
              {isChunkError
                ? "Não conseguimos carregar esta tela"
                : "Algo deu errado"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isChunkError
                ? "Provavelmente uma nova versão foi publicada enquanto você estava aqui. Recarregar a página costuma resolver."
                : "Encontramos um erro inesperado ao renderizar esta tela. Tente recarregar — se o problema persistir, avise o time técnico."}
            </p>
          </div>
          {error?.message && (
            <pre className="text-left text-xs bg-muted/50 border border-border rounded-md p-3 overflow-auto max-h-32 text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div className="flex items-center justify-center gap-3">
            {!isChunkError && (
              <Button variant="outline" onClick={this.reset}>
                Tentar de novo
              </Button>
            )}
            <Button onClick={this.reload}>Recarregar página</Button>
          </div>
        </div>
      </div>
    );
  }
}
