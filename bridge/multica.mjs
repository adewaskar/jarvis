/**
 * Multica issue/comment/task adapter for the local voice pilot.
 *
 * This deliberately uses the documented CLI instead of a private API. Every
 * invocation is an executable plus an argument array (`shell: false`), so a
 * transcript can never become shell syntax. The small JSON outbox is written
 * atomically and with user-only permissions; it avoids adding a database
 * dependency for a single-user pilot while still retaining C/T/R correlation
 * and playback acknowledgement across bridge restarts.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const PENDING_TASK_STATES = new Set([
  'queued',
  'dispatched',
  'running',
  'waiting_local_directory',
])
const FAILED_TASK_STATES = new Set(['failed', 'cancelled'])
const MARKER_PATTERN = /<!--\s*jarvis-turn:([0-9a-f-]+)\s*-->/gi

export class MulticaConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MulticaConfigError'
  }
}

export class MulticaInterruptedError extends Error {
  constructor(message = 'The Multica turn was interrupted.') {
    super(message)
    this.name = 'MulticaInterruptedError'
    this.code = 'INTERRUPTED'
  }
}

function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new MulticaConfigError(`${name} is required in Multica mode.`)
  return value
}

function positiveInteger(raw, fallback, name) {
  if (raw == null || String(raw).trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MulticaConfigError(`${name} must be a positive integer.`)
  }
  return value
}

export function multicaConfigFromEnv(env = process.env) {
  const stateDir = env.JARVIS_MULTICA_STATE_DIR?.trim()
  return {
    executable: env.JARVIS_MULTICA_CLI?.trim() || 'multica',
    profile: required(env, 'JARVIS_MULTICA_PROFILE'),
    issueId: required(env, 'JARVIS_MULTICA_ISSUE_ID'),
    workspaceId: required(env, 'JARVIS_MULTICA_WORKSPACE_ID'),
    agentId: required(env, 'JARVIS_MULTICA_AGENT_ID'),
    timeoutMs: positiveInteger(
      env.JARVIS_MULTICA_TIMEOUT_MS,
      180_000,
      'JARVIS_MULTICA_TIMEOUT_MS',
    ),
    pollIntervalMs: positiveInteger(
      env.JARVIS_MULTICA_POLL_INTERVAL_MS,
      1_000,
      'JARVIS_MULTICA_POLL_INTERVAL_MS',
    ),
    commandTimeoutMs: positiveInteger(
      env.JARVIS_MULTICA_COMMAND_TIMEOUT_MS,
      30_000,
      'JARVIS_MULTICA_COMMAND_TIMEOUT_MS',
    ),
    stateDir: resolve(stateDir || join(homedir(), '.jarvis', 'multica')),
  }
}

/** Run one CLI command without a shell and keep stdout/stderr separate. */
export function runCliProcess(executable, args, { timeoutMs, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs ?? 30_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `Multica executable not found: ${executable}`
            : `Could not start the Multica CLI: ${error.message}`,
        ),
      )
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error('The Multica CLI command timed out.'))
      } else if (code !== 0) {
        // Do not echo stderr: a CLI failure must not make comment or agent text
        // part of bridge logs or browser errors.
        reject(
          new Error(
            `The Multica CLI command failed (${signal ? `signal ${signal}` : `exit ${code}`}).`,
          ),
        )
      } else {
        resolvePromise({ stdout, stderr })
      }
    })
  })
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Multica returned malformed JSON for ${label}.`)
  }
}

function records(value, keys = []) {
  if (Array.isArray(value)) return value
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key]
  }
  return []
}

function idOf(value) {
  return value?.id ?? value?.comment_id ?? value?.comment?.id ?? null
}

function contentOf(value) {
  return value?.content ?? value?.body ?? value?.text ?? ''
}

function authorIdOf(value) {
  return value?.creator_id ?? value?.author_id ?? value?.agent_id ?? null
}

function taskIdOf(value) {
  return value?.id ?? value?.task_id ?? null
}

function taskStatusOf(value) {
  return String(value?.status ?? '').toLowerCase()
}

function flattenObjects(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (!Array.isArray(value) && idOf(value)) out.push(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child && typeof child === 'object') flattenObjects(child, out, seen)
  }
  return out
}

function withoutMarkers(text) {
  return String(text ?? '').replace(MARKER_PATTERN, '').trim()
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

class JsonOutbox {
  constructor(config) {
    const safeIssue = config.issueId.replace(/[^a-zA-Z0-9_-]/g, '_')
    this.directory = config.stateDir
    this.path = join(config.stateDir, `${safeIssue}.json`)
    this.issueId = config.issueId
    this.data = null
  }

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed.issueId !== this.issueId || parsed.version !== 1) {
        throw new Error('The Multica state file belongs to another issue or version.')
      }
      this.data = parsed
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.data = {
        version: 1,
        issueId: this.issueId,
        previousResponseId: null,
        turns: [],
      }
      await this.save()
    }
    return this.data
  }

  async save() {
    const temporary = join(
      this.directory,
      `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`,
    )
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, this.path)
  }

  async createBody(turnId, text, marker) {
    const path = join(this.directory, `turn-${turnId}.txt`)
    await writeFile(path, `${text.trim()}\n\n${marker}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    return path
  }

  async removeBody(path) {
    if (path) await rm(path, { force: true })
  }
}

export class MulticaAdapter {
  constructor(config, options = {}) {
    this.config = config
    this.outbox = new JsonOutbox(config)
    this.active = null
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? sleep
    this.run =
      options.run ??
      ((args) =>
        runCliProcess(config.executable, args, {
          timeoutMs: config.commandTimeoutMs,
        }))
  }

  async cli(args, label) {
    const result = await this.run(['--profile', this.config.profile, ...args])
    return parseJson(result.stdout, label)
  }

  async initialize() {
    await this.outbox.load()
    const issue = await this.cli(
      ['issue', 'get', this.config.issueId, '--output', 'json'],
      'issue validation',
    )
    if (issue?.id !== this.config.issueId) {
      throw new MulticaConfigError('The configured Multica issue was not returned by the CLI.')
    }
    if (issue.workspace_id !== this.config.workspaceId) {
      throw new MulticaConfigError(
        `The configured issue is in workspace ${issue.workspace_id ?? '(unknown)'}, not ${this.config.workspaceId}.`,
      )
    }
    if (issue.assignee_id !== this.config.agentId || issue.assignee_type !== 'agent') {
      throw new MulticaConfigError(
        'The configured pilot issue is not assigned to the configured Multica agent.',
      )
    }
    return issue
  }

  blockingTurn() {
    return this.outbox.data.turns.find((turn) =>
      ['prepared', 'submitted', 'task_seen', 'unresolved'].includes(turn.status),
    )
  }

  async update(turn, patch) {
    Object.assign(turn, patch, { updatedAt: new Date(this.now()).toISOString() })
    await this.outbox.save()
  }

  async commentsFor(turn) {
    const anchor = turn.parentResponseId
    const args = anchor
      ? [
          'issue',
          'comment',
          'list',
          this.config.issueId,
          '--thread',
          anchor,
          '--tail',
          '30',
          '--output',
          'json',
        ]
      : [
          'issue',
          'comment',
          'list',
          this.config.issueId,
          '--recent',
          '50',
          '--output',
          'json',
        ]
    return this.cli(args, 'comment list')
  }

  async reconcileSubmission(turn) {
    let comments
    try {
      comments = await this.commentsFor(turn)
    } catch {
      return null
    }
    const matches = flattenObjects(comments).filter((comment) =>
      String(contentOf(comment)).includes(turn.marker),
    )
    return matches.length === 1 ? idOf(matches[0]) : null
  }

  async submit(turn, text) {
    turn.bodyFile = await this.outbox.createBody(turn.localId, text, turn.marker)
    await this.outbox.save()
    const args = [
      'issue',
      'comment',
      'add',
      this.config.issueId,
      '--content-file',
      turn.bodyFile,
    ]
    if (turn.parentResponseId) args.push('--parent', turn.parentResponseId)
    args.push('--output', 'json')

    try {
      const comment = await this.cli(args, 'comment submission')
      const commentId = idOf(comment)
      if (!commentId) throw new Error('Multica did not return the submitted comment id.')
      await this.update(turn, { status: 'submitted', commentId })
    } catch {
      const commentId = await this.reconcileSubmission(turn)
      if (!commentId) {
        await this.update(turn, {
          status: 'unresolved',
          error:
            'It is unclear whether the Multica comment was created. The adapter will not retry it automatically.',
        })
        throw new Error(turn.error)
      }
      await this.update(turn, { status: 'submitted', commentId, reconciled: true })
    }
    await this.outbox.removeBody(turn.bodyFile)
    delete turn.bodyFile
    await this.outbox.save()
  }

  matchingTasks(value, commentId) {
    return records(value, ['runs', 'tasks']).filter(
      (task) => task?.trigger_comment_id === commentId,
    )
  }

  matchingResponses(value, taskId) {
    return flattenObjects(value).filter(
      (comment) =>
        comment?.source_task_id === taskId && authorIdOf(comment) === this.config.agentId,
    )
  }

  async cancelTask(turn) {
    if (!turn.taskId || turn.cancelSentAt) return turn.cancelConfirmed === true
    // Persist before invoking: a crash must not send a second cancellation.
    await this.update(turn, { cancelSentAt: new Date(this.now()).toISOString() })
    try {
      await this.cli(
        [
          'issue',
          'cancel-task',
          turn.taskId,
          '--issue',
          this.config.issueId,
          '--output',
          'json',
        ],
        'task cancellation',
      )
      await this.update(turn, { cancelConfirmed: true })
      return true
    } catch {
      await this.update(turn, { cancelConfirmed: false })
      return false
    }
  }

  async waitForResult(turn) {
    const deadline = this.now() + this.config.timeoutMs
    let response = null
    let completedWithoutResponse = 0

    while (this.now() < deadline) {
      const runs = await this.cli(
        ['issue', 'runs', this.config.issueId, '--output', 'json'],
        'issue runs',
      )
      const tasks = this.matchingTasks(runs, turn.commentId)
      if (tasks.length > 1) {
        throw new Error('Multica returned more than one task for this voice turn.')
      }
      if (tasks.length === 1) {
        const taskId = taskIdOf(tasks[0])
        if (!taskId) throw new Error('The matching Multica task has no id.')
        if (turn.taskId && turn.taskId !== taskId) {
          throw new Error('The Multica task id changed during the turn.')
        }
        if (!turn.taskId) {
          await this.update(turn, { status: 'task_seen', taskId })
        }

        if (turn.cancelRequestedAt) {
          const confirmed = await this.cancelTask(turn)
          await this.update(turn, {
            status: 'interrupted',
            error: confirmed
              ? null
              : 'The turn was interrupted, but server cancellation could not be confirmed.',
          })
          throw new MulticaInterruptedError(turn.error ?? undefined)
        }

        const comments = await this.cli(
          [
            'issue',
            'comment',
            'list',
            this.config.issueId,
            '--thread',
            turn.commentId,
            '--tail',
            '30',
            '--output',
            'json',
          ],
          'response comments',
        )
        const responses = this.matchingResponses(comments, taskId)
        if (responses.length > 1) {
          throw new Error('Multica returned multiple final comments for this voice turn.')
        }
        if (responses.length === 1) response = responses[0]

        const status = taskStatusOf(tasks[0])
        if (FAILED_TASK_STATES.has(status)) {
          throw new Error(`The Multica task ended with status ${status}.`)
        }
        if (!PENDING_TASK_STATES.has(status) && status !== 'completed') {
          throw new Error(`The Multica task returned unknown status ${status || '(blank)'}.`)
        }
        if (status === 'completed' && response) {
          const responseId = idOf(response)
          const text = withoutMarkers(contentOf(response))
          if (!responseId || !text) {
            throw new Error('The Multica task completed with an invalid final comment.')
          }
          await this.update(turn, { status: 'response_seen', responseId })
          this.outbox.data.previousResponseId = responseId
          await this.outbox.save()
          return { text, responseId, turnId: turn.localId }
        }
        if (status === 'completed') {
          completedWithoutResponse += 1
          if (completedWithoutResponse >= 3) {
            throw new Error(
              'The Multica task completed without exactly one matching final comment.',
            )
          }
        } else {
          completedWithoutResponse = 0
        }
      }

      await this.sleep(this.config.pollIntervalMs)
    }

    const confirmed = await this.cancelTask(turn)
    throw new Error(
      turn.taskId
        ? `The Multica turn timed out after ${this.config.timeoutMs} ms; cancellation ${confirmed ? 'was requested' : 'could not be confirmed'}.`
        : `The Multica turn timed out after ${this.config.timeoutMs} ms before its task became visible.`,
    )
  }

  async ask(text) {
    if (!this.outbox.data) throw new Error('The Multica adapter is not initialized.')
    if (this.active) throw new Error('A Multica turn is already active. Interrupt it first.')
    const blocked = this.blockingTurn()
    if (blocked) {
      throw new Error(
        `A previous Multica turn (${blocked.localId}) is still ${blocked.status}; inspect the private state file before sending another comment.`,
      )
    }
    if (!String(text).trim()) throw new Error('The voice turn is empty.')

    const localId = randomUUID()
    const turn = {
      localId,
      marker: `<!-- jarvis-turn:${localId} -->`,
      status: 'prepared',
      parentResponseId: this.outbox.data.previousResponseId,
      createdAt: new Date(this.now()).toISOString(),
      updatedAt: new Date(this.now()).toISOString(),
    }
    // Claim the in-process issue lock before the first await. Two sockets can
    // call ask() in the same tick, and persistence must not create a race gap.
    this.active = turn
    this.outbox.data.turns.push(turn)
    if (this.outbox.data.turns.length > 100) this.outbox.data.turns.splice(0, 25)

    try {
      await this.outbox.save()
      await this.submit(turn, text)
      return await this.waitForResult(turn)
    } catch (error) {
      if (!['unresolved', 'interrupted'].includes(turn.status)) {
        await this.update(turn, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    } finally {
      if (this.active === turn) this.active = null
    }
  }

  async interrupt() {
    const turn = this.active
    if (!turn || turn.cancelRequestedAt) return false
    await this.update(turn, {
      cancelRequestedAt: new Date(this.now()).toISOString(),
    })
    // The polling loop owns the cancellation call. Keeping one owner avoids a
    // race where interrupt() and the just-finished runs poll both send it.
    return true
  }

  async markSpoken(responseId) {
    if (!responseId) return false
    const turn = this.outbox.data?.turns.find(
      (candidate) => candidate.responseId === responseId,
    )
    if (!turn || turn.status === 'spoken') return false
    if (turn.status !== 'response_seen') return false
    await this.update(turn, {
      status: 'spoken',
      spokenAt: new Date(this.now()).toISOString(),
    })
    return true
  }
}

export function createMulticaAdapterFromEnv(env = process.env, options = {}) {
  return new MulticaAdapter(multicaConfigFromEnv(env), options)
}

/** Bind the adapter to the subset of the Jarvis WebSocket protocol it needs. */
export function attachMulticaSocket(socket, adapter, logger = console) {
  const send = (message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }
  send({ type: 'ready', servers: ['Multica agent'], backend: 'multica' })
  let activeAsk = null

  socket.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (message.type === 'ask' && typeof message.text === 'string') {
      const askId = typeof message.id === 'string' ? message.id : null
      if (activeAsk !== null) {
        send({
          type: 'error',
          ask: askId,
          message: 'A Multica turn is already active. Interrupt it first.',
        })
        return
      }
      activeAsk = askId
      void adapter
        .ask(message.text)
        .then(({ text, responseId }) => {
          if (activeAsk !== askId) return
          // Multica comments are final responses rather than token streams.
          // Emit exactly one text frame and one terminal frame.
          send({ type: 'text', ask: askId, delta: text })
          send({ type: 'done', ask: askId, text, responseId })
        })
        .catch((error) => {
          if (error instanceof MulticaInterruptedError) return
          if (activeAsk === askId) {
            send({
              type: 'error',
              ask: askId,
              message: error?.message ?? 'The Multica turn failed.',
            })
          }
        })
        .finally(() => {
          if (activeAsk === askId) activeAsk = null
        })
      return
    }

    if (message.type === 'interrupt') {
      void adapter.interrupt()
      return
    }

    if (message.type === 'played' && typeof message.responseId === 'string') {
      void adapter.markSpoken(message.responseId)
    }
  })

  socket.on('close', () => {
    logger.log('[jarvis] client disconnected')
    if (activeAsk !== null) void adapter.interrupt()
  })
}
