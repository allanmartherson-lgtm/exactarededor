
-- Ensure no orphaned groups exist
DELETE FROM public.payment_company_groups 
WHERE payment_id NOT IN (SELECT id FROM public.payments);

-- Add missing foreign key for payment_id with cascade delete
ALTER TABLE public.payment_company_groups
ADD CONSTRAINT payment_company_groups_payment_id_fkey
FOREIGN KEY (payment_id)
REFERENCES public.payments(id)
ON DELETE CASCADE;

-- Add foreign key for company_id
ALTER TABLE public.payment_company_groups
ADD CONSTRAINT payment_company_groups_company_id_fkey
FOREIGN KEY (company_id)
REFERENCES public.companies(id)
ON DELETE SET NULL;

-- Add foreign keys for user references
ALTER TABLE public.payment_company_groups
ADD CONSTRAINT payment_company_groups_validated_by_fkey
FOREIGN KEY (validated_by)
REFERENCES auth.users(id)
ON DELETE SET NULL;

ALTER TABLE public.payment_company_groups
ADD CONSTRAINT payment_company_groups_approved_by_fkey
FOREIGN KEY (approved_by)
REFERENCES auth.users(id)
ON DELETE SET NULL;

ALTER TABLE public.payment_company_groups
ADD CONSTRAINT payment_company_groups_rejected_by_fkey
FOREIGN KEY (rejected_by)
REFERENCES auth.users(id)
ON DELETE SET NULL;
