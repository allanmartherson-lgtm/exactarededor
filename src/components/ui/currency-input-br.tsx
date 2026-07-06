import { Input } from "@/components/ui/input";
import { forwardRef, useMemo, type ComponentPropsWithoutRef } from "react";

type Props = Omit<ComponentPropsWithoutRef<typeof Input>, "type" | "value" | "onChange" | "inputMode"> & {
  /** Valor cru — string com ponto decimal ("3055.00") ou number. Vazio = campo em branco. */
  value: string | number | null | undefined;
  /** Emite string com ponto decimal ("3055.00"), compatível com numOrNull existente. */
  onChange: (raw: string) => void;
};

// Formatação BR padrão: 3.055,00
const fmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Input monetário no padrão brasileiro (R$ 3.055,00).
 *
 * Estratégia: extrai apenas dígitos do que o usuário digitou, trata como
 * centavos e formata para exibição. Por padrão emite string com ponto decimal
 * (ex.: "3055.00") — o pipeline downstream (numOrNull) já aceita ambos.
 *
 * Motivo: `type="number"` do HTML respeita o locale do SO do usuário, o que
 * fazia o valor 3055 aparecer como "3,055" (padrão en-US) em vez de "3.055,00".
 */
export const CurrencyInputBR = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, ...rest }, ref) => {
    const display = useMemo(() => {
      if (value === null || value === undefined || value === "") return "";
      const n =
        typeof value === "number"
          ? value
          : Number(String(value).replace(",", "."));
      if (!isFinite(n)) return "";
      return fmt.format(n);
    }, [value]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          if (!digits) {
            onChange("");
            return;
          }
          const cents = Number(digits);
          onChange((cents / 100).toFixed(2));
        }}
      />
    );
  },
);
CurrencyInputBR.displayName = "CurrencyInputBR";
