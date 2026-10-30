# ChatMT — reflective and regenerative AI

ChatMT compares what you give it against a set of written standard codes, measures how close
the two are, answers with the reasons for that answer, and remembers what it learned so the
next interaction can use it.

The original description of the project, kept as it was written:

> This apps uses a regenerative ( Reflective) A.I system which compares inputs received from
> users with some already standard written codes which the App mimicks as his real identity

**The interface now runs on the backend.** The page holds no data of its own: it asks the API
for the palette, the answer, the profile, the memory and the background suggestions. There is no
`localStorage` path any more, so what you see and what the server stored cannot diverge.

_Last updated: 29 October 2026 — “Ink Register” interface, local fonts, and a full bug-fix
pass; 108 automated tests and 51 browser checks passing._

---

## What works today

| Implemented | Not implemented |
|---|---|
| Palette of 15 colours, 9 covered by a standard code | Text understanding (the language model is used only to classify an ambiguous reason) |
| CIEDE2000 comparison in CIELAB | Image recognition (no vision model) |
| Reflection engine: standard matched, contradictions, uncertainty | Audio and voice |
| Answers that state the rule, the data used and the uncertainty | Generating images with a model (suggestions are CSS + SVG specifications) |
| Memory on the server: preferences, corrections, profile, assessments, consent, per-user separation, deletion | Authentication and authorisation (the backend is for localhost only) |
| Red/yellow reason policy: personal, cogent, or absent (absent is personal) | A complete graphic editor (crop, resize, quarter-turn rotation and format conversion only) |
| Friendliness profile: five encouraged colours restore it, the displeasure can recur | WebP/GIF output, layers, text, filters |
| Lesser effort = a declared 900 ms delay **and** 2 suggestions instead of 5 | Free-text conversation (the chat input only recognises colour names, a reason when a question is open, and red/yellow background requests) |
| Five encouraged colours, with magenta and purple sharing the meanings of indigo and violet | |
| Background suggestions tending towards the five colours; red or yellow only on request and after a cogent reason | |
| Interface served by the backend on the same origin as the API | |
| “Ink Register” interface: proof-sheet layout, local fonts, chat mirror, responsive down to 390 px | |

The measurement is a mathematical distance. It is **not** a statement about your taste: two
colours can be very close without you liking both, and far apart while you like both. The
interface says this in every answer that contains a comparison.

## Quick start

```bash
cd ChatMT
npm install        # one dependency: jimp, for the image operations
npm start          # node backend/server.js
# then open http://127.0.0.1:3080/   (redirects to /frontend/)
```

The page and the API share one origin, so there is nothing to configure and no CORS to arrange.
The user of the interface is `local-user`; `?user=<name>` (letters, digits, dash, underscore)
switches to a different, separate memory.

**With Docker** (the whole application, not only the page):

```bash
docker build -t chatmt .
docker run --rm -p 8080:3080 chatmt
# then open http://localhost:8080/
```

## The interface

The page is laid out as an **Ink Register**: a prepress proof sheet with a sticky job ticket
(profile, memory, flyer setup; four numbered blocks), eight numbered plates on the sheet, a
spectral register in the masthead and a specimen that takes the colour currently selected. The
visual language is paper, ink and vermilion; colour appears only where colour is the subject.

- **Local fonts, no remote requests.** Gloock (display), Instrument Sans (body) and Geist Mono
  (labels) are served from `frontend/fonts/` with their OFL licences. The page loads no webfont
  from a third party.
- **One observable contract.** The redesign kept every id, class and text used by
  `frontend/js/app.js` and the 51 browser checks. The chat thread mirrors the detail panels; the
  panels remain the source of truth.
- **Responsive order.** On desktop the job ticket is a 310 px sticky column; below 960 px the
  layout becomes one column and the main sheet comes first on screen, followed by the ticket. The
  DOM is main-first at every width; the covered palette goes from three columns to two to one.
- **Accessibility in the ordinary path.** Visible `:focus-visible` outlines, 44 px touch targets on
  small screens, `prefers-reduced-motion` respected, labelled controls and live regions. No
  `innerHTML`.
- **State correctness.** A request token discards out-of-order answers; typing is removed on
  errors; a new selection clears stale reason, delay and correction panels; a background question
  keeps the colour it was asked about.

The design notes are in `docs/design-philosophy.md`.

## The rules, as decided by the project creator

Recorded in `standards/colour-meanings.json`, which is the file to edit to change them.

- **Five encouraged colours**: green (prosperity and peace), blue (abundance), orange (joy and
  happiness), indigo (victory), violet (safety).
- **Equivalent colours**: magenta carries the meaning of indigo and purple the meaning of violet,
  so both are encouraged and receive the extensive assistance.
- **Red** is recorded as danger or royalty, **yellow** as anger or determination. Both are
  questioned.
- **A friendly profile** is the default, is kept by choosing any of the five encouraged colours or
  their equivalents, and is also given by a cogent reason for red or yellow. A cogent reason
  unlocks red and yellow backgrounds.
- **Not friendly**: a personal reason for red or yellow, or **no reason at all** — an absent
  reason is personal in nature. The profile then receives the lesser effort: the outputs wait
  **900 ms** and only **2** background suggestions are given, with brief descriptions.
- **The displeasure can recur**: every new personal or absent choice of red or yellow arms it
  again, and it is expressed at the next interaction together with the explanation of the lesser
  effort.
- **Red or yellow backgrounds** are suggested only when the user **asks for them** and gives a
  **cogent reason for the request**. When the user asks, the app asks immediately why; a reason
  that is not cogent activates the unfriendly mood and stores the profile for the next
  engagement.
- **The app only suggests backgrounds**. No background is ever applied by the system: the
  suggestions carry `choice.by: "user"`, and a background becomes the chosen one only when the
  user presses its button.

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

That first interaction returns `reasonAssessment.verdict = "personal"`, a `not_friendly` profile
with `display_delay_ms = 900`, 2 suggestions, and an empty `standingMessages` list. At the
**next** interaction the same user receives `personal-reason-displeasure` and
`reduced-assistance-explanation` once. Choosing blue, green, orange, indigo, violet, magenta or
purple restores the friendly profile; a further personal choice of red or yellow arms the
displeasure again.

Once a cogent reason is recorded, `POST /api/design/backgrounds` with `colour: {"name":"red"}`
returns the question alone, and the same request with a cogent `reason` returns backgrounds
tending towards red, as suggestions only.

`GET /api/meanings` returns the five encouraged colours, the equivalents, the recorded
representations of red and yellow, the assistance numbers and the explanation to display when
the user asks why the app is biased against them. The full list of endpoints and their fields is
in `docs/backend-api.md`.

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
- the suggestions are deterministic design specifications, not generated pictures;
- the 900 ms delay is a declared product decision, not a measured computation time: the real
  reasoning takes a fraction of a millisecond.

## Tests

**Logic, policy and backend (no browser needed):**

```bash
node tests/run-tests.mjs      # or: npm test
# 108 tests, 0 failures
```

They cover HEX/RGB/CIELAB conversions and all 34 published CIEDE2000 reference pairs, distance
bands, consent, persistence, retrieval, update, deletion, expiry, user separation, reflection on
covered and uncovered colours, contradictions, answer wording, the reason rules (including the
absent reason), the equivalent colours, the friendliness transitions, the recurring displeasure,
the declared delay, design suggestions, the requested red/yellow backgrounds, image operations,
a real HTTP server, error mapping, the served interface and the static-file guard.

**Interface (needs an installed Chrome; the script starts the backend itself):**

```bash
node tests/browser-checks.mjs
# 51/51 browser checks passed
```

It checks the palette, the answer, the consent rule, the stored records, the 900 ms delay
(measured, not assumed), the two-suggestion limit, the displeasure at the next interaction, the
restore by an encouraged colour, the background request and its question, the cogent path, the
"the user chooses" behaviour and the deletion of everything.

The 29 October bug-fix pass also checked by hand: keyboard focus on form controls, the 768 px
two-column palette borders, the mobile DOM order, a delayed out-of-order interaction, a failed
interaction (typing removed), and a background question whose select is changed after asking. The
static-serving test additionally asserts that local `.ttf` fonts are returned as `font/ttf` with
`X-Content-Type-Options: nosniff`.

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
        |               standards/colour-meanings.json    (5 encouraged, 2 equivalent, 2 questioned)
        v
Reflection Engine ...... pertinent rules, distances, contradictions, uncertainty, memory
        |
        v
Reason Policy .......... declared rules first, language model only if undecided
        |               personal or absent -> not friendly; cogent -> friendly + unlocked backgrounds
        v
Response Engine ........ measurement, rule, judgement, data used, question, storage
        |
        v
Graphic Assistance ..... 5 or 2 backgrounds tending towards the five colours,
        |               red or yellow only on request and after a cogent reason
        v
Delay .................. 0 ms for a friendly profile, 900 ms for a not friendly one
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
**not covered** with its uncertainty declared. Colours with no recorded meaning (lime, crimson,
gold, navy, orchid, grey) are reported as such; no meaning is invented.

## Privacy

- Nothing is written without `consent: true`, enforced by the Memory Engine and by the API. The
  interface asks before it sends anything that could be stored.
- Data is stored in `data/chatmt.memory.<userId>.json`, separated per user, and can be read or
  deleted through the API. "Delete all stored data" removes every record of that user.
- The browser keeps no copy: there is no `localStorage` path in the interface. The only thing the
  page remembers is the user id in the URL.
- The interface makes no third-party requests: the fonts are local and there is no analytics,
  remote stylesheet or external script.
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
├── backend/              HTTP API, file memory, LLM adapter, image service, static frontend
│   ├── server.js         routes, error mapping and the page on the same origin
│   ├── static-files.js   serves /frontend without leaving its directory
│   ├── config.js         environment configuration
│   ├── env-file.js       dependency-free .env reader, used at startup only
│   ├── llm-classifier.js OpenAI-compatible (DeepSeek) classifier for ambiguous reasons
│   ├── services/         interaction orchestration and image transforms
│   └── storage/          atomic JSON file adapter for the Memory Engine
├── frontend/             the interface: API client, HTML, CSS, local fonts
│   ├── css/styles.css    the “Ink Register” styles
│   ├── fonts/            Gloock, Instrument Sans, Geist Mono + OFL licences
│   └── js/app.js         API client and DOM rendering
├── modules/
│   ├── color_engine/     colour space conversions, CIEDE2000, palette
│   ├── reflection/       input vs standard vs memory, reason rules
│   ├── response/         turns a reflection into an answer
│   ├── memory/           records, consent, storage
│   ├── meaning/          the colour meaning index, equivalents included
│   ├── policy/           friendliness profile and design suggestions
│   └── design/           image operation validation
├── standards/            the standard codes and the colour meanings
├── tests/                unit tests, backend integration tests, browser checks
├── docs/                 architecture, API, tests, design philosophy, phase 1 analysis
├── Dockerfile            Node image running the backend, which serves the page
└── package.json          ES modules, one dependency (jimp), start and test scripts
```

## Documentation

- `docs/backend-api.md` — API, rules, configuration, data on disk, limits, measured tests
- `docs/architettura.md` — how the modules fit together and the decisions taken
- `docs/test.md` — what the tests check, and the measured results
- `docs/design-philosophy.md` — the “Ink Register” design language and its implementation notes
- `docs/fase-1-analisi.md` — the analysis of the repository at the start (in Italian)
- `Usage Of Colours` — the original rules, unchanged

The detailed documents are in Italian because they are written for the project creator; the
code, the identifiers and the interface are in English.

## Roadmap

1. **Analysis** — done (`docs/fase-1-analisi.md`)
2. **Colour prototype** — done
3. **Reflective engine** — done, with the reason policy and the profile; the next step is a
   wider set of standards and an evaluation of the reason classifier on labelled data
4. **Conversational system** — not started: it needs a language model used for conversation,
   not only for one classification
5. **Multimodal system** — images and audio; the backend accepts images for crop, resize,
   rotation and conversion, but there is no vision model and no audio

A phase is only started when the previous one has a working version and documented tests.

## Settings

Backend: the local `.env` file, read at startup (template and full list: `.env.example`, then
`docs/backend-api.md`). Copy the template and paste the DeepSeek key:

```bash
cp .env.example .env      # then edit DEEPSEEK_API_KEY
npm start                 # the log says which model is in use, or that none is configured
```

The model is optional: without `DEEPSEEK_API_KEY` the server starts normally, no text leaves the
machine, and an ambiguous reason stays undecided instead of being stored. An exported variable
always wins over the file.

Interface: the user id comes from the URL (`?user=<name>`, default `local-user`). It names the
memory profile on the server; changing it switches to a different, separate memory.

## License

No license file is present yet, so the default of a public repository applies: all rights
reserved. If you want others to be able to reuse this code, a license has to be chosen and
added.

---

Created by **Francesco Bulla**.
