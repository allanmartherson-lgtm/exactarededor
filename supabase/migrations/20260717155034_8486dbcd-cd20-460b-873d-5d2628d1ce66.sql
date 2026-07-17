
REVOKE ALL ON FUNCTION public.get_overlap_audit(date, date, text, integer, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_overlap_audit(date, date, text, integer, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overlap_audit(date, date, text, integer, text, text[]) TO service_role;
