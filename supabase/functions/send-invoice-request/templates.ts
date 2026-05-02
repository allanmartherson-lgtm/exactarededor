/**
 * Geração do assunto e do corpo do e-mail de pedido de NF.
 * Mantém o template HIG / DF Star em um único lugar para facilitar ajustes
 * de copywriting sem mexer na orquestração.
 */
import {
  addBusinessDays,
  aoAos,
  formatCompetenceBR,
  formatDateBR,
  greetingBrasilia,
  joinPt,
} from "./text.ts";

const BUSINESS_DAYS_BEFORE_DUE = 10;

const DADOS_CADASTRAIS = `Hospitais Integrados da Gávea S.A - DF Star
CNPJ: 31.635.857/0006-16   C.C.M: 07.895.204/001-40
SGAS 914 Conjunto H - Parte
Asa Sul - CEP: 70.390-140`;

const ASSINATURA = `Atenciosamente,

GHM DF Star
Tel: (11) 2142-4879
ghm.repassedfstar@rededor.com.br
www.rededor.com.br`;

export type TemplateContext = {
  recipient_label: string;
  total_amount_formatted: string;
  upload_url: string;
  payment_due_date: string | null;
  competence: string | string[] | null | undefined;
  sectors: string[];
  specialties: string[];
};

export type EmailTemplate = {
  subject: string;
  body: string;
};

const buildSetores = (sectors: string[], specialties: string[]) => {
  const all = Array.from(new Set([
    ...(Array.isArray(sectors) ? sectors : []),
    ...(Array.isArray(specialties) ? specialties : []),
  ].filter(Boolean)));
  return { all, label: all.length ? joinPt(all) : "Produção médica" };
};

export const buildSubject = (ctx: TemplateContext): string => {
  const { label } = buildSetores(ctx.sectors, ctx.specialties);
  const competencia = formatCompetenceBR(ctx.competence);
  const parts = ["Solicitação de Nota Fiscal", "DF Star", "Produção", label];
  if (competencia) parts.push(competencia);
  return parts.join(" - ");
};

export const buildEmailBody = (ctx: TemplateContext): string => {
  const { all: setoresArr, label: setoresStr } = buildSetores(ctx.sectors, ctx.specialties);
  const competenciaStr = formatCompetenceBR(ctx.competence);

  let prazoLine = "";
  if (ctx.payment_due_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ctx.payment_due_date));
    if (m) {
      const due = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      const prazo = addBusinessDays(due, -BUSINESS_DAYS_BEFORE_DUE);
      prazoLine = `Favor emitir a Nota Fiscal e nos encaminhar até o dia ${formatDateBR(prazo)}.`;
    }
  }

  const greeting = greetingBrasilia();

  return `Prezados,
${greeting}!

Solicitamos, por gentileza, a emissão de Nota Fiscal referente ${aoAos(setoresArr.length)} Produção de ${setoresStr}${competenciaStr ? ` ${competenciaStr}` : ""}:

${ctx.recipient_label} - ${setoresStr}
Valor: ${ctx.total_amount_formatted}
Previsão de pagamento: 10 dias úteis após o envio da NF.
Para envio da NF ou caso tenha dúvidas ou questionamentos, utilize o link abaixo:

${ctx.upload_url}

Dados Cadastrais do Hospital:
${DADOS_CADASTRAIS}
${prazoLine ? `\n${prazoLine}\n` : ""}
${ASSINATURA}`;
};

export const buildEmail = (ctx: TemplateContext): EmailTemplate => ({
  subject: buildSubject(ctx),
  body: buildEmailBody(ctx),
});
