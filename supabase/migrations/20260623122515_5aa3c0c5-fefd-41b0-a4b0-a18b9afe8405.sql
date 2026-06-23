
UPDATE public.payment_parecer_report_rows
SET
  atendimento = COALESCE(atendimento, NULLIF(raw->>'Atend. Paciente',''), NULLIF(raw->>'Atendimento','')),
  medico_resposta = COALESCE(
    medico_resposta,
    NULLIF(regexp_replace(COALESCE(raw->>'Médico Resposta Parecer', raw->>'Medico Resposta Parecer',''), '\s*[\(\[]\s*CRM[^\)\]]*[\)\]]\s*$', '', 'i'), '')
  ),
  medico_resposta_crm = COALESCE(
    medico_resposta_crm,
    (regexp_match(COALESCE(raw->>'Médico Resposta Parecer', raw->>'Medico Resposta Parecer',''), 'CRM[^\d]*?(\d{2,7})', 'i'))[1]
  ),
  medico_solicitante = COALESCE(
    medico_solicitante,
    NULLIF(regexp_replace(COALESCE(raw->>'Médico Solic. Parecer', raw->>'Medico Solic. Parecer',''), '\s*[\(\[]\s*CRM[^\)\]]*[\)\]]\s*$', '', 'i'), '')
  ),
  espec_origem = COALESCE(espec_origem, NULLIF(raw->>'Espec. Méd. Solic. Parecer',''), NULLIF(raw->>'Espec. Med. Solic. Parecer','')),
  espec_destino = COALESCE(espec_destino, NULLIF(raw->>'Espec. Dest. Parecer',''))
WHERE raw IS NOT NULL
  AND (atendimento IS NULL OR medico_resposta IS NULL OR medico_resposta_crm IS NULL);
