-- Fecha o rastro de schema drift: estes 4 valores de payment_status já
-- existem no banco (usados em produção pelo app e por outras migrations)
-- mas nenhuma migration deste repositório os adicionou via ALTER TYPE — ou
-- seja, um `supabase db reset` recriando o schema do zero a partir das
-- migrations geraria um enum sem eles, quebrando em runtime.
--
-- Sem efeito em bancos onde já existem (IF NOT EXISTS). Não altera nenhum
-- dado nem comportamento — só documenta retroativamente uma alteração de
-- schema que já foi aplicada.
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'em_questionamento';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'revisao_pos_aprovacao';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'aprovado_parcial';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'concluido_validacao';
