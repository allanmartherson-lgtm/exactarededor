import { c1_userInvite, c2_passwordRecovery } from "./emailTemplates/templates.ts";

type SendPasswordActionEmailParams = {
  supabaseUrl: string;
  serviceRoleKey: string;
  to: string;
  fullName?: string | null;
  actionLink: string;
  kind: PasswordActionKind;
};

export function buildPasswordActionLink(params: {
  redirectTo?: string;
  tokenHash?: string | null;
  kind: PasswordActionKind;
  fallbackActionLink?: string | null;
}) {
  if (params.redirectTo && params.tokenHash) {
    return `${params.redirectTo}?token_hash=${encodeURIComponent(params.tokenHash)}&type=${encodeURIComponent(params.kind)}`;
  }
  return params.fallbackActionLink ?? null;
}

export async function sendPasswordActionEmail(params: SendPasswordActionEmailParams) {
  const subject = params.kind === "invite"
    ? "Crie sua senha de acesso ao Exacta"
    : "Defina uma nova senha de acesso ao Exacta";
  const greeting = params.fullName?.trim() ? `Olá, ${escapeHtml(params.fullName.trim())}.` : "Olá.";
  const actionLabel = params.kind === "invite" ? "Criar senha" : "Definir nova senha";
  const intro = params.kind === "invite"
    ? "Seu acesso ao Exacta foi criado. Use o botão abaixo para definir sua senha."
    : "Foi gerado um link seguro para você definir uma nova senha de acesso ao Exacta.";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(subject)}</h1>
      <p>${greeting}</p>
      <p>${intro}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeAttribute(params.actionLink)}" style="display: inline-block; background: #002855; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 6px; font-weight: 700;">
          ${escapeHtml(actionLabel)}
        </a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">Se o botão não abrir, copie e cole este link no navegador:</p>
      <p style="font-size: 12px; word-break: break-all; color: #4b5563;">${escapeHtml(params.actionLink)}</p>
      <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">Por segurança, use sempre o e-mail mais recente recebido.</p>
    </div>
  `;

  const text = [
    subject,
    "",
    stripHtml(greeting),
    intro,
    "",
    `${actionLabel}: ${params.actionLink}`,
    "",
    "Por segurança, use sempre o e-mail mais recente recebido.",
  ].join("\n");

  try {
    const response = await fetch(`${params.supabaseUrl}/functions/v1/send-email-corporate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: params.to,
        subject,
        html,
        text,
        event_key: params.kind === "invite" ? "user_invite" : "password_recovery",
        template_key: params.kind === "invite" ? "user_invite_password" : "admin_password_recovery",
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        sent: false,
        warning: `Não foi possível enviar o e-mail automático (${response.status}). Use o link manual. ${body}`,
      };
    }
    return { sent: true, warning: null as string | null };
  } catch (e) {
    return {
      sent: false,
      warning: `Não foi possível enviar o e-mail automático. Use o link manual. ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "");
}