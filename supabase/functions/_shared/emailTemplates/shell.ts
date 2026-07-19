// Shell HTML compartilhado por todos os e-mails transacionais do Exacta.
// Header azul institucional (#003075) + logo padrão (círculo #003DA5, check
// bronze #C6A27C — nossa marca oficial, substituindo o laranja divergente
// dos comps originais). Rodapé com preferências.

export const BRAND = {
  navy: "#003075",
  blue: "#003DA5",
  bronze: "#C6A27C",
  orange: "#FF8200",     // cor de destaque/CTA usada nos comps
  orangeDark: "#D7720A",
  panelBg: "#F5F5F7",
  cardBg: "#FFFFFF",
  border: "#E8E8EA",
  text: "#2A323E",
  textMuted: "#6E6E6E",
  softBlue: "#C6DEF0",
  warn: "#B5590A",
  warnBg: "#FFC27B",
  danger: "#E03C3C",
} as const;

export const escapeHtml = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const escapeAttr = (s: unknown): string =>
  escapeHtml(s).replace(/`/g, "&#096;");

export const formatBRL = (v: number | string | null | undefined): string => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (!Number.isFinite(n as number)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(n as number);
};

/** SVG oficial Exacta — círculo azul institucional com check bronze. */
export const brandLogoSvg = (size = 48): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    <circle cx="256" cy="256" r="256" fill="${BRAND.blue}"/>
    <polyline points="148,272 223,348 374,180" fill="none" stroke="${BRAND.bronze}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const DEFAULT_PREFERENCES_LINK =
  Deno.env.get("APP_BASE_URL")?.replace(/\/+$/, "") + "/preferencias-notificacoes" ||
  "https://exactarededor.lovable.app/preferencias-notificacoes";

export type ShellOpts = {
  preheader: string;
  bodyHtml: string;
  footerExtra?: string; // linha extra opcional acima do footer padrão
  preferencesLink?: string;
};

export function renderShell(opts: ShellOpts): string {
  const preferencesLink = opts.preferencesLink ?? DEFAULT_PREFERENCES_LINK;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>a { color: ${BRAND.blue}; } a:hover { color: ${BRAND.navy}; }</style>
  <title>Exacta</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.panelBg};">
  <tr><td style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BRAND.panelBg};">${escapeHtml(opts.preheader)}</td></tr>
  <tr><td style="background-color:${BRAND.navy};padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:48px;">${brandLogoSvg(48)}</td>
      <td style="padding-left:14px;">
        <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">Exacta</div>
        <div style="font-size:12px;font-weight:400;color:#ffffff;opacity:0.6;margin-top:2px;">Rede D'Or</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:20px 16px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.cardBg};border-radius:8px;box-shadow:0 1px 4px rgba(42,50,62,0.08);">
      <tr><td style="padding:32px;">
        ${opts.bodyHtml}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid ${BRAND.border};">
    ${opts.footerExtra ?? ""}
    <p style="margin:0 0 6px;font-size:12px;color:${BRAND.textMuted};">Exacta — Um produto Rede D'Or</p>
    <p style="margin:0 0 6px;font-size:12px;"><a href="${escapeAttr(preferencesLink)}" style="color:${BRAND.blue};text-decoration:underline;">Gerenciar preferências de notificação</a></p>
    <p style="margin:0;font-size:12px;color:${BRAND.textMuted};">Você recebe este e-mail porque está cadastrado no sistema Exacta.</p>
  </td></tr>
</table>
</body>
</html>`;
}

/** Botão CTA laranja (primário) usado em quase todos os templates. */
export function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="${BRAND.orange}" style="border-radius:8px;">
      <a href="${escapeAttr(href)}" target="_blank" style="display:block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background-color:${BRAND.orange};">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

/** Botão CTA secundário com borda azul (usado no e1 em Rejeitar). */
export function ctaSecondary(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}" target="_blank" style="display:block;padding:10.5px 30px;font-size:14px;font-weight:500;color:${BRAND.blue};text-decoration:none;">${escapeHtml(label)}</a>`;
}

/** Linha data-value da tabela padrão de detalhes (label mono, valor à direita). */
export function detailRow(label: string, value: string, opts?: { last?: boolean; valueColor?: string }): string {
  const border = opts?.last ? "" : "border-bottom:1px solid " + BRAND.border + ";";
  const color = opts?.valueColor ?? BRAND.text;
  return `<tr${opts?.last ? "" : ' style="border-bottom:1px solid ' + BRAND.border + ';"'}>
    <td style="padding:8px 0;font-family:'SF Mono','Menlo','Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.textMuted};${border}">${escapeHtml(label)}</td>
    <td align="right" style="padding:8px 0;font-size:14px;font-weight:500;color:${color};${border}">${value}</td>
  </tr>`;
}

/** Chip/pill superior (padrão azul claro). */
export function chip(label: string, opts?: { bg?: string; fg?: string }): string {
  const bg = opts?.bg ?? BRAND.softBlue;
  const fg = opts?.fg ?? BRAND.blue;
  return `<span style="display:inline-block;background-color:${bg};color:${fg};font-family:'SF Mono','Menlo','Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:5px 12px;border-radius:20px;margin-bottom:16px;">${escapeHtml(label)}</span>`;
}
