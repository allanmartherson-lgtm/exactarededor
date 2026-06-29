/**
 * Zeev Screen Context — Fase 2.
 *
 * Pub/sub leve em memória onde telas publicam "o que está acontecendo agora"
 * (regra em edição, conflitos detectados, filtros aplicados, etc). O
 * ZeevExecutorChat lê o snapshot atual no envio de cada pergunta e o envia
 * como `screen_context` ao edge function `zeev-executor`, que repassa ao LLM
 * para diagnósticos cirúrgicos sem precisar adivinhar o estado da UI.
 *
 * Princípios:
 *  - Apenas LEITURA é publicada (nunca tokens/PII/segredos).
 *  - Telas devem CHAMAR clearZeevContext(key) no unmount/fechamento.
 *  - Snapshot tem teto de tamanho para não explodir o prompt.
 */

const store = new Map<string, unknown>();
const listeners = new Set<() => void>();

const MAX_JSON_BYTES = 8 * 1024; // 8KB por publish — corte defensivo

function safeSize(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function publishZeevContext(key: string, value: unknown): void {
  if (!key) return;
  if (value === null || value === undefined) {
    if (store.has(key)) {
      store.delete(key);
      listeners.forEach((l) => l());
    }
    return;
  }
  if (safeSize(value) > MAX_JSON_BYTES) {
    // recusa silenciosa — telas podem inspecionar via getCurrentZeevContext
    return;
  }
  store.set(key, value);
  listeners.forEach((l) => l());
}

export function clearZeevContext(key: string): void {
  if (store.delete(key)) {
    listeners.forEach((l) => l());
  }
}

export function getCurrentZeevContext(): Record<string, unknown> | null {
  if (store.size === 0) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of store.entries()) out[k] = v;
  return out;
}

export function subscribeZeevContext(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
