#!/usr/bin/env -S deno run --allow-read
/**
 * Audita todas as edge functions e falha se alguma nova função não tiver
 * guard de autenticação. Rodado no CI para evitar regressões.
 *
 * Uma função "passa" se:
 *  - contém requireInternalOrRole  OU
 *  - está na allowlist de públicas intencionais (com motivo documentado)  OU
 *  - é auto-gerada (arquivo começa com "AUTO-GENERATED")
 */
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

// Cada allowlist tem { motivo } — documentar por que é público.
const PUBLIC_ALLOWLIST: Record<string, string> = {
  "approve-via-magic-link": "público por design — valida JWT do magic link",
  "submit-invoice": "público por design — valida upload_token do convite",
  "submit-access-request": "público por design — form de solicitação de acesso; valida CAPTCHA (Turnstile) + rate-limit por IP/e-mail",
  "mcp": "auto-gerado — MCP OAuth server tem auth próprio",
  // Chamados por pg_cron/trigger com anon key (sem service-role em SQL).
  // São idempotentes, não recebem input do usuário externo — payloads vêm do próprio DB.
  "notification-queue-worker": "cron 30s; drena fila interna; sem input externo",
  "notify-campaign-decision": "chamado por trigger DB; payload = NEW.id",
  "dispatch-broadcast": "chamado por trigger DB; payload = NEW.id",
  // Admins têm checagem manual robusta (has_role admin + audit_log)
  "admin-create-portal-user": "admin-only, checa has_role internamente",
  "admin-create-user": "admin-only, checa has_role internamente",
  "admin-manage-user-hospitals": "admin-only, checa has_role internamente",
  "admin-resend-invite": "admin-only, checa has_role internamente",
  "admin-reset-password": "admin-only, checa has_role internamente",
};

const failures: string[] = [];
const publicOk: string[] = [];
const guarded: string[] = [];

for await (const entry of walk("supabase/functions", { includeDirs: false, exts: [".ts"], match: [/index\.ts$/] })) {
  const parts = entry.path.split("/");
  const funcName = parts[parts.length - 2];
  if (funcName === "_shared") continue;
  const src = await Deno.readTextFile(entry.path);

  if (src.includes("AUTO-GENERATED")) { guarded.push(funcName + " (auto-gen)"); continue; }
  if (src.includes("requireInternalOrRole")) { guarded.push(funcName); continue; }
  if (funcName in PUBLIC_ALLOWLIST) { publicOk.push(`${funcName} — ${PUBLIC_ALLOWLIST[funcName]}`); continue; }

  failures.push(funcName);
}

console.log(`\n✅ Com guard: ${guarded.length}`);
console.log(`✅ Públicas justificadas: ${publicOk.length}`);
publicOk.forEach((n) => console.log(`   • ${n}`));

if (failures.length > 0) {
  console.error(`\n❌ Sem guard e sem justificativa: ${failures.length}`);
  failures.forEach((n) => console.error(`   • ${n}`));
  console.error(`\nCada nova edge function deve começar com:`);
  console.error(`   import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";`);
  console.error(`   const _auth = await requireInternalOrRole(req);`);
  console.error(`   if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);`);
  console.error(`\nOu adicione ${JSON.stringify(failures)} ao PUBLIC_ALLOWLIST em scripts/audit-edge-auth.ts com o motivo.`);
  Deno.exit(1);
}

console.log(`\n🎉 Todas as ${guarded.length + publicOk.length} edge functions estão protegidas ou documentadas.`);
