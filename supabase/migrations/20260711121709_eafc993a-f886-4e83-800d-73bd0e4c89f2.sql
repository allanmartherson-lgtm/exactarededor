
ALTER TABLE public.system_announcements
  ADD COLUMN IF NOT EXISTS target_roles text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.system_announcements.target_roles IS
  'Se vazio, aviso é global. Se preenchido, só aparece para usuários que possuem pelo menos uma das roles listadas.';

-- Restringir o aviso de baseline (11/07/2026) para admins apenas
UPDATE public.system_announcements
SET target_roles = ARRAY['admin']
WHERE title ILIKE '%baseline%' OR message ILIKE '%baseline de permiss%';
