-- Adiciona tipo de item "Procedimento" para classificação override de itens.
-- Espelha o code numa entrada em payment_types (modelo legacy) para que o write
-- continua usando payment_type_id (ver useItemTypes.ts).
INSERT INTO public.item_types (code, label, active, sort_order, requires_tuss, is_default_when_no_tuss, tuss_default, tuss_codes_extra)
VALUES ('procedimento', 'Procedimento', true, 35, false, false, NULL, NULL)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, active = true, sort_order = EXCLUDED.sort_order;

INSERT INTO public.payment_types (code, label, active)
VALUES ('procedimento', 'Procedimento', true)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, active = true;
