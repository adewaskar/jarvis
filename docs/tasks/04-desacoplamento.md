# Task 4: Extrair a política de autorização

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/tools/permissions.mjs`, `tests/permissions.test.mjs`;
alterar `bridge/server.mjs` e criar `bridge/providers/claude/tools.mjs`.
**Interfaces:** `createPermissionPolicy({ allowWrites })`; adaptador
`describeClaudeTool(name)` traduz nomes legados para descrições canônicas.

- [x] Fixar a matriz atual de built-ins, MCP, exceções e ferramentas internas; verificar desconhecidos negados no padrão.
- [x] Mover política sem mudar permissões. Preservar allowlists explícitas; efeito desconhecido não é classificado automaticamente como leitura.
- [x] Rodar `node --import tsx --test tests/permissions.test.mjs`; verificar também `allowWrites` e ausência de execução na negação.
