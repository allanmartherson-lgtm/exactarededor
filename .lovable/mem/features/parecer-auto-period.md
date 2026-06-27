---
name: Período do relatório de parecer — auto-detectado
description: Período do relatório Tasy de parecer é sempre derivado das datas do arquivo, nunca input manual. Vale para produção e remessa.
type: feature
---

## Regra
Em **qualquer modo** (produção ou remessa), o motor lê min/max de `dt_solic_parecer`/`dt_resposta_parecer` do arquivo importado e grava `período_inicio` e `período_fim` automaticamente. O analista nunca precisa preencher o período.

## Por quê
- Tasy permite emitir relatórios de qualquer janela; obrigar o analista a redigitar o período acumula erro humano.
- Subir base anual para analisar lote mensal é cenário normal — bloquear isso trava o trabalho.
- A data real do parecer (não a competência do lote) é a fonte da verdade para o cruzamento item × parecer.

## Implementação
- `ParecerReportCard.tsx` e `ParecerReportWizardCard.tsx`: campos `Período início/fim` removidos da UI.
- Cliente computa min/max ISO das datas durante o parse e envia em `init`.
- Edge function `import-parecer-report`: `period_start`/`period_end` opcionais — quando ausentes, são derivados das linhas em `finalize`.

## O que NÃO fazer
- Relatório com range maior que a competência do lote **nunca** dispara alerta de "trocar para remessa" — é cenário normal. Esse diagnóstico vive na **base de pagamento**, não no parecer.
