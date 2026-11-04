# Task 7: Extrair as demais ferramentas de UI

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** alterar `bridge/tools/ui.mjs`, `bridge/ui.mjs`, `tests/ui-tools.test.mjs` (criar).
**Interface:** completar `createUiTools({ emit })` com as operações existentes.

- [x] Caracterizar coerção de números/booleanos, cores automáticas, clamps e operações inválidas, preservando tolerâncias atuais.
- [x] Transferir handlers e schemas restantes; manter registro SDK apenas no adaptador/fachada temporária.
- [x] Rodar `node --import tsx --test tests/ui-tools.test.mjs`; comparar operações emitidas com fixtures legadas.
