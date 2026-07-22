# Plano — Melhorar match de PJ (CNPJ + auto-aprendizado)

## Objetivo
Reduzir o número de arquivos que caem em stand-by por falha de match de nome, sem afrouxar o limiar de 90%. Duas alavancas independentes.

---

## Parte 1 — Vínculo por CNPJ

### Comportamento novo
Antes de tentar match por nome, o motor procura um CNPJ válido (com dígito verificador) em três lugares, nesta ordem:
1. Nome do arquivo.
2. Primeiras ~20 linhas do `rawMatrix` (cabeçalho do TASY costuma trazer razão social + CNPJ).
3. Coluna "Terceiro"/"Empresa" da linha (caso a planilha traga documento junto).

Se achar CNPJ válido → casa direto contra `companies.document` (normalizado, só dígitos). Match por CNPJ é **auto-aceito com score 1.0** — não passa por revisão, pois é chave forte com DV.

Se não achar CNPJ → cai no fluxo atual de match por nome (≥90%).

### Arquivos alterados
- `src/lib/parsePaymentFile.ts`: nova função `findCnpjInText(text)` reutilizando `isValidCNPJ` de `src/lib/cnpj.ts`; nova função `matchCompanyByDocument(cnpj, companies)`; `matchCompany` passa a receber matriz/nome do arquivo e tenta CNPJ primeiro.
- `src/pages/NewPayment.tsx`: no ponto onde `matchCompany` é chamado (linhas ~1180 e ~2670), passar também `rawMatrix` e `file.name` para varredura de CNPJ.
- `src/lib/__tests__/matchCompany.test.ts`: testes novos (CNPJ no nome do arquivo, CNPJ no cabeçalho, CNPJ inválido ignorado, colisão de nome mas CNPJ diferente).

### Fora de escopo
Não alteramos telas de conciliação, retroativo, ou re-import — só a ingestão em `/pagamentos/novo`. Se der certo, replicamos depois.

---

## Parte 2 — Auto-aprendizado ampliado de aliases

### Comportamento novo
Todo lugar onde o analista **explicitamente** aponta "esse texto bruto = essa PJ" passa a chamar `learnCompanyAlias` (que já existe e já respeita o guard `shouldLearnAlias`).

Pontos que **passam a aprender**:
1. Reimportação de base em `PaymentDetail` (quando o analista corrige a PJ no modal de re-upload).
2. Wizard de conciliação retroativa (`RetroactiveMappingWizard`) — vinculação manual PJ ↔ texto bruto.
3. Ação de "Aceitar com alerta" e vinculação manual dentro do `PaymentConciliationModal`.

Pontos que **já aprendem hoje** (não mexemos): troca manual e confirmação de sugestão em `/pagamentos/novo`.

### Undo visível
Após aprender, o toast passa a exibir botão **"Desfazer aprendizado"** que remove o alias recém-adicionado (nova RPC `unlearn_company_alias` — SECURITY DEFINER, remove por match exato do texto no array `aliases`). Analista tem ~10s para reverter se percebeu que errou.

### Arquivos alterados
- `supabase/functions/` (migração): nova RPC `unlearn_company_alias(_company_id uuid, _raw_name text)` — remove `_raw_name` de `companies.aliases` se existir. Grants para `authenticated`.
- `src/lib/learnCompanyAlias.ts`: exportar helper `unlearnCompanyAlias` simétrico.
- `src/pages/PaymentDetail.tsx`: no fluxo de reimport, chamar `learnCompanyAlias` quando o analista troca a PJ.
- `src/components/retroactive/RetroactiveMappingWizard.tsx` (ou equivalente): idem no mapeamento manual.
- `src/components/payment-detail/PaymentConciliationModal.tsx`: idem na vinculação manual de PJ.
- Componente compartilhado de toast: nova prop `undo?: { label: string; onClick: () => void }` no toast usado após vínculo.

### Segurança / auditoria
- `unlearn_company_alias` só remove o alias específico, nunca renomeia a PJ nem toca outros campos.
- Toda escrita de alias já grava `updated_by` via RLS — mantém rastro de quem aprendeu.

### Fora de escopo
Não vamos rodar backfill retroativo aprendendo aliases de vínculos antigos — só passa a aprender a partir de agora. Backfill fica como decisão separada se quiserem depois.

---

## Ordem de execução
1. Parte 1 (CNPJ) — isolada, sem risco em dados existentes.
2. Migração da RPC `unlearn_company_alias`.
3. Parte 2 (auto-aprendizado nos 3 pontos + undo).

## Migrações de banco
Uma migração nova: `unlearn_company_alias` (função + grants). Nenhuma alteração de tabela, nenhuma alteração de RLS existente.

## Riscos e mitigações
- **CNPJ inválido no arquivo (falso positivo de regex):** validação de DV rejeita.
- **CNPJ certo mas de outra unidade da mesma rede:** aceita — é o comportamento correto; o cadastro é a fonte de verdade.
- **Aprendizado errado do analista:** toast com "Desfazer" por 10s + `shouldLearnAlias` bloqueando aliases contaminados por sufixo (já existe).
