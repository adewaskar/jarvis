# Task 6: Criar executor e adaptar uma ferramenta pequena

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/tools/registry.mjs`, `bridge/tools/ui.mjs`,
`tests/tools.test.mjs`; alterar `bridge/ui.mjs` e o adaptador Claude de ferramentas.
**Interface:** `createToolExecutor({ definitions, policy })`; factory
`createUiTools({ emit })`; `registerClaudeTools({ definitions, executor })`.

- [x] Testar ferramenta de reset: chamada permitida emite uma operação; negação e entrada inválida não chamam handler; saída inválida vira falha normalizada.
- [x] Extrair somente reset, deixando as demais ferramentas no caminho legado; traduzir resultado próprio para MCP no adaptador.
- [x] Rodar `node --import tsx --test tests/tools.test.mjs`; verificar preservação do nome e payload públicos.

Execução: reset e executor foram validados isoladamente nesta task; a troca da fachada de produção foi concluída com a extração integral da UI na task 7, mantendo o caminho legado funcional durante a transição.
