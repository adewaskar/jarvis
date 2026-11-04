# Task 14: Criar composição e seleção de provedor

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/providers/create.mjs`, `bridge/bootstrap.mjs`,
`tests/composition.test.mjs`; alterar `bridge/config/load.mjs` e `scripts/setup.mjs`.
**Interfaces:** `createProvider(id, factories)`; `composeBridge(deps)`;
opção `JARVIS_PROVIDER`, padrão `claude`. Fake é injetado em testes, não um
provedor de produção anunciado ao usuário.

- [x] Testar padrão Claude, registro alternativo fake, ID inválido e diagnóstico com integrações indisponíveis.
- [x] Montar fontes, política, tools e provider num único ponto; verificar requisitos específicos do provedor selecionado no setup, usando processos falsos nos testes.
- [x] Rodar `node --import tsx --test tests/composition.test.mjs`; não importar/inicializar Claude para executar a composição com fake.

Refinamento do contrato: SessionOptions.tools é um ToolCatalog público com create(context, emit), declarado em shared/tools.ts. A criação por turno evita callbacks mutáveis; o teste de composição executa ui_reset por um provedor alternativo usando o mesmo catálogo.
