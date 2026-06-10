import { createRoot } from "react-dom/client";
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

const rootElement = document.getElementById("root");
if (rootElement) {
  import("./App.tsx").then(({ default: App }) => {
    createRoot(rootElement).render(<App />);
  });
}

