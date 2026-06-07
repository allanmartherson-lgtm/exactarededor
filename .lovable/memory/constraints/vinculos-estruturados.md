---
name: Vínculos sempre estruturados
description: Todo relacionamento (médico↔PJ, médico↔convênio, PJ↔grupo, etc.) vive em tabela própria com FK; nunca em texto livre, observações, cards informativos ou listas paralelas. Cadastros espelham-se mutuamente.
type: constraint
---
Regra inegociável: relacionamento = linha em tabela de vínculo + checkbox/toggle na UI. Proibido:
- Mencionar PJ/médico/convênio em campo "observações", "notas internas", textarea ou descrição como forma de vínculo.
- Manter cards de seleção desconectados do banco (estado só no front).
- Dados de vínculo em duas telas que não se atualizam mutuamente.

Aplicação:
- Cadastro do médico mostra PJs vinculadas (checkbox) → grava em doctor_companies. Cadastro da PJ mostra os mesmos médicos (mesma fonte). Editar de qualquer lado reflete imediatamente no outro.
- Observações internas: somente texto operacional (lembrete, status pessoal). NUNCA carrega CNPJ/CRM como vínculo.
- Migração: qualquer dado de vínculo encontrado em campo livre vira sugestão de vínculo pendente para o admin aprovar — nunca é apagado silenciosamente nem promovido automaticamente sem revisão.
- Auditoria: criar varredura periódica que aponte CNPJs/CRMs em campos de texto e abra fila de revisão.
