Aumentar o limite de busca de empresas e médicos nas listagens e processos do sistema para garantir que todos os registros (atualmente ~1500 empresas e ~4600 médicos) sejam carregados, resolvendo o problema de visualização e processamento limitado a 1000 itens (padrão do Supabase).

### Detalhes técnicos
- Adicionar `.limit(10000)` (ou similar) em todas as chamadas `supabase.from().select()` que buscam listas completas de empresas e médicos para cache local, fuzzy matching e listagem.
- Corrigir a lógica de deduplicação na importação de empresas para que ela considere toda a base existente, não apenas os primeiros 1000 registros.
- Revisar as páginas: Empresas, Médicos, Novas Regras e Novo Pagamento.

### Arquivos afetados
- `src/pages/Companies.tsx`: Listagem principal e deduplicação no import.
- `src/pages/Doctors.tsx`: Listagem de médicos e empresas relacionadas.
- `src/pages/Rules.tsx`: Carregamento de empresas para vínculo com regras.
- `src/pages/NewPayment.tsx`: Cache de empresas para reconhecimento automático.
- `src/pages/PaymentDetail.tsx`: Listagem de empresas para edição.
- `src/pages/CompanyAnalysis.tsx`: Listagem de empresas para análise.
