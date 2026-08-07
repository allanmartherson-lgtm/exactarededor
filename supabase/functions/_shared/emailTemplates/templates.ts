// Renderizadores tipados dos 13 templates transacionais Exacta.
// Cada função retorna { subject, html, text } pronto para envio.

import {
  BRAND,
  chip,
  ctaButton,
  ctaSecondary,
  detailRow,
  escapeAttr,
  escapeHtml,
  formatBRL,
  renderShell,
} from "./shell.ts";

export type Rendered = { subject: string; html: string; text: string };

const DASH = "—";
const asText = (v: unknown): string => (v == null || v === "" ? DASH : String(v));

// ---------- a1: send-invoice-request ----------
export type A1Ctx = {
  recipient_label: string;
  total_formatted: string;
  upload_url: string;
  setores: string;
  competencia?: string | null;
  prazo_envio?: string | null;
  hospital_name: string;
  hospital_contact_email: string;
  hospital_contact_phone: string;
  hospital_dados_cadastrais: string;
  preferences_link?: string;
  subject?: string;
  request_intro?: string;
};
export function a1_sendInvoiceRequest(ctx: A1Ctx): Rendered {
  const competencia = asText(ctx.competencia);
  const prazo = asText(ctx.prazo_envio);
  const intro = ctx.request_intro ??
    `Solicitamos a emissão de NF referente à produção de ${ctx.setores}${ctx.competencia ? " — " + ctx.competencia : ""}.`;
  const body = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Pedido de Nota Fiscal</h2>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text};">Prezados,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">${escapeHtml(intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background-color:${BRAND.panelBg};border-left:3px solid ${BRAND.blue};border-radius:0 8px 8px 0;">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:6px 0;font-size:13px;color:${BRAND.textMuted};">Empresa</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.text};">${escapeHtml(ctx.recipient_label)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:${BRAND.textMuted};">Valor</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.text};">${escapeHtml(ctx.total_formatted)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:${BRAND.textMuted};">Previsão de pagamento</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.text};">10 dias úteis</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:${BRAND.textMuted};">Prazo para envio</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.warn};">${escapeHtml(prazo)}</td></tr>
        </table>
      </td></tr>
    </table>
    ${ctaButton(ctx.upload_url, "Enviar Nota Fiscal →")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr><td style="padding:14px 0;border-top:1px solid ${BRAND.border};font-family:'SF Mono','Menlo','Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.textMuted};">Dados cadastrais do tomador</td></tr>
      <tr><td style="padding:0 0 4px;font-size:13px;line-height:1.6;color:${BRAND.text};white-space:pre-line;">${escapeHtml(ctx.hospital_dados_cadastrais).replace(/\r?\n/g, "<br/>")}</td></tr>
    </table>
  `;
  const footerExtra = `
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${BRAND.text};">${escapeHtml(ctx.hospital_name)}</p>
    <p style="margin:0 0 14px;font-size:12px;color:${BRAND.textMuted};">${escapeHtml(ctx.hospital_contact_email)} · ${escapeHtml(ctx.hospital_contact_phone)}</p>
  `;
  const html = renderShell({
    preheader: "Solicitamos a emissão da nota fiscal referente à produção do período.",
    bodyHtml: body,
    footerExtra,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Pedido de Nota Fiscal\n\n${intro}\n\nEmpresa: ${ctx.recipient_label}\nValor: ${ctx.total_formatted}\nPrevisão de pagamento: 10 dias úteis\nPrazo para envio: ${prazo}\n\nAcessar: ${ctx.upload_url}\n\n${ctx.hospital_dados_cadastrais}\n\n${ctx.hospital_name}\n${ctx.hospital_contact_email} · ${ctx.hospital_contact_phone}`;
  return { subject: ctx.subject ?? `Solicitação de Nota Fiscal — ${ctx.recipient_label}`, html, text };
}

// ---------- a2: nf-received ----------
export type A2Ctx = {
  analyst_name: string;
  company_name: string;
  company_cnpj?: string | null;
  invoice_value: string;
  competence_month?: string | null;
  payment_reference: string;
  invoice_link: string;
  preferences_link?: string;
};
export function a2_nfReceived(ctx: A2Ctx): Rendered {
  const rows = [
    detailRow("Empresa", escapeHtml(ctx.company_name)),
    detailRow("CNPJ", escapeHtml(asText(ctx.company_cnpj))),
    detailRow("Valor", escapeHtml(ctx.invoice_value)),
    detailRow("Competência", escapeHtml(asText(ctx.competence_month))),
    detailRow("Lote", escapeHtml(ctx.payment_reference), { last: true }),
  ].join("");
  const body = `
    ${chip("NF recebida")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Nova nota fiscal recebida</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.analyst_name)}, uma nova nota fiscal foi recebida e aguarda conferência.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">${rows}</table>
    ${ctaButton(ctx.invoice_link, "Ver NF")}
  `;
  const html = renderShell({
    preheader: "Nova nota fiscal recebida para conferência.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Nova nota fiscal recebida\n\nOlá, ${ctx.analyst_name}.\nEmpresa: ${ctx.company_name}\nCNPJ: ${asText(ctx.company_cnpj)}\nValor: ${ctx.invoice_value}\nCompetência: ${asText(ctx.competence_month)}\nLote: ${ctx.payment_reference}\n\nAcessar: ${ctx.invoice_link}`;
  return { subject: `Nova NF recebida — ${ctx.company_name} (${ctx.payment_reference})`, html, text };
}

// ---------- b1: validator-assignment ----------
export type B1Ctx = {
  validator_name: string;
  payment_reference: string;
  payment_type?: string | null;
  competence_month?: string | null;
  hospital_name?: string | null;
  company_count: number | string;
  payment_link: string;
  preferences_link?: string;
};
export function b1_validatorAssignment(ctx: B1Ctx): Rendered {
  const rows = [
    detailRow("Referência", escapeHtml(ctx.payment_reference)),
    detailRow("Tipo", escapeHtml(asText(ctx.payment_type))),
    detailRow("Competência", escapeHtml(asText(ctx.competence_month))),
    detailRow("Hospital", escapeHtml(asText(ctx.hospital_name))),
    detailRow("Qtd. empresas", escapeHtml(String(ctx.company_count)), { last: true }),
  ].join("");
  const body = `
    ${chip("Novo lote")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Novo lote atribuído para validação</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.validator_name)}, você foi designado(a) para validar o lote abaixo.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">${rows}</table>
    ${ctaButton(ctx.payment_link, "Abrir lote")}
  `;
  const html = renderShell({
    preheader: "Um novo lote foi atribuído para sua validação.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Novo lote atribuído — ${ctx.payment_reference}\n\nOlá, ${ctx.validator_name}.\nTipo: ${asText(ctx.payment_type)}\nCompetência: ${asText(ctx.competence_month)}\nHospital: ${asText(ctx.hospital_name)}\nEmpresas: ${ctx.company_count}\n\nAcessar: ${ctx.payment_link}`;
  return { subject: `Novo lote para validação — ${ctx.payment_reference}`, html, text };
}

// ---------- b2: ia-concluded ----------
export type B2Ctx = {
  analyst_name: string;
  payment_reference: string;
  items_count: number | string;
  alerts_count: number | string;
  divergences_count: number | string;
  analysis_duration?: string | null;
  payment_link: string;
  preferences_link?: string;
};
export function b2_iaConcluded(ctx: B2Ctx): Rendered {
  // Zero é informação ("0 alertas"). Só omitimos a linha quando o dado é
  // realmente indisponível (null/undefined/"").
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  const parts: Array<{ label: string; value: string; color?: string }> = [
    { label: "Referência", value: escapeHtml(ctx.payment_reference) },
  ];
  if (has(ctx.items_count)) parts.push({ label: "Itens analisados", value: escapeHtml(String(ctx.items_count)) });
  if (has(ctx.alerts_count)) parts.push({ label: "Alertas", value: escapeHtml(String(ctx.alerts_count)), color: BRAND.warn });
  if (has(ctx.divergences_count)) parts.push({ label: "Divergências", value: escapeHtml(String(ctx.divergences_count)), color: BRAND.danger });
  if (has(ctx.analysis_duration)) parts.push({ label: "Tempo de análise", value: escapeHtml(String(ctx.analysis_duration)) });
  const rows = parts
    .map((p, i) => detailRow(p.label, p.value, { last: i === parts.length - 1, valueColor: p.color }))
    .join("");
  const body = `
    ${chip("Análise concluída")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Análise pelo motor de regras concluída</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.analyst_name)}, a análise automática do lote foi finalizada. Revise os resultados.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">${rows}</table>
    ${ctaButton(ctx.payment_link, "Revisar análise")}
  `;
  const html = renderShell({
    preheader: "A análise automática do lote foi finalizada.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Análise concluída — ${ctx.payment_reference}\n\nItens: ${ctx.items_count} · Alertas: ${ctx.alerts_count} · Divergências: ${ctx.divergences_count}\n\nAcessar: ${ctx.payment_link}`;
  return { subject: `Análise concluída — Lote ${ctx.payment_reference}`, html, text };
}

// ---------- b3: returned ----------
export type B3Ctx = {
  analyst_name: string;
  payment_reference: string;
  returned_by?: string | null;
  returned_at?: string | null;
  return_reason?: string | null;
  payment_link: string;
  preferences_link?: string;
};
export function b3_returned(ctx: B3Ctx): Rendered {
  const rows = [
    detailRow("Referência", escapeHtml(ctx.payment_reference)),
    detailRow("Retornado por", escapeHtml(asText(ctx.returned_by))),
    detailRow("Data", escapeHtml(asText(ctx.returned_at)), { last: true }),
  ].join("");
  const reason = ctx.return_reason?.trim();
  const body = `
    ${chip("Retornado", { bg: BRAND.warn, fg: "#ffffff" })}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Lote retornado para correção</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.analyst_name)}, o lote abaixo foi devolvido e requer sua atenção.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${reason ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:${BRAND.warnBg};border-left:3px solid ${BRAND.warn};"><tr><td style="padding:14px 18px;font-size:14px;font-style:italic;line-height:1.6;color:${BRAND.text};">"${escapeHtml(reason)}"</td></tr></table>` : ""}
    ${ctaButton(ctx.payment_link, "Abrir lote")}
  `;
  const html = renderShell({
    preheader: "Um lote foi devolvido e precisa de correção.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Lote retornado — ${ctx.payment_reference}\n\nRetornado por: ${asText(ctx.returned_by)}\nData: ${asText(ctx.returned_at)}\n${reason ? `Motivo: ${reason}\n` : ""}\nAcessar: ${ctx.payment_link}`;
  return { subject: `Lote ${ctx.payment_reference} devolvido para correção`, html, text };
}

// ---------- b5: internal-question ----------
export type B5Ctx = {
  analyst_name: string;
  payment_reference: string;
  question_by?: string | null;
  question_preview: string;
  thread_link: string;
  preferences_link?: string;
};
export function b5_internalQuestion(ctx: B5Ctx): Rendered {
  const body = `
    ${chip("Questionamento")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Novo questionamento no lote</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.analyst_name)}, ${escapeHtml(asText(ctx.question_by))} fez uma pergunta sobre o lote ${escapeHtml(ctx.payment_reference)}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:${BRAND.panelBg};border-left:3px solid #71C5E8;"><tr><td style="padding:14px 18px;font-size:14px;font-style:italic;line-height:1.6;color:${BRAND.text};">"${escapeHtml(ctx.question_preview)}"</td></tr></table>
    ${ctaButton(ctx.thread_link, "Responder")}
  `;
  const html = renderShell({
    preheader: "Há um novo questionamento no lote que precisa da sua resposta.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Nova pergunta no lote ${ctx.payment_reference}\nPor: ${asText(ctx.question_by)}\n\n"${ctx.question_preview}"\n\nAcessar: ${ctx.thread_link}`;
  return { subject: `Nova pergunta no lote ${ctx.payment_reference}`, html, text };
}

// ---------- b6: question-reply ----------
export type B6Ctx = {
  recipient_name: string;
  payment_reference: string;
  replied_by?: string | null;
  reply_preview: string;
  thread_link: string;
  preferences_link?: string;
  subject?: string;
};
export function b6_questionReply(ctx: B6Ctx): Rendered {
  const body = `
    ${chip("Resposta")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Nova resposta ao seu questionamento</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.recipient_name)}, ${escapeHtml(asText(ctx.replied_by))} respondeu ao seu questionamento sobre o lote ${escapeHtml(ctx.payment_reference)}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:${BRAND.panelBg};border-left:3px solid #71C5E8;"><tr><td style="padding:14px 18px;font-size:14px;font-style:italic;line-height:1.6;color:${BRAND.text};">"${escapeHtml(ctx.reply_preview)}"</td></tr></table>
    ${ctaButton(ctx.thread_link, "Ver resposta")}
  `;
  const html = renderShell({
    preheader: "Você recebeu uma resposta ao seu questionamento.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Nova resposta — ${ctx.payment_reference}\nPor: ${asText(ctx.replied_by)}\n\n"${ctx.reply_preview}"\n\nAcessar: ${ctx.thread_link}`;
  return { subject: ctx.subject ?? `Resposta ao seu questionamento — ${ctx.payment_reference}`, html, text };
}

// ---------- c1: admin-password-recovery ----------
export type C1Ctx = {
  user_name: string;
  reset_link: string;
  expiry_hours?: number | string;
  preferences_link?: string;
};
export function c1_passwordRecovery(ctx: C1Ctx): Rendered {
  const expiry = ctx.expiry_hours ?? 24;
  const body = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Redefinição de senha</h2>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.user_name)}, recebemos uma solicitação para redefinir sua senha no Exacta. Clique no botão abaixo para criar uma nova senha.</p>
    ${ctaButton(ctx.reset_link, "Redefinir senha")}
    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:${BRAND.textMuted};">Este link expira em ${escapeHtml(String(expiry))} horas. Se você não solicitou esta alteração, ignore este e-mail.</p>
  `;
  const html = renderShell({
    preheader: "Redefina sua senha de acesso ao Exacta.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Redefinição de senha\n\nOlá, ${ctx.user_name}.\nAcesse: ${ctx.reset_link}\nO link expira em ${expiry} horas.`;
  return { subject: "Redefina sua senha do Exacta", html, text };
}

// ---------- c2: new-user-invite ----------
export type C2Ctx = {
  user_name: string;
  user_email: string;
  hospital_name?: string | null;
  activation_link: string;
  preferences_link?: string;
};
export function c2_newUserInvite(ctx: C2Ctx): Rendered {
  const body = `
    ${chip("Bem-vindo")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Bem-vindo ao Exacta</h2>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.user_name)}, sua conta foi criada${ctx.hospital_name ? ` em ${escapeHtml(ctx.hospital_name)}` : ""} no Exacta — a plataforma de gestão de pagamentos médicos da Rede D'Or.</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.text};">Ative sua conta (${escapeHtml(ctx.user_email)}) para começar a usar o sistema.</p>
    ${ctaButton(ctx.activation_link, "Ativar minha conta")}
  `;
  const html = renderShell({
    preheader: "Sua conta no Exacta foi criada — ative para começar.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Bem-vindo ao Exacta\n\nOlá, ${ctx.user_name}.\nSua conta (${ctx.user_email}) foi criada.\nAtive em: ${ctx.activation_link}`;
  return { subject: "Ative sua conta no Exacta", html, text };
}

// ---------- d2: campaign-broadcast ----------
export type D2Ctx = {
  campaign_title: string;
  campaign_message: string;
  hospital_name?: string | null;
  recipient_name?: string | null;
  reply_link?: string | null;
  allow_reply?: boolean;
  preferences_link?: string;
};
export function d2_campaignBroadcast(ctx: D2Ctx): Rendered {
  const greetingName = ctx.recipient_name?.trim() || "prezado(a)";
  const messageHtml = escapeHtml(ctx.campaign_message).replace(/\n/g, "<br/>");
  const body = `
    ${ctx.hospital_name ? `<p style="margin:0 0 6px;font-size:12px;color:${BRAND.textMuted};">${escapeHtml(ctx.hospital_name)}</p>` : ""}
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">${escapeHtml(ctx.campaign_title)}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(greetingName)},</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.text};">${messageHtml}</p>
    ${ctx.allow_reply && ctx.reply_link
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border:1.5px solid ${BRAND.blue};border-radius:8px;">${ctaSecondary(ctx.reply_link, "Responder")}</td></tr></table>`
      : ""}
  `;
  const html = renderShell({
    preheader: ctx.campaign_title,
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `${ctx.campaign_title}\n\nOlá, ${greetingName},\n\n${ctx.campaign_message}${ctx.allow_reply && ctx.reply_link ? `\n\nResponder: ${ctx.reply_link}` : ""}`;
  return { subject: ctx.campaign_title.slice(0, 200), html, text };
}

// ---------- e1: production-validation (director approval) ----------
export type E1Ctx = {
  director_name: string;
  payment_reference: string;
  payment_type?: string | null;
  competence_month?: string | null;
  hospital_name?: string | null;
  company_count: number | string;
  total_value: string;
  approve_link: string;
  reject_link?: string | null;
  preferences_link?: string;
};
export function e1_productionValidation(ctx: E1Ctx): Rendered {
  const rows = [
    detailRow("Referência", escapeHtml(ctx.payment_reference)),
    detailRow("Tipo", escapeHtml(asText(ctx.payment_type))),
    detailRow("Competência", escapeHtml(asText(ctx.competence_month))),
    detailRow("Hospital", escapeHtml(asText(ctx.hospital_name))),
    detailRow("Empresas", escapeHtml(String(ctx.company_count)), { last: true }),
  ].join("");
  const rejectBtn = ctx.reject_link
    ? `<td width="12"></td><td align="center" style="border:1.5px solid ${BRAND.blue};border-radius:8px;">${ctaSecondary(ctx.reject_link, "Rejeitar")}</td>`
    : "";
  const body = `
    ${chip("Aprovação pendente")}
    <h2 style="margin:14px 0 16px;font-size:22px;font-weight:600;color:${BRAND.text};">Produção aguardando sua validação</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.text};">Olá, ${escapeHtml(ctx.director_name)}, o lote abaixo está pronto para aprovação.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:${BRAND.softBlue};border-radius:8px;"><tr>
      <td style="padding:14px 18px;font-size:13px;color:${BRAND.blue};">Valor total</td>
      <td align="right" style="padding:14px 18px;font-size:18px;font-weight:700;color:${BRAND.blue};">${escapeHtml(ctx.total_value)}</td>
    </tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${BRAND.orange}" style="border-radius:8px;"><a href="${escapeAttr(ctx.approve_link)}" target="_blank" style="display:block;padding:12px 30px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background-color:${BRAND.orange};">Aprovar produção</a></td>
      ${rejectBtn}
    </tr></table>
  `;
  const html = renderShell({
    preheader: "Um lote está pronto e aguarda sua validação.",
    bodyHtml: body,
    preferencesLink: ctx.preferences_link,
  });
  const text = `Produção aguardando sua validação\n\nLote: ${ctx.payment_reference}\nTipo: ${asText(ctx.payment_type)}\nCompetência: ${asText(ctx.competence_month)}\nHospital: ${asText(ctx.hospital_name)}\nEmpresas: ${ctx.company_count}\nValor total: ${ctx.total_value}\n\nAprovar: ${ctx.approve_link}${ctx.reject_link ? `\nRejeitar: ${ctx.reject_link}` : ""}`;
  return { subject: `Aprovação pendente — Lote ${ctx.payment_reference} (${ctx.total_value})`, html, text };
}
