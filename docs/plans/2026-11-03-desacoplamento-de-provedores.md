# Plano de implementação: desacoplamento de provedores

> **Para agentes:** executar tarefa por tarefa usando a skill
> `superpowers:executing-plans`, somente após aprovação explícita deste plano.
> Os checkboxes registram progresso de execução, não aprovação.

**Status:** aprovado e implementado em 2026-11-03; verificação automatizada concluída, validação manual com hardware/login pendente.

**Objetivo:** permitir substituir o agente por injeção de dependências sem
alterar conversa, ferramentas ou interface visual.

**Arquitetura:** contratos próprios e factories com dependências explícitas.
Extrair primeiro comportamentos existentes, mantendo Claude como padrão;
conectar a nova orquestração somente depois de testar seus limites com dublês.
Não adicionar outro provedor real nesta implementação.

**Stack:** React/TypeScript, Node ESM `.mjs`, Zod e SDKs Anthropic existentes.
Usar `node:test`, `node:assert/strict` e o `tsx` já declarado para testes, sem
introduzir framework de DI ou migrar o backend inteiro para TypeScript.

**Spec:** [spec aprovada](../specs/2026-11-03-desacoplamento-de-provedores.md).

## Restrições globais

- Claude continua como padrão e cada incremento mantém a aplicação utilizável.
- Preservar backend direto, protocolo WebSocket e fallbacks de voz existentes.
- Separar escolha de transporte (`bridge`/`direct`) de escolha de agente.
- Não adicionar novos provedores reais, autenticação, cobrança ou driver Chrome.
- Não relaxar permissões, `settingSources: []`, CSP, sanitização, Origin/CORS,
  confinamento de arquivos, SSRF ou consentimento de câmera/microfone.
- Não executar ferramentas com efeitos externos nem ler credenciais pessoais
  nos testes. Não modificar alterações preexistentes em `package-lock.json`.
- Não fazer commits automáticos: cada tarefa é uma unidade revisável e pode ser
  commitada separadamente caso o usuário autorize commits.

## Mapa dos arquivos de destino

Os caminhos abaixo são decisões deste plano; criar cada arquivo somente na
tarefa que introduz seu comportamento. Arquivos antigos podem continuar como
fachadas de compatibilidade durante a extração.

| Local | Responsabilidade |
| --- | --- |
| `shared/agent.ts`, `shared/tools.ts`, `shared/client.ts` | Contratos sem SDK, consumidos por TS e JSDoc |
| `bridge/config/{load,claude-source,voice}.mjs` | Opções e fontes de configuração |
| `bridge/tools/{permissions,registry}.mjs` | Autorização e execução de ferramentas |
| `bridge/tools/{panels,ui,vision,chrome}.mjs` | Definições e handlers independentes do agente |
| `bridge/integrations/claude-chrome.mjs` | Comunicação com a extensão Claude |
| `bridge/providers/claude/{provider,events,tools}.mjs` | Adaptação de sessão, eventos e registro no SDK |
| `bridge/conversation/{service,turns}.mjs` | Sessões, turnos e isolamento de eventos |
| `bridge/transport/{client-capabilities,ws}.mjs` | Solicitações ao navegador e protocolo de rede |
| `bridge/providers/create.mjs`, `bridge/bootstrap.mjs` | Seleção por registro e composição |
| `src/lib/{brain,create-brain,anthropic}.ts` | Porta do frontend, composição e adaptador direto |
| `shared/persona.mjs`, `shared/persona.d.mts` | Regras comuns da persona e declaração para o frontend, sem instruções de SDK |
| `tests/` | Contratos, fixtures, dublês e integração local sem credenciais |

## Contratos a estabelecer

Tipos ilustram as assinaturas públicas previstas; completar os unions com os
campos já utilizados no protocolo, evitando `any` e tipos de SDK.

- `Message = { role: 'user' | 'assistant'; content: ContentPart[] }`;
  `ContentPart` distingue texto e imagem com MIME e dados/URL explícitos.
- `AgentProvider.openSession(options: SessionOptions): Promise<AgentSession>`.
- `AgentSession.run(input: TurnInput, signal: AbortSignal): AsyncIterable<AgentEvent>`;
  `interrupt(turnId: string): Promise<void>`; `close(): Promise<void>`.
- `TurnInput = { sessionId: string; turnId: string; message: Message }`.
  Todo evento de turno carrega esses IDs. Eventos distinguem texto incremental,
  ferramenta, efeitos de UI e término `completed | failed | interrupted`.
  Eventos de disponibilidade pertencem à sessão, sem turno artificial.
- `SessionOptions` contém persona, ferramentas autorizadas, integrações MCP,
  capacidades do cliente e callbacks necessários, usando contratos próprios.
  Configuração específica do SDK é injetada no factory do adaptador.
- `ToolDefinition`: ID canônico, namespace, nome, descrição, esquemas Zod de
  entrada/saída e efeito `read | write | ui | camera | unknown`.
- `ToolExecutor.execute(id, input, context): Promise<ToolResult>`;
  `context` contém IDs e sinal. `ToolResult` distingue sucesso/falha e conteúdo
  de texto/imagem; o formato MCP é produzido somente no adaptador.
- `PermissionPolicy.decide(tool): { allowed: boolean; reason?: string }`.
- `ClientCapabilities.request(kind, payload, context): Promise<ClientReply>`;
  disponibilidade declarada e cancelamento/timeout explícitos.
- `createConversationService(deps)` produz
  `open({ sessionId, emit }): Promise<Conversation>`;
  `Conversation.ask(input): Promise<void>`, `interrupt(): Promise<void>` e
  `close(): Promise<void>`. `ask` aceita o turno ou rejeita antes de iniciá-lo;
  depois de aceito, o término é comunicado por evento.

Não exigir ferramentas de um provedor que só suporta conversa. Capacidades
opcionais são declaradas e verificadas antes da execução.

## Método de execução em baby steps

Executar sequencialmente. Para cada task de código: escrever o teste descrito,
rodá-lo e observar a falha esperada; implementar somente o necessário; repetir
o teste até passar; revisar o diff antes de seguir. Extrações começam com teste
de caracterização passando no código antigo, seguido de teste da nova fronteira.
Não deixar tarefas acumuladas sem verificação.

Adicionar na task 1 o comando `npm test` como
`node --import tsx --test tests/*.test.*` e manter testes no
primeiro nível de `tests/`. Comandos específicos abaixo usam o mesmo runner.
Ao conectar código de produção, executar também `npm run lint`, `npm run build`
e `node --check` em cada `.mjs` alterado. O resultado esperado é saída zero;
falhas preexistentes devem ser identificadas antes de atribuí-las à extração.

## Foco da revisão

| Condição | Resultado esperado e task responsável |
| --- | --- |
| Evento atrasado após interrupção | Não altera texto/HUD/câmera de outro turno; 13 e 15 |
| Cliente desconecta com câmera pendente | Rejeita pedido, limpa timer e encerra turno; 5 e 15 |
| SDK emite resultado duplicado ou termina sem resultado | Um único término, falha explícita quando necessário; 11 e 12 |
| Configuração inexistente ou provedor inválido | Fallback legado apenas para fonte opcional; provedor inválido falha; 3 e 14 |
| Extensão Chrome ausente ou ferramenta desconhecida | Capacidade indisponível/negação, sem sucesso simulado; 4 e 9 |

## Tasks

### 1. Fixar o comportamento WebSocket atual

**Arquivos:** criar `tests/protocol.test.mjs`, `tests/fixtures/protocol.mjs`;
alterar `package.json`.
**Interface:** fixtures dos eventos existentes `ready`, `text`, `tool`, `done`,
`error`, `panel`, `blade`, `ui`, captura/resposta e comandos de interrupção.

- [x] Ler produtor e consumidor e registrar payloads sintéticos válidos, sem dados pessoais.
- [x] Criar teste que verifica campos obrigatórios, IDs `ask` e sequência de uma conversa.
- [x] Adicionar `npm test` e rodar `node --import tsx --test tests/protocol.test.mjs`; esperar aprovação dos exemplos atuais. Esta task caracteriza, não altera, o comportamento.

### 2. Definir tipos próprios e um provedor falso

**Arquivos:** criar `shared/{agent,tools,client}.ts`, `tests/fakes/provider.mjs`,
`tests/contracts.test.ts`; alterar `tsconfig.app.json` para incluir `shared`.
**Interface:** contratos da seção anterior; `createFakeProvider(script)` devolve
`AgentProvider` e permite disparar eventos/erros e observar cancelamento.

- [x] Criar testes de texto e imagem, capacidades ausentes e consumo do fake; confirmar falha pela ausência das novas interfaces.
- [x] Declarar contratos sem dependências Anthropic e implementar fake controlado por teste, sem timers reais ou rede.
- [x] Rodar `node --import tsx --test tests/contracts.test.ts` e `npm run build`; esperar sucesso. Usar exemplos tipados para verificar as assinaturas no build.

### 3. Isolar fontes de configuração

**Arquivos:** criar `bridge/config/{load,claude-source,voice}.mjs`,
`tests/config.test.mjs`; alterar `bridge/server.mjs` somente nos pontos de leitura.
**Interfaces:** `loadBridgeConfig(env)`, `readClaudeSource({ readFile, home })`,
`resolveVoiceCredentials({ env, legacySource })`; retornar objetos próprios.

- [x] Caracterizar precedência MCP global/home e chave de voz: ambiente prevalece sobre fonte legada; arquivo ausente/malformado conserva fallback atual.
- [x] Extrair funções e injetar leitura de arquivo; manter valores e defaults efetivos atuais. Nenhum teste acessa `~/.claude.json` real.
- [x] Rodar `node --import tsx --test tests/config.test.mjs`; verificar que fonte ausente não impede boot nem expõe segredos em mensagens.

### 4. Extrair a política de autorização

**Arquivos:** criar `bridge/tools/permissions.mjs`, `tests/permissions.test.mjs`;
alterar `bridge/server.mjs` e criar `bridge/providers/claude/tools.mjs`.
**Interfaces:** `createPermissionPolicy({ allowWrites })`; adaptador
`describeClaudeTool(name)` traduz nomes legados para descrições canônicas.

- [x] Fixar a matriz atual de built-ins, MCP, exceções e ferramentas internas; verificar desconhecidos negados no padrão.
- [x] Mover política sem mudar permissões. Preservar allowlists explícitas; efeito desconhecido não é classificado automaticamente como leitura.
- [x] Rodar `node --import tsx --test tests/permissions.test.mjs`; verificar também `allowWrites` e ausência de execução na negação.

### 5. Extrair solicitações ao cliente

**Arquivos:** criar `bridge/transport/client-capabilities.mjs`,
`tests/client-capabilities.test.mjs`; alterar `bridge/server.mjs`.
**Interface:** `createClientCapabilities({ send, available, timeoutMs, clock })`
implementa a porta, mais `receive(reply)` e `close()` para o transporte.

- [x] Testar correlação de respostas fora de ordem, resposta desconhecida, timeout, abort e desconexão com câmera pendente.
- [x] Extrair mapa de pendências e limpeza; manter timeout padrão atual de 20.000 ms e injetar relógio nos testes.
- [x] Rodar `node --import tsx --test tests/client-capabilities.test.mjs`; todos os pedidos devem terminar e timers serem limpos.

### 6. Criar executor e adaptar uma ferramenta pequena

**Arquivos:** criar `bridge/tools/registry.mjs`, `bridge/tools/ui.mjs`,
`tests/tools.test.mjs`; alterar `bridge/ui.mjs` e o adaptador Claude de ferramentas.
**Interface:** `createToolExecutor({ definitions, policy })`; factory
`createUiTools({ emit })`; `registerClaudeTools({ definitions, executor })`.

- [x] Testar ferramenta de reset: chamada permitida emite uma operação; negação e entrada inválida não chamam handler; saída inválida vira falha normalizada.
- [x] Extrair somente reset, deixando as demais ferramentas no caminho legado; traduzir resultado próprio para MCP no adaptador.
- [x] Rodar `node --import tsx --test tests/tools.test.mjs`; verificar preservação do nome e payload públicos.

### 7. Extrair as demais ferramentas de UI

**Arquivos:** alterar `bridge/tools/ui.mjs`, `bridge/ui.mjs`, `tests/ui-tools.test.mjs` (criar).
**Interface:** completar `createUiTools({ emit })` com as operações existentes.

- [x] Caracterizar coerção de números/booleanos, cores automáticas, clamps e operações inválidas, preservando tolerâncias atuais.
- [x] Transferir handlers e schemas restantes; manter registro SDK apenas no adaptador/fachada temporária.
- [x] Rodar `node --import tsx --test tests/ui-tools.test.mjs`; comparar operações emitidas com fixtures legadas.

### 8. Extrair painéis, blades e visão

**Arquivos:** criar `bridge/tools/{panels,vision}.mjs`, `tests/panels.test.mjs`,
`tests/vision.test.mjs`; alterar `bridge/{panels,vision}.mjs`.
**Interfaces:** `createPanelTools({ emit, pages })`,
`createVisionTools({ clientCapabilities })`; `pages` injeta obtenção/render de páginas existente.

- [x] Testar painel/blade sem SDK, frame e sequência de frames como imagens, captura recusada e capacidade ausente.
- [x] Extrair primeiro painéis e verificar `tests/panels.test.mjs`; depois visão e verificar `tests/vision.test.mjs`, usando o runner da task 1 em cada passo.
- [x] Confirmar que nenhum handler novo importa SDK e que mídia continua pelo fluxo seguro existente; não alterar DOMPurify/CSP.

### 9. Isolar a integração Chrome

**Arquivos:** criar `bridge/integrations/claude-chrome.mjs`,
`bridge/tools/chrome.mjs`, `tests/chrome.test.mjs`; alterar `bridge/chrome.mjs`.
**Interfaces:** `createClaudeChromeClient({ connect, discover })`,
`createChromeTools({ client, allowWrites })`; manter fachada de compatibilidade.

- [x] Testar extensão ausente, resultado de leitura e ferramentas de ação omitidas com escrita desabilitada, usando socket falso.
- [x] Separar conexão/protocolo da extensão dos handlers e do registro SDK; identificar explicitamente a dependência Claude no diagnóstico.
- [x] Rodar `node --import tsx --test tests/chrome.test.mjs`; extensão ausente não impede conversa.

### 10. Consolidar persona e converter mensagens diretas

**Arquivos:** criar `shared/persona.mjs`, `shared/persona.d.mts`, `tests/direct-messages.test.ts`;
alterar `src/config.ts`, `src/lib/{brain,anthropic}.ts`, `bridge/server.mjs`.
**Interfaces:** regras comuns em `JARVIS_PERSONA`; conversores Anthropic privados
em `src/lib/anthropic.ts`; `Msg` passa a alias de `Message` próprio durante a transição.

- [x] Caracterizar prompts atuais e testar conversão de histórico texto/imagem sem mutar entrada; comparar regras comuns antes/depois.
- [x] Centralizar apenas regras equivalentes, mantendo diferenças existentes como instruções específicas de cada modo; não mudar persona por harmonização acidental.
- [x] Manter a persona compartilhada em JavaScript executável pelo Node sem loader TypeScript; usar `.d.mts` para declarar seu export no frontend. Os contratos `.ts` são imports de tipo/JSDoc no backend, nunca dependências de runtime.
- [x] Rodar `node --import tsx --test tests/direct-messages.test.ts` e build; nenhuma API pública reexporta mensagens Anthropic.

### 11. Extrair tradução de eventos Claude

**Arquivos:** criar `bridge/providers/claude/events.mjs`,
`tests/claude-events.test.mjs`; alterar o pump em `bridge/server.mjs`.
**Interface:** `createClaudeEventMapper({ sessionId, turnId, policy })` com
`accept(raw): AgentEvent[]` e `finish(): AgentEvent[]`, sem rede.

- [x] Usar fixtures sintéticas para deltas, anúncio duplicado de ferramenta, ferramenta negada, sucesso, erro e EOF sem resultado.
- [x] Mover tradução e deduplicação; custo indisponível permanece opcional/nulo, nunca zero inventado.
- [x] Rodar `node --import tsx --test tests/claude-events.test.mjs`; exigir exatamente um terminal por turno aceito e falha no EOF incompleto.

### 12. Encapsular sessão Claude

**Arquivos:** criar `bridge/providers/claude/provider.mjs`,
`tests/claude-session.test.mjs`; alterar `bridge/server.mjs`.
**Interface:** `createClaudeProvider({ query, config, registerTools })` implementa
`AgentProvider`; injeta `query` real somente na composição provisória.

- [x] Testar query falso: opções de SDK preservadas, fila de entrada, término duplicado, interrupção rejeitada, stream quebrado e close idempotente.
- [x] Mover criação de query, gerador de entrada, sincronização legada e pump para o adaptador; manter `settingSources: []`, ferramentas e política existentes.
- [x] Vincular callbacks de ferramentas ao contexto original da chamada/turno. Não usar apenas o turno corrente mutável para rotular efeitos: se o SDK não permitir correlação confiável após interrupção, invalidar a sessão e seus callbacks antes de aceitar o próximo turno.
- [x] Rodar `node --import tsx --test tests/claude-session.test.mjs`; o servidor passa a consumir eventos próprios, sem `switch` de eventos Anthropic.

### 13. Implementar orquestração e isolamento de turnos

**Arquivos:** criar `bridge/conversation/{service,turns}.mjs`,
`tests/conversation.test.mjs`.
**Interface:** `createConversationService({ provider, tools, policy, clientCapabilities, clock, interruptTimeoutMs })` conforme contratos; usar 400 ms como limite inicial de espera de interrupção, conservando a referência legada.

- [x] Com fake, testar streaming, A interrompido seguido de B, efeitos atrasados de A, fechamento e isolamento entre duas sessões.
- [x] Implementar estado por sessão, IDs imutáveis e término único. Ao timeout/rejeição de interrupt, invalidar a sessão antiga antes de reabrir ou reportar falha; nunca reatribuir seus eventos a B.
- [x] Rodar `node --import tsx --test tests/conversation.test.mjs`; incluir ferramenta demorada de A e impedir novos efeitos locais após abort.

### 14. Criar composição e seleção de provedor

**Arquivos:** criar `bridge/providers/create.mjs`, `bridge/bootstrap.mjs`,
`tests/composition.test.mjs`; alterar `bridge/config/load.mjs` e `scripts/setup.mjs`.
**Interfaces:** `createProvider(id, factories)`; `composeBridge(deps)`;
opção `JARVIS_PROVIDER`, padrão `claude`. Fake é injetado em testes, não um
provedor de produção anunciado ao usuário.

- [x] Testar padrão Claude, registro alternativo fake, ID inválido e diagnóstico com integrações indisponíveis.
- [x] Montar fontes, política, tools e provider num único ponto; verificar requisitos específicos do provedor selecionado no setup, usando processos falsos nos testes.
- [x] Rodar `node --import tsx --test tests/composition.test.mjs`; não importar/inicializar Claude para executar a composição com fake.

### 15. Conectar o transporte ao serviço

**Arquivos:** criar `bridge/transport/ws.mjs`, `tests/ws-integration.test.mjs`;
alterar `bridge/server.mjs`, `bridge/bootstrap.mjs`, `src/lib/bridge.ts` se necessário para descartar efeitos atrasados.
**Interface:** `attachConversationSocket({ socket, conversation, clientCapabilities })`;
tradução preserva nomes/campos existentes e pode acrescentar IDs compatíveis.

- [x] Testar WebSocket local com fake: conversa, interrupção A/B, painel atrasado, captura/resposta, desconexão, erro e nova conexão.
- [x] Substituir orquestração inline pelo serviço; manter endpoints HTTP e controles de Origin/CORS existentes. Não usar espera de tempo como prova de identidade de turno.
- [x] Rodar `node --import tsx --test tests/ws-integration.test.mjs` e suíte completa; confirmar compatibilidade com fixtures da task 1.

### 16. Injetar backend do frontend

**Arquivos:** criar `src/lib/create-brain.ts`, `tests/brain.test.ts`;
alterar `src/lib/{brain,bridge,anthropic}.ts` e `src/App.tsx` somente se necessário.
**Interfaces:** `createBrain(deps)` retorna porta de conversa; transporte selecionado
na composição. Portas opcionais de HUD/captura/conexão ficam segregadas da conversa.

- [x] Testar envio, histórico próprio, cancelamento e erro em backend direto com cliente falso; testar escolha de transporte sem checar provedor na UI.
- [x] Manter fachada pública `brain.ts`, mas injetar implementações; representar recursos ausentes explicitamente em vez de watchers vazios que aparentem suporte.
- [x] Rodar `node --import tsx --test tests/brain.test.ts`, lint e build; preservar comportamento bridge/direct e labels do HUD.

### 17. Verificar fronteiras e atualizar documentação

**Arquivos:** criar `tests/architecture.test.mjs`, `docs/architecture/providers.md`;
alterar `README.md`, `.env.example`, `AGENTS.md` e remover fachadas antigas apenas
quando não houver consumidores. Atualizar status do plano somente após execução validada.
**Interface:** guia de novo adaptador e matriz de capacidades/restrições reais.

- [x] Testar imports do núcleo/handlers/shared: SDKs só nos adaptadores; nenhum acesso direto a ambiente/filesystem no serviço. Rodar suíte de contrato contra fake e Claude com `query` falso.
- [x] Documentar composição, `JARVIS_PROVIDER`, restrições do modo direto, extensão Chrome e limitações das aprovações de ferramentas internas. Atualizar mapa e comandos do AGENTS sem remover regras de aprovação.
- [x] Executar `npm test`, `npm run lint`, `npm run build`, `node --check` nos `.mjs` alterados e `git diff --check`; registrar resultados e limitações.
- [ ] Se disponíveis hardware/login, verificar em Chrome/Edge boot, despertar, streaming, interrupção, HUD, mídia, câmera consentida e reconexão; testar modo direto somente com credenciais autorizadas. Se indisponíveis, marcar como pendente, sem declarar validação real concluída.

## Rastreabilidade da spec

| Critério | Tasks |
| --- | --- |
| 1 — Independência de SDK | 2, 6–12, 16–17 |
| 2 — Injeção explícita | 3–5, 12–16 |
| 3 — Substituição demonstrável | 2, 13–15 |
| 4 — Contratos de sessão | 2, 11–13, 15 |
| 5 — Interrupção segura | 5, 12–13, 15 |
| 6 — Ferramentas independentes | 6–9 |
| 7 — Permissões preservadas | 4, 6, 9, 12 |
| 8 — Capacidades explícitas | 2, 5, 8–9, 16 |
| 9 — Configuração isolada | 3, 14 |
| 10 — Compatibilidade funcional | 1, 10–12, 15–17 |
| 11 — Segurança mantida | 4–9, 15, 17 |
| 12 — Verificação/documentação | Todas; consolidação na 17 |

## Aprovação

Plano aprovado pelo pedido explícito de criar e implementar suas tasks em 2026-11-03.
Consultar os arquivos individuais em `docs/tasks/` para acompanhar a execução. Caso a implementação
revele necessidade de alterar escopo ou contratos essenciais, atualizar os
documentos e solicitar nova aprovação do trecho afetado antes de executá-lo.

## Resultado da execução

- Implementação em `/private/tmp/personal-jarvis-providers`, branch `refactor/provider-injection`, sem commits ou merge.
- Tasks individuais em `docs/tasks/01-desacoplamento.md` até `17-desacoplamento.md`.
- Verificação final: 30 testes passaram com Node 22, incluindo WebSocket real em localhost; lint sem erros, build concluído, sintaxe `.mjs` e diff conferidos. O teste localhost exige permissão de rede local no sandbox.
- Lint mantém aviso legado no cliente Chrome e aviso de generator no dublê de erro; build mantém avisos de externalização do SDK no modo direto e tamanho de chunks.
- Revisão independente detectou dois problemas, corrigidos e verificados com regressões: preservação de resume após interrupção e exposição pública do catálogo de ferramentas para outro provedor.
- Validar manualmente voz, câmera consentida, autenticação Claude e latência da query por turno. Nenhuma chamada de modelo ou ação externa foi executada nos testes.
- Refinamento interno: catálogo de ferramentas por turno substitui array estático de definições em SessionOptions, preservando contexto imutável. Tasks 12 e 14 registram a decisão.
