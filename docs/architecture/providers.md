# Provedores do Jarvis

A seleção do transporte do frontend (`VITE_BACKEND=bridge|direct`) é independente
 da seleção do agente do bridge (`JARVIS_PROVIDER=claude`). Apenas Claude é um
provedor real implementado; a arquitetura é exercitada com um fake em testes.

## Direção das dependências

- `shared/`: contratos próprios de mensagens, sessões, ferramentas e cliente.
- `bridge/conversation/`: ciclo de vida de turnos; não importa SDK, ambiente ou filesystem.
- `bridge/tools/`: schemas Zod e handlers, sem registro específico de SDK.
- `bridge/providers/claude/`: query, tradução de eventos, classificação legada,
  prompt específico e registro MCP Anthropic.
- `bridge/transport/`: protocolo WebSocket e pedidos correlacionados ao navegador.
- `bridge/bootstrap.mjs`: ponto de composição. Recebe fontes/configuração e
  injeta a implementação do provedor e integrações opcionais.
- `src/lib/create-brain.ts`: portas do frontend; `brain.ts` monta bridge ou direct.
  O cliente direto Anthropic e as conversões ficam em adaptadores próprios.

Não há container de DI: factories recebem explicitamente suas dependências.
Os módulos `.mjs` são executáveis pelo Node; os contratos `.ts` não são imports
 de runtime do backend. A persona compartilhada usa `.mjs` e declaração `.d.mts`.

## Adicionar outro provedor

1. Implementar `AgentProvider`/`AgentSession` de `shared/agent.ts`, traduzindo
   mensagens, eventos e resultados nas bordas. Não exportar tipos do SDK.
2. Obter as ferramentas pelo catálogo público `options.tools.create(context, emit)`
   e executar chamadas por `createToolExecutor` com `options.policy`. Declarar capacidades reais; não simular ferramentas/câmera ausentes.
3. Registrar um factory em `composeBridge`, com import tardio do SDK. Credenciais
   e opções específicas são parâmetros do factory, nunca lidas pelo serviço.
4. Mapear ferramentas e permissões do novo runtime. Ferramentas locais passam
   pelo executor; ferramentas internas do agente exigem controles equivalentes.
5. Adicionar diagnóstico em `diagnoseProvider` e fonte de configuração apropriada.
6. Executar os testes de sessão, ferramentas, interrupção e transporte contra o
   adaptador com SDK falso antes de uma validação real autorizada.

`createProvider` rejeita IDs desconhecidos; não troca silenciosamente de agente.
Não há troca de provedor em uma sessão ativa nem carregamento de plugins externos.

## Sessões e cancelamento

Cada evento de turno tem `sessionId` e `turnId` imutáveis. O serviço aceita um
turno por vez, emite um terminal e descarta eventos após término/interrupção.
Interrupções são limitadas a 400 ms; falha ou timeout invalida a sessão antiga.
Encerramento limpa as solicitações ao cliente; captura tem timeout de 20 s.

O adaptador Claude abre uma query por turno e retoma a conversa pelo ID do SDK.
Isso isola callbacks de ferramentas no contexto original. Há custo potencial de
inicialização por turno, a medir em uso real. Fechar uma query não desfaz ações
externas já executadas. O protocolo antigo é preservado; efeitos passam a carregar
`ask` para que o frontend descarte atualizações atrasadas.

## Segurança e capacidades

| Recurso | Bridge Claude | Direct Anthropic |
| --- | --- | --- |
| Conversa e texto incremental | Sim | Sim |
| MCP local/stdin | Configuração injetada, fonte Claude por compatibilidade | Não |
| MCP remoto | Via runtime Claude | Via API Anthropic |
| HUD e câmera por ferramentas | Sim, com permissões do navegador | Indisponível |
| Controle do navegador local | Opcional; depende da extensão Claude | Indisponível |
| Credencial do agente | Login Claude local | Chave existente exposta ao navegador; somente demo local |

O executor local verifica política, input/output e cancelamento. A classificação
legada baseada em nomes fica no adaptador Claude. `settingSources: []` permanece;
o SDK ainda pode autorizar ferramentas internas sem consultar o callback, como
já ocorria antes. A política não é uma sandbox completa. Um futuro adaptador não
pode alegar equivalência de isolamento sem testar seu próprio enforcement.

As validações de rede, caminhos, HTML e mídia continuam nos módulos existentes.
A configuração ElevenLabs foi separada da descoberta de MCP: ambiente prevalece,
com fallback de compatibilidade para a fonte Claude, sem publicar a chave.

## Verificação

`npm test` executa testes locais com Node/tsx e dublês, sem modelos, credenciais,
câmera real ou ações externas. `npm run build` verifica frontend e contratos;
`npm run lint` verifica estilo; `node --check` verifica sintaxe `.mjs`.
Testes automatizados não substituem validação real de latência, autenticação,
voz, câmera ou compatibilidade com a extensão. Esses testes manuais precisam
ser registrados separadamente, sem apresentar ausência de teste como sucesso.
