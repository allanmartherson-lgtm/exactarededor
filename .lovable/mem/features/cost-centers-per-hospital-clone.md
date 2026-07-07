---
name: Centros de custo por hospital com clone da rede
description: Estrutura P12 é padrão Rede D'Or; cada hospital tem sua própria cópia dos centros de custo, sem compartilhamento global
type: feature
---

Centros de custo (`cost_centers`) seguem a estrutura P12 padrão da Rede D'Or, que é a mesma para toda a rede. Mesmo assim, **o catálogo é por hospital** — nunca global (`hospital_id NOT NULL`).

**Por quê:** "global" na prática vira "empréstimo do DF Star" — quebra auditoria, mistura escopos, e qualquer edição em um hospital afetaria os outros. Não temos módulo global; temos multi-tenant por hospital.

**Unicidade:** `UNIQUE (hospital_id, code_p12)` e `UNIQUE (hospital_id, code)` — o mesmo P12 pode (e deve) existir em cada unidade.

**Onboarding de novo hospital:** seed a partir do DF Star (cópia de todos os P12 ativos) via migration que registra a operação em `cost_center_imports` com `file_name = seed_from_df_star_<hospital>.internal`, permitindo reversão pela tela `/centros-de-custo`. Depois, se a controladoria enviar planilha oficial da unidade, o importador normal (`update` por `code_p12`) reconcilia.

**Nunca:** tornar `hospital_id` nullable, criar centros "globais", nem compartilhar linhas entre hospitais.
