# Task 9: Isolar a integração Chrome

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `bridge/integrations/claude-chrome.mjs`,
`bridge/tools/chrome.mjs`, `tests/chrome.test.mjs`; alterar `bridge/chrome.mjs`.
**Interfaces:** `createClaudeChromeClient({ connect, discover })`,
`createChromeTools({ client, allowWrites })`; manter fachada de compatibilidade.

- [x] Testar extensão ausente, resultado de leitura e ferramentas de ação omitidas com escrita desabilitada, usando socket falso.
- [x] Separar conexão/protocolo da extensão dos handlers e do registro SDK; identificar explicitamente a dependência Claude no diagnóstico.
- [x] Rodar `node --import tsx --test tests/chrome.test.mjs`; extensão ausente não impede conversa.
