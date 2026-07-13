---
name: Setor nunca bloqueia importação
description: Setor é dimensão operacional/analítica, não chave de cálculo — painel de resolução mostra sector unresolved como aviso, nunca como gate
type: constraint
---
Motor de repasse/glosa/pool NÃO usa setor como chave. Planilhas legítimas (Cardiologia Rateio, Neurologia do Centro Brasiliense, etc.) não têm coluna de setor e nunca tiveram — não podem ser travadas por "N setores não resolvidos".

Regra: em `src/pages/NewPayment.tsx`, `hasUnresolved` filtra `kind !== "sector"`. Setor continua aparecendo no `RegistryResolutionPanel` como informativo. Botão de envio segue desabilitado apenas para médico/convênio não resolvidos.

Não reintroduzir gate de setor sem confirmação explícita do usuário.
