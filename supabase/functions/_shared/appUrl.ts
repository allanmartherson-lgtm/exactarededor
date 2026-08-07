// URL canônica de produção do app.
// NUNCA use req.headers.get("origin") para montar links dentro de e-mails:
// no preview do editor a origin é `id-preview--*.lovable.app`, que exige login no Lovable.
// Origin continua válida apenas para CORS e redirects de navegação no browser.

const FALLBACK_APP_URL = "https://exactarededor.lovable.app";

export function getAppUrl(): string {
  const raw = (Deno.env.get("PUBLIC_APP_URL") ?? "").trim();
  const base = raw || FALLBACK_APP_URL;
  return base.replace(/\/+$/, "");
}

export const APP_URL = getAppUrl();
