# ChatMT — reflective and regenerative AI

ChatMT compares what you give it against a set of written standard codes, measures how close
the two are, answers with the reasons for that answer, and remembers what it learned so the
next interaction can use it.

The original description of the project, kept as it was written:

> This apps uses a regenerative ( Reflective) A.I system which compares inputs received from
> users with some already standard written codes which the App mimicks as his real identity

**Phase 2 (colour preference engine) and its backend are implemented and testable.** The
frontend is still the phase 2 interface and uses browser storage; the backend adds shared
memory on disk, the reason policy for red and yellow, the friendliness profile, design
suggestions and four image operations. Everything below describes what is really in this
repository.

_Last updated: 28 October 2026 — backend added, 87 automated tests and 47 browser checks passing._

---

## What works today

| Implemented | Not implemented |
|---|---|
| Palette of 15 colours, 9 covered by a standard code | Text understanding (the language model is used only to classify an ambiguous reason) |
| CIEDE2000 comparison in CIELAB | Image recognition (no vision model) |
| Reflection engine: standard matched, contradictions, uncertainty | Audio and voice |
| Answers that state the rule, the data used and the uncertainty | Generating images with a model (suggestions are CSS + SVG specifications) |
| Memory: preferences, corrections, consent, per-user separation, deletion | Frontend wired to the backend |
| Red/yellow reason policy: personal or cogent, with an explanation of each verdict | Authentication and authorisation (the backend is for localhost only) |
| Friendliness profile: displeasure and reduced assistance delivered once, at the next interaction | A complete graphic editor (crop, resize, quarter-turn rotation and format conversion only) |
| Five encouraged colours with recorded meanings; no meaning invented for the others | WebP/GIF output, layers, text, filters |
| Design suggestions tending towards the five colours, fewer for a not friendly profile | |
| Backend HTTP API with memory on disk and image operations | |

The measurement is a mathematical distance. It is **not** a statement about your taste: two
colours can be very close without you liking both, and far apart while you like both. The
interface says this in every answer that contains a comparison.

## Backend at a glance

```bash
curl -s -X POST http://127.0.0.1:3080/api/interactions \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "local-user",
    "colour": { "name": "red" },
    "reason": "I just like it",
    "consent": true,
    "design": { "type": "flyer", "subject": "Jazz night" }
  }'
```

That first interaction returns `reasonAssessment.verdict = "personal"`, a `not_friendly`
profile, 2 suggestions instead of 5, and an empty `standingMessages` list. At the **next**
interaction the same user receives `personal-reason-displeasure` and
`reduced-assistance-explanation` once; the profile stays not friendly until a cogent reason for
red or yellow is recorded. A cogent reason returns a friendly profile, 5 suggestions and a
red/yellow accent.

`GET /api/meanings` returns the five encouraged colours, the recorded representations of red
and yellow, and the explanation to display when the user asks why the app is biased against
them. The full list of endpoints and their fields is in `docs/backend-api.md`.

## What this is not

Named so that nothing is claimed that the code does not do:

- it is **not** a trained neural network, and no weights are updated by any interaction;
- it is **not** a general language model; the model, when configured, receives one short
  reason and returns one of three labels;
- it is **not** shown to be better than any existing AI system. No comparative benchmark has
  been run, so no claim of superiority is made;
- stored preferences and profiles are **not** learning in the machine-learning sense: they are
  records written to JSON files and read back;
- the reason classifier is a declared set of wording rules with thresholds. Its accuracy on
  real reasons has **not** been measured, because no labelled set exists yet;
- the suggestions are deterministic design specifications, not generated pictures.

## Quick start

### Backend

```bash
cd ChatMT
npm install        # one dependency: jimp, for the image operations
npm start          # node backend/server.js
# http://127.0.0.1:3080/api/health
```

The API documentation is in `docs/backend-api.md`. Without any configuration the backend is
fully local: no account, no API key, no external service. The optional language model is
described below.

### Frontend

The frontend must be served over HTTP: ES modules and `fetch()` do not work from `file://`, so
double-clicking `index.html` shows a clear message instead of the interface.

```bash
python -m http.server 8000
# then open http://localhost:8000/frontend/
```

**With Docker (frontend only):**

```bash
docker build -t chatmt .
docker run --rm -p 8080:80 chatmt
# then open http://localhost:8080/   (redirects to /frontend/)
```

The Docker image serves the static frontend with nginx. It does **not** run the Node backend;
use `npm start` for that.

## Tests

**Logic and backend (no browser needed):**

```bash
node tests/run-tests.mjs      # or: npm test
# 87 tests, 0 failures
```

The 41 original tests cover HEX/RGB/CIELAB conversions, all 34 published CIEDE2000 reference
pairs, distance bands, consent, persistence, retrieval, update, deletion, expiry, user
separation, reflection on covered and uncovered colours, contradictions, and answer wording.
The 46 new tests cover the reason rules, the meaning standard, the friendliness transitions,
design suggestions, image operation validation, a real HTTP server, persistence across server
instances, error mapping, image transforms, a simulated language model and the two generic
memory methods the backend uses for profiles and assessments.

**Interface (needs a running server and an installed Chrome):**

```bash
python -m http.server 8000
node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html
# 47/47 checks passed
```

See `docs/test.md` for what each test proves and for the measured results.

## How an answer is produced

```
your input (a colour from the palette, plus a reason for red or yellow)
        |
        v
Input Layer ............ HEX, RGB and CIELAB
        |
        v
Standard Code Layer .... standards/usage-of-colours.json  (9 rules)
        |               standards/colour-meanings.json    (5 encouraged, 2 questioned)
        v
Reflection Engine ...... pertinent rules, distances, contradictions, uncertainty, memory
        |
        v
Reason Policy .......... declared rules first, language model only if undecided
        |               personal -> not friendly; cogent -> friendly
        v
Response Engine ........ measurement, rule, judgement, data used, question, storage
        |
        v
Graphic Assistance ..... 5 or 2 backgrounds tending towards the five colours
        |
        v
Memory Engine .......... preferences, corrections, profile, assessments, with consent
```

## The colour standards

The nine usage rules come verbatim from the file `Usage Of Colours` written by the project
creator. `standards/usage-of-colours.json` is the machine-readable version, with the decisions
taken about them:

- **"majesta color"** was confirmed as **magenta** (`#FF00FF`); the original text is unchanged.
- **"accepted"** means: answer affirmatively, and store the preference only with explicit consent.
- The rules apply to **a colour chosen from the palette**, not to text or images.
- Each named colour is anchored to its **CSS named-colour value**, which is public and
  verifiable. CSS `green` is `#008000`; `#00FF00` is `lime`.

Seven colours are accepted, two are questioned. Any colour that no rule covers is reported as
**not covered** with its uncertainty declared.

The meanings and the behaviour for red and yellow come from the creator's messages of
28 October 2026 and live in `standards/colour-meanings.json`:

- the five encouraged colours are **green** (prosperity and peace), **blue** (abundance),
  **orange** (joy and happiness), **indigo** (victory) and **violet** (safety);
- **red** is recorded as danger or royalty, **yellow** as anger or determination;
- a personal reason for red or yellow stores a **not friendly** profile and reduces the
  assistance; a cogent reason keeps the friendly tone and unlocks red/yellow accents;
- the displeasure and the explanation of the reduced assistance are delivered **once**, at the
  next interaction;
- colours with no recorded meaning (magenta, purple and the uncovered palette colours) are
  reported as such; no meaning is invented.

`GET /api/meanings` returns the recorded representations and the explanation to display when
the user asks why the app is biased against red and yellow.

## Privacy

- **Frontend:** nothing is written without ticking the consent box; data stays in the browser
  (`localStorage`, key `chatmt.memory.<user>`).
- **Backend:** nothing is written without `consent: true`, enforced by the Memory Engine and by
  the API. Data is stored in `data/chatmt.memory.<userId>.json`, separated per user, and can be
  read or deleted through the API.
- The frontend and the backend do not talk to each other yet: enabling the backend does not
  move the existing browser data anywhere.
- The optional language model is called **only** when the declared rules cannot classify a
  reason and a key is configured. In that case the reason text is sent to the configured
  provider. Without a key, no text leaves the machine.
- The API key stays on the server and is never returned by an endpoint.
- The backend has **no authentication**: anyone who can reach it can use any `userId`. It
  listens on `127.0.0.1` by default. Do not expose it to a network without adding
  authentication, authorisation, rate limiting and HTTPS.

## Project structure

```
ChatMT/
├── backend/              HTTP API, file memory, LLM adapter, image service
│   ├── server.js         routes and error mapping
│   ├── config.js         environment configuration
│   ├── llm-classifier.js OpenAI-compatible classifier for ambiguous reasons
│   ├── services/         interaction orchestration and image transforms
│   └── storage/          atomic JSON file adapter for the Memory Engine
├── frontend/             the phase 2 interface (HTML, CSS, ES modules)
├── modules/
│   ├── color_engine/     colour space conversions, CIEDE2000, palette
│   ├── reflection/       input vs standard vs memory, reason rules
│   ├── response/         turns a reflection into an answer
│   ├── memory/           records, consent, storage
│   ├── meaning/          the colour meaning index
│   ├── policy/           friendliness profile and design suggestions
│   └── design/           image operation validation
├── standards/            the standard codes and the colour meanings
├── tests/                unit tests, backend integration tests, browser checks
├── docs/                 architecture, API, tests, phase 1 analysis
├── Dockerfile            nginx serving the static frontend
└── package.json          ES modules, one dependency (jimp), test and start scripts
```

## Documentation

- `docs/backend-api.md` — API, rules, configuration, data on disk, limits, measured tests
- `docs/architettura.md` — how the modules fit together and the decisions taken
- `docs/test.md` — what the tests check, and the measured results
- `docs/fase-1-analisi.md` — the analysis of the repository at the start (in Italian)
- `Usage Of Colours` — the original rules, unchanged

The detailed documents are in Italian because they are written for the project creator; the
code, the identifiers and the interface are in English.

## Roadmap

1. **Analysis** — done (`docs/fase-1-analisi.md`)
2. **Colour prototype** — done (frontend)
3. **Reflective engine** — the comparison, feedback, context recovery, reason policy and
   profile are implemented; the next step is a wider set of standards and an evaluation of the
   reason classifier on labelled data
4. **Conversational system** — not started: it needs a language model used for conversation,
   not only for one classification
5. **Multimodal system** — images and audio; the backend now accepts images for crop, resize,
   rotation and conversion, but there is no vision model and no audio

A phase is only started when the previous one has a working version and documented tests.

## Settings

Backend: environment variables only, documented in `docs/backend-api.md`. The optional
language model uses `ZAI_API_BASE` / `ZAI_API_KEY` (or `CHATMT_LLM_*`) and is not required.

Frontend: the only setting in the code is the local user id, `USER_ID` in
`frontend/js/app.js`, which names the browser memory profile. Changing it switches to a
different, separate memory.

## License

No license file is present yet, so the default of a public repository applies: all rights
reserved. If you want others to be able to reuse this code, a license has to be chosen and
added.

---

Created by **Francesco Bulla**.
