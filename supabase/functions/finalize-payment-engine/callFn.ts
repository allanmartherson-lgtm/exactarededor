// Módulo dedicado para a chamada com retry/backoff — extraído do index.ts
// para poder ser testado isoladamente (Deno) sem precisar bootar o handler
// completo, que exige SUPABASE_URL / SERVICE_ROLE_KEY.
//
// Contrato crítico coberto por callFn.test.ts:
//   - HTTP 429 vindo como RESPOSTA (não exceção) NUNCA pode voltar { ok: true }.
//   - Após esgotar retries, retorno é { ok: false, status: 429 }.
//   - Honra Retry-After (segundos ou HTTP date) até MAX_BACKOFF_MS.

export type CallFnResult = { ok: boolean; status: number; body: string };

export type CallFnOptions = {
  baseUrl: string;
  serviceKey: string;
  maxRetries?: number;
  maxBackoffMs?: number;
  /** Injetável para testes evitarem waits reais. */
  sleep?: (ms: number) => Promise<void>;
  /** Injetável para testes stubbarem fetch. */
  fetchImpl?: typeof fetch;
};

/** 5xx de infraestrutura (crash/boot timeout/saturação do edge worker). */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);


export function parseRetryAfterMs(headerVal: string | null): number {
  if (!headerVal) return 0;
  const n = Number(headerVal);
  if (Number.isFinite(n) && n > 0) return Math.floor(n * 1000);
  const t = Date.parse(headerVal);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return 0;
}

export async function callFn(
  name: string,
  body: unknown,
  opts: CallFnOptions,
): Promise<CallFnResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fetchImpl = opts.fetchImpl ?? fetch;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetchImpl(`${opts.baseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.serviceKey}` },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      // 429 vindo como RESPOSTA (não thrown): tenta ler Retry-After e retentar.
      if (r.status === 429 && attempt < maxRetries) {
        const suggested = parseRetryAfterMs(r.headers.get("retry-after"));
        const backoff = Math.min(maxBackoffMs, Math.max(1000 * 2 ** attempt, suggested));
        console.warn(`[finalize] callFn(${name}) HTTP 429 — aguardando ${backoff}ms (tentativa ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
        attempt += 1;
        continue;
      }
      // 2026-08-08: 502/503/504 são crash / boot-timeout / saturação do worker
      // (não erro de negócio — esses voltam 4xx/500 com JSON). São transitórios
      // e as funções alvo são idempotentes (lock + upsert), então retentamos com
      // backoff em vez de pular silenciosamente a dedução daquela PJ.
      if (TRANSIENT_STATUSES.has(r.status) && attempt < maxRetries) {
        const suggested = parseRetryAfterMs(r.headers.get("retry-after"));
        const backoff = Math.min(maxBackoffMs, Math.max(2000 * 2 ** attempt, suggested));
        console.warn(`[finalize] callFn(${name}) HTTP ${r.status} transitório — aguardando ${backoff}ms (tentativa ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
        attempt += 1;
        continue;
      }
      // Contrato: 429 residual (após esgotar retries) NUNCA pode voltar ok=true.
      // r.ok já é false para 4xx/5xx, mas deixamos explícito para o leitor.
      return { ok: r.ok && r.status !== 429, status: r.status, body: txt };

    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; retryAfterMs?: number } | undefined;
      const msg = String(err?.message ?? e);
      const isRate = err?.name === "RateLimitError" || /rate limit/i.test(msg);
      if (!isRate || attempt >= maxRetries) {
        console.warn(`[finalize] callFn(${name}) desistiu após ${attempt} tentativas`, msg);
        return { ok: false, status: 429, body: JSON.stringify({ error: msg, rate_limited: isRate }) };
      }
      const suggested = Number(err?.retryAfterMs ?? 0);
      const backoff = Math.min(maxBackoffMs, Math.max(1000 * 2 ** attempt, suggested));
      console.warn(`[finalize] callFn(${name}) rate-limited — aguardando ${backoff}ms (tentativa ${attempt + 1}/${maxRetries})`);
      await sleep(backoff);
      attempt += 1;
    }
  }
}
