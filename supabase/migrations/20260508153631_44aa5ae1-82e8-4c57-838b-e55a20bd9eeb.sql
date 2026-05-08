-- Gap 4: Add 'arquivado' status (final archive after analyst confirmation post-lancado)
ALTER TYPE public.payment_status ADD VALUE 'arquivado' AFTER 'lancado';