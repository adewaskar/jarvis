# Task 5: Extrair solicitações ao cliente

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/transport/client-capabilities.mjs`,
`tests/client-capabilities.test.mjs`; alterar `bridge/server.mjs`.
**Interface:** `createClientCapabilities({ send, available, timeoutMs, clock })`
implementa a porta, mais `receive(reply)` e `close()` para o transporte.

- [x] Testar correlação de respostas fora de ordem, resposta desconhecida, timeout, abort e desconexão com câmera pendente.
- [x] Extrair mapa de pendências e limpeza; manter timeout padrão atual de 20.000 ms e injetar relógio nos testes.
- [x] Rodar `node --import tsx --test tests/client-capabilities.test.mjs`; todos os pedidos devem terminar e timers serem limpos.
