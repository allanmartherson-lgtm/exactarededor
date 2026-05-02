/**
 * Shim de compatibilidade — encaminha o toast legado (shadcn) para o `sonner`.
 *
 * Histórico: o projeto tinha duas pilhas de toast (shadcn e sonner) coexistindo
 * em App.tsx, gerando inconsistência visual e duas APIs. Para evitar tocar em
 * ~12 arquivos de uma só vez, mantivemos a assinatura `toast({ title,
 * description, variant })` e delegamos para o `sonner`.
 *
 * Novos arquivos devem importar `toast` direto de `"sonner"`.
 */
import * as React from "react";
import { toast as sonnerToast } from "sonner";

type Variant = "default" | "destructive";
type LegacyToastInput = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: Variant;
};

function nodeToString(n: React.ReactNode | undefined): string | undefined {
  if (n == null) return undefined;
  if (typeof n === "string" || typeof n === "number") return String(n);
  // Sonner aceita ReactNode em description; mas title precisa de string para
  // renderizar como toast. Cai num cast seguro.
  return String(n);
}

export function toast(input: LegacyToastInput | string) {
  if (typeof input === "string") {
    return sonnerToast(input);
  }
  const title = nodeToString(input.title) ?? "";
  const description = input.description as React.ReactNode | undefined;
  const opts = description != null ? { description } : undefined;
  if (input.variant === "destructive") {
    return sonnerToast.error(title, opts);
  }
  return sonnerToast(title, opts);
}

export function useToast() {
  // Mantém a interface mínima usada por componentes legados (Toaster shadcn).
  // Lista vazia: toda a UI é renderizada pelo <Sonner /> no App.tsx.
  return { toast, toasts: [] as Array<{ id: string }>, dismiss: (_?: string) => sonnerToast.dismiss() };
}
