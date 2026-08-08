/**
 * Corrida entre uma promise e um timeout. Usada em operações destrutivas
 * (reimportação) para que uma chamada que nunca responde não deixe a UI
 * pendurada em "Reimportando…" para sempre.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError(`${label} não respondeu em ${Math.round(ms / 1000)}s. Nada foi confirmado — tente novamente.`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer!)) as Promise<T>;
}
