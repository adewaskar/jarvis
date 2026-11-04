# Task 1: Fixar o comportamento WebSocket atual

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `tests/protocol.test.mjs`, `tests/fixtures/protocol.mjs`;
alterar `package.json`.
**Interface:** fixtures dos eventos existentes `ready`, `text`, `tool`, `done`,
`error`, `panel`, `blade`, `ui`, captura/resposta e comandos de interrupção.

- [x] Ler produtor e consumidor e registrar payloads sintéticos válidos, sem dados pessoais.
- [x] Criar teste que verifica campos obrigatórios, IDs `ask` e sequência de uma conversa.
- [x] Adicionar `npm test` e rodar `node --import tsx --test tests/protocol.test.mjs`; esperar aprovação dos exemplos atuais. Esta task caracteriza, não altera, o comportamento.
