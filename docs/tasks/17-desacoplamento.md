# Task 17: Verificar fronteiras e atualizar documentação

Status: implementação e verificações automatizadas concluídas; validação manual pendente.

Plano: [desacoplamento de provedores](../plans/2026-11-03-desacoplamento-de-provedores.md).

**Arquivos:** criar `tests/architecture.test.mjs`, `docs/architecture/providers.md`;
alterar `README.md`, `.env.example`, `AGENTS.md` e remover fachadas antigas apenas
quando não houver consumidores. Atualizar status do plano somente após execução validada.
**Interface:** guia de novo adaptador e matriz de capacidades/restrições reais.

- [x] Testar imports do núcleo/handlers/shared: SDKs só nos adaptadores; nenhum acesso direto a ambiente/filesystem no serviço. Rodar suíte de contrato contra fake e Claude com `query` falso.
- [x] Documentar composição, `JARVIS_PROVIDER`, restrições do modo direto, extensão Chrome e limitações das aprovações de ferramentas internas. Atualizar mapa e comandos do AGENTS sem remover regras de aprovação.
- [x] Executar `npm test`, `npm run lint`, `npm run build`, `node --check` nos `.mjs` alterados e `git diff --check`; registrar resultados e limitações.
- [ ] Se disponíveis hardware/login, verificar em Chrome/Edge boot, despertar, streaming, interrupção, HUD, mídia, câmera consentida e reconexão; testar modo direto somente com credenciais autorizadas. Se indisponíveis, marcar como pendente, sem declarar validação real concluída.

Resultado: 30 testes passaram com Node 22, lint sem erros, build e sintaxe verificados. Testes reais de hardware/login não executados. Revisão independente concluída com regressões corrigidas.
