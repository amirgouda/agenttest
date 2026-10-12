/**
 * The testing agent's backend: personas, scenarios and runs over a small JSON API for the web app,
 * and the runner that plays them against Ordoor's WhatsApp simulator API.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'

import { config } from './config.js'
import { llmConfigured, llmDescription } from './llm/index.js'
import { ordoor } from './ordoor-client.js'
import { enqueueRun, recoverRunsAfterRestart, stopRun } from './runner.js'
import { db } from './db.js'
import {
  ValidationError,
  deletePersona,
  deleteRun,
  deleteScenario,
  getRun,
  initStore,
  listPersonas,
  listRunSummaries,
  listScenarios,
  newId,
  savePersona,
  saveScenario,
} from './store.js'

const PersonaBody = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^\+?\d{8,15}$/, 'phone: international digits, e.g. 201000000101'),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().trim().max(300).optional(),
    label: z.string().trim().max(60).optional(),
  }),
  character: z.string().trim().min(1).max(2000),
  language: z.string().trim().min(1).max(60),
  traits: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  sendsVoiceNotes: z.boolean().default(false),
})

const ScenarioBody = z.object({
  personaId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  intent: z.string().trim().min(1).max(2000),
  expectedItems: z
    .array(z.object({ description: z.string().trim().min(1).max(200), quantity: z.number().positive().optional(), unit: z.string().trim().max(30).optional() }))
    .max(30)
    .default([]),
  expectedOutcome: z.enum(['order_confirmed', 'order_placed', 'no_order', 'any']),
  storeBehaviour: z.string().trim().max(1000).default(''),
  maxTurns: z.number().int().min(1).max(60).default(14),
  resetBeforeRun: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional(),
})

const RunBody = z.union([
  z.object({ scenarioIds: z.array(z.string().min(1)).min(1).max(200) }),
  z.object({ personaId: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
])

const app = express()
app.use(express.json({ limit: '1mb' }))

type Handler = (req: Request, res: Response) => unknown
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next)
const id = (req: Request) => String(req.params.id)

// ── Health ───────────────────────────────────────────────────────────────────────────────────────

app.get(
  '/api/health',
  route(async (_req, res) => {
    let ordoorStatus: { ok: boolean; error?: string } = { ok: true }
    try {
      // Any number answers 200 with an empty state — this proves the URL, the switch and the token.
      await ordoor.customer('200')
    } catch (err) {
      ordoorStatus = { ok: false, error: (err as Error).message }
    }
    res.json({
      ordoor: { baseUrl: config.ordoor.baseUrl, tokenSet: Boolean(config.ordoor.token), ...ordoorStatus },
      llm: { model: llmDescription(), configured: llmConfigured() },
      runConcurrency: config.runConcurrency,
    })
  }),
)

// ── Personas & scenarios ─────────────────────────────────────────────────────────────────────────

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' })

app.get('/api/personas', route(async (_req, res) => res.json(await listPersonas())))
app.post('/api/personas', route(async (req, res) => res.status(201).json(await savePersona(PersonaBody.parse(req.body)))))
app.put('/api/personas/:id', route(async (req, res) => res.json(await savePersona({ ...PersonaBody.parse(req.body), id: id(req) }))))
app.delete('/api/personas/:id', route(async (req, res) => ((await deletePersona(id(req))) ? res.status(204).end() : notFound(res))))

app.get(
  '/api/scenarios',
  route(async (req, res) => res.json(await listScenarios(typeof req.query.personaId === 'string' ? req.query.personaId : undefined))),
)
app.post('/api/scenarios', route(async (req, res) => res.status(201).json(await saveScenario(ScenarioBody.parse(req.body)))))
app.put('/api/scenarios/:id', route(async (req, res) => res.json(await saveScenario({ ...ScenarioBody.parse(req.body), id: id(req) }))))
app.delete('/api/scenarios/:id', route(async (req, res) => ((await deleteScenario(id(req))) ? res.status(204).end() : notFound(res))))

// ── Runs ─────────────────────────────────────────────────────────────────────────────────────────

app.get('/api/runs', route(async (_req, res) => res.json(await listRunSummaries())))
app.get('/api/runs/:id', route(async (req, res) => {
  const run = await getRun(id(req))
  return run ? res.json(run) : notFound(res)
}))
app.post(
  '/api/runs',
  route(async (req, res) => {
    const body = RunBody.parse(req.body)
    const scenarioIds =
      'scenarioIds' in body ? body.scenarioIds : (await listScenarios('personaId' in body ? body.personaId : undefined)).map((s) => s.id)
    if (!scenarioIds.length) throw new ValidationError('No scenarios to run.')
    const batchId = scenarioIds.length > 1 ? newId('batch') : undefined
    const runs = []
    for (const sid of scenarioIds) runs.push(await enqueueRun(sid, batchId))
    res.status(201).json(runs)
  }),
)
app.post('/api/runs/:id/stop', route(async (req, res) => ((await stopRun(id(req))) ? res.json({ ok: true }) : res.status(409).json({ error: 'The run is not in progress.' }))))
app.post(
  '/api/runs/:id/rerun',
  route(async (req, res) => {
    const run = await getRun(id(req))
    if (!run) return notFound(res)
    res.status(201).json(await enqueueRun(run.scenarioId))
  }),
)
app.delete('/api/runs/:id', route(async (req, res) => ((await deleteRun(id(req))) ? res.status(204).end() : notFound(res))))

// ── The built web app (production) ───────────────────────────────────────────────────────────────

const dist = join(config.root, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message })
  console.error(err)
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' })
})

async function start(): Promise<void> {
  const store = await initStore()
  const server = app.listen(config.port, () => {
    console.log(`agent-test server on http://localhost:${config.port}`)
    console.log(`  Database: ${redact(config.databaseUrl)}${store.migrations.length ? ` (migrated: ${store.migrations.join(', ')})` : ''}`)
    console.log(`  Ordoor:   ${config.ordoor.baseUrl} (token ${config.ordoor.token ? 'set' : 'MISSING'})`)
    console.log(`  Model:    ${llmDescription()}${llmConfigured() ? '' : ' (API key MISSING)'}`)
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is in use — is agent-test already running? (AGENT_TEST_PORT changes it)` : err.message)
    process.exit(1)
  })
  await recoverRunsAfterRestart()
}

/** The URL without its password. */
const redact = (url: string) => url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@')

start().catch((err: Error) => {
  console.error(`agent-test could not start: ${err.message}`)
  void db().close().catch(() => undefined)
  process.exit(1)
})
