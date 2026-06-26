
-- 1) Restrict storage upload policy to hospital members
DROP POLICY IF EXISTS "Hospital members can upload email approval files" ON storage.objects;

CREATE POLICY "Hospital members can upload email approval files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-email-approvals'
  AND EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid()
  )
);

-- 2) Add permissive SELECT policy for payment_job_context, scoped by hospital
CREATE POLICY "Hospital members can read job context"
ON public.payment_job_context
FOR SELECT
TO authenticated
USING (
  hospital_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid()
      AND uh.hospital_id = payment_job_context.hospital_id
  )
);
