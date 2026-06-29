import { useEffect } from "react";

type OptionLike = { id: string; code: string };

/**
 * Sincroniza o `code` exibido no Select "Tipo de pagamento" com o `id`
 * escolhido no modal pré-wizard (PaymentModeSelectModal grava apenas o id
 * em sessionStorage / URL).
 *
 * Roda sempre que `paymentTypeId` ou a lista carregada mudar — inclusive:
 *  - após reload de página (paymentType começa vazio mas o id vem da URL/storage);
 *  - quando o id muda para outro tipo (mantém o code do Select coerente).
 */
export function usePaymentTypeCodeSync<TCode extends string>(params: {
  paymentTypeId: string | null;
  paymentTypeOptions: OptionLike[];
  paymentType: TCode | "";
  setPaymentType: (code: TCode) => void;
}): void {
  const { paymentTypeId, paymentTypeOptions, paymentType, setPaymentType } = params;
  useEffect(() => {
    if (!paymentTypeId) return;
    if (paymentTypeOptions.length === 0) return;
    const match = paymentTypeOptions.find((o) => o.id === paymentTypeId);
    if (match?.code && match.code !== paymentType) {
      setPaymentType(match.code as TCode);
    }
  }, [paymentTypeId, paymentTypeOptions, paymentType, setPaymentType]);
}
