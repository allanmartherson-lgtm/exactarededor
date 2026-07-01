REVOKE ALL ON FUNCTION public.can_manage_new_payment(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollback_new_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_insert_new_payment_items(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_insert_new_payment_unmatched_items(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_new_payment(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rollback_new_payment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_new_payment_items(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_new_payment_unmatched_items(uuid, jsonb) TO authenticated, service_role;