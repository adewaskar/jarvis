# Task 8: Extrair painéis, blades e visão

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/tools/{panels,vision}.mjs`, `tests/panels.test.mjs`,
`tests/vision.test.mjs`; alterar `bridge/{panels,vision}.mjs`.
**Interfaces:** `createPanelTools({ emit, pages })`,
`createVisionTools({ clientCapabilities })`; `pages` injeta obtenção/render de páginas existente.

- [x] Testar painel/blade sem SDK, frame e sequência de frames como imagens, captura recusada e capacidade ausente.
- [x] Extrair primeiro painéis e verificar `tests/panels.test.mjs`; depois visão e verificar `tests/vision.test.mjs`, usando o runner da task 1 em cada passo.
- [x] Confirmar que nenhum handler novo importa SDK e que mídia continua pelo fluxo seguro existente; não alterar DOMPurify/CSP.
