import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type DispatchResult =
  | { ok: true; data: any }
  | { ok: false; blocked: true; reason: string; message: string }
  | { ok: false; blocked: false; error: any };

/**
 * Wrapper de supabase.functions.invoke("dispatch-payment-analysis") que detecta
 * gates de negócio (HTTP 409) — em especial `missing_parecer_report` — e devolve
 * resultado tipado para a UI tratar sem cair em erro genérico / tela branca.
 *
 * Se `showToast` (padrão true) e o gate for `missing_parecer_report`, já exibe
 * o toast amigável pedindo o relatório do Tasy.
 */
export async function invokeDispatchAnalysis(
  body: Record<string, unknown>,
  opts: { showToast?: boolean } = {},
): Promise<DispatchResult> {
  const showToast = opts.showToast !== false;
  try {
    const { data, error } = await supabase.functions.invoke("dispatch-payment-analysis", { body });
    if (error) {
      // FunctionsHttpError: extrai payload da Response para detectar gate 409.
      let blockedPayload: any = null;
      try {
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          blockedPayload = await ctx.clone().json();
        }
      } catch { /* noop */ }
      if (blockedPayload?.blocked) {
        if (showToast && blockedPayload.reason === "missing_parecer_report") {
          toast({
            title: "Relatório de Parecer obrigatório",
            description:
              blockedPayload.message ||
              "Anexe o relatório de Parecer do Tasy antes de iniciar a análise.",
            variant: "destructive",
          });
        }
        return {
          ok: false,
          blocked: true,
          reason: String(blockedPayload.reason ?? "blocked"),
          message: String(blockedPayload.message ?? ""),
        };
      }
      return { ok: false, blocked: false, error };
    }
    if (data?.blocked) {
      if (showToast && data.reason === "missing_parecer_report") {
        toast({
          title: "Relatório de Parecer obrigatório",
          description:
            data.message ||
            "Anexe o relatório de Parecer do Tasy antes de iniciar a análise.",
          variant: "destructive",
        });
      }
      return {
        ok: false,
        blocked: true,
        reason: String(data.reason ?? "blocked"),
        message: String(data.message ?? ""),
      };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, blocked: false, error };
  }
}
