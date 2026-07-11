---
name: Planilha original para auditoria
description: Armazenar arquivo bruto do TASY por lote em Storage para conferência retroativa
type: feature
---

# Objetivo
Guardar a planilha original (arquivo enviado pelo analista) vinculada a cada `payment` para permitir auditorias posteriores confrontando o que o motor leu vs. o que estava na fonte.

# Motivação
Bug do bônus (Tarefa B) só foi diagnosticado 100% porque o Rodrigo (usuário) lembrava do relatório de 03/07. Sem o arquivo original salvo, dependemos da memória humana + reconstrução via banco. Para futuros incidentes queremos abrir a planilha do lote e comparar linha a linha.

# Escopo
- Bucket privado `payment-source-files` no Storage (RLS: mesmo escopo do lote — hospital_id + roles analista/admin/auditor).
- Nova coluna `payments.source_file_path` (text) + `source_file_uploaded_at` (timestamptz) + `source_file_size_bytes` (bigint) + `source_file_sha256` (text).
- Upload automático no fluxo `NewPayment.tsx` quando o usuário confirma a criação do lote (upload paralelo, não bloqueia salvamento).
- Guardar o arquivo TAL COMO enviado (xlsx/csv/xls originais), sem transformação.
- Se o usuário trocar arquivo antes de fechar o lote: substitui e mantém versão anterior por 7 dias no bucket com sufixo `_prev_<timestamp>`.
- Após lote em `pago`: arquivo é imutável (política de bucket bloqueia UPDATE/DELETE via RLS).
- Botão "Baixar arquivo original" em `PaymentDetail.tsx` (visível para analista/admin/auditor).
- Registro de download em `audit_log` (`entity_type='payment'`, `action='download_source_file'`).

# Estimativa de custo
- Média por lote: 200-800 KB (xlsx). ~2.400 lotes/ano × 500 KB = ~1,2 GB/ano. Baixo.
- Storage Supabase incluído no plano atual comporta sem problema.

# Fora do escopo (fase 1)
- Múltiplas versões navegáveis do arquivo (só a última + eventual prev de 7 dias).
- OCR/parsing retroativo — o arquivo é evidência bruta.
- Backfill dos lotes já existentes (só a partir da implementação; discutir se vale importar histórico manualmente depois).

# Riscos
- LGPD: planilha contém CPF de paciente. Bucket privado + RLS estrito por hospital + log de acesso. OK.
- Analistas subirem versão errada: mitigar com preview + hash SHA256 exibido antes de confirmar.

# Checklist implementação
- [ ] Migration: bucket + colunas em `payments`
- [ ] RLS bucket (SELECT: mesmo hospital; INSERT: analista; DELETE: nunca via cliente)
- [ ] Upload em `NewPayment.tsx` (paralelo ao insert do payment)
- [ ] Ação "trocar arquivo" quando lote ainda em `em_confeccao`/`analise`
- [ ] Botão download em `PaymentDetail.tsx` + log
- [ ] Testes: upload, download, RLS cross-hospital, imutabilidade em lote pago
