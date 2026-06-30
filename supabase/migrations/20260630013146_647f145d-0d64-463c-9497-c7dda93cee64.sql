-- Fase D, passo 0: realinhar UUIDs de item_types e payment_models para baterem
-- com os UUIDs históricos de payment_types (mesmo code). Depois desta migration,
-- toda FK/JSON/array que hoje guarda um payment_types.id passa a apontar também
-- para o item_types.id (ou payment_models.id) correspondente, sem precisar de
-- remapeamento adicional no D2.

BEGIN;

-- Desliga triggers temporariamente para evitar que a sincronia da Fase B'
-- reverta nossas atualizações.
SET LOCAL session_replication_role = replica;

-- ============ item_types: realinhar 7 codes compartilhados ============
CREATE TEMP TABLE _it_remap AS
SELECT it.id AS old_id, pt.id AS new_id, it.code
FROM public.item_types it
JOIN public.payment_types pt ON pt.code = it.code
WHERE it.id <> pt.id;

-- Atualiza referências antes de mexer na PK
UPDATE public.payment_items pi
   SET item_type_id = m.new_id
  FROM _it_remap m
 WHERE pi.item_type_id = m.old_id;

UPDATE public.rules r
   SET item_type_id = m.new_id
  FROM _it_remap m
 WHERE r.item_type_id = m.old_id;

UPDATE public.procedure_classifications pc
   SET item_type_id = m.new_id
  FROM _it_remap m
 WHERE pc.item_type_id = m.old_id;

-- Swap dos IDs em item_types
UPDATE public.item_types it
   SET id = m.new_id
  FROM _it_remap m
 WHERE it.id = m.old_id;

-- ============ payment_models: realinhar 4 codes compartilhados ============
CREATE TEMP TABLE _pm_remap AS
SELECT pm.id AS old_id, pt.id AS new_id, pm.code
FROM public.payment_models pm
JOIN public.payment_types pt ON pt.code = pm.code
WHERE pm.id <> pt.id;

UPDATE public.rules r
   SET payment_model_id = m.new_id
  FROM _pm_remap m
 WHERE r.payment_model_id = m.old_id;

UPDATE public.payments p
   SET payment_model_id = m.new_id
  FROM _pm_remap m
 WHERE p.payment_model_id = m.old_id;

UPDATE public.payment_models pm
   SET id = m.new_id
  FROM _pm_remap m
 WHERE pm.id = m.old_id;

SET LOCAL session_replication_role = DEFAULT;

COMMIT;

-- Verificação: pós-migration, todo code compartilhado deve ter mesmo id
-- nas três tabelas. Se algo divergir, levanta erro imediato.
DO $$
DECLARE
  diff_count int;
BEGIN
  SELECT COUNT(*) INTO diff_count
  FROM public.payment_types pt
  LEFT JOIN public.item_types it ON it.code = pt.code
  LEFT JOIN public.payment_models pm ON pm.code = pt.code
  WHERE (it.id IS NOT NULL AND it.id <> pt.id)
     OR (pm.id IS NOT NULL AND pm.id <> pt.id);
  IF diff_count > 0 THEN
    RAISE EXCEPTION 'Realinhamento de UUIDs falhou: % codes ainda divergem', diff_count;
  END IF;
END $$;