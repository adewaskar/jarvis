# Task 16: Injetar backend do frontend

Status: concluída.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `src/lib/create-brain.ts`, `tests/brain.test.ts`;
alterar `src/lib/{brain,bridge,anthropic}.ts` e `src/App.tsx` somente se necessário.
**Interfaces:** `createBrain(deps)` retorna porta de conversa; transporte selecionado
na composição. Portas opcionais de HUD/captura/conexão ficam segregadas da conversa.

- [x] Testar envio, histórico próprio, cancelamento e erro em backend direto com cliente falso; testar escolha de transporte sem checar provedor na UI.
- [x] Manter fachada pública `brain.ts`, mas injetar implementações; representar recursos ausentes explicitamente em vez de watchers vazios que aparentem suporte.
- [x] Rodar `node --import tsx --test tests/brain.test.ts`, lint e build; preservar comportamento bridge/direct e labels do HUD.
