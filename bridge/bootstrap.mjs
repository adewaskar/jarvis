import { createProvider } from './providers/create.mjs'
import { createPermissionPolicy } from './tools/permissions.mjs'
import { createConversationService } from './conversation/service.mjs'
import { createPanelToolSet } from './tools/panels.mjs'
import { createUiToolSet } from './tools/ui.mjs'
import { createVisionToolSet } from './tools/vision.mjs'
import { createChromeToolSet } from './tools/chrome.mjs'
export async function composeBridge({ config, source, providerFactories, chromeClient, pages }) {
  const factories = providerFactories ?? {
    claude: async () => {
      const [{ query }, { createClaudeProvider }, { registerClaudeToolSet }, { SYSTEM_PROMPT }] = await Promise.all([
        import('@anthropic-ai/claude-agent-sdk'), import('./providers/claude/provider.mjs'),
        import('./providers/claude/register-tools.mjs'), import('./providers/claude/prompt.mjs'),
      ])
      return createClaudeProvider({
        query, config: { ...config, persona: SYSTEM_PROMPT }, registerTools: (options, context, emit) => {
          const sets = options.tools.create(context, emit)
          return Object.fromEntries(sets.map(set => [set.name, registerClaudeToolSet(set, { policy: options.policy, context })]))
        }
      })
    },
  }
  const provider = await createProvider(config.provider, factories)
  const policy = createPermissionPolicy({ allowWrites: config.allowWrites })
  return {
    openConversation({ sessionId, emit, clientCapabilities, onReady }) {
      const createToolSets = (context, publish) => {
        const guarded = fn => (...args) => {
          if (!context.signal.aborted)
            fn(...args)
        }
        return [
          createPanelToolSet({ emit: guarded(panel => publish({ type: 'panel', panel })), emitBlade: guarded(blade => publish({ type: 'blade', blade })), pages }),
          createUiToolSet({ emit: guarded((op, args) => publish({ type: 'ui', op, args })) }),
          createVisionToolSet({ clientCapabilities }),
          ...(chromeClient?.forward ? [createChromeToolSet({ client: chromeClient, allowWrites: config.allowWrites })] : []),
        ]
      }
      return createConversationService({
        provider, tools: { create: createToolSets }, policy, clientCapabilities, sessionOptions: {
          integrations: source.servers, onReady,
        }
      }).open({ sessionId, emit })
    },
  }
}
