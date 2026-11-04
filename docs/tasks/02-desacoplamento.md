# Task 2: Definir tipos próprios e um provedor falso

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `shared/{agent,tools,client}.ts`, `tests/fakes/provider.mjs`,
`tests/contracts.test.ts`; alterar `tsconfig.app.json` para incluir `shared`.
**Interface:** contratos da seção anterior; `createFakeProvider(script)` devolve
`AgentProvider` e permite disparar eventos/erros e observar cancelamento.

- [x] Criar testes de texto e imagem, capacidades ausentes e consumo do fake; confirmar falha pela ausência das novas interfaces.
- [x] Declarar contratos sem dependências Anthropic e implementar fake controlado por teste, sem timers reais ou rede.
- [x] Rodar `node --import tsx --test tests/contracts.test.ts` e `npm run build`; esperar sucesso. Usar exemplos tipados para verificar as assinaturas no build.
