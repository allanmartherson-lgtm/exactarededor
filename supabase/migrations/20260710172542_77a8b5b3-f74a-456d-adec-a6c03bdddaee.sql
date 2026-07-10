ALTER TABLE public.reconciliation_items DROP CONSTRAINT IF EXISTS reconciliation_items_action_taken_check;
ALTER TABLE public.reconciliation_items ADD CONSTRAINT reconciliation_items_action_taken_check
  CHECK (action_taken = ANY (ARRAY[
    'incorporar_credito'::text,
    'incorporar_debito'::text,
    'marcar_glosa'::text,
    'revisar_manual'::text,
    'ignorar'::text,
    'cancelado_conciliacao'::text,
    'rolar_debito_residual'::text
  ]));