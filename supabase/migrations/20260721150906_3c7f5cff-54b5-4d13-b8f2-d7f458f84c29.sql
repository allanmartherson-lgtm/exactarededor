
DROP POLICY IF EXISTS zeev_knowledge_read_all ON public.zeev_knowledge;
CREATE POLICY zeev_knowledge_read_authenticated
  ON public.zeev_knowledge
  FOR SELECT
  TO authenticated
  USING (active = true);
REVOKE SELECT ON public.zeev_knowledge FROM anon;

CREATE OR REPLACE FUNCTION public.trg_zeev_knowledge_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.body, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
