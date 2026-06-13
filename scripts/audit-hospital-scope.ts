/**
 * Guard multi-tenant (CI): falha o build se alguma RPC de leitura SECURITY
 * DEFINER ler a tabela payments sem aplicar current_active_hospital().
 * Chama a função de auditoria audit_hospital_scope() no banco usando a
 * service role. Funções escopadas por médico (portal) são isentas
 * automaticamente pela própria função de auditoria.
 *
 * Secrets necessários no CI: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Sem os secrets (fork/local), o guard é pulado com aviso (exit 0).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    "[hospital-scope-guard] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — guard pulado.",
  );
  process.exit(0);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.rpc("audit_hospital_scope");

if (error) {
  console.error("[hospital-scope-guard] erro ao executar auditoria:", error.message);
  process.exit(2);
}

if (Array.isArray(data) && data.length > 0) {
  console.error(
    "\n[hospital-scope-guard] ❌ RPCs que leem payments sem filtro de hospital ativo:\n",
  );
  for (const row of data as Array<{ proname: string; args: string }>) {
    console.error(`  - ${row.proname}(${row.args})`);
  }
  console.error(
    "\nCorrija adicionando 'AND p.hospital_id = current_active_hospital()' na leitura de payments,\n" +
      "ou, se for função escopada por médico (portal), use portal_can_access_doctor/doctor_portal_users.\n",
  );
  process.exit(1);
}

console.log("[hospital-scope-guard] ✅ Nenhuma RPC vaza dados entre hospitais.");
process.exit(0);
