/**
 * URL canônica de produção do app.
 *
 * Usada em qualquer lugar que gere um link para ser aberto FORA do app
 * (e-mail, WhatsApp, link copiado para a empresa). Nunca usar
 * `window.location.origin` nesses casos: no editor/preview do Lovable o
 * origin é um domínio de preview que exige login na plataforma.
 */
export const APP_URL = "https://exactarededor.lovable.app";

/** Monta a URL pública do portal de upload de NF a partir do token. */
export const invoiceUploadUrl = (token: string) => `${APP_URL}/portal/nota/${token}`;
