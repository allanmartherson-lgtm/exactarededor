## Contexto

Alinhamento de conceito: **cada internação gera um novo atendimento**, então "atendimento" e "paciente" são a mesma unidade. Reinternações do mesmo paciente = múltiplos atendimentos distintos e devem ser contadas separadamente. A coluna atual "PACIENTES ÚNICOS" (dedup por `patient_name`) está errada — colapsa reinternações.

## Escopo

Só `src/pages/OverlapAudit.tsx`. Sem tocar hook, RPC ou outros arquivos.

## Mudanças

### 1. Tabela "Pares de médicos mais frequentes" (linha 830+)

Colunas passam a ser:

| PAR | ATENDIMENTOS | VISITAS EM COMUM | VALOR ESTIMADO |
|---|---|---|---|

- **ATENDIMENTOS** = valor de `count` atual (nº de atendimentos em que a dupla apareceu junta).
- **VISITAS EM COMUM** (novo) = soma de `r.items` nesses atendimentos (proxy de visitas/lançamentos coincidentes).
- Remover coluna "PACIENTES ÚNICOS".

No `doctorPairs` (linha 252), trocar o `Set<string> patients` por acumulador `visits: number` (`cur.visits += Number(r.items ?? 0)`). Remover `uniquePatients`.

### 2. Seção "Pacientes com mais sobreposições" (linha 760+)

O RPC devolve `by_patient` já agregado por paciente — mas conceitualmente devemos falar em **atendimentos**, não pacientes. Renomear títulos/labels:

- Título da seção: "Pacientes com mais sobreposições" → "Atendimentos com mais sobreposição"
- Legenda do gráfico e header da tabela: "PACIENTE" → "ATENDIMENTO / PACIENTE" (mantém o nome como rótulo, mas rótulo textual esclarece que uma linha = uma internação)
- KPI/frase "Top paciente" (linha 321) → "Top atendimento"

Não alteramos a agregação do `by_patient` (isso viria do RPC, fora de escopo). Se o RPC hoje deduplica por nome, aparece nota no cabeçalho da seção: _"Uma linha por internação; reinternações do mesmo paciente aparecem separadas quando o RPC devolve atendimentos distintos."_

### 3. KPIs do topo (linha 176)

- Card "Pacientes" → renomear para "Atendimentos" (já usa `attendances.size`, valor não muda; label passa a refletir o conceito).
- Remover o card duplicado se houver "Pacientes" + "Atendimentos" separados; se só houver um, apenas relabelar.

### 4. Tabela "Atendimentos com sobreposição no mesmo dia" (linha 941+)

Sem mudança estrutural — já é por atendimento. Só confirmar que o subtítulo diz "Uma linha = uma internação".

## Fora de escopo

- Não mexer em `useOverlapAudit.ts` nem na RPC `get_overlap_audit`.
- Se `by_patient` do RPC estiver colapsando reinternações por nome (a investigar depois), fica como próxima tarefa — este plano só ajusta rótulos e a tabela de pares.

## Resultado visível

- Tabela de pares fica: `Felipe × Maria Teresa | 10 atendimentos | 47 visitas em comum | R$ 11.424,62`.
- Some a confusão do "10 sobreposições / 10 pacientes únicos" (que era redundante).
- Some o "Andre × Carolina 8 / 2" que dava impressão errada de "só 2 pacientes" — vira "8 atendimentos / N visitas".

Aprovar para eu implementar?
