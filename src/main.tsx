import { createRoot } from "react-dom/client";
import "./index.css";

const PASSWORD_AUTH_URL_CACHE_KEY = "medpay-password-auth-url";

const cachePasswordAuthUrl = () => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const isPasswordRoute = url.pathname === "/definir-senha" || url.pathname === "/reset-password";
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

    if (!isPasswordRoute) {
      url.pathname = "/definir-senha";
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
};

cachePasswordAuthUrl();

void import("./App.tsx").then(({ default: App }) => {
  createRoot(document.getElementById("root")!).render(<App />);
});
