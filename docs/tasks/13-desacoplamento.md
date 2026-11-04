# Task 13: Implementar orquestração e isolamento de turnos

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/conversation/{service,turns}.mjs`,
`tests/conversation.test.mjs`.
**Interface:** `createConversationService({ provider, tools, policy, clientCapabilities, clock, interruptTimeoutMs })` conforme contratos; usar 400 ms como limite inicial de espera de interrupção, conservando a referência legada.

- [x] Com fake, testar streaming, A interrompido seguido de B, efeitos atrasados de A, fechamento e isolamento entre duas sessões.
- [x] Implementar estado por sessão, IDs imutáveis e término único. Ao timeout/rejeição de interrupt, invalidar a sessão antiga antes de reabrir ou reportar falha; nunca reatribuir seus eventos a B.
- [x] Rodar `node --import tsx --test tests/conversation.test.mjs`; incluir ferramenta demorada de A e impedir novos efeitos locais após abort.
