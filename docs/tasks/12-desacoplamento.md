# Task 12: Encapsular sessão Claude

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/providers/claude/provider.mjs`,
`tests/claude-session.test.mjs`; alterar `bridge/server.mjs`.
**Interface:** `createClaudeProvider({ query, config, registerTools })` implementa
`AgentProvider`; injeta `query` real somente na composição provisória.

- [x] Testar query falso: opções de SDK preservadas, fila de entrada, término duplicado, interrupção rejeitada, stream quebrado e close idempotente.
- [x] Mover criação de query, gerador de entrada, sincronização legada e pump para o adaptador; manter `settingSources: []`, ferramentas e política existentes.
- [x] Vincular callbacks de ferramentas ao contexto original da chamada/turno. Não usar apenas o turno corrente mutável para rotular efeitos: se o SDK não permitir correlação confiável após interrupção, invalidar a sessão e seus callbacks antes de aceitar o próximo turno.
- [x] Rodar `node --import tsx --test tests/claude-session.test.mjs`; o servidor passa a consumir eventos próprios, sem `switch` de eventos Anthropic.

Decisão técnica: uma query SDK por turno com resume da conversa, mantendo callbacks imutáveis. A interrupção fecha deliberadamente a query; não envia control request depois do fechamento, preservando o ID de retomada. Teste de regressão cobre A/interrupção/B.
