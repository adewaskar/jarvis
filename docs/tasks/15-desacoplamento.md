# Task 15: Conectar o transporte ao serviço

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/transport/ws.mjs`, `tests/ws-integration.test.mjs`;
alterar `bridge/server.mjs`, `bridge/bootstrap.mjs`, `src/lib/bridge.ts` se necessário para descartar efeitos atrasados.
**Interface:** `attachConversationSocket({ socket, conversation, clientCapabilities })`;
tradução preserva nomes/campos existentes e pode acrescentar IDs compatíveis.

- [x] Testar WebSocket local com fake: conversa, interrupção A/B, painel atrasado, captura/resposta, desconexão, erro e nova conexão.
- [x] Substituir orquestração inline pelo serviço; manter endpoints HTTP e controles de Origin/CORS existentes. Não usar espera de tempo como prova de identidade de turno.
- [x] Rodar `node --import tsx --test tests/ws-integration.test.mjs` e suíte completa; confirmar compatibilidade com fixtures da task 1.
