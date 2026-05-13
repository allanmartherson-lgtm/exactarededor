/**
 * Sub-Onda 2D — Helper para testes de integração contra o banco do preview.
 *
 * ESTRATÉGIA DE USUÁRIO DE TESTE
 * ------------------------------
 * Reusamos o UUID de um admin já existente (lookup em user_roles WHERE
 * role='admin' LIMIT 1) em vez de criar um usuário novo a cada teste.
 *
 * Motivo: o role do `SUPABASE_DB_URL` (pooler) NÃO tem grant em `auth.users`,
 * então `INSERT INTO auth.users` falha com "permission denied for schema
 * auth", e a FK `user_roles_user_id_fkey` impede inserir role para um UUID
 * inventado. Não vamos contornar isso adicionando função SECURITY DEFINER de
 * "test_seed_user" ao schema de produção (red flag em auditoria fiscal).
 *
 * O isolamento entre testes continua garantido pela TRANSAÇÃO + ROLLBACK
 * final: nenhuma escrita feita no callback persiste, equivalente a usuário
 * descartável. Os testes NÃO devem modificar dados do admin reusado
 * (defesa em profundidade), só tocar nas tabelas alvo da 2D
 * (rules, rule_calculations, audit_log).
 *
 * O helper provê `withAuthenticatedTx(role, cb)`:
 *   1) Conexão Postgres via `SUPABASE_DB_URL` (env). Sem hardcode.
 *   2) Lookup de admin existente — falha clara se não houver nenhum.
 *   3) BEGIN.
 *   4) `SET LOCAL request.jwt.claims = '{"sub":"<adminId>"}'` para `auth.uid()`.
 *   5) Executa o callback recebendo um `tx` com `query`/`queryOne`.
 *   6) ROLLBACK sempre — nada é persistido.
 */
import { Client, type QueryArguments } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export interface TxClient {
  query<T = Record<string, unknown>>(
    sql: string,
    args?: QueryArguments,
  ): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(
    sql: string,
    args?: QueryArguments,
  ): Promise<T | null>;
}

export function requireDbUrl(): string {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url || url.trim() === "") {
    throw new Error(
      "SUPABASE_DB_URL não definido — testes de integração DB requerem a env do banco do preview. " +
        "Configure SUPABASE_DB_URL antes de rodar (ex.: export SUPABASE_DB_URL=postgres://...).",
    );
  }
  return url;
}

export async function withAuthenticatedTx<T>(
  role: "admin" | "diretor",
  cb: (tx: TxClient, actorId: string) => Promise<T>,
): Promise<T> {
  const connStr = requireDbUrl();
  const client = new Client(connStr);
  await client.connect();
  try {
    // Lookup do admin reusável ANTES da tx, para falhar rápido e claro.
    const lookup = await client.queryObject<{ user_id: string }>(
      `SELECT user_id::text AS user_id
         FROM public.user_roles
        WHERE role = $1::public.app_role
        LIMIT 1`,
      [role],
    );
    if (lookup.rows.length === 0) {
      throw new Error(
        `Teste exige pelo menos 1 usuário com role '${role}' no banco de preview. ` +
          `Cadastre um antes de rodar a suíte de integração.`,
      );
    }
    const actorId = lookup.rows[0].user_id;

    await client.queryArray("BEGIN");
    try {
      // SET LOCAL — só vale dentro desta transação.
      await client.queryArray(
        `SELECT set_config('request.jwt.claims', $1::text, true)`,
        [JSON.stringify({ sub: actorId, role: "authenticated" })],
      );

      const tx: TxClient = {
        async query<R>(sql: string, args?: QueryArguments) {
          const r = await client.queryObject<R>(sql, args);
          return r.rows as R[];
        },
        async queryOne<R>(sql: string, args?: QueryArguments) {
          const r = await client.queryObject<R>(sql, args);
          return (r.rows[0] as R) ?? null;
        },
      };
      const out = await cb(tx, actorId);
      // Sempre rollback — testes não persistem.
      await client.queryArray("ROLLBACK");
      return out;
    } catch (err) {
      try { await client.queryArray("ROLLBACK"); } catch { /* noop */ }
      throw err;
    }
  } finally {
    try { await client.end(); } catch { /* noop */ }
  }
}

/** Gera UUID v4 sem dependência externa. Usado para CRMs/CNPJs aleatórios. */
export function newUuid(): string {
  return crypto.randomUUID();
}
