# Task 10: Consolidar persona e converter mensagens diretas

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `shared/persona.mjs`, `shared/persona.d.mts`, `tests/direct-messages.test.ts`;
alterar `src/config.ts`, `src/lib/{brain,anthropic}.ts`, `bridge/server.mjs`.
**Interfaces:** regras comuns em `JARVIS_PERSONA`; conversores Anthropic privados
em `src/lib/anthropic.ts`; `Msg` passa a alias de `Message` próprio durante a transição.

- [x] Caracterizar prompts atuais e testar conversão de histórico texto/imagem sem mutar entrada; comparar regras comuns antes/depois.
- [x] Centralizar apenas regras equivalentes, mantendo diferenças existentes como instruções específicas de cada modo; não mudar persona por harmonização acidental.
- [x] Manter a persona compartilhada em JavaScript executável pelo Node sem loader TypeScript; usar `.d.mts` para declarar seu export no frontend. Os contratos `.ts` são imports de tipo/JSDoc no backend, nunca dependências de runtime.
- [x] Rodar `node --import tsx --test tests/direct-messages.test.ts` e build; nenhuma API pública reexporta mensagens Anthropic.
