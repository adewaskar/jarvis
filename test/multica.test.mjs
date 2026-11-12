import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MulticaAdapter,
  MulticaConfigError,
  MulticaInterruptedError,
  attachMulticaSocket,
  multicaConfigFromEnv,
  runCliProcess,
} from '../bridge/multica.mjs'

const WORKSPACE = 'workspace-1'
const AGENT = 'agent-1'
const ISSUE = 'issue-1'
const temporary = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })))
})

class FakeCli {
  constructor(turns = []) {
    this.turns = turns
    this.submissions = []
    this.runCalls = new Map()
    this.cancelCalls = []
    this.createdComments = []
    this.issue = {
      id: ISSUE,
      workspace_id: WORKSPACE,
      assignee_id: AGENT,
      assignee_type: 'agent',
    }
  }

  json(value) {
    return { stdout: JSON.stringify(value), stderr: '' }
  }

  async run(args) {
    assert.deepEqual(args.slice(0, 2), ['--profile', 'pilot'])
    const command = args.slice(2)
    if (command[0] === 'issue' && command[1] === 'get') return this.json(this.issue)

    if (command[0] === 'issue' && command[1] === 'comment' && command[2] === 'add') {
      const turn = this.turns[this.submissions.length]
      const bodyPath = command[command.indexOf('--content-file') + 1]
      const body = await readFile(bodyPath, 'utf8')
      const marker = /<!-- jarvis-turn:[0-9a-f-]+ -->/.exec(body)?.[0]
      const parentIndex = command.indexOf('--parent')
      const submission = {
        id: turn.commentId,
        body,
        marker,
        parent: parentIndex === -1 ? null : command[parentIndex + 1],
      }
      this.submissions.push(submission)
      if (turn.ambiguousExisting) {
        this.createdComments.push({ id: turn.commentId, content: `${body}` })
        throw new Error('ambiguous transport failure')
      }
      if (turn.ambiguousMissing) throw new Error('ambiguous transport failure')
      if (turn.malformedSubmission) return { stdout: '{', stderr: '' }
      this.createdComments.push({ id: turn.commentId, content: `${body}` })
      return this.json({ id: turn.commentId })
    }

    if (command[0] === 'issue' && command[1] === 'runs') {
      const turn = this.turns[Math.max(0, this.submissions.length - 1)]
      const count = this.runCalls.get(turn.commentId) ?? 0
      this.runCalls.set(turn.commentId, count + 1)
      if (turn.malformedRuns) return { stdout: 'not-json', stderr: '' }
      const status = turn.statuses[Math.min(count, turn.statuses.length - 1)]
      if (status == null) return this.json([])
      return this.json([
        {
          id: turn.taskId,
          trigger_comment_id: turn.commentId,
          status,
        },
        ...(turn.otherTask
          ? [{ id: 'other-task', trigger_comment_id: 'other-comment', status: 'completed' }]
          : []),
      ])
    }

    if (command[0] === 'issue' && command[1] === 'comment' && command[2] === 'list') {
      const threadIndex = command.indexOf('--thread')
      const thread = threadIndex === -1 ? null : command[threadIndex + 1]
      const active = this.turns[Math.max(0, this.submissions.length - 1)]
      if (!thread || thread !== active.commentId) return this.json(this.createdComments)
      const runCount = this.runCalls.get(active.commentId) ?? 0
      const comments = [
        { id: active.commentId, content: this.submissions.at(-1)?.body ?? '' },
        ...(active.otherResponse
          ? [
              {
                id: 'stale-response',
                content: 'stale',
                creator_id: AGENT,
                source_task_id: 'other-task',
              },
            ]
          : []),
      ]
      if (runCount >= (active.responseAt ?? active.statuses.length)) {
        comments.push({
          id: active.responseId,
          content: active.responseText ?? `answer for ${active.commentId}`,
          creator_id: AGENT,
          creator_type: 'agent',
          source_task_id: active.taskId,
        })
        if (active.multipleResponses) {
          comments.push({
            id: `${active.responseId}-duplicate`,
            content: 'duplicate',
            creator_id: AGENT,
            creator_type: 'agent',
            source_task_id: active.taskId,
          })
        }
      }
      return this.json(comments)
    }

    if (command[0] === 'issue' && command[1] === 'cancel-task') {
      this.cancelCalls.push(command[2])
      if (this.turns.at(-1)?.cancelFails) throw new Error('cancel failed')
      return this.json({ id: command[2], status: 'cancelled' })
    }

    throw new Error(`unexpected fake CLI command: ${command.join(' ')}`)
  }
}

async function harness(turns, overrides = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'jarvis-multica-test-'))
  temporary.push(stateDir)
  const fake = overrides.fake ?? new FakeCli(turns)
  let now = 1_000
  const adapter = new MulticaAdapter(
    {
      executable: '/fake/multica',
      profile: 'pilot',
      issueId: ISSUE,
      workspaceId: WORKSPACE,
      agentId: AGENT,
      timeoutMs: overrides.timeoutMs ?? 30,
      pollIntervalMs: 1,
      commandTimeoutMs: 100,
      stateDir,
    },
    {
      run: (args) => fake.run(args),
      now: () => now,
      sleep:
        overrides.sleep ??
        (async () => {
          now += 1
        }),
    },
  )
  await adapter.initialize()
  return { adapter, fake, stateDir, advance: () => (now += 1) }
}

const successful = (suffix, extra = {}) => ({
  commentId: `C${suffix}`,
  taskId: `T${suffix}`,
  responseId: `R${suffix}`,
  statuses: ['queued', 'running', 'completed'],
  responseAt: 2,
  ...extra,
})

test('missing Multica installation parameters are rejected clearly', () => {
  assert.throws(() => multicaConfigFromEnv({}), /JARVIS_MULTICA_PROFILE is required/)
})

test('CLI arguments are passed literally without a shell', async () => {
  const transcript = 'hello; $(touch should-not-run) `whoami`'
  const result = await runCliProcess(
    process.execPath,
    ['-e', 'process.stdout.write(process.argv[1])', transcript],
    { timeoutMs: 1_000 },
  )
  assert.equal(result.stdout, transcript)
})

test('correlates C→T→R and ignores tasks and comments from other turns', async () => {
  const { adapter, fake } = await harness([
    successful('1', { otherTask: true, otherResponse: true }),
  ])
  const result = await adapter.ask('hello')
  assert.deepEqual(result, {
    text: 'answer for C1',
    responseId: 'R1',
    turnId: result.turnId,
  })
  assert.equal(fake.submissions.length, 1)
  assert.match(fake.submissions[0].body, /<!-- jarvis-turn:/)
})

test('socket mapping emits exactly one text and one done for a final response', async () => {
  class FakeSocket extends EventEmitter {
    OPEN = 1
    readyState = 1
    sent = []
    send(raw) {
      this.sent.push(JSON.parse(raw))
    }
  }
  const socket = new FakeSocket()
  const played = []
  const adapter = {
    ask: async () => ({ text: 'final answer', responseId: 'R1' }),
    interrupt: async () => true,
    markSpoken: async (id) => played.push(id),
  }
  attachMulticaSocket(socket, adapter, { log() {} })
  socket.emit('message', JSON.stringify({ type: 'ask', id: 'a1', text: 'hello' }))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(socket.sent.filter((frame) => frame.type === 'text').length, 1)
  assert.equal(socket.sent.filter((frame) => frame.type === 'done').length, 1)
  assert.deepEqual(socket.sent.at(-2), {
    type: 'text',
    ask: 'a1',
    delta: 'final answer',
  })
  assert.deepEqual(socket.sent.at(-1), {
    type: 'done',
    ask: 'a1',
    text: 'final answer',
    responseId: 'R1',
  })

  socket.emit('message', JSON.stringify({ type: 'played', responseId: 'R1' }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(played, ['R1'])
})

test('two sequential turns share the issue and turn two is parented to R1', async () => {
  const { adapter, fake } = await harness([successful('1'), successful('2')])
  const first = await adapter.ask('first')
  const second = await adapter.ask('second')
  assert.equal(fake.submissions[0].parent, null)
  assert.equal(fake.submissions[1].parent, 'R1')
  assert.notEqual(first.turnId, second.turnId)
  assert.deepEqual(
    [first.responseId, second.responseId],
    ['R1', 'R2'],
  )
})

test('a second turn is rejected while the issue lock is active', async () => {
  const { adapter, fake } = await harness([successful('1')])
  const first = adapter.ask('first')
  await assert.rejects(adapter.ask('overlap'), /already active/)
  assert.equal((await first).responseId, 'R1')
  assert.equal(fake.submissions.length, 1)
})

test('response may arrive before completed and delayed task visibility is tolerated', async () => {
  const turn = successful('1', {
    statuses: [null, null, 'running', 'completed'],
    responseAt: 3,
  })
  const { adapter, fake } = await harness([turn])
  assert.equal((await adapter.ask('wait')).responseId, 'R1')
  assert.equal(fake.runCalls.get('C1'), 4)
})

for (const [name, turn, pattern] of [
  ['failed task', successful('1', { statuses: ['failed'] }), /status failed/],
  ['cancelled task', successful('1', { statuses: ['cancelled'] }), /status cancelled/],
  [
    'multiple final comments',
    successful('1', { statuses: ['completed'], responseAt: 1, multipleResponses: true }),
    /multiple final comments/,
  ],
  ['malformed CLI JSON', successful('1', { malformedRuns: true }), /malformed JSON/],
]) {
  test(`${name} fails without returning stale speech`, async () => {
    const { adapter } = await harness([turn])
    await assert.rejects(adapter.ask('hello'), pattern)
  })
}

test('completed without a final response fails after bounded polling', async () => {
  const { adapter } = await harness([
    successful('1', { statuses: ['completed'], responseAt: 1_000 }),
  ], { timeoutMs: 5 })
  await assert.rejects(adapter.ask('hello'), /completed without exactly one/)
})

test('timeout cancels the current task once and returns no answer', async () => {
  const { adapter, fake } = await harness([
    successful('1', { statuses: ['running'], responseAt: 1_000 }),
  ], { timeoutMs: 4 })
  await assert.rejects(adapter.ask('hello'), /timed out/)
  assert.deepEqual(fake.cancelCalls, ['T1'])
})

test('startup rejects a mismatched workspace or agent', async () => {
  for (const mismatch of [
    { workspace_id: 'wrong' },
    { assignee_id: 'wrong' },
    { assignee_type: 'user' },
  ]) {
    const fake = new FakeCli([])
    Object.assign(fake.issue, mismatch)
    const stateDir = await mkdtemp(join(tmpdir(), 'jarvis-multica-test-'))
    temporary.push(stateDir)
    const adapter = new MulticaAdapter(
      {
        executable: '/fake/multica',
        profile: 'pilot',
        issueId: ISSUE,
        workspaceId: WORKSPACE,
        agentId: AGENT,
        timeoutMs: 10,
        pollIntervalMs: 1,
        commandTimeoutMs: 10,
        stateDir,
      },
      { run: (args) => fake.run(args) },
    )
    await assert.rejects(adapter.initialize(), MulticaConfigError)
  }
})

test('an ambiguous send with an existing marker is reconciled without retry', async () => {
  const { adapter, fake } = await harness([
    successful('1', { ambiguousExisting: true }),
  ])
  assert.equal((await adapter.ask('hello')).responseId, 'R1')
  assert.equal(fake.submissions.length, 1)
})

test('an unresolved ambiguous send is not retried blindly', async () => {
  const { adapter, fake } = await harness([
    successful('1', { ambiguousMissing: true }),
  ])
  await assert.rejects(adapter.ask('hello'), /will not retry/)
  await assert.rejects(adapter.ask('again'), /previous Multica turn/)
  assert.equal(fake.submissions.length, 1)
})

test('played responses are persisted and never replayed on restart', async () => {
  const fake = new FakeCli([successful('1')])
  const { adapter, stateDir } = await harness([successful('1')], { fake })
  const result = await adapter.ask('hello')
  assert.equal(await adapter.markSpoken(result.responseId), true)
  assert.equal(await adapter.markSpoken(result.responseId), false)

  const restarted = new MulticaAdapter(
    {
      ...adapter.config,
      stateDir,
    },
    { run: (args) => fake.run(args) },
  )
  await restarted.initialize()
  const state = JSON.parse(await readFile(join(stateDir, `${ISSUE}.json`), 'utf8'))
  assert.equal(state.turns[0].status, 'spoken')
  assert.equal(fake.submissions.length, 1)
})

test('interrupt before task visibility cancels only that task and suppresses its answer', async () => {
  let now = 1_000
  const fake = new FakeCli([
    successful('1', {
      statuses: [null, 'running', 'completed'],
      responseAt: 3,
    }),
  ])
  const stateDir = await mkdtemp(join(tmpdir(), 'jarvis-multica-test-'))
  temporary.push(stateDir)
  const adapter = new MulticaAdapter(
    {
      executable: '/fake/multica',
      profile: 'pilot',
      issueId: ISSUE,
      workspaceId: WORKSPACE,
      agentId: AGENT,
      timeoutMs: 100,
      pollIntervalMs: 1,
      commandTimeoutMs: 100,
      stateDir,
    },
    {
      run: (args) => fake.run(args),
      now: () => now,
      sleep: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            now += 1
            resolve()
          }, 2)
        }),
    },
  )
  await adapter.initialize()
  const asking = assert.rejects(adapter.ask('stop this'), MulticaInterruptedError)
  while ((fake.runCalls.get('C1') ?? 0) < 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(await adapter.interrupt(), true)
  await asking
  assert.deepEqual(fake.cancelCalls, ['T1'])
})
