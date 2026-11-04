import { z } from 'zod'
const part = z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() })])
export const toolResultSchema = z.object({ content: z.array(part), isError: z.boolean().optional() })
export const toolFailure = (text) => ({ isError: true, content: [{ type: 'text', text }] })
export function defineTool(name, description, schema, handler) {
  return { name, description, inputSchema: z.object(schema), outputSchema: toolResultSchema, handler }
}
export function defineToolSet({ name, tools, ...metadata }) {
  return { name, ...metadata, tools: tools.map(t => ({ ...t, id: `${name}:${t.name}`, namespace: name, effect: t.effect ?? (name === 'jarvis_eyes' ? 'camera' : name === 'jarvis_chrome' ? 'unknown' : 'ui') })) }
}
export function createToolExecutor({ definitions, policy }) {
  const tools = new Map(definitions.map(t => [t.id, t]))
  return {
    async execute(id, input, context) {
      const def = tools.get(id)
      if (!def)
        return toolFailure('Unknown tool')
      if (context.signal?.aborted)
        return toolFailure('Turn interrupted')
      if (!policy.decide(def).allowed)
        return toolFailure('Tool blocked by permission policy')
      try {
        const args = def.inputSchema.parse(input)
        const result = await def.handler(args, context)
        if (context.signal?.aborted)
          return toolFailure('Turn interrupted')
        return def.outputSchema.parse(result)
      }
      catch {
        return toolFailure('Tool execution or validation failed')
      }
    },
  }
}
