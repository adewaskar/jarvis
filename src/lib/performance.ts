import { BRIDGE_HTTP_URL } from '../config'

export type GraphicsTier = 'lite' | 'balanced' | 'full'
export type GraphicsProfile = { tier: GraphicsTier; label: string; dpr: number; particles: number; postProcessing: boolean }
type HardwareSnapshot = { webgl: boolean; memoryGB: number; cpuCores: number; renderer: string; saveData: boolean }

const PROFILES: Record<GraphicsTier, GraphicsProfile> = {
  lite: { tier: 'lite', label: 'Leve', dpr: 0.78, particles: 420, postProcessing: false },
  balanced: { tier: 'balanced', label: 'Equilibrado', dpr: 1, particles: 1600, postProcessing: false },
  full: { tier: 'full', label: 'Completo', dpr: 1.35, particles: 4000, postProcessing: true },
}
export function classifyGraphicsTier(s: HardwareSnapshot): GraphicsTier {
  const software = /swiftshader|llvmpipe|softpipe|software rasterizer|basic render|basic display/i.test(s.renderer)
  if (!s.webgl || software || s.saveData || s.memoryGB <= 4 || s.cpuCores <= 4) return 'lite'
  const dedicated = /nvidia|geforce|radeon|amd|intel arc|apple m[1-9]/i.test(s.renderer)
  return s.memoryGB >= 16 && s.cpuCores >= 8 && dedicated ? 'full' : 'balanced'
}
function browserHardware(): HardwareSnapshot {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  let webgl = false
  let renderer = ''
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2', { powerPreference: 'low-power' }) ||
      canvas.getContext('webgl', { powerPreference: 'low-power' })) as WebGLRenderingContext | null
    if (gl) {
      webgl = true
      const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null
      renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) || '')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch { webgl = false }
  return {
    webgl,
    memoryGB: typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : 8,
    cpuCores: Math.max(1, Number(nav.hardwareConcurrency) || 4),
    renderer,
    saveData: Boolean(nav.connection?.saveData),
  }
}
function makeProfile(s: HardwareSnapshot): GraphicsProfile { return { ...PROFILES[classifyGraphicsTier(s)] } }
export function detectBrowserPerformanceProfile(): GraphicsProfile { return makeProfile(browserHardware()) }

/** Supplements browser estimates with real physical RAM and logical CPU count from localhost. */
export async function detectPerformanceProfile(): Promise<GraphicsProfile> {
  const s = browserHardware()
  try {
    const response = await fetch(`${BRIDGE_HTTP_URL}/health`, { signal: AbortSignal.timeout(1800), cache: 'no-store' })
    if (response.ok) {
      const h = (await response.json()) as { hardware?: { cpuCores?: number; memoryGB?: number } }
      if (typeof h.hardware?.cpuCores === 'number' && h.hardware.cpuCores > 0) s.cpuCores = h.hardware.cpuCores
      if (typeof h.hardware?.memoryGB === 'number' && h.hardware.memoryGB > 0) s.memoryGB = h.hardware.memoryGB
    }
  } catch { /* Browser estimate remains usable if the bridge is unavailable. */ }
  return makeProfile(s)
}
export function downgradePerformanceProfile(p: GraphicsProfile): GraphicsProfile {
  return p.tier === 'full' ? { ...PROFILES.balanced } : p.tier === 'balanced' ? { ...PROFILES.lite } : p
}
