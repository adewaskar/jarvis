/**
 * Security & Permissions Manager for JARVIS
 * 
 * Controls access to:
 * - MCP (Model Context Protocol servers)
 * - Shell (Terminal execution)
 * - Files (File system read/write)
 * - Browser (Playwright / Chrome control)
 * 
 * Supports:
 * - Read-only mode toggle
 * - Granular capability blocking
 */

export type Capability = 'mcp' | 'shell' | 'files' | 'browser'

export interface SecurityConfig {
  readOnly: boolean
  blockedCapabilities: Record<Capability, boolean>
  allowWrites: boolean
  requireConfirmation: boolean
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  readOnly: false,
  blockedCapabilities: {
    mcp: false,
    shell: false,
    files: false,
    browser: false
  },
  allowWrites: true,
  requireConfirmation: false
}

export class SecurityManager {
  private config: SecurityConfig

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
  }

  getConfig(): SecurityConfig {
    return { ...this.config }
  }

  setReadOnly(readOnly: boolean): void {
    this.config.readOnly = readOnly
    if (readOnly) {
      this.config.allowWrites = false
    }
  }

  setBlocked(capability: Capability, blocked: boolean): void {
    this.config.blockedCapabilities[capability] = blocked
  }

  isBlocked(capability: Capability): boolean {
    return !!this.config.blockedCapabilities[capability]
  }

  canWrite(): boolean {
    return !this.config.readOnly && this.config.allowWrites
  }

  /**
   * Check if an action is permitted. Throws an error if blocked or read-only violation.
   */
  assertPermission(capability: Capability, actionType: 'read' | 'write' | 'execute'): void {
    if (this.isBlocked(capability)) {
      throw new Error(`Security Violation: Capability '${capability}' is currently BLOCKED.`)
    }

    if ((actionType === 'write' || actionType === 'execute') && this.config.readOnly) {
      throw new Error(`Security Violation: System is in READ-ONLY mode. '${capability}' ${actionType} rejected.`)
    }

    if ((actionType === 'write' || actionType === 'execute') && !this.config.allowWrites) {
      throw new Error(`Security Violation: Writes are disabled. '${capability}' ${actionType} rejected.`)
    }
  }
}

// Global singleton instance for bridge
let globalSecurityManager: SecurityManager | null = null

export function getSecurityManager(): SecurityManager {
  if (!globalSecurityManager) {
    globalSecurityManager = new SecurityManager({
      readOnly: import.meta.env.JARVIS_READ_ONLY === 'true',
      allowWrites: import.meta.env.JARVIS_ALLOW_WRITES !== 'false',
      blockedCapabilities: {
        mcp: import.meta.env.JARVIS_DISABLE_MCP === 'true',
        shell: import.meta.env.JARVIS_DISABLE_SHELL === 'true',
        files: import.meta.env.JARVIS_DISABLE_FILES === 'true',
        browser: import.meta.env.JARVIS_DISABLE_BROWSER === 'true'
      }
    })
  }
  return globalSecurityManager
}
