# Task 3: Isolar fontes de configuração

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/config/{load,claude-source,voice}.mjs`,
`tests/config.test.mjs`; alterar `bridge/server.mjs` somente nos pontos de leitura.
**Interfaces:** `loadBridgeConfig(env)`, `readClaudeSource({ readFile, home })`,
`resolveVoiceCredentials({ env, legacySource })`; retornar objetos próprios.

- [x] Caracterizar precedência MCP global/home e chave de voz: ambiente prevalece sobre fonte legada; arquivo ausente/malformado conserva fallback atual.
- [x] Extrair funções e injetar leitura de arquivo; manter valores e defaults efetivos atuais. Nenhum teste acessa `~/.claude.json` real.
- [x] Rodar `node --import tsx --test tests/config.test.mjs`; verificar que fonte ausente não impede boot nem expõe segredos em mensagens.
