
-- 1) Desfaz absorção dos itens
UPDATE public.payment_items
   SET absorbed_by_pool_id = NULL,
       absorbed_by_run_id = NULL,
       empresa_tem_pool = false,
       empresa_liquido_total = NULL,
       rateio = NULL
 WHERE payment_id = '294cc542-6cb2-439c-ab45-dc6017e5814e'
   AND absorbed_by_pool_id = 'ffe42571-cced-4843-8892-97319e1b22cc';

-- 2) Apaga claims do pool nesse lote
DELETE FROM public.pool_item_claims
 WHERE pool_id = 'ffe42571-cced-4843-8892-97319e1b22cc'
   AND payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = '294cc542-6cb2-439c-ab45-dc6017e5814e'
   );

-- 3) Invalida runs desse pool nesse lote (mantém para auditoria)
UPDATE public.pool_calculation_runs
   SET invalidated_at = now(),
       invalidated_reason = COALESCE(invalidated_reason, 'limpeza_pool_filtros_vazios_2026-06-26')
 WHERE payment_id = '294cc542-6cb2-439c-ab45-dc6017e5814e'
   AND pool_id = 'ffe42571-cced-4843-8892-97319e1b22cc'
   AND invalidated_at IS NULL;

-- 4) Remove os 2 grupos sintéticos vazios criados pelo pool
DELETE FROM public.payment_company_groups
 WHERE payment_id = '294cc542-6cb2-439c-ab45-dc6017e5814e'
   AND items_count = 0
   AND company_id IN (
     '2b2e0a9c-3510-4b16-996b-46601996cea3', -- 2M CARDIO DERMA
     '5d6cded9-fee9-45dc-9fd2-6a383d86d6ae'  -- MORAIS E CARVALHO
   );
