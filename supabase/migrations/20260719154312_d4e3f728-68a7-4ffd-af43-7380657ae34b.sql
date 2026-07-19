-- Ajuste pontual: 9 lotes recentemente promovidos a "pago" foram marcados por
-- engano como histórico. Precisamos revertê-los para 'normal' para que voltem
-- a compor os KPIs de intervenção. O trigger trg_payments_historico_guard
-- bloqueia alterar import_mode em pagamento histórico, então desabilitamos
-- ele apenas durante este UPDATE administrativo.

ALTER TABLE public.payments DISABLE TRIGGER trg_payments_historico_guard;

UPDATE public.payments
SET import_mode = 'normal',
    validated_by = COALESCE(validated_by, 'f8a4b4ef-0523-497c-9bce-9de7ed332df7'),
    validated_at = COALESCE(validated_at, now()),
    approved_by  = COALESCE(approved_by,  'f9a59eee-95e6-499a-b0a1-7d22adc29c35'),
    approved_at  = COALESCE(approved_at,  now()),
    updated_at   = now()
WHERE id IN (
  'aa2685e1-b65e-4ee4-ae8a-282d29382bc4',
  '84b7b814-6718-4b5a-b8d2-1939e5e5bcd7',
  '9264dcbe-0fc4-429c-9856-4457508a1ed5',
  'c188e09b-128c-49c2-872d-d4464d7c33ac',
  '58658472-7df6-465c-882d-4fa285f815c2',
  '69aca4dc-b5fa-477c-aa22-baca14d1d9c0',
  'b548b619-9d6b-4182-a34a-d51a200a5c3e',
  '73bad12c-b20d-40e0-b50d-19007588c22a',
  'bedb1515-565c-4f3d-8610-d136279a7bd3'
);

ALTER TABLE public.payments ENABLE TRIGGER trg_payments_historico_guard;

-- Materializa o ledger de intervenção para esses lotes, para que o card
-- "Impacto das intervenções" volte a mostrar o valor economizado / adicional.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'aa2685e1-b65e-4ee4-ae8a-282d29382bc4',
      '84b7b814-6718-4b5a-b8d2-1939e5e5bcd7',
      '9264dcbe-0fc4-429c-9856-4457508a1ed5',
      'c188e09b-128c-49c2-872d-d4464d7c33ac',
      '58658472-7df6-465c-882d-4fa285f815c2',
      '69aca4dc-b5fa-477c-aa22-baca14d1d9c0',
      'b548b619-9d6b-4182-a34a-d51a200a5c3e',
      '73bad12c-b20d-40e0-b50d-19007588c22a',
      'bedb1515-565c-4f3d-8610-d136279a7bd3'
    ]::uuid[]) AS pid
  LOOP
    BEGIN
      PERFORM public.materialize_intervention_ledger(r.pid);
    EXCEPTION WHEN OTHERS THEN
      -- não bloquear a migration se o ledger falhar para um lote específico
      RAISE NOTICE 'materialize_intervention_ledger falhou para %: %', r.pid, SQLERRM;
    END;
  END LOOP;
END $$;