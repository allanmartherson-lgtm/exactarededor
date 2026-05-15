
REVOKE EXECUTE ON FUNCTION public.learn_company_alias(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.link_unmatched_items_to_company(uuid, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ignore_unmatched_items(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learn_company_alias(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_unmatched_items_to_company(uuid, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ignore_unmatched_items(uuid, text, text) TO authenticated;
