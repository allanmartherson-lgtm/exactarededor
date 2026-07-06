---
name: Migração CURA — pausada na Fase 3
description: Status da migração para @rededor/cura-react; retomar quando registry/tarball estiver disponível
type: constraint
---
Fases 1 e 2 concluídas (tokens CURA em index.css/tailwind, Button/AppLayout ajustados). Fase 3 (instalar @rededor/cura + @rededor/cura-react e substituir componentes) está PAUSADA por falta de acesso ao registry privado da Rede D'Or.

Ao retomar, oferecer opções nesta ordem:
1. Tarball local (.tgz via `npm pack`) — fidelidade 100%, sem token
2. Registry privado com build secret (.npmrc + NPM_TOKEN em Workspace Settings)
3. Git submodule com deploy key
4. Copiar dist/ para src/vendor/cura-react/
5. Wrapper local com tokens CURA (último recurso, fidelidade só visual)

Não reimplementar CURA como wrapper sem confirmação explícita do usuário.
