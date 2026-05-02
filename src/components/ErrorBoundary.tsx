import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary global — captura erros de renderização não tratados em
 * qualquer descendente e mostra uma tela de fallback discreta com a opção de
 * recarregar. Sem isso, qualquer throw em um componente derruba toda a SPA
 * para uma página em branco.
 *
 * Uso: envolver uma vez no nível mais alto possível (ex.: dentro do
 * BrowserRouter, fora das Routes) em App.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log no console do navegador para diagnóstico.
    // Em produção poderia enviar para um serviço (Sentry/etc).
    console.error("[ErrorBoundary] Uncaught error:", error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" aria-hidden />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-foreground">
              Algo deu errado
            </h1>
            <p className="text-sm text-muted-foreground">
              Encontramos um erro inesperado ao renderizar esta tela. Tente
              recarregar — se o problema persistir, avise o time técnico.
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="text-left text-xs bg-muted/50 border border-border rounded-md p-3 overflow-auto max-h-32 text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={this.reset}>
              Tentar de novo
            </Button>
            <Button onClick={this.reload}>Recarregar página</Button>
          </div>
        </div>
      </div>
    );
  }
}
