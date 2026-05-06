
## Objetivo

Hoje o campo `specialty` em `payment_items` recebe o **tipo de ato** (Cirurgia, Anestesia, Visita…), não a **especialidade médica** (Urologia, Ortopedia…). Isso quebra o filtro de especialidade nas regras. Vamos separar os dois conceitos e ensinar o motor a inferir a especialidade médica a partir de um mapa código TUSS → especialidade.

## Etapas

### 1. Schema — separar conceitos

Migration:
- Adicionar coluna `tipo_item TEXT` em `payment_items`.
- Copiar `specialty → tipo_item` para todos os registros existentes.
- Limpar `specialty` (passa a representar especialidade médica, populado pelo motor).
- Criar tabela `procedure_specialty_map`:
  - `procedure_code` (PK)
  - `medical_specialty`
  - `status` (`aprovado` | `sugerido` | `rejeitado`)
  - `confidence_pct`, `sample_size`
  - `approved_by`, `approved_at`, `created_at`, `updated_at`
  - RLS: leitura para workflow autenticado; escrita para admin/diretor.

### 2. Motor de regras — resolver especialidade médica em runtime

Em `supabase/functions/_shared/rulesEngine.ts`:
- Novo helper `resolveMedicalSpecialty(item, doctorsCache, mapCache)`:
  1. `mapCache[item.procedure_code]` se status=aprovado → usa.
  2. Se médico tem 1 só especialidade → usa.
  3. Se mapa devolve especialidade e médico tem várias → interseção.
  4. Caso contrário → `null` (regras com whitelist são puladas, cai default).
- `analyze-payment` carrega mapa aprovado + cache de doctors antes do loop.
- `ruleAcceptsItemSpecialty` passa a usar `specialty_efetiva` em vez de `item.specialty`.
- `selection_trace` registra `specialty_resolved` + fonte (`map`, `doctor`, `null`).

### 3. Job de sugestões (nightly)

Edge function `suggest-procedure-specialties`:
- Para cada `procedure_code` com ≥10 ocorrências em `payment_items`:
  - Conta especialidades dos médicos que executaram (via `doctors.specialties`).
  - Se uma especialidade concentra ≥60% das ocorrências → cria/atualiza linha em `procedure_specialty_map` com `status='sugerido'`, `confidence_pct`, `sample_size`.
  - Não sobrescreve linhas com `status='aprovado'` ou `status='rejeitado'`.
- Agendar via `pg_cron` 1x/dia às 03:00.

### 4. Tela de aprovação (admin)

Nova rota `/admin/mapa-especialidades`:
- Lista entradas agrupadas por status (sugeridas no topo).
- Colunas: código, descrição (do TUSS mais frequente), especialidade sugerida, confiança, amostra.
- Ações: Aprovar / Editar especialidade / Rejeitar / Adicionar manual.
- Acessível só para admin/diretor (link no menu lateral).

### 5. Importador / UI

- Importador de pagamento: campo lido como `tipo_item` (mantém parsing atual, só renomeia).
- Tela de detalhe do pagamento: exibir `tipo_item` na coluna onde hoje aparece "Cirurgia"; adicionar coluna/tooltip "Especialidade (inferida)" com a fonte (mapa/médico).
- Cadastro de regras: ajustar label do campo para deixar claro que é "Especialidade médica" (não tipo de ato).

### 6. Backfill

Após aprovar o primeiro lote de sugestões, rodar reanálise dos pagamentos pendentes/recentes para que itens passem a casar com regras corretas.

## Detalhes técnicos

- Cache do mapa carregado uma vez por execução de `analyze-payment` (Map em memória).
- Doctors carregados em batch por `crm`/`crm_uf` ou `full_name` normalizado, conforme já feito hoje.
- Job nightly idempotente: usa `INSERT ... ON CONFLICT (procedure_code) DO UPDATE` filtrado por `status <> 'aprovado' AND status <> 'rejeitado'`.
- Cron via `pg_cron` + `pg_net` chamando a edge function (não migration — vai pelo insert tool com a anon key).

## Fora de escopo desta etapa

- Versionamento do mapa.
- Aprendizado considerando convênio/setor (só especialidade por enquanto).
- Migração retroativa de regras já cadastradas (admin revisa manualmente após renomear o label).
