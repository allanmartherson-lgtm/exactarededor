# Proteção contra batches destrutivos em cadastros

_Última atualização: 11/07/2026 — após incidente do batch de 03/06/2026._

## Contexto

Em 03/06/2026 um batch de importação via `import-wizard` executou padrão **delete-then-insert**
em `doctor_companies`, apagando silenciosamente vínculos legítimos médico↔PJ e reintroduzindo
outros que já haviam sido corrigidos. O incidente só foi detectável porque analisamos pagamentos
retroativamente. Não havia auditoria.

## Invariantes garantidos hoje (não regredir)

1. **DELETE físico bloqueado** em tabelas de cadastro por `block_physical_delete`:
   - `doctor_companies`
   - `doctor_hospital_overrides`
   - `company_hospital_overrides`
   - `doctor_aliases`, `convenio_aliases`, `sector_aliases`

   A única forma de "remover" um vínculo é `UPDATE ... SET end_date = ..., end_reason = ...`.

2. **Auditoria automática** por `trg_audit_generic_registry` / `trg_audit_doctor_companies`
   grava em `public.audit_log` toda operação INSERT/UPDATE (soft-close) com:
   - `actor_id = auth.uid()`
   - `diff` completo antes/depois
   - `entity_type` plural (ex: `doctor_companies`)

3. **`import-wizard` usa diff**, não `delete + insert`. Ver `src/pages/import/*`
   (grep por `applyDoctorCompaniesDiff`).

## Como reproduzir manualmente a proteção

```sql
-- deve falhar com "Physical DELETE not allowed on public.doctor_companies"
DELETE FROM public.doctor_companies WHERE doctor_id = '...' LIMIT 1;

-- forma correta:
UPDATE public.doctor_companies
   SET end_date = CURRENT_DATE, end_reason = 'motivo_operacional'
 WHERE id = '...';
```

## Onde a UI expõe isso

`/auditoria?tab=log` → filtro entity_type inclui as novas categorias
(vínculos, overrides, aliases) e as ações `soft_closed`, `delete_blocked`, `restore`.

## Testes

- **DB-level**: teste manual em ambiente staging antes de qualquer release que toque
  em `import-wizard` ou nesses cadastros. Rodar os DELETEs acima e verificar bloqueio.
- **UI-level**: `AuditLog` renderiza rótulos amigáveis das novas entidades (labels em
  `ENTITY_LABELS` e `ACTION_LABELS`).

## Se um novo cadastro global for criado

Sempre que adicionar tabela de cadastro (aliases, overrides, vínculos), replicar:
1. Trigger `BEFORE DELETE EXECUTE FUNCTION block_physical_delete`.
2. Trigger `AFTER INSERT OR UPDATE EXECUTE FUNCTION audit_generic_registry` (ou dedicado).
3. Adicionar `entity_type` correspondente à constraint `audit_log_entity_type_check`.
4. Adicionar label em `src/pages/AuditLog.tsx` (`ENTITY_LABELS`).
