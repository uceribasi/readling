#!/usr/bin/env node
/**
 * readling bridge: lets the readling web app use coding-agent CLIs installed on
 * this computer (Claude Code, Codex, Antigravity) to explain words.
 *
 * Security model
 * - Listens on 127.0.0.1 only and rejects unexpected Host headers (DNS rebinding).
 * - Every request needs a pairing token, shown at startup and pasted into readling.
 * - Browser requests must come from an allowed Origin (READLING_ORIGINS).
 * - Agents run in an empty temporary folder with tools disabled or sandboxed,
 *   prompts are passed without a shell, and runs are time- and size-limited.
 *
 * Run with: npm run bridge   (Node 22.18+ runs this TypeScript file directly)
 */
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const VERSION = '0.1.0'
const HOST = '127.0.0.1'
const PORT = Number(process.env.READLING_BRIDGE_PORT ?? 8787)
const RUN_TIMEOUT_MS = Number(process.env.READLING_BRIDGE_TIMEOUT_MS ?? 120_000)
const MAX_BODY_BYTES = 64 * 1024
const MAX_FIELD_CHARS = 16_000
const MAX_CONCURRENT_RUNS = 2

const ALLOWED_ORIGINS = new Set(
  [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    ...(process.env.READLING_ORIGINS ?? '').split(','),
  ]
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

type AgentId = 'claude-code' | 'codex' | 'antigravity'

interface AgentRun {
  args: string[]
  stdin?: string
  env?: NodeJS.ProcessEnv
  /** Turns the finished process output into the model's text, or throws. */
  read: (stdout: string, workdir: string) => Promise<string>
}

interface AgentSpec {
  label: string
  binary: string
  binaryEnv: string
  build: (input: { system: string; prompt: string; model?: string; workdir: string }) => Promise<AgentRun>
}

class BridgeError extends Error {
  status: number
  code: string
  /** The CLI printed nothing usable, so its stderr is the better explanation. */
  unreadable: boolean

  constructor(status: number, code: string, message: string, unreadable = false) {
    super(message)
    this.status = status
    this.code = code
    this.unreadable = unreadable
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new BridgeError(502, 'agent-failed', `Unexpected output: ${text.trim().slice(0, 300)}`, true)
  }
}

const AGENTS: Record<AgentId, AgentSpec> = {
  'claude-code': {
    label: 'Claude Code',
    binary: 'claude',
    binaryEnv: 'READLING_CLAUDE_BIN',
    async build({ system, prompt, model, workdir }) {
      const systemFile = join(workdir, 'system-prompt.txt')
      await writeFile(systemFile, system)
      return {
        // Print mode with every tool, MCP server, hook, slash command and saved session turned off.
        args: [
          '-p',
          '--output-format', 'json',
          '--system-prompt-file', systemFile,
          '--tools', '',
          '--strict-mcp-config',
          '--disable-slash-commands',
          '--no-session-persistence',
          '--permission-mode', 'dontAsk',
          '--settings', JSON.stringify({ disableAllHooks: true }),
          ...(model ? ['--model', model] : []),
        ],
        stdin: prompt,
        env: { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
        async read(stdout) {
          const result = parseJson(stdout) as { subtype?: string; is_error?: boolean; result?: unknown; errors?: string[] }
          if (result.is_error !== false || result.subtype !== 'success' || typeof result.result !== 'string') {
            const detail = result.errors?.join('; ') || (typeof result.result === 'string' ? result.result : result.subtype)
            throw new BridgeError(502, 'agent-failed', detail ?? 'Claude Code failed')
          }
          return result.result
        },
      }
    },
  },
  codex: {
    label: 'Codex',
    binary: 'codex',
    binaryEnv: 'READLING_CODEX_BIN',
    async build({ system, prompt, model, workdir }) {
      const outputFile = join(workdir, 'last-message.txt')
      return {
        // Read-only sandbox, no user config (so no MCP servers), nothing saved; prompt comes from stdin.
        args: [
          'exec',
          '--skip-git-repo-check',
          '--sandbox', 'read-only',
          '--ephemeral',
          '--ignore-user-config',
          '--output-last-message', outputFile,
          ...(model ? ['--model', model] : []),
          '-',
        ],
        stdin: `${system}\n\n${prompt}`,
        async read(stdout) {
          const text = await readFile(outputFile, 'utf8').catch(() => stdout)
          if (!text.trim()) throw new BridgeError(502, 'agent-failed', 'Codex returned an empty answer', true)
          return text
        },
      }
    },
  },
  antigravity: {
    label: 'Antigravity',
    binary: 'agy',
    binaryEnv: 'READLING_AGY_BIN',
    async build({ system, prompt, model }) {
      return {
        // Headless print mode inside an empty workspace with the terminal sandbox on.
        args: [
          '-p', `${system}\n\n${prompt}`,
          '--output-format', 'json',
          '--sandbox',
          ...(model ? ['--model', model] : []),
        ],
        async read(stdout) {
          const result = parseJson(stdout) as { status?: string; response?: unknown; error?: unknown }
          if (result.status !== 'SUCCESS' || typeof result.response !== 'string') {
            const detail = typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? result.status)
            throw new BridgeError(502, 'agent-failed', detail)
          }
          return result.response
        },
      }
    },
  },
}

/** Finds an executable on PATH plus the usual per-user install folders. */
async function findBinary(spec: AgentSpec): Promise<string | undefined> {
  const home = homedir()
  const override = process.env[spec.binaryEnv]
  const candidates = override
    ? [override]
    : [
        ...(process.env.PATH ?? '').split(delimiter),
        join(home, '.local', 'bin'),
        join(home, '.claude', 'local'),
        join(home, '.npm-global', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
      ]
        .filter(Boolean)
        .map((dir) => join(dir, spec.binary))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here; keep looking.
    }
  }
  return undefined
}

let runningCount = 0

async function runAgent(
  agent: AgentId,
  input: { system: string; prompt: string; model?: string },
  signal: AbortSignal,
): Promise<string> {
  const spec = AGENTS[agent]
  const binary = await findBinary(spec)
  if (!binary) throw new BridgeError(404, 'agent-missing', `${spec.label} CLI (${spec.binary}) was not found on this computer`)
  if (runningCount >= MAX_CONCURRENT_RUNS) throw new BridgeError(429, 'busy', 'Too many requests at once')

  runningCount++
  const workdir = await mkdtemp(join(tmpdir(), 'readling-bridge-'))
  try {
    const run = await spec.build({ ...input, workdir })
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        // Its own process group, so a stuck CLI and anything it started can be killed together.
        const child = spawn(binary, run.args, {
          cwd: workdir,
          env: run.env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
        let stopReason: 'timeout' | 'canceled' | undefined
        // SIGKILL can't be caught or ignored, so the slot is always freed.
        const stop = (reason: 'timeout' | 'canceled') => {
          stopReason ??= reason
          try {
            if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
            else child.kill('SIGKILL')
          } catch {
            // Already gone.
          }
        }
        const timer = setTimeout(() => stop('timeout'), RUN_TIMEOUT_MS)
        const onAbort = () => stop('canceled')
        signal.addEventListener('abort', onAbort)
        if (signal.aborted) onAbort()

        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => (out += chunk))
        child.stderr.on('data', (chunk) => (err += chunk))
        child.on('error', (error) => reject(new BridgeError(502, 'agent-failed', error.message)))
        child.on('close', (exitCode) => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          if (stopReason === 'timeout') reject(new BridgeError(504, 'timeout', `${spec.label} took too long`))
          else if (stopReason === 'canceled') reject(new BridgeError(499, 'canceled', 'Request canceled'))
          else resolve({ code: exitCode, stdout: out, stderr: err })
        })
        child.stdin.on('error', () => {})
        child.stdin.end(run.stdin ?? '')
      },
    )
    try {
      return await run.read(stdout, workdir)
    } catch (error) {
      // When the output can't be read, the CLI's stderr (e.g. "not logged in") says why.
      if (error instanceof BridgeError && error.unreadable && code !== 0 && stderr.trim())
        throw new BridgeError(502, 'agent-failed', stderr.trim().slice(-500))
      throw error
    }
  } finally {
    runningCount--
    await rm(workdir, { recursive: true, force: true })
  }
}

async function loadToken(): Promise<string> {
  if (process.env.READLING_BRIDGE_TOKEN) return process.env.READLING_BRIDGE_TOKEN
  const dir = join(homedir(), '.config', 'readling')
  const file = join(dir, 'bridge-token')
  try {
    const saved = (await readFile(file, 'utf8')).trim()
    if (saved) return saved
  } catch {
    // First run: create a token below.
  }
  const token = randomBytes(18).toString('base64url')
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return token
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '')
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new BridgeError(415, 'bad-request', 'Expected application/json')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new BridgeError(413, 'bad-request', 'Request too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BridgeError(400, 'bad-request', 'Invalid JSON')
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const token = await loadToken()

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) throw new BridgeError(403, 'forbidden', 'Unexpected Host header')
    if (origin) {
      if (!ALLOWED_ORIGINS.has(origin)) throw new BridgeError(403, 'forbidden', `Origin ${origin} is not allowed`)
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      })
      return res.end()
    }

    if (!tokenMatches(req.headers.authorization, token)) throw new BridgeError(401, 'bridge-auth', 'Wrong pairing token')

    if (req.method === 'GET' && req.url === '/health') {
      const agents = Object.fromEntries(
        await Promise.all(
          (Object.keys(AGENTS) as AgentId[]).map(async (id) => [id, { available: Boolean(await findBinary(AGENTS[id])) }]),
        ),
      )
      return send(res, 200, { ok: true, version: VERSION, agents })
    }

    if (req.method === 'POST' && req.url === '/v1/explain') {
      const body = (await readBody(req)) as Record<string, unknown>
      const agent = body.agent as AgentId
      const { system, prompt, model } = body
      if (!(agent in AGENTS)) throw new BridgeError(400, 'bad-request', 'Unknown agent')
      if (typeof system !== 'string' || typeof prompt !== 'string') throw new BridgeError(400, 'bad-request', 'Missing prompt')
      if (system.length > MAX_FIELD_CHARS || prompt.length > MAX_FIELD_CHARS)
        throw new BridgeError(413, 'bad-request', 'Prompt too long')
      if (model !== undefined && (typeof model !== 'string' || !/^[\w.:[\]/-]{0,100}$/.test(model)))
        throw new BridgeError(400, 'bad-request', 'Invalid model name')

      // Stop the CLI if readling gives up on the request (e.g. the user clicked another word).
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      const started = Date.now()
      const text = await runAgent(agent, { system, prompt, model: model || undefined }, controller.signal)
      console.log(`  ${AGENTS[agent].label}: answered in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      return send(res, 200, { text })
    }

    throw new BridgeError(404, 'not-found', 'Not found')
  } catch (error) {
    const bridgeError =
      error instanceof BridgeError ? error : new BridgeError(500, 'internal', error instanceof Error ? error.message : String(error))
    if (bridgeError.status >= 500 || bridgeError.code === 'agent-missing') console.warn(`  ${bridgeError.code}: ${bridgeError.message}`)
    send(res, bridgeError.status, { error: { code: bridgeError.code, message: bridgeError.message } })
  }
})

server.listen(PORT, HOST, async () => {
  const found = await Promise.all(
    (Object.keys(AGENTS) as AgentId[]).map(async (id) => `${AGENTS[id].label}: ${(await findBinary(AGENTS[id])) ?? 'not found'}`),
  )
  console.log(`readling bridge ${VERSION} listening on http://${HOST}:${PORT}`)
  console.log(`\n  Pairing token: ${token}\n  Paste it into readling → Settings.\n`)
  for (const line of found) console.log(`  ${line}`)
  console.log(`\n  Allowed origins: ${[...ALLOWED_ORIGINS].join(', ')}`)
  console.log('  Add your own with READLING_ORIGINS=https://your-site.example\n')
})
