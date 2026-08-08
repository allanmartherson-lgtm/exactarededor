// Contrato crítico: HTTP 429 no finalize-payment-engine NUNCA pode ser
// contabilizado como sucesso. Se voltar { ok: true } com status 429, o pipeline
// downstream marca payment_engine_sources.read_at e a fonte é pulada em
// execuções futuras — resultando em DRE/glosa/mín-garantido zerados sem sinal.
//
// Rode: deno test supabase/functions/finalize-payment-engine/callFn.test.ts --allow-net --allow-env
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callFn, parseRetryAfterMs } from "./callFn.ts";

// Injetáveis que evitam waits reais / rede.
const noSleep = (_ms: number) => Promise.resolve();

function makeFetchAlways(status: number, headers: Record<string, string> = {}, body = ""): typeof fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) => {
    return Promise.resolve(new Response(body, { status, headers }));
  }) as typeof fetch;
}

function makeFetchSequence(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>): { fetchImpl: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const fetchImpl = ((_input: string | URL | Request, _init?: RequestInit) => {
    const r = responses[Math.min(state.calls, responses.length - 1)];
    state.calls += 1;
    return Promise.resolve(new Response(r.body ?? "", { status: r.status, headers: r.headers ?? {} }));
  }) as typeof fetch;
  return { fetchImpl, get calls() { return state.calls; } } as never;
}

Deno.test("HTTP 429 persistente esgota retries e retorna ok=false", async () => {
  const fetchImpl = makeFetchAlways(429, { "retry-after": "1" }, '{"error":"rate limit"}');
  const res = await callFn("apply-company-deductions", {}, {
    baseUrl: "http://mock",
    serviceKey: "k",
    maxRetries: 2,
    maxBackoffMs: 10,
    sleep: noSleep,
    fetchImpl,
  });
  assertEquals(res.ok, false, "HTTP 429 residual jamais pode voltar ok=true");
  assertEquals(res.status, 429);
});

Deno.test("HTTP 429 residual mesmo sem retry (maxRetries=0) volta ok=false", async () => {
  // Regressão específica: garante que r.ok && r.status !== 429 no return
  // do callFn não deixa 429 passar como sucesso quando não há retry configurado.
  const fetchImpl = makeFetchAlways(429);
  const res = await callFn("compute-company-financials", {}, {
    baseUrl: "http://mock",
    serviceKey: "k",
    maxRetries: 0,
    maxBackoffMs: 10,
    sleep: noSleep,
    fetchImpl,
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 429);
});

Deno.test("HTTP 429 → 200 recupera e volta ok=true", async () => {
  const { fetchImpl } = makeFetchSequence([
    { status: 429, headers: { "retry-after": "1" } },
    { status: 200, body: '{"applied":3}' },
  ]);
  const res = await callFn("apply-minimum-guarantee", {}, {
    baseUrl: "http://mock",
    serviceKey: "k",
    maxRetries: 3,
    maxBackoffMs: 10,
    sleep: noSleep,
    fetchImpl,
  });
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
  assert(res.body.includes("applied"));
});

Deno.test("500 residual volta ok=false sem retry (não é 429)", async () => {
  const fetchImpl = makeFetchAlways(500, {}, '{"error":"boom"}');
  const res = await callFn("compute-company-financials", {}, {
    baseUrl: "http://mock",
    serviceKey: "k",
    maxRetries: 3,
    maxBackoffMs: 10,
    sleep: noSleep,
    fetchImpl,
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 500);
});

Deno.test("RateLimitError lançado pelo fetch respeita retryAfterMs e desiste após retries", async () => {
  class RateLimitError extends Error {
    override name = "RateLimitError";
    retryAfterMs = 1;
    constructor() { super("Rate limit exceeded for trace"); }
  }
  const fetchImpl = (() => { throw new RateLimitError(); }) as typeof fetch;
  const res = await callFn("apply-company-deductions", {}, {
    baseUrl: "http://mock",
    serviceKey: "k",
    maxRetries: 2,
    maxBackoffMs: 10,
    sleep: noSleep,
    fetchImpl,
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 429);
  assert(res.body.includes("rate_limited"));
});

Deno.test("parseRetryAfterMs aceita segundos e HTTP date, ignora inválido", () => {
  assertEquals(parseRetryAfterMs(null), 0);
  assertEquals(parseRetryAfterMs(""), 0);
  assertEquals(parseRetryAfterMs("5"), 5000);
  assertEquals(parseRetryAfterMs("nao-numero"), 0);
  const future = new Date(Date.now() + 2000).toUTCString();
  const ms = parseRetryAfterMs(future);
  assert(ms > 0 && ms <= 2000, `esperado 0<ms<=2000, veio ${ms}`);
});

// 2026-08-08: 502/503/504 (crash ou boot-timeout do edge worker) são
// transitórios — precisam ser retentados, não podem pular a dedução da PJ.
Deno.test("HTTP 502 transitório é retentado e recupera em 200", async () => {
  let calls = 0;
  const fetchImpl = ((_i: string | URL | Request, _init?: RequestInit) => {
    calls += 1;
    return Promise.resolve(new Response("", { status: calls === 1 ? 502 : 200 }));
  }) as typeof fetch;
  const res = await callFn("apply-company-deductions", {}, {
    baseUrl: "http://mock", serviceKey: "k", maxRetries: 3, maxBackoffMs: 10,
    sleep: noSleep, fetchImpl,
  });
  assertEquals(calls, 2, "deve ter retentado o 502");
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
});

Deno.test("HTTP 502 persistente esgota retries e retorna ok=false", async () => {
  const fetchImpl = makeFetchAlways(502);
  const res = await callFn("apply-company-deductions", {}, {
    baseUrl: "http://mock", serviceKey: "k", maxRetries: 2, maxBackoffMs: 10,
    sleep: noSleep, fetchImpl,
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 502);
});

Deno.test("HTTP 400 (erro de negócio) NÃO é retentado", async () => {
  let calls = 0;
  const fetchImpl = ((_i: string | URL | Request, _init?: RequestInit) => {
    calls += 1;
    return Promise.resolve(new Response('{"error":"payment_id obrigatório"}', { status: 400 }));
  }) as typeof fetch;
  const res = await callFn("apply-company-deductions", {}, {
    baseUrl: "http://mock", serviceKey: "k", maxRetries: 3, maxBackoffMs: 10,
    sleep: noSleep, fetchImpl,
  });
  assertEquals(calls, 1);
  assertEquals(res.ok, false);
  assertEquals(res.status, 400);
});
