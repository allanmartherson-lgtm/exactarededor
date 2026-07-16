DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.ai_checklist_cache;
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting DROP: ai_checklist_cache has % rows', n;
  END IF;
END $$;

DROP TABLE public.ai_checklist_cache;