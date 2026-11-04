# Instruções para agentes

## Escopo e contexto

Este arquivo orienta o trabalho em todo o repositório. Consulte instruções mais
específicas em subdiretórios, caso existam, antes de alterá-los.

J.A.R.V.I.S. é um assistente de voz com interface holográfica no navegador.
São dois processos: o frontend React/Vite e um bridge Node.js que executa o
Claude Agent SDK, reutiliza o login local do Claude Code e integra servidores
MCP. O modo padrão é `bridge`; existe também um backend `direct` que chama a
API Anthropic pelo navegador.

## Mapa do projeto

- `src/App.tsx`: orquestra inicialização, conversa, interrupções e recursos de
  voz/câmera. Preserve a lógica que impede turnos antigos de atualizar o estado.
- `src/store.ts`: estado compartilhado com Zustand, incluindo fases e HUD.
- `src/config.ts`: configuração do frontend e interpretação de variáveis Vite.
- `src/lib/brain.ts`: fachada que seleciona o backend `bridge` ou `direct`.
- `src/lib/bridge.ts`: cliente WebSocket, eventos, conexão e cancelamento.
- `src/lib/anthropic.ts`: implementação do backend direto.
- `src/lib/`: voz, VAD, áudio, TTS, capacidades, câmera e gestos.
- `src/scene/`: cena Three.js via React Three Fiber, efeitos e shaders.
- `src/ui/` e `src/index.css`: interface, HUD, painéis e estilos.
- `src/ui/sanitise.ts`: sanitização central de HTML e reescrita de mídia.
- `bridge/server.mjs`: servidor HTTP/WebSocket, sessão do agente, permissões e
  integração com a configuração MCP local.
- `bridge/net.mjs`: acesso HTTP externo com proteção contra SSRF.
- `bridge/{panels,ui,chrome,vision}.mjs`: ferramentas MCP da interface e câmera.
- `bridge/page.mjs`: obtenção de páginas remotas.
- `scripts/start.mjs`: inicia os dois processos e prepara assets MediaPipe.
- `scripts/setup.mjs`: diagnóstico de pré-requisitos locais.
- `public/`: assets estáticos; `public/audio/CREDITS.md` registra créditos de áudio.

- `shared/`: contratos independentes de SDK.
- `bridge/conversation/`: serviço de conversa e isolamento de turnos.
- `bridge/tools/`: definições, handlers, executor e política.
- `bridge/providers/claude/`: adaptador do SDK e registro MCP.
- `bridge/transport/`: WebSocket e solicitações ao cliente.
- `bridge/bootstrap.mjs`: composição; selecione provedores aqui, sem condicionais no núcleo.
- `docs/architecture/providers.md`: arquitetura e guia para novos adaptadores.

## Ambiente e comandos

Use npm e preserve `package-lock.json`. `package.json` declara Node.js >=20;
confira também os requisitos das dependências instaladas em caso de falha.

| Comando | Finalidade |
| --- | --- |
| `npm ci` | Instalar as dependências a partir do lockfile |
| `npm run setup` | Conferir os pré-requisitos locais |
| `npm start` | Iniciar bridge e frontend juntos |
| `npm run dev` | Iniciar somente o Vite, porta padrão 5173 |
| `npm run bridge` | Iniciar somente o bridge, porta padrão 8787 |
| `npm run build` | Executar `tsc -b` e gerar o bundle Vite |
| `npm test` | Executar contratos e integração local, sem credenciais |
| `npm run lint` | Executar Oxlint conforme `.oxlintrc.json` |
| `npm run preview` | Servir o build do frontend para inspeção |

O preview não inicia o bridge. `npm run bridge:writes` habilita ferramentas com
efeitos externos; não o use como comando habitual de desenvolvimento ou teste.
Para testar voz, use Chrome/Edge em janela real, com microfone permitido e WebGL.
O modo bridge requer Claude Code instalado e autenticado para executar o agente.

## Convenções de implementação

- Siga o estilo dos arquivos existentes: módulos ES, aspas simples, sem ponto e
  vírgula e indentação de dois espaços. Frontend em `.ts`/`.tsx`; bridge e scripts
  em `.mjs`. Preserve o idioma inglês predominante no código e na interface.
- Use componentes funcionais e respeite as regras de hooks. Reaproveite o store
  e as abstrações existentes antes de criar outro canal de estado ou backend.
- Os tsconfigs verificam variáveis/parâmetros não usados e usam
  `verbatimModuleSyntax`; use `import type` para imports exclusivamente de tipos.
- Ao mudar mensagens WebSocket ou ferramentas da interface, confira o produtor
  em `bridge/`, o consumidor em `src/lib/bridge.ts` e os tipos/estado relacionados.
- Ao mudar classes `.hud-*`, mantenha alinhados o contrato em `bridge/panels.mjs`,
  os estilos e a allowlist em `src/ui/sanitise.ts`.
- Em áudio, câmera, eventos e animações, preserve limpeza de recursos,
  cancelamento e interrupção por fala. Respostas assíncronas de turnos cancelados
  não devem reativar áudio nem sobrescrever o turno atual.
- Preserve os fallbacks de voz do navegador e o funcionamento sem chaves opcionais.
- Evite alterações incidentais em dependências, assets e arquivos do usuário.
  Não versione `dist/`, `node_modules/` nem `public/mediapipe/` gerado pelo launcher.

## Configuração e limites de segurança

- Consulte `.env.example`, `src/config.ts` e `bridge/server.mjs` antes de alterar
  configuração. Em divergências com o README, confirme o comportamento no código.
  O fallback atual de `JARVIS_EFFORT` é `high`.
- O frontend lê `VITE_*` de `.env.local`; o bridge lê o ambiente do processo.
  Não presuma que o bridge carregue automaticamente `.env.local`.
- Valores `VITE_*` entram no bundle público. Nunca adicione segredos reais ao
  código, documentação, logs ou arquivos versionados. O backend direto existente
  expõe a chave ao navegador e não deve ser adotado como padrão de implantação.
- Preserve `decideTool()`, a política padrão de restrição de ferramentas com
  efeitos externos e `settingSources: []`. Não amplie permissões para contornar
  falhas de desenvolvimento.
- Preserve validação de Origin/CORS, confinamento e resolução real de caminhos
  em `/file`, limites de proxy e controles de DNS/redirect/endereços privados em
  `bridge/net.mjs`. Reutilize esse módulo para novas requisições remotas do bridge.
- HTML gerado pelo modelo é não confiável: passe pela sanitização central e
  preserve a CSP em `index.html`, a allowlist de classes e as restrições de embeds.
- Preserve os controles de consentimento e os indicadores de câmera/microfone.

## Continuidade entre tasks

Antes de iniciar cada nova task, leia `docs/tasks/finished.md`, quando existir,
para recuperar o estado do trabalho anterior. Consulte em seguida a descrição
da próxima task, o plano aprovado e os arquivos relevantes. Use esses registros
e o estado atual do repositório como contexto, sem depender do histórico da
conversa do Codex. Se o resumo ainda não existir, parta do plano aprovado e do
estado do repositório; não presuma que alguma task foi concluída.

Ao finalizar cada task, após as verificações pertinentes, sobrescreva sempre
o mesmo arquivo `docs/tasks/finished.md` (criando a pasta se necessário).
Mantenha somente o resumo da última task concluída, sem acumular histórico.
Use os quatro campos abaixo, com links relativos para os documentos e, quando
a task estiver no próprio plano, para a seção correspondente:

```markdown
- Última task feita: <número e título>
- Arquivo de descrição da task: <link para arquivo ou seção>
- Arquivo de descrição do plano: <link para o plano>
- Descrição das mudanças: <resumo breve, incluindo verificação e eventual limitação relevante>
```

Mantenha o resumo em poucas linhas, sem logs, diffs ou transcrições. Se não
houver documento de task ou plano associado, informe `Não se aplica` no campo
correspondente. Não registre uma task incompleta como finalizada. O resumo
não substitui as aprovações obrigatórias nem o acompanhamento no plano.

## Validação e entrega

Toda spec e todo plano devem receber aprovação explícita do usuário.
Specs devem ser salvas em arquivos dentro de `docs/specs/`; aguarde a aprovação
da spec antes de criar seu plano. Todos os planos de implementação devem ser
salvos em um arquivo dentro de `docs/plans/`, preferencialmente com nome
`YYYY-MM-DD-<assunto>.md`, e referenciar a spec correspondente quando houver.
A aprovação da spec autoriza somente a elaboração do plano; aguarde também a
aprovação explícita do plano antes de iniciar a implementação. Registre o status
de aprovação em cada documento. Mudanças de escopo em uma spec ou plano aprovado
devem ser submetidas a nova aprovação antes da execução do escopo alterado.

Execute `npm test` para os testes locais de contratos e integração com dublês.
Para mudanças de código, execute `npm run lint` e `npm run build`. O build
verifica o TypeScript do frontend/configuração Vite, não o JavaScript do bridge.
Para arquivos `.mjs` alterados, use também `node --check caminho/do/arquivo.mjs`.

Faça validação manual proporcional à alteração: inicialização e conexão do
bridge; despertar, fala, interrupção e retorno ao standby para mudanças de voz;
renderização e mídia para mudanças no HUD. Use `D` para diagnóstico e `T` para o
autoteste de áudio. Não execute ferramentas com efeitos externos como teste.
Alterações apenas de documentação exigem conferir caminhos, comandos e diff.

Informe o que mudou, quais verificações foram executadas e quais dependeram de
hardware, autenticação ou serviços indisponíveis. Não afirme validação que não
foi realizada. Atualize README e `.env.example` quando mudar configuração ou
comportamento documentado. Preserve alterações preexistentes no diretório de trabalho.
