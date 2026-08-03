import { useEffect, useRef, useState, useCallback } from "react";
import { TURNSTILE_SITE_KEY } from "@/config/turnstile";

interface TurnstileWidgetProps {
  /** Recebe o token do CAPTCHA (ou string vazia quando expira/reseta). */
  onToken: (token: string) => void;
  /** Incremente para forçar reset do widget após um envio. */
  resetKey?: number;
}

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const loadScript = () =>
  new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_script_error"));
    document.head.appendChild(script);
  });

/** Widget de CAPTCHA. Não renderiza nada quando a site key não está configurada. */
export const TurnstileWidget = ({ onToken, resetKey = 0 }: TurnstileWidgetProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  const getApi = useCallback(
    () => (window as unknown as { turnstile?: TurnstileApi }).turnstile,
    [],
  );

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    void loadScript()
      .then(() => {
        const api = getApi();
        if (cancelled || !api || !containerRef.current || widgetIdRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      const api = getApi();
      if (api && widgetIdRef.current) {
        try { api.remove(widgetIdRef.current); } catch { /* noop */ }
        widgetIdRef.current = null;
      }
    };
    // onToken é estável no uso atual; recriar o widget a cada render quebraria o desafio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getApi]);

  useEffect(() => {
    if (!resetKey) return;
    const api = getApi();
    if (api && widgetIdRef.current) {
      try { api.reset(widgetIdRef.current); } catch { /* noop */ }
      onToken("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className="space-y-1">
      <div ref={containerRef} />
      {failed && (
        <p className="text-xs text-destructive">
          Não foi possível carregar a verificação de segurança. Recarregue a página e tente novamente.
        </p>
      )}
    </div>
  );
};

export default TurnstileWidget;
