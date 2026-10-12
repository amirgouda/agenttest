# Ordoor Agent Test

An AI testing agent that plays **Ordoor customers on WhatsApp**: different **personas** (each with
their own number, location and character), each with different **scenarios** (an intent such as
"buy two litres of full-fat milk"). It talks to Ordoor the way a customer's phone would, plays the
store's side when the order reaches it, and grades the result.

It is a **separate application** with its own code. It reaches Ordoor only over HTTP, through
Ordoor's WhatsApp simulator API. No real WhatsApp number is used and nothing is sent to WhatsApp.

```
┌──────────── agent-test ────────────┐         ┌───────────────── Ordoor (code/) ──────────────────┐
│ web (React)  ⇄  server (Express)   │  HTTP   │ /api/simulator/whatsapp/*                         │
│   personas · scenarios · runs      │ ──────▶ │   messages   → simulatePlatformMessage → runTurn  │
│   customer agent · store agent ·   │ Bearer  │   customers  → basket, order, settlement, reset   │
│   judge  (Gemini or Claude)        │  token  │   orders/:id/store → rehearseAsStore              │
└───────────────┬────────────────────┘         │ every conversation isTest → replies SUPPRESSED,   │
                │                              │ returned in the HTTP response instead             │
     PostgreSQL ▼ ordoor_agent_test            └───────────────────────────────────────────────────┘
     (its own database and role — never Ordoor's)
```

## Setup

1. **Turn the simulator on in Ordoor.** Add a long random token to `code/.env.local`:
   ```
   WHATSAPP_SIMULATOR_TOKEN=<openssl rand -hex 24>
   ```
   Without it every simulator route answers 404. In production it also needs
   `WHATSAPP_SIMULATOR_ALLOW_PRODUCTION=1`.
2. **Create this app's database** — its own database and role, separate from Ordoor's:
   ```sql
   CREATE ROLE agent_test LOGIN PASSWORD '<openssl rand -hex 20>';
   CREATE DATABASE ordoor_agent_test OWNER agent_test;
   ```
   On start the migrations in `server/migrations/` create the tables **and the data**: the personas,
   their scenarios and the recorded runs (`npm run db:migrate` does the same without starting the app).
3. **Configure this app:** `cp .env.example .env`, then set `DATABASE_URL`, set `ORDOOR_SIMULATOR_TOKEN`
   to the same token as Ordoor, and set a model key (`GEMINI_API_KEY`, or `LLM_PROVIDER=anthropic` +
   `ANTHROPIC_API_KEY`).
4. Install and run it:
   ```bash
   npm install
   npm run dev          # API on :4100, web on http://localhost:5173
   ```
   For production, run `npm run build && npm start`; the server then serves the built web app on `:4100`.

The header shows whether Ordoor is reachable and which model is in use.

## How a run works

1. **Reset** (optional, per scenario): the persona's unfinished rehearsal is closed so the run starts
   a new order attempt. What Ordoor remembers about the persona (name, places, memory cards) is kept,
   so a persona behaves as a returning customer from its second run onward.
2. **Customer agent.** On each turn the model reads the conversation, including every button and list
   row with its hidden id, and sends one message: `text`, `tap` (by option id), `location` (the
   persona's pin), `wait`, or `done`. A persona with *voice notes* on sends its text as a transcribed
   voice note.
3. **Ordoor replies** in the same HTTP response. The runner then keeps polling until Ordoor has been
   quiet for 2.5 s, so it also catches follow-up messages.
4. **Store agent.** Once the customer confirms, the order goes to the store side. If the scenario has
   a *store behaviour* (for example "confirm as is" or "say the Nestlé water is out of stock"), the agent
   answers the store's messages until the order no longer waits on the store.
5. **The run ends** when the order is settled or cancelled, the conversation is closed, the customer
   says it is done, or the turn limit is reached.
6. **Judging.** The **outcome** (order confirmed, placed, or none) is checked by code from Ordoor's own
   state. The model cannot overrule it. The model then grades each expected item, how well Ordoor
   understood the request, whether it asked only necessary questions, how it handled corrections, and
   its tone. It also lists issues for a developer to look at.

## Storage

Everything lives in the app's own PostgreSQL database (`DATABASE_URL`), never in Ordoor's:

| Table | Holds |
|---|---|
| `personas` | name, phone (unique — one number per persona), location, character, language, traits |
| `scenarios` | persona, intent, expected items, expected outcome, store behaviour, limits — deleted with their persona |
| `runs` | status, timings, transcript, store side, Ordoor's final state, evaluation, log (`jsonb`); `verdict` and `score` are generated columns for reporting. A run keeps a copy of its persona and scenario, so it survives their edit or deletion |
| `schema_migrations` | which migrations ran |

A run is saved as it happens, so the web app shows it live. A restart marks the runs it interrupted as
failed and picks queued ones up again. For reporting, e.g. the pass rate per scenario:

```sql
SELECT scenario ->> 'title' AS scenario, count(*) AS runs,
       round(100.0 * count(*) FILTER (WHERE verdict = 'pass') / count(*)) AS pass_pct, round(avg(score)) AS avg_score
FROM runs WHERE evaluation IS NOT NULL GROUP BY 1 ORDER BY 3;
```

### Migrations — tables and data

`server/migrations/NNN_name.sql` run in order, once each, in a transaction (`schema_migrations`):

| File | Contents |
|---|---|
| `001_schema.sql` | the tables |
| `002_personas_scenarios_runs.sql` | 4 personas, 6 scenarios and 3 runs (as of 2026-10-12) |

A new database built from them holds exactly that data. To capture what the database holds now — new
personas or scenarios, or runs worth keeping — as the next migration:

```bash
npm run db:export-data -- my_new_scenarios     # → server/migrations/003_my_new_scenarios.sql
```

Every exported row is `INSERT … ON CONFLICT DO NOTHING`, so the file changes nothing on the database it
came from, and never overwrites a row someone edited elsewhere. Never edit a migration that has run —
add the next one.

## Things to know

- **Locations matter.** A pin outside every live store's delivery area gets "we don't deliver there
  yet". The seed personas sit in areas the dev stores delivered to on 2026-10-12: Dokki, Fifth
  Settlement Hay 1, El Shorouk and Zamalek. Move a pin if those change.
- **Leave `RUN_CONCURRENCY` at 1** unless you know what you are doing. All rehearsal orders of a store
  share that store's number, so parallel orders queue behind each other (`QUEUED`). Two runs on the
  same persona never run at once.
- **An order still with the store** survives a reset, because its settlement has its own writer in
  Ordoor. The run shows a warning when this happens. Finish that order from the store side, or give the
  persona a new number.
- Rehearsal conversations appear in Ordoor's **Super admin → Chats**, together with Ordoor's own trace
  of each turn, which is useful when a run fails.

## Ordoor's simulator API

All routes require `Authorization: Bearer $WHATSAPP_SIMULATOR_TOKEN`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/simulator/whatsapp/messages` | `{from, text}` · `{from, text, voice: true}` · `{from, location: {lat, lng, address?}}` · `{from, tap: {id, title}}` | `{conversationId, isNew, replies[], cursor, state}` |
| GET | `/api/simulator/whatsapp/messages` | `?phone=…&after=<message id>&direction=outbound` | `{messages[], cursor}` |
| GET | `/api/simulator/whatsapp/customers` | `?phone=…` | `{conversation (basket lines), order (items, settlementState)}` |
| POST | `/api/simulator/whatsapp/customers` | `{phone, action: "reset"}` | `{abandoned, settling[]}` |
| GET | `/api/simulator/whatsapp/orders/:id/store` | | `{settlementState, version, messages[]}` (rehearsal orders only) |
| POST | `/api/simulator/whatsapp/orders/:id/store` | `{text}` or `{tap: {id, title}}` | `{ok, store}` |

Each reply has the shape `{id, type: text|buttons|list|location_request|link|…, text, options: [{position, id, title}]}`.
To tap an option, send its `id` and `title` back.

## Development

```bash
npm test             # unit tests, the database layer on PGlite (in-process Postgres), and a full run
                     # against a fake Ordoor and a scripted model — no server or database needed
npm run typecheck
```
