// Site key pública do Cloudflare Turnstile (pode ficar no código — é publishable).
// Defina VITE_TURNSTILE_SITE_KEY no build, ou cole a chave abaixo.
// Enquanto estiver vazia, o widget não é renderizado e o servidor aceita sem CAPTCHA
// (apenas rate-limit ativo).
export const TURNSTILE_SITE_KEY: string =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";
