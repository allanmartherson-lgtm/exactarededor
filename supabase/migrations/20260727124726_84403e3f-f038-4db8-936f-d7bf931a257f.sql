DROP POLICY IF EXISTS "authenticated insert own switch log" ON public.hospital_switch_log;

CREATE POLICY "authenticated insert own switch log"
ON public.hospital_switch_log
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.can_access_hospital(auth.uid(), new_hospital_id)
  AND (old_hospital_id IS NULL OR public.can_access_hospital(auth.uid(), old_hospital_id))
);