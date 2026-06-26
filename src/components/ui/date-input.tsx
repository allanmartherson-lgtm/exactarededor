import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Input mascarado para datas no formato brasileiro (dd/mm/aaaa).
 *
 * Armazena/expõe o valor como ISO `yyyy-mm-dd` (compatível com
 * <input type="date"> e Postgres `date`), mas o usuário sempre vê e digita
 * `dd/mm/aaaa`. Aceita colagem em qualquer formato razoável.
 */
export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Valor ISO `yyyy-mm-dd` (ou vazio). */
  value?: string | null;
  /** Recebe ISO `yyyy-mm-dd` ou "" quando vazio/inválido. */
  onChange?: (isoOrEmpty: string) => void;
}

const isoToBr = (iso?: string | null): string => {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const brToIso = (br: string): string => {
  const digits = br.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const d = digits.slice(0, 2);
  const mo = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  const dn = Number(d);
  const mn = Number(mo);
  const yn = Number(y);
  if (dn < 1 || dn > 31 || mn < 1 || mn > 12 || yn < 1900 || yn > 2999) return "";
  return `${y}-${mo}-${d}`;
};

const formatMask = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, placeholder = "dd/mm/aaaa", ...rest }, ref) => {
    const [text, setText] = React.useState<string>(() => isoToBr(value));

    // Sincroniza quando o valor externo muda (ex.: reset de formulário).
    React.useEffect(() => {
      const incoming = isoToBr(value);
      if (incoming !== text && brToIso(text) !== (value ?? "")) {
        setText(incoming);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const masked = formatMask(e.target.value);
      setText(masked);
      const iso = brToIso(masked);
      onChange?.(iso);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // Em blur, se inválido, limpa para evitar lixo silencioso.
      if (text && !brToIso(text)) {
        setText("");
        onChange?.("");
      }
      rest.onBlur?.(e);
    };

    return (
      <Input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        className={cn(className)}
        {...rest}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  },
);
DateInput.displayName = "DateInput";
