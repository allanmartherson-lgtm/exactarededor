DROP TRIGGER IF EXISTS trg_sync_payout_models_type_columns ON public.payout_models;
DROP TRIGGER IF EXISTS sync_payout_models_type_columns ON public.payout_models;
DROP FUNCTION IF EXISTS public.sync_payout_models_type_columns() CASCADE;
ALTER TABLE public.payout_models DROP COLUMN IF EXISTS payment_type_id;