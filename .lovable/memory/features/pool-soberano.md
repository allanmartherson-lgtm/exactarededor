---
name: Pool é soberano no rateio
description: Em pagamentos de pool, as PJs do pool definem o repasse — doctor_companies não bloqueia distribuição
type: feature
---
Quando `payments.pool_id` está preenchido, o repasse pertence às PJs cadastradas em `pool_participants` daquele pool, não às PJs próprias dos médicos.

Regras:
- `distribute_unmatched_items_by_doctor` ignora `doctor_companies` em lote de pool e distribui itens entre as PJs do pool (round-robin estável por hash do nome do médico). O cálculo do pool faz o rateio financeiro depois.
- Lote comum (sem `pool_id`) continua exigindo `doctor_companies` cruzando com participantes do `payment_company_groups`.
- Não confundir com a regra global "médico sem PJ não recebe repasse" — essa vale para lotes habituais. Em pool, a PJ do médico é irrelevante: quem recebe é a PJ participante do pool.
- UI: botão se chama "Distribuir entre PJs do pool"; só pede vínculo médico→PJ quando NÃO é pool.
