-- SELECT: cada médico só vê mensagens dos seus próprios doctor_id(s) vinculados e ativos
DROP POLICY IF EXISTS dm_medico_select ON public.doctor_messages;
CREATE POLICY dm_medico_select ON public.doctor_messages
  FOR SELECT TO authenticated
  USING (
    doctor_id IN (
      SELECT dpu.doctor_id
      FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid()
        AND dpu.active = true
    )
  );

-- UPDATE: médico só pode atualizar mensagens do próprio doctor_id (uso típico: read_by_doctor_at)
DROP POLICY IF EXISTS dm_medico_update ON public.doctor_messages;
CREATE POLICY dm_medico_update ON public.doctor_messages
  FOR UPDATE TO authenticated
  USING (
    doctor_id IN (
      SELECT dpu.doctor_id
      FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid()
        AND dpu.active = true
    )
  )
  WITH CHECK (
    doctor_id IN (
      SELECT dpu.doctor_id
      FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid()
        AND dpu.active = true
    )
  );

-- INSERT: garante que o médico só insere para o próprio doctor_id e como author_type='medico'
DROP POLICY IF EXISTS dm_medico_insert ON public.doctor_messages;
CREATE POLICY dm_medico_insert ON public.doctor_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_type = 'medico'
    AND author_user_id = auth.uid()
    AND doctor_id IN (
      SELECT dpu.doctor_id
      FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid()
        AND dpu.active = true
    )
  );

NOTIFY pgrst, 'reload schema';