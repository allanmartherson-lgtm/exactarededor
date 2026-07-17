## Painel de padrões de sobreposição assistencial

Auditoria autônoma dos casos "mesmo paciente + mesmo dia + ≥2 lançamentos assistenciais". Não depende da regra ter rodado no lote — consulta direto os `payment_items` do hospital ativo por janela de datas.

### Onde vive

Nova rota `/auditoria/sobreposicao-assistencial` (link no menu de Relatórios/Auditoria). Escopo por `current_active_hospital()` via RLS já existente.

### O que a tela mostra

**Filtros no topo**
- Janela (data inicial / final; default últimos 90 dias sobre `procedure_date`)
- Tipo de item: Visita+Parecer (default) / só Visita / só Parecer
- Mínimo de especialidades distintas por paciente/dia (default 2)
- Modo de especialidade: Principal (1ª do médico) / Qualquer
- Especialidades a ignorar (multi-select — default Infectologia, como na regra)

**Card 1 — Combinações de especialidades**
Tabela: `Especialidades | Pacientes | Dias | Atendimentos | Ver exemplos`
Ex.: `Neurologia + Geriatria — 47 pac / 112 dias / 189 atend.`
Inclui combinações mesma-especialidade quando o TUSS difere (ex.: Neuro EEG + Neuro Visita) — coluna extra "Mesma especialidade" com badge.

**Card 2 — Pacientes com mais dias em sobreposição**
Top 50: `Paciente | Dias | Especialidades envolvidas | Atendimentos`. Clique expande drill-down por dia com lote, médico, TUSS, valor.

**Card 3 — Atendimentos com sobreposição no mesmo dia**
Lista paginada: `Data | Paciente | Atendimento | Médicos (especialidades) | Lotes | Total pago`. Link para cada lote.

**Ações**
- Exportar Excel (3 abas: Combinações, Pacientes, Atendimentos)
- "Abrir regra de sobreposição" (link para `/regras`) — não altera regra a partir daqui

### Como o cálculo funciona

Nova RPC `get_overlap_audit(p_start, p_end, p_item_scope, p_min_distinct, p_specialty_mode, p_excluded_specs[])` que:
1. Filtra `payment_items` do hospital ativo com `procedure_date` na janela.
2. Elegibilidade estrita por TUSS/nome (mesma lista usada em `validate-payment`: 10102019, 10102027, 10103015, 10103082 + nomes visita/parecer/interconsulta/consultoria).
3. Junta com `doctors` + `doctor_specialties` para resolver especialidades (fallback: `doctor_document` → `doctor_name`).
4. Agrupa por `(paciente_normalizado, procedure_date::date)`.
5. Retorna 3 result sets via JSONB: `by_specialty_combo`, `by_patient`, `by_attendance` — cada linha já com contagens, sample_ids e valores agregados.

Cache client-side com React Query (staleTime 5 min); ação de refresh manual.

### Arquivos a criar

- `supabase/migrations/<ts>_overlap_audit_rpc.sql` — cria função `public.get_overlap_audit(...)` `SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated`. Reusa `normSpec`/`normName` inline.
- `src/pages/OverlapAudit.tsx` — layout com filtros + 3 cards + export.
- `src/lib/overlapAuditReport.ts` — export Excel (mesmo padrão de `interventionReport.ts`).
- `src/hooks/useOverlapAudit.ts` — React Query wrapper da RPC.

### Arquivos a alterar (mínimo)

- `src/App.tsx` — registrar rota `/auditoria/sobreposicao-assistencial`.
- `src/components/layout/Sidebar.tsx` (ou equivalente) — adicionar item "Sobreposição assistencial" em Auditoria/Relatórios.

Nenhum outro arquivo compartilhado é tocado. A regra `sobreposicao_assistencial` e a edge function `validate-payment` permanecem intactas.

### Fora do escopo

- Criar/editar regra a partir do painel
- Notificações automáticas
- Cruzamento com Aurum/CBHPM
- Ajuste de valores ou glosa direto pelo painel

### Riscos

- Volume de dados: janela grande em hospital grande pode ficar lenta. Mitigação: janela default 90d + índice já existente em `payment_items(hospital_id, procedure_date)` (a verificar; se faltar, criar na mesma migration).
- Pacientes sem nome normalizado consistente: usa `normName` (lower + sem acento); casos de digitação divergente ficam em grupos separados (documentado como limitação).

### Ordem de execução

1. Criar migration da RPC (aguardar aprovação da DB).
2. Criar `useOverlapAudit`, `overlapAuditReport`, `OverlapAudit.tsx`.
3. Registrar rota e menu.
4. Testar com HDF Neuro maio + janela 30d.

Confirma que sigo?