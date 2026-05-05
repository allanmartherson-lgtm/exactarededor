update public.payment_items
set agreement_text = coalesce(
  nullif(btrim(raw_data->>'Convênio'), ''),
  nullif(btrim(raw_data->>'Convenio'), ''),
  nullif(btrim(raw_data->>'convenio'), ''),
  nullif(btrim(raw_data->>'convênio'), ''),
  agreement_text
)
where raw_data is not null
  and (
    nullif(btrim(raw_data->>'Convênio'), '') is not null
    or nullif(btrim(raw_data->>'Convenio'), '') is not null
    or nullif(btrim(raw_data->>'convenio'), '') is not null
    or nullif(btrim(raw_data->>'convênio'), '') is not null
  );