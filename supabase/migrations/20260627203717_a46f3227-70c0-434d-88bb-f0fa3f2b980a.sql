ALTER TABLE public.learned_patterns DROP CONSTRAINT IF EXISTS learned_patterns_kind_check;
ALTER TABLE public.learned_patterns ADD CONSTRAINT learned_patterns_kind_check
  CHECK (kind = ANY (ARRAY['exclusao'::text, 'ausencia'::text, 'override_valor'::text, 'aceitar_divergencia'::text, 'zeev_preference'::text]));