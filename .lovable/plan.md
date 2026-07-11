# Tarefa 1 — Persistir planilha original para auditoria

## Situação atual

- Upload já grava no bucket `payment-files`, mas só o **primeiro** arquivo é anexado ao lote (`source_file_path = uploadedPaths[0]`). Lotes multi-arquivo (SAT + Bônus + Sobreaviso) perdem os demais.
- Sem hash → não é possível provar "a planilha X gerou o cálculo Y".
- Sem metadata (tamanho, mime, sheet_name, nome original preservado).
- 45 de 80 pagamentos recentes (56%) ficaram **sem** `source_file_path`. Erros silenciosos de upload (só checa `!upErr`) sem alertar o analista.
- Bucket `payment-files` **não tem RLS policy** — leitura/escrita hoje depende do papel do usuário no dashboard, o que é frágil.

## Objetivo

Guardar **todos** os arquivos enviados no lote, com hash SHA-256 e metadados, vinculados ao `payment_id`, acessíveis para reprocessar/auditar sem depender do que ficou serializado no motor.

## Plano

### 1. Tabela `payment_source_files` (nova)

```
payment_id            uuid  FK payments(id) ON DELETE CASCADE
storage_path          text  (payment-files/{user_id}/{ts}-{name})
original_filename     text
mime_type             text
size_bytes            bigint
sha256                text  (calculado no client antes do upload)
sheet_name            text  nullable (aba processada)
bucket_role           text  ('sat' | 'bonus' | 'sobreaviso' | 'outros')
uploaded_at           timestamptz default now()
uploaded_by           uuid  FK auth.users
```

- Unique `(payment_id, sha256)` — mesmo arquivo enviado 2×  não duplica.
- RLS: leitura pelos papéis já autorizados a ver o `payment` (via `has_role` + `hospital_id` do lote).
- GRANT `SELECT/INSERT` a `authenticated`; `ALL` a `service_role`.

### 2. RLS no bucket `payment-files`

Criar policies em `storage.objects` restringindo por `hospital_id` (extraível do `path` ou via join com `payment_source_files`). Fecha buraco identificado nesta investigação.

### 3. Fluxo de upload (`NewPayment.tsx`)

- Calcular SHA-256 no client (`crypto.subtle.digest`).
- Fazer upload de **cada** bucket file, não só o primeiro.
- Após inserir `payments`, gravar N linhas em `payment_source_files`.
- Se algum upload falhar, **bloquear** o submit e mostrar toast — nunca gravar o lote sem os arquivos.
- Manter `payments.source_file_path` populado com o primeiro (compat), mas passar a ser derivado.

### 4. UI de auditoria

Botão "Arquivos originais" em `PaymentDetail` → lista com nome, tamanho, hash truncado, botão download (URL assinada 5 min). Habilitado para roles `admin`, `analista`, `validador`.

### 5. Backfill (opcional, mesma migration)

Popular `payment_source_files` a partir dos `payments.source_file_path` existentes (35 registros). Hash fica `null` — flag `legacy=true` para diferenciar.

## Fora do escopo

- Reprocessar historicamente qualquer lote a partir do arquivo salvo (fica para tarefa futura).
- Versionamento (edição do arquivo original). Se o analista subir novo arquivo = novo lote.

## Ordem de execução

1. Migration: cria tabela + RLS + policies do bucket + GRANTs.
2. Após aprovação, ajusto o front (upload multi-arquivo + hash + gravação em `payment_source_files`).
3. Componente `<PaymentSourceFilesList />` em `PaymentDetail`.
4. Backfill dos 35 registros existentes.

Confirmo para iniciar pela migration?
