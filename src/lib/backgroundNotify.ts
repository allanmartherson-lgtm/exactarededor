// Notificação nativa do navegador para avisar o analista quando o parse
// termina e ele está em outra aba. Sem service worker — Notification API
// simples. Se a permissão foi negada, silenciosamente vira no-op (o toast
// da tela cobre o caso). Uma flag global evita pedir permissão em loop.

let permissionAsked = false;

export function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

/**
 * Pede permissão de notificação (uma vez por sessão) e dispara a notificação
 * apenas se a aba estiver oculta. Retorna a instância criada ou null.
 */
export async function notifyIfHidden(
  title: string,
  body: string,
): Promise<Notification | null> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return null;
  if (!isPageHidden()) return null;

  try {
    if (Notification.permission === "default" && !permissionAsked) {
      permissionAsked = true;
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return null;
    const n = new Notification(title, { body, tag: "exacta-parse-done" });
    // Foca a aba ao clicar na notificação — atalho para o analista voltar
    // direto para a tela onde estava trabalhando.
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch {
        /* noop */
      }
    };
    return n;
  } catch {
    return null;
  }
}

/**
 * Registra um listener one-shot: quando a aba voltar a ficar visível,
 * chama `cb` uma única vez. Útil para mostrar o toast "de volta ao trabalho"
 * só quando o analista realmente retorna.
 */
export function onNextVisible(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  if (!document.hidden) {
    cb();
    return () => {};
  }
  const handler = () => {
    if (!document.hidden) {
      document.removeEventListener("visibilitychange", handler);
      cb();
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
