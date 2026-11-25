# Reference implementation

One way to build what the [guide](../guide/) describes, not the only one. It follows the public
[UN Transcripts](https://transcripts.un.org/) of the General Assembly, its main committees and the Security
Council. Read it to see how each principle can be turned into code; change whatever does not fit your forum,
your source or your rules.

The State in `profile/state.json` is a generic, invented example. Write your own (see
[`templates/state-profile.md`](../templates/state-profile.md)) before running anything.

## How it maps to the guide

| Guide | Here |
|---|---|
| 2. The State's profile | `profile/state.json`, validated on load (`engine/profile/`) |
| 3. The team | `profile/team.json` (roles, who leads by body); `prompts/` (one file per role and task, versioned); `engine/work/` |
| 4. The source | `engine/ingest/` (index, scope, transcripts), `engine/evidence/` (segments, quality marks, meetings inside a recording) |
| 5. The checks | `engine/check/` (citations, figures, quotations, speakers, tallies, group statements, decision, cable, language); the second-family claim check in `engine/work/` |
| 6. Running it | `engine/queue/` and `engine/run/` (budgets, lock, alerts), `cli/`, `tools/` (cost, regression set, verifier comparison), `ops/` (example systemd units and Caddy) |
| Publishing | `web/`: a read-only site, server-rendered; its only script is the copy button of the press pack (`web/static/copy.js`) |

## Layout

```
engine/    llm · ingest · evidence · check · work · queue · run · db · profile
cli/       command-line entry points (demo, ingest, run, web, status, reopen, …)
prompts/   one file per role and task, versioned
profile/   the State profile (generic example), the team, the regression set (empty)
db/        SQL migrations (one SQLite file)
web/       the site
tests/     node:test suites with invented data and mocked source and model responses
tools/     cost, regression set, verifier comparison
ops/       example systemd units and Caddy configuration
```

Node 24 runs the TypeScript sources directly; SQLite is Node's built-in `node:sqlite`. No runtime dependencies.

## Running it

```sh
cd reference
npm ci
npm run check          # types, tests (mocked, invented data), file size, format
cp .env.example .env   # names only; put real values in your own environment, never in git
node --env-file=.env cli/ingest.ts --from <date> --to <date>
node --env-file=.env cli/run.ts --manual --no-ingest --max-calls 100
node cli/status.ts
node cli/web.ts        # http://127.0.0.1:3910
```

Models: any Ollama-compatible or OpenAI-compatible endpoint (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`). No
model is built in: name the writer (`LLM_MODEL`), a checker of another model family (`LLM_MODEL_CHECK`), a
fallback (`LLM_MODEL_FALLBACK`) and a checker for the fallback's documents (`LLM_MODEL_CHECK_FALLBACK`). A
missing name stops the run with a plain message. Every call is recorded before it is sent (`llm_calls`).

## See it without a key

```sh
cd reference
npm ci
npm run demo           # http://127.0.0.1:3910
```

The demo runs the real engine and the real site on three invented meetings, one of each level of work (a note,
a report and a full file), with a scripted model in place of a real one. It needs no key and no network, and
stores nothing. It shows the shape of the documents and the pages, not the quality of any model.

## Another forum

The engine reads the UN Transcripts format and knows the UN's Member States and groups
(`engine/check/member-states.ts`, `engine/check/groups.ts`). For another forum, register its members with
`extendMemberStates` and its groups with `extendGroups`, list the groups in the profile's `known_groups`, and
replace `engine/ingest/` with a reader for your source that produces the same segments. The tests do exactly
this with invented States and groups (`tests/support/invented.ts`).

## Rules the code keeps

- The work never waits for a person: no state or button holds a document for human approval, and the checks
  decide what is accepted. Reading the output is still a person's job (guide, chapters 6 and 7), and the limits
  of the checks are stated on every page.
- The state of a meeting file lives in `files.status` only. Stored documents are never rewritten; a new attempt
  is a new row.
- Every model call is recorded before it is sent; every document records provider, model, prompt id and version,
  tokens and duration.
- No source file over 400 lines (`npm run check:size`).
