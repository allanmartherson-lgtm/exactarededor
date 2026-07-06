import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/500.css";
import "./index.css";

const PASSWORD_AUTH_URL_CACHE_KEY = "exacta-password-auth-url";

const cachePasswordAuthUrl = () => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const isPasswordRoute = ["/definir-senha", "/reset-password", "/auth/reset-password"].includes(url.pathname);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const authType = url.searchParams.get("type") || hashParams.get("type");
  const hasAuthParams = Boolean(
    url.searchParams.get("code")
      || url.searchParams.get("token_hash")
      || url.searchParams.get("token")
      || url.searchParams.get("error_description")
      || hashParams.get("access_token")
      || hashParams.get("refresh_token")
      || hashParams.get("token_hash")
      || hashParams.get("token")
      || hashParams.get("error_description"),
  );
  const isPasswordAuthFlow = isPasswordRoute || authType === "recovery" || authType === "invite";

  if (isPasswordAuthFlow && hasAuthParams) {
    sessionStorage.setItem(PASSWORD_AUTH_URL_CACHE_KEY, JSON.stringify({ href: window.location.href, savedAt: Date.now() }));
    url.pathname = "/auth/reset-password";
    url.search = "";
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.pathname);
  }
};

cachePasswordAuthUrl();

/**
 * Pré-warm de sessão antes de carregar chunks dinâmicos.
 *
 * Quando o preview do Lovable fica ocioso, o token expira e o primeiro
 * `import()` após retomar costuma falhar com "Failed to fetch dynamically
 * imported module". Forçamos `getSession()` (que dispara refresh se preciso)
 * antes do próximo import. Erro é silencioso: o ErrorBoundary já cuida do
 * fallback com auto-reload único.
 */
const refreshAuthSession = async () => {
  try {
    const { supabase } = await import("./integrations/supabase/client.ts");
    await supabase.auth.getSession();
  } catch {
    // ignore — pior caso, ErrorBoundary recarrega
  }
};

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshAuthSession();
  });
  window.addEventListener("online", () => void refreshAuthSession());
}

const RELOAD_FLAG_KEY = "exacta-chunk-error-reloaded";

/**
 * Importa App.tsx com retry. Quando o Vite reinicia (preview ocioso, novo
 * deploy), o primeiro import falha com "Failed to fetch dynamically imported
 * module". Tentamos novamente com backoff curto; se persistir, fazemos UM
 * reload da página — o ErrorBoundary não cobre esse import pois ele acontece
 * antes do React montar.
 */
async function loadAppWithRetry(attempts = 3, delayMs = 400): Promise<typeof import("./App.tsx")> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await import("./App.tsx");
    } catch (err) {
      lastErr = err;
      try {
        const { supabase } = await import("./integrations/supabase/client.ts");
        await supabase.auth.getSession();
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  loadAppWithRetry()
    .then(({ default: App }) => {
      try { sessionStorage.removeItem(RELOAD_FLAG_KEY); } catch { /* ignore */ }
      createRoot(rootElement).render(<App />);
    })
    .catch((err) => {
      console.error("[main] Falha ao carregar App.tsx após retries:", err);
      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG_KEY) === "1";
        sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
      } catch {
        return;
      }
      if (!alreadyReloaded) {
        setTimeout(() => window.location.reload(), 300);
      }
    });
}

