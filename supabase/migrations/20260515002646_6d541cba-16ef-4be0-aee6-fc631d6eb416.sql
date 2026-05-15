-- Clean up orphaned records first to allow constraint creation
DELETE FROM public.status_anomalies WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.ai_analysis_versions WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_director_notifications WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_processing_jobs WHERE payment_id NOT IN (SELECT id FROM public.payments);

-- 1. status_anomalies
ALTER TABLE public.status_anomalies
DROP CONSTRAINT IF EXISTS status_anomalies_payment_id_fkey;

ALTER TABLE public.status_anomalies
ADD CONSTRAINT status_anomalies_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;

-- 2. ai_analysis_versions
ALTER TABLE public.ai_analysis_versions
DROP CONSTRAINT IF EXISTS ai_analysis_versions_payment_id_fkey;

ALTER TABLE public.ai_analysis_versions
ADD CONSTRAINT ai_analysis_versions_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;

-- 3. payment_director_notifications
ALTER TABLE public.payment_director_notifications
DROP CONSTRAINT IF EXISTS payment_director_notifications_payment_id_fkey;

ALTER TABLE public.payment_director_notifications
ADD CONSTRAINT payment_director_notifications_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;

-- 4. payment_processing_jobs
ALTER TABLE public.payment_processing_jobs
DROP CONSTRAINT IF EXISTS payment_processing_jobs_payment_id_fkey;

ALTER TABLE public.payment_processing_jobs
ADD CONSTRAINT payment_processing_jobs_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;
