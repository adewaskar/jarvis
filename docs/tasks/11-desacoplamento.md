# Task 11: Extrair tradução de eventos Claude

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/providers/claude/events.mjs`,
`tests/claude-events.test.mjs`; alterar o pump em `bridge/server.mjs`.
**Interface:** `createClaudeEventMapper({ sessionId, turnId, policy })` com
`accept(raw): AgentEvent[]` e `finish(): AgentEvent[]`, sem rede.

- [x] Usar fixtures sintéticas para deltas, anúncio duplicado de ferramenta, ferramenta negada, sucesso, erro e EOF sem resultado.
- [x] Mover tradução e deduplicação; custo indisponível permanece opcional/nulo, nunca zero inventado.
- [x] Rodar `node --import tsx --test tests/claude-events.test.mjs`; exigir exatamente um terminal por turno aceito e falha no EOF incompleto.
