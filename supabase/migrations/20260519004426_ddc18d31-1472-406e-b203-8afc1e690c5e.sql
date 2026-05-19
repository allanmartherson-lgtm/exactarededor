
revoke execute on function public.get_payment_pivot(date, int, text, text) from public, anon;
grant execute on function public.get_payment_pivot(date, int, text, text) to authenticated;
