/**
 * Sub-Onda 2D — Helper para testes de integração contra o banco do preview.
 *
 * Provê `withAuthenticatedTx(userId, role, cb)`:
 *   1) Abre conexão Postgres usando `SUPABASE_DB_URL` (env).
 *   2) Inicia transação.
 *   3) Insere `user_roles(user_id=userId, role=role)` (rollback no fim, sem lixo).
 *   4) `SET LOCAL request.jwt.claims = '{"sub":"<userId>"}'` para `auth.uid()`.
 *   5) Roda o callback recebendo um `tx` com método `query(sql, args)`.
 *   6) `ROLLBACK` sempre — nada é persistido.
 *
 * Conexão NUNCA é hardcoded. Se `SUPABASE_DB_URL` não estiver definida,
 * lança erro explicativo (não silenciar testes de integração).
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
  userId: string,
  role: "admin" | "diretor" | "validador" | "analista",
  cb: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const connStr = requireDbUrl();
  const client = new Client(connStr);
  await client.connect();
  try {
    await client.queryArray("BEGIN");
    try {
      // Seed isolado: role no escopo da transação (rollback remove).
      await client.queryArray(
        "INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::app_role) ON CONFLICT DO NOTHING",
        [userId, role],
      );
      // SET LOCAL — só vale dentro desta transação.
      await client.queryArray(
        `SELECT set_config('request.jwt.claims', $1::text, true)`,
        [JSON.stringify({ sub: userId, role: "authenticated" })],
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
      const out = await cb(tx);
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

/** Gera UUID v4 sem dependência externa (Deno tem crypto.randomUUID). */
export function newUuid(): string {
  return crypto.randomUUID();
}
