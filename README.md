# ChatMT — reflective and regenerative AI

ChatMT compares what you give it against a set of written standard codes, measures how close
the two are, answers with the reasons for that answer, and remembers what it learned so the
next interaction can use it.

**Phase 2 (colour preference engine) is implemented and testable.** Everything below describes
what is really in this repository, not what is planned.

Original description of the project, kept as it was written:

> This apps uses a regenerative ( Reflective) A.I system which compares inputs received from users with some already standard written codes which the App mimicks as his real identity

---

## What works today

| Implemented | Not implemented |
|---|---|
| Palette of 15 colours, 9 of them covered by a standard code | Text understanding (no language model is integrated) |
| CIEDE2000 perceptual comparison in CIELAB | Image recognition (no vision model is integrated) |
| Reflection engine: standard matched, contradictions, uncertainty | Audio and voice (no speech model is integrated) |
| Answers that state the rule applied, the data used and the uncertainty | Any neural network being trained or retrained |
| Memory: colour preference, correction, consent, per-user separation, deletion | Multiple users in one interface (the store supports them, the interface uses one profile) |
| Explicit correction of an answer, stored without changing the standard | |

The measurement is a mathematical distance. It is **not** a statement about your taste: two
colours can be very close to each other without you liking both, and far apart while you like
both. The interface says this in every answer that contains a comparison.

## What this is not

Named here so that nothing is claimed that the code does not do:

- it is **not** a trained neural network, and no weights are updated by any interaction;
- it is **not** a language model and it does not understand sentences;
- it is **not** shown to be better than any existing AI system. No comparative benchmark has
  been run, so no claim of superiority is made;
- stored preferences are **not** learning in the machine-learning sense: they are records
  written to a local storage and read back.

The distinction between a rule-based system, an information-retrieval system, a persistent
memory and a system that trains a model is kept explicit in the code and in `docs/`.

## Quick start

The application must be served over HTTP: ES modules and `fetch()` do not work from `file://`,
so double-clicking `index.html` will show a clear message instead of the interface.

**With Python (already installed on most systems):**

```bash
python -m http.server 8000
# then open http://localhost:8000/frontend/
```

**With Docker:**

```bash
docker build -t chatmt .
docker run --rm -p 8080:80 chatmt
# then open http://localhost:8080/   (redirects to /frontend/)
```

No dependency is installed and there is no build step: the browser loads the ES modules
directly from `modules/`.

## Tests

**Logic (no browser needed):**

```bash
node tests/run-tests.mjs      # or: npm test
```

41 tests: HEX/RGB/CIELAB conversions, all 34 published CIEDE2000 reference pairs, colour
comparison bands, consent enforcement, persistence, retrieval, update, deletion, expiry, user
separation, reflection on covered and uncovered colours, contradictions, and the wording of
the answers. See `docs/test.md` for what each test proves and for how to run them.

**Interface (needs a running server and an installed Chrome):**

```bash
python -m http.server 8000
node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html
```

47 checks that drive a real browser through the whole flow and assert on the DOM.

## How an answer is produced

```
your input (a colour from the palette)
        |
        v
Input Layer ............ the colour is turned into HEX, RGB and CIELAB
        |
        v
Standard Code Layer .... standards/usage-of-colours.json  (9 rules)
        |
        v
Reflection Engine ...... which rules are pertinent, what contradicts what, how uncertain
        |
        v
Response Engine ........ an answer that separates measurement, rule and judgement
        |
        v
Memory Engine .......... preference and correction records, with consent
```

## The colour standard

The nine rules come verbatim from the file `Usage Of Colours` written by the project creator.
`standards/usage-of-colours.json` is the machine-readable version of the same rules, and it
records the decisions taken about them:

- **"majesta color"** is not a standard colour name. It was confirmed as **magenta** (`#FF00FF`).
  The original text is kept unchanged.
- **"accepted"** means: answer affirmatively, and store the preference only with explicit consent.
- The rules apply to **a colour chosen from the palette**, not to text or images.
- Each named colour is anchored to its **CSS named-colour value**, which is public and
  verifiable. This matters: CSS `green` is `#008000`, and `#00FF00` is `lime`.

Seven colours are accepted (green, blue, orange, magenta, indigo, purple, violet), two are
questioned (red: "Why did you choose Red?", yellow: "Why did you choose Yellow?"). Any colour
that no rule covers is reported as **not covered** and its uncertainty is declared.

## Privacy

- Nothing is written without ticking the consent box, and nothing is written automatically:
  storing a preference always requires a button press.
- Consent is asked again at every reload.
- Data stays in your browser (`localStorage`, key `chatmt.memory.<user>`). Nothing is sent to a
  server, because this version has no server to send it to.
- "Delete all stored data" removes every record of the current user.

## Project structure

```
ChatMT/
├── frontend/            the interface (HTML, CSS, ES modules)
├── modules/
│   ├── color_engine/    colour space conversions, CIEDE2000, palette
│   ├── reflection/      input vs standard vs memory
│   ├── response/        turns a reflection into an answer
│   └── memory/          records, consent, storage
├── standards/           the standard codes, readable by a machine
├── tests/               unit tests and browser checks
├── docs/                architecture, tests, and the phase 1 analysis
├── Dockerfile           nginx serving the static application
└── package.json         ES modules enabled, one test script, no dependencies
```

## Documentation

- `docs/architettura.md` — how the modules fit together, the interfaces, and the decisions taken
- `docs/test.md` — what the tests check, and the measured results
- `docs/fase-1-analisi.md` — the analysis of the repository at the start (in Italian)
- `Usage Of Colours` — the original rules, unchanged

The detailed documents are in Italian because they are written for the project creator; the
code, the identifiers and the interface are in English.

## Roadmap

The five phases of the project brief:

1. **Analysis** — done (`docs/fase-1-analisi.md`)
2. **Colour prototype** — done (this version)
3. **Reflective engine** — partly done: the comparison with the standards, the generated
   feedback and the recovery of context are implemented; the next step is a wider set of
   standards and a review of the uncertainty rules
4. **Conversational system** — not started: it needs a language model, through an API or a
   local model
5. **Multimodal system** — not started: images and audio, each with its own tests

A phase is only started when the previous one has a working version and documented tests.

## Settings

No configuration file is needed and no API key is used. The only setting in the code is the
local user id, `USER_ID` in `frontend/js/app.js`, which names the memory profile. Changing it
switches to a different, separate memory.

## License

No license file is present yet, so the default of a public repository applies: all rights
reserved. If you want others to be able to reuse this code, a license has to be chosen and
added.

---

Created by **Francesco Bulla**.
