ALTER TABLE public.item_types ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.payment_models ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS color text;

UPDATE public.item_types it SET description = COALESCE(it.description, pt.description), color = COALESCE(it.color, pt.color)
FROM public.payment_types pt WHERE pt.id = it.id;

UPDATE public.payment_models pm SET description = COALESCE(pm.description, pt.description), color = COALESCE(pm.color, pt.color)
FROM public.payment_types pt WHERE pt.id = pm.id;

DROP VIEW IF EXISTS public.payment_types_unified;

CREATE VIEW public.payment_types_unified AS
SELECT it.id, it.code, it.label, COALESCE(it.active, true) AS active, COALESCE(it.sort_order, 0) AS sort_order,
       it.description, it.color, 'item_type'::text AS origin, it.created_at, it.updated_at
FROM public.item_types it
UNION ALL
SELECT pm.id, pm.code, pm.label, COALESCE(pm.active, true) AS active, COALESCE(pm.sort_order, 0) AS sort_order,
       pm.description, pm.color, 'payment_model'::text AS origin, pm.created_at, pm.updated_at
FROM public.payment_models pm;

ALTER VIEW public.payment_types_unified SET (security_invoker = true);
GRANT SELECT ON public.payment_types_unified TO authenticated, anon;
GRANT ALL ON public.payment_types_unified TO service_role;