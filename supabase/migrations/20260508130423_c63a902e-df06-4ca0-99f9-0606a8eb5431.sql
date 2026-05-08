
ALTER TABLE public.payment_observations
  ADD COLUMN is_question boolean NOT NULL DEFAULT false,
  ADD COLUMN resolved_at timestamptz NULL,
  ADD COLUMN resolved_by uuid NULL,
  ADD COLUMN answered_by_observation_id uuid NULL REFERENCES public.payment_observations(id) ON DELETE SET NULL;

CREATE INDEX idx_payment_observations_open_questions
  ON public.payment_observations (payment_id)
  WHERE is_question = true AND resolved_at IS NULL;

-- Migração retroativa: marca como pergunta as observações que historicamente
-- representavam questionamento (status_to=nf_questionada ou mensagem do recebedor).
UPDATE public.payment_observations
   SET is_question = true
 WHERE is_question = false
   AND (
     status_to = 'nf_questionada'
     OR message LIKE 'Recebedor da NF enviou um questionamento%'
   );

-- Para perguntas antigas que já tiveram observação posterior no mesmo lote,
-- marca como resolvida usando a observação seguinte como "answered_by".
WITH q AS (
  SELECT id, payment_id, created_at
    FROM public.payment_observations
   WHERE is_question = true AND resolved_at IS NULL
),
nxt AS (
  SELECT q.id AS question_id,
         (SELECT po.id FROM public.payment_observations po
           WHERE po.payment_id = q.payment_id
             AND po.created_at > q.created_at
             AND po.id <> q.id
           ORDER BY po.created_at ASC LIMIT 1) AS answer_id,
         (SELECT po.created_at FROM public.payment_observations po
           WHERE po.payment_id = q.payment_id
             AND po.created_at > q.created_at
             AND po.id <> q.id
           ORDER BY po.created_at ASC LIMIT 1) AS answer_at,
         (SELECT po.author_id FROM public.payment_observations po
           WHERE po.payment_id = q.payment_id
             AND po.created_at > q.created_at
             AND po.id <> q.id
           ORDER BY po.created_at ASC LIMIT 1) AS answer_author
    FROM q
)
UPDATE public.payment_observations po
   SET resolved_at = nxt.answer_at,
       resolved_by = nxt.answer_author,
       answered_by_observation_id = nxt.answer_id
  FROM nxt
 WHERE po.id = nxt.question_id
   AND nxt.answer_id IS NOT NULL;
