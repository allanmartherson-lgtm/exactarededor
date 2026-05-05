import { createRoot } from "react-dom/client";
import "./index.css";

const PASSWORD_AUTH_URL_CACHE_KEY = "medpay-password-auth-url";

const cachePasswordAuthUrl = () => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const isPasswordRoute = url.pathname === "/definir-senha" || url.pathname === "/reset-password";
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const hasAuthParams = Boolean(
    url.searchParams.get("code")
      || url.searchParams.get("token_hash")
      || url.searchParams.get("error_description")
      || hashParams.get("access_token")
      || hashParams.get("refresh_token")
      || hashParams.get("token_hash")
      || hashParams.get("error_description"),
  );

  if (isPasswordRoute && hasAuthParams) {
    sessionStorage.setItem(PASSWORD_AUTH_URL_CACHE_KEY, JSON.stringify({ href: window.location.href, savedAt: Date.now() }));
  }
};

cachePasswordAuthUrl();

void import("./App.tsx").then(({ default: App }) => {
  createRoot(document.getElementById("root")!).render(<App />);
});
