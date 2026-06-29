/**
 * Teste de integração para usePaymentTypeCodeSync.
 *
 * Garante que, quando o modal pré-wizard grava apenas o `payment_type_id`,
 * o Select visível ("Tipo de pagamento") em NewPayment é preenchido com o
 * `code` correspondente assim que `usePaymentTypes` retorna a lista — inclusive
 * após reload (paymentType começa vazio) e quando o id muda para outro tipo.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { usePaymentTypeCodeSync } from "../usePaymentTypeCodeSync";

type Option = { id: string; code: string };

function useHarness(initialId: string | null, initialOptions: Option[]) {
  const [paymentTypeId, setPaymentTypeId] = useState<string | null>(initialId);
  const [paymentTypeOptions, setPaymentTypeOptions] = useState<Option[]>(initialOptions);
  const [paymentType, setPaymentType] = useState<string | "">("");
  usePaymentTypeCodeSync({
    paymentTypeId,
    paymentTypeOptions,
    paymentType: paymentType as any,
    setPaymentType: (c) => setPaymentType(c),
  });
  return { paymentType, setPaymentTypeId, setPaymentTypeOptions };
}

describe("usePaymentTypeCodeSync", () => {
  const opts: Option[] = [
    { id: "id-consulta", code: "consulta" },
    { id: "id-parecer", code: "parecer" },
    { id: "id-cirurgia", code: "cirurgia" },
  ];

  it("preenche o code quando a lista de tipos carrega (cenário de reload com id no storage)", () => {
    // Simula reload: paymentTypeId já vem da URL/sessionStorage, mas paymentTypeOptions
    // ainda está vazio porque usePaymentTypes está carregando.
    const { result, rerender } = renderHook(
      ({ id, options }: { id: string | null; options: Option[] }) => {
        const [paymentType, setPaymentType] = useState<string | "">("");
        usePaymentTypeCodeSync({
          paymentTypeId: id,
          paymentTypeOptions: options,
          paymentType: paymentType as any,
          setPaymentType: (c) => setPaymentType(c),
        });
        return paymentType;
      },
      { initialProps: { id: "id-parecer", options: [] as Option[] } },
    );

    expect(result.current).toBe("");

    // Lista carrega → effect deve disparar e preencher o code.
    rerender({ id: "id-parecer", options: opts });
    expect(result.current).toBe("parecer");
  });

  it("ressincroniza quando o paymentTypeId muda para outro tipo", () => {
    const { result } = renderHook(() => useHarness("id-consulta", opts));

    expect(result.current.paymentType).toBe("consulta");

    act(() => result.current.setPaymentTypeId("id-cirurgia"));
    expect(result.current.paymentType).toBe("cirurgia");
  });

  it("não dispara setPaymentType quando o code atual já bate (evita loop)", () => {
    const setPaymentType = vi.fn();
    renderHook(() =>
      usePaymentTypeCodeSync({
        paymentTypeId: "id-consulta",
        paymentTypeOptions: opts,
        paymentType: "consulta",
        setPaymentType,
      }),
    );
    expect(setPaymentType).not.toHaveBeenCalled();
  });

  it("ignora quando paymentTypeId é null", () => {
    const setPaymentType = vi.fn();
    renderHook(() =>
      usePaymentTypeCodeSync({
        paymentTypeId: null,
        paymentTypeOptions: opts,
        paymentType: "",
        setPaymentType,
      }),
    );
    expect(setPaymentType).not.toHaveBeenCalled();
  });

  it("ignora quando o id não bate com nenhuma opção carregada", () => {
    const setPaymentType = vi.fn();
    renderHook(() =>
      usePaymentTypeCodeSync({
        paymentTypeId: "id-inexistente",
        paymentTypeOptions: opts,
        paymentType: "",
        setPaymentType,
      }),
    );
    expect(setPaymentType).not.toHaveBeenCalled();
  });
});
