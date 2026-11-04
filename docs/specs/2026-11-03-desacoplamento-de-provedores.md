# Nome da implementação

Desacoplamento de provedores de agentes com SOLID e injeção de dependências.

Status: aprovada explicitamente pelo usuário em 2026-11-03.

## Visão geral da implementação

Refatorar o Jarvis para que a conversa, a interface e as ferramentas dependam
de contratos próprios da aplicação, em vez de tipos, eventos e construtores
do Claude Agent SDK. O objetivo é permitir a inclusão futura de Codex ou
outro provedor sem reescrever a orquestração da conversa nem o frontend.

A abordagem proposta é incremental: manter o Claude como implementação real
e padrão durante a refatoração, preservando os comportamentos existentes.
Validar a substituição com um provedor falso determinístico, sem chamadas
externas. Implementar Codex ou outro provedor real será um trabalho posterior.

### Situação atual

- `bridge/server.mjs` concentra transporte HTTP/WebSocket, sessão Claude,
  configuração, permissões, ferramentas e tradução de eventos.
- `bridge/{panels,ui,chrome,vision}.mjs` registram ferramentas com construtores
  do SDK Anthropic.
- `src/lib/brain.ts` seleciona implementações concretas e reexporta tipos
  definidos em `src/lib/anthropic.ts`, incluindo mensagens do SDK Anthropic.
- A descoberta de MCP e parte da configuração de ElevenLabs dependem de
  `~/.claude.json`; o setup pressupõe Claude instalado.
- O controle de Chrome utiliza a extensão e o socket do Claude. Essa integração
  é uma dependência independente da escolha do agente.

### Alternativas e decisão proposta

1. **Extração incremental, recomendada:** introduzir contratos e extrair o
   adaptador Claude em etapas verificáveis. Reduz o risco de regressão e permite
   manter a aplicação utilizável, ao custo de uma transição temporária entre
   módulos antigos e novos.
2. **Reorganização completa do backend:** estabelecer toda a estrutura de uma
   vez. Amplia a quantidade de comportamento alterado simultaneamente e torna
   mais difícil identificar regressões em voz e interrupção.

A aprovação desta spec confirma a primeira alternativa. A sequência detalhada
de tarefas será definida no plano, após essa aprovação.

### Limites e responsabilidades

- **Contratos da aplicação:** mensagens multimodais, eventos de sessão/turno,
  resultados, erros, capacidades e descrições de ferramentas independentes de
  SDK. Tipos externos não podem fazer parte desses contratos públicos.
- **Serviço de conversa:** gerencia identidade e ciclo de vida de sessões e
  turnos, interrupções, encerramento e encaminhamento de eventos. Depende dos
  contratos e recebe suas dependências explicitamente.
- **Adaptador de provedor:** implementa abertura de sessão, entrada de usuário,
  streaming, interrupção e descarte; traduz contratos e eventos para o SDK e
  normaliza erros e metadados. Particularidades de sincronização do Claude
  permanecem nesse adaptador.
- **Ferramentas:** definições e handlers do Jarvis são separados do registro
  específico de SDK/MCP. Um registro/executor disponibiliza ferramentas com
  identidade, esquema de entrada e classificação de efeitos. Resultados precisam
  representar texto, imagem e falha sem tipos Anthropic.
- **Permissões:** política independente avalia descrições normalizadas de
  ferramentas. O executor verifica a autorização antes de executar handlers
  locais; o adaptador configura os controles disponíveis para ferramentas
  executadas pelo próprio agente. Não se presume equivalência entre sandboxes.
- **Capacidades do cliente:** câmera e outras solicitações ao navegador usam
  uma porta de comunicação com correlação, timeout e cancelamento, sem expor
  sockets aos handlers de negócio.
- **Configuração:** fontes de MCP, credenciais e opções são injetadas.
  `~/.claude.json` permanece uma fonte de compatibilidade isolada; não é uma
  dependência obrigatória do núcleo. A obtenção de credenciais de voz deve ser
  separada da descoberta de ferramentas do agente.
- **Transporte:** HTTP/WebSocket converte o protocolo de rede em chamadas e
  eventos da aplicação, sem interpretar eventos do SDK Claude.
- **Composição:** um ponto de inicialização seleciona o provedor e monta os
  serviços por parâmetros/factories. Não é necessário um framework de DI.

### Aplicação dos princípios SOLID

| Princípio | Requisito de design |
| --- | --- |
| Responsabilidade única | Separar transporte, conversa, ferramentas, política, configuração e adaptação do SDK |
| Aberto/fechado | Adicionar provedor por novo adaptador e registro na composição, sem novos condicionais na conversa ou UI |
| Substituição de Liskov | Garantir semântica comum de eventos, conclusão, erro, interrupção e encerramento |
| Segregação de interfaces | Separar sessão, execução de ferramentas e capacidades opcionais; evitar métodos vazios para recursos ausentes |
| Inversão de dependência | O núcleo define contratos; implementações externas dependem deles e são injetadas |

### Compatibilidade e escopo

Preservar o protocolo WebSocket observado pelo frontend ou manter uma camada de
tradução compatível. Preservar o backend direto Anthropic e seu comportamento,
confinando seus tipos e conversões ao adaptador correspondente. Seleção de
transporte (`bridge`/`direct`) e seleção de provedor são decisões distintas.

Manter a integração Chrome existente como adaptador opcional e identificar sua
dependência da extensão Claude; não implementar outro driver de navegador.
Centralizar as regras comuns da persona, mantendo instruções específicas de
provedor/ferramenta em seus respectivos adaptadores.

Não estão incluídos novos provedores reais, troca de voz/STT/TTS, redesign
visual, troca de provedor durante uma sessão ativa, migração do backend inteiro
para TypeScript, container de DI, sistema de plugins dinâmicos ou alterações de
autenticação e cobrança. Os contratos podem ser expressos com tipos TypeScript
compartilhados e JSDoc nos módulos `.mjs` existentes.

## Critérios de aceitação

1. **Independência de SDK:** núcleo da conversa, contratos compartilhados e
   handlers de ferramentas não importam SDK Anthropic nem tipos ou estruturas
   específicas dele. Imports concretos ficam nos adaptadores e na composição,
   quando necessários.
2. **Injeção explícita:** serviço de conversa recebe provedor, ferramentas,
   política e capacidades do cliente por parâmetros. Não lê variáveis de
   ambiente, arquivos globais ou configurações do SDK diretamente.
3. **Substituição demonstrável:** a mesma orquestração executa com adaptador
   Claude e com provedor falso. Selecionar uma implementação não exige modificar
   o serviço de conversa ou componentes visuais. Provedor inválido falha com
   mensagem clara, sem fallback silencioso.
4. **Contratos de sessão:** testes determinísticos verificam streaming ordenado,
   identificação de sessão/turno e distinção entre conclusão, falha e interrupção.
   Cada turno aceito termina com exatamente um evento terminal, inclusive em
   falha, interrupção ou encerramento da sessão. Encerrar a sessão libera
   recursos e resolve ou rejeita operações pendentes; a entrega ao navegador
   depende de o transporte ainda estar conectado.
5. **Interrupção segura:** ao interromper A e iniciar B, texto, conclusão e efeitos
   de UI atrasados de A não são atribuídos a B nem atualizam sua interface.
   Falha/timeout ao interromper tem tratamento explícito e não bloqueia a
   conversa indefinidamente. Efeitos externos já executados não são considerados
   reversíveis pelo cancelamento.
6. **Ferramentas independentes:** painéis, blades, temas e câmera podem ter seus
   handlers exercitados sem inicializar o Claude. O registro no SDK é separado
   da execução; entradas e saídas são validadas na fronteira.
7. **Permissões preservadas:** ferramentas restritas e desconhecidas permanecem
   negadas no modo padrão. Testes verificam que chamadas negadas não executam
   handlers. Flags de escrita não são habilitadas automaticamente. O adaptador
   Claude preserva `settingSources: []` e os controles existentes; limitações
   de enforcement de ferramentas internas ficam documentadas.
8. **Capacidades explícitas:** recursos ausentes são anunciados como indisponíveis,
   com resposta tratada pela aplicação. Não há implementações vazias que
   aparentem sucesso para uma capacidade não suportada.
9. **Configuração isolada:** descoberta de MCP e obtenção de credenciais podem
   receber fontes falsas nos testes. A fonte Claude mantém compatibilidade sem
   exigir leitura do diretório pessoal para testar a aplicação. Setup e mensagens
   de disponibilidade refletem o provedor e integrações selecionados.
10. **Compatibilidade funcional:** Claude continua como padrão; conversa, áudio
    incremental, interrupção, HUD, mídia, câmera e reconexão mantêm o comportamento
    existente. Backend direto permanece funcional, com mensagens convertidas
    pelo seu adaptador. Testes com dublês cobrem o protocolo; verificações reais
    que exigem hardware ou login são registradas separadamente.
11. **Segurança mantida:** não há relaxamento de Origin/CORS, CSP, sanitização,
    confinamento de arquivos, proteção SSRF ou consentimento de câmera/microfone.
    Não são adicionados segredos ao bundle nem executadas ações externas para
    validar testes automatizados.
12. **Verificação e documentação:** lint, build, checagem de sintaxe dos `.mjs`
    alterados e testes de contratos passam. README, exemplo de ambiente e
    instruções de arquitetura refletem a composição final e explicam como
    adicionar um adaptador. Etapas incrementais devem manter a aplicação
    utilizável e incluir verificação proporcional no futuro plano.

## Aprovação e próximo artefato

A aprovação da spec autoriza criar o plano incremental em um arquivo de
`docs/plans/`, referenciando esta spec e seus critérios de aceitação.
A implementação depende de aprovação explícita desse plano pelo usuário.
