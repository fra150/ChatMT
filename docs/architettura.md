# ChatMT — Architettura (Fase 2 e backend)

- **Stato:** implementata e verificata (87 test automatici + 47 controlli nel browser)
- **Data:** 26 ottobre 2026 (fase 2), 28 ottobre 2026 (backend)
- **Ambito:** confronto di un colore scelto dalla tavolozza con i codici standard, memoria delle preferenze e delle correzioni, giudizio della ragione per rosso/giallo, profilo friendly/not_friendly, suggerimenti grafici, operazioni immagine

> Il §1 descrive la fase 2, che resta valida e non è stata riscritta. Il backend aggiunge i
> pezzi del §8 e sostituisce la decisione "nessun backend" del §4, che valeva per quella fase.
> L'interfaccia continua a usare `localStorage`: il collegamento alle API non è stato fatto.

---

## 1. Vista d'insieme

```
input utente (colore scelto dalla tavolozza)
   |
   v
[frontend/js/app.js]  interfaccia: nessuna logica di colore, nessuna regola
   |
   v
[modules/reflection/reflection-engine.js]
   |  caratteristiche misurabili  ->  standard pertinenti  ->  distanze  ->  contraddizioni  ->  incertezza  ->  contesto dalla memoria
   v
[modules/response/response-engine.js]
   |  risposta: misura, regola applicata, giudizio, dati usati, incertezza, domanda
   v
[frontend]  mostra la risposta e chiede il consenso per memorizzare
   |
   v
[modules/memory/memory-store.js]  record di preferenza o di correzione
```

Regola di separazione applicata ovunque: **il calcolo vive nei moduli, l'interfaccia non calcola nulla**. Se una funzione matematica fosse scritta dentro `app.js`, non sarebbe verificabile senza un browser.

---

## 2. Moduli e interfacce

| Modulo | Responsabilità | Interfaccia pubblica |
|---|---|---|
| `modules/color_engine/color-space.js` | conversioni e distanza percettiva | `isValidHex(hex)`, `normaliseHex(hex)`, `hexToRgb(hex)`, `rgbToHex(rgb)`, `srgbToLinear(c)`, `rgbToXyz(rgb)`, `xyzToLab(xyz)`, `rgbToLab(rgb)`, `hexToLab(hex)`, `deltaE2000(lab1, lab2)`, `deltaE2000Hex(hex1, hex2)`, `InvalidColourError`, `D65` |
| `modules/color_engine/color-engine.js` | rappresentazione strutturata e descrizione della misura | `createColour(hex, name)`, `compareColours(a, b)`, `describeDistance(deltaE)`, `describeMeasurement(deltaE)`, `rgbToCss(rgb)`, `DISTANCE_BANDS` |
| `modules/color_engine/palette.js` | la tavolozza mostrata, con l'indicazione di ciò che è coperto da uno standard | `PALETTE`, `coveredColours()`, `uncoveredColours()` |
| `modules/reflection/reflection-engine.js` | confronto input ↔ standard ↔ memoria | `createReflectionEngine({ standards })` → `{ reflect(input, { memory }) }`, `INPUT_TYPES`, `UNCERTAINTY`, `LABEL_VALUE_TOLERANCE`, `UnsupportedInputError` |
| `modules/response/response-engine.js` | costruzione della risposta | `buildResponse(reflection)` |
| `modules/memory/memory-store.js` | memoria persistente con consenso | `new MemoryStore({ adapter, userId, now, idFactory })`, `addPreference`, `addCorrection`, `updatePreference`, `get`, `list`, `listPreferences`, `currentPreference`, `correctionsFor`, `delete`, `clear`, `count`, `isExpired`, `CATEGORIES`, `CONFIRMATION`, `ConsentRequiredError`, `RecordNotFoundError`, `createVolatileAdapter()` |

### Forma del risultato della riflessione

```js
{
  input:      { type, hex, name },
  features:   { hex, rgb, lab, name },          // rappresentazione strutturata
  standards:  { id, version, ruleCount },
  coverage:   'covered' | 'uncovered',
  rule:       { id, colour_name, hex, outcome, question, source_text } | null,
  distanceToRule: number | null,
  nearest:    { rule, deltaE },                 // lo standard più vicino, anche quando non è pertinente
  contradictions: [{ code, severity, message }],
  uncertainty:    { level: 'low'|'medium'|'high', reasons: [string] },
  memory:     { used, preference, comparison, corrections, correction }
}
```

### Forma della risposta

```js
{
  headline, paragraphs[], judgement,
  measurement: { deltaE, band, sentence, comparedWith } | null,
  appliedRules[], nearestStandard, dataUsed[],
  contradictions[], uncertainty,
  question, needsClarification,
  storage: { permitted, confirmation, requiresQuestionAnswer, explanation },
  coverage
}
```

La risposta **non contiene una catena di ragionamento**: contiene i dati usati, le regole applicate, il livello di incertezza e le sue motivazioni. È ciò che il §7 del brief chiede di mostrare.

---

## 3. Modello dei dati di memoria

Ogni record, con i campi richiesti dal §3 del brief:

```js
{
  id,                              // identificativo
  category,                        // categoria (vedi sotto)
  user_id,                         // separazione tra utenti
  content,                         // contenuto
  origin,                          // origine
  created_at, updated_at,          // date
  confidence,                      // attendibilità (0..1)
  expires_at,                      // scadenza, null = nessuna
  confirmation,                    // 'confirmed' | 'unconfirmed'
  consent: true                    // consenso esplicito senza il quale il record non esiste
}
```

Contenuto di una preferenza: `{ kind: 'colour', hex, name, reason }`, dove `reason` è la risposta dell'utente alla domanda richiesta da una regola (per esempio "Why did you choose Red?").

Contenuto di una correzione: `{ kind: 'colour_outcome_correction', hex, name, target_standard_id, proposed_outcome, note }`.

### Categorie

| Categoria | Uso in questa fase |
|---|---|
| `preference` | **usata** — il colore preferito |
| `correction` | **usata** — la correzione di una risposta |
| `conversational` | dichiarata, **non scritta** (non c'è ancora conversazione) |
| `knowledge` | dichiarata, **non scritta** (non c'è ancora estrazione di conoscenza) |
| `interaction` | dichiarata, **non scritta** (non c'è ancora valutazione degli esiti) |

Le tre categorie non usate sono dichiarate nel codice e mostrate nell'interfaccia come non usate: nessuna funzione finta è stata scritta per loro.

### Adattatore di archiviazione

Il magazzino non conosce il browser: riceve un `adapter` con `getItem`, `setItem`, `removeItem`. Nel browser è `window.localStorage`; nei test è un `Map` in memoria (`createVolatileAdapter()`). Se `localStorage` non è disponibile (modalità privata, quota), l'interfaccia passa all'adattatore volatile e **avvisa** che la memoria è temporanea, invece di far credere che i dati siano stati salvati.

---

## 4. Decisioni tecniche e motivi

| Decisione | Motivo | Alternativa scartata |
|---|---|---|
| HTML + CSS + JavaScript vanilla **per il frontend**, nessuna dipendenza, nessun passo di build | il creatore conosce HTML e CSS; il primo modulo è aritmetica deterministica; il §6 del brief chiede componenti semplici e verificabili | framework frontend, che avrebbe aggiunto dipendenze e un passo di build senza risolvere alcun problema di questa fase |
| Nessun backend **in fase 2** | non serviva a quella fase: la memoria locale bastava. Un backend diventa necessario per la memoria condivisa, un modello linguistico via API, immagini e audio | server Python fin dall'inizio, che avrebbe aggiunto codice non verificabile in quella fase. **Superata dalla fase backend: vedi §8** |
| Gli standard stanno in un file JSON letto con `fetch` | il file resta modificabile a mano senza toccare il codice, e potrà essere letto anche da un backend futuro | incorporare gli standard nel JavaScript dell'interfaccia, che avrebbe imposto di duplicare i dati |
| L'applicazione va servita via HTTP | i moduli ES e `fetch` non funzionano da `file://`; è un vincolo del browser, non una scelta | aprire `index.html` con doppio clic, che mostra un messaggio di errore con l'istruzione da eseguire |
| Ogni nome di colore è ancorato al valore CSS omonimo | è un valore pubblico e verificabile; evita di scegliere a caso, per esempio, cosa sia "green" (`#008000`, non `#00FF00`) | valori inventati dal progetto |
| Le bande di distanza (`DISTANCE_BANDS`) sono una convenzione del progetto | servono a tradurre un numero in una frase; l'unico appiglio preso dalla letteratura è che ΔE00 ≈ 1 è la differenza appena percepibile | presentare le bande come se fossero misure scientifiche |
| Tolleranza di 1.0 tra etichetta e valore misurato | sotto la differenza appena percepibile, etichetta e valore si considerano lo stesso colore | tolleranza inventata senza riferimento |
| Memorizzare richiede un consenso **e** un clic esplicito | il §3 del brief vieta di usare automaticamente ogni correzione o selezione come modifica permanente; il confronto con la preferenza precedente deve restare visibile | memorizzare automaticamente alla selezione, che avrebbe reso invisibile il confronto |
| Il consenso si richiede di nuovo a ogni ricaricamento | il consenso non è un dato da conservare di nascosto; la casella compare non selezionata | consenso pre-selezionato o memorizzato |
| Un colore non coperto può essere memorizzato solo come osservazione **non confermata** | il sistema non deve dichiarare "accettato" ciò che nessun codice copre; il campo `confirmation` esiste proprio per questo | rifiutare del tutto la memorizzazione, che avrebbe perso l'informazione che l'utente ha scelto quel colore |
| Una correzione non cambia lo standard | il §3 del brief lo vieta esplicitamente; la contraddizione viene mostrata e resta visibile | applicare la correzione allo standard automaticamente |
| Un solo profilo locale (`local-user`) nell'interfaccia | il §7 del brief non richiede la gestione di più profili in questa fase | un selettore di profili, funzione non richiesta |
| Nessun altro input accettato oltre al colore | il campo di applicazione è stato deciso dal creatore: solo la tavolozza. Altri tipi sollevano `UnsupportedInputError` invece di essere interpretati in modo approssimativo | interpretare il testo che nomina un colore, che avrebbe richiesto un modello linguistico assente |

---

## 5. Estensioni previste (Fasi 3, 4, 5)

I punti di innesto sono già definiti, così le fasi successive non dovranno riscrivere questa:

- **Testo** — un Text Engine dovrà produrre lo stesso input accettato da `reflect()` (un tipo nuovo in `INPUT_TYPES` con le sue caratteristiche misurate) e nuovi standard nel formato di `standards/`. Richiede un modello linguistico: API o modello locale.
- **Immagini** — un Image Engine dovrà estrarre un colore dominante o caratteristiche confrontabili con gli standard, e dichiarare l'incertezza del modello usato.
- **Audio** — un Audio Engine dovrà trascrivere e collegare il testo al contesto; il tono della voce non dovrà essere presentato come prova certa dello stato emotivo.
- **Memoria** — `knowledge` e `interaction` sono ora usate dal backend per la valutazione della ragione e per il profilo; `conversational` resta dichiarata e non usata.
- **Backend** — **implementato** (vedi §8): memoria su file, API HTTP, classificatore LLM opzionale, suggerimenti e operazioni immagine.

---

## 6. Limiti noti (dichiarati, non nascosti)

1. **Un solo insieme di standard**, di 9 regole: qualunque colore fuori da quei 9 è "non coperto", e il sistema non può dire altro che questo.
2. **Le correzioni sono confrontate per valore HEX esatto.** Una correzione su `#00FF00` non si applica a `#00FE01`, che dista 0.4: la corrispondenza per prossimità non è implementata.
3. **I livelli di incertezza sono regole, non probabilità.** "high" significa "esiste una condizione dichiarata nel codice", non un valore statistico.
4. **Le bande di distanza sono una convenzione**, non una misura di quanto piaccia un colore.
5. **La memoria non conserva la conversazione**, solo preferenze e correzioni.
6. **Nessuna ricerca o indicizzazione**: i record sono pochi e vengono filtrati linearmente.
7. **La latenza mostrata nell'interfaccia vale per questa sessione e questo dispositivo**, non è un benchmark.
8. **Nessuna verifica di accessibilità automatica** è stata eseguita: sono state usate etichette `aria`, testo alternativo per i colori e contrasto, ma non è stata misurata con strumenti dedicati né provata con uno screen reader.
9. **Il confronto è su un monitor sRGB.** Su schermi diversi o con colori fuori gamut i valori sono gli stessi, la percezione no.

---

## 7. Privacy e consenso

- Nessuna scrittura senza `consent === true`: il controllo è nel Memory Engine, non solo nell'interfaccia, quindi vale anche per un uso futuro da script.
- I record sono separati per `user_id` e la chiave di archiviazione contiene l'identificativo dell'utente.
- `clear()` elimina tutti i record dell'utente corrente e rimuove la voce dall'archivio.
- **Frontend:** nessun dato lascia il dispositivo; non esiste alcuna chiave API nel browser.
- **Backend:** i dati restano in `data/chatmt.memory.<userId>.json`. Se viene configurata una chiave, solo la ragione ambigua viene inviata al provider LLM; senza chiave nessun testo esce dalla macchina. Il backend non ha autenticazione e va usato su localhost (vedi §8.5).
- Se l'archivio è illeggibile, il sistema **solleva un errore** invece di mostrare una memoria vuota: un dato danneggiato non deve sembrare un dato assente.

---

## 8. Backend (fase 2.5)

### 8.1 Vista d'insieme

```
POST /api/interactions
   |
   v
[backend/server.js]  routing, validazione, CORS, mappatura degli errori
   |
   v
[backend/services/interaction-service.js]
   |  messaggi in sospeso -> reflect() -> buildResponse()
   |  -> reason-assessment (regole) -> llm-classifier solo se indeciso
   |  -> standing-engine -> design-suggestions
   v
[modules/memory/memory-store.js] + [backend/storage/file-adapter.js]
   |  preferenza, correzione, profilo (interaction), valutazione (knowledge)
   v
data/chatmt.memory.<userId>.json
```

La regola di separazione resta la stessa: il calcolo e le decisioni vivono nei moduli, il server
fa routing e validazione, l'interfaccia non calcola nulla.

### 8.2 Moduli aggiunti

| Modulo | Responsabilità | Interfaccia pubblica |
|---|---|---|
| `modules/meaning/colour-meanings.js` | indicizza e valida i significati, dichiara i colori senza significato | `createMeaningIndex(standard, {palette})` → `encouraged`, `questioned`, `assistance`, `representationFor`, `isEncouraged`, `isQuestioned`, `coloursWithoutMeaning`, `buildBiasExplanation` |
| `modules/reflection/reason-assessment.js` | regole dichiarate per la ragione | `assessReasonWithRules({colourName, reason})`, `VERDICTS`, `METHODS`, `PERSONAL_MARKERS`, `COGENT_MARKERS`, `DECISION_THRESHOLDS` |
| `modules/policy/standing-engine.js` | transizioni del profilo e messaggi differiti | `createDefaultStanding`, `normaliseStanding`, `applyAssessment`, `collectEngagementMessages`, `assistanceFor`, `summaryOf` |
| `modules/policy/design-suggestions.js` | sfondi deterministici tendenti ai cinque colori | `buildDesignSuggestions`, `normaliseDesignContext`, `DESIGN_TYPES`, `BACKGROUND_STYLES` |
| `modules/design/image-operations.js` | validazione delle operazioni | `parseOperations`, `assertCropFits`, `resolveResize`, `normaliseFormat`, `OUTPUT_FORMATS`, `IMAGE_LIMITS` |
| `backend/llm-classifier.js` | seconda fase per le ragioni ambigue | `createLlmClassifier({apiBase, apiKey, model, timeoutMs})` → `configured`, `classify` |
| `backend/services/interaction-service.js` | orchestra riflessione, politica, memoria, suggerimenti | `interact`, `suggestionsFor`, `savePreference`, `addCorrection`, `standingFor`, `memoryFor`, `deleteRecord`, `clearMemory` |
| `backend/services/image-service.js` | crop, resize, rotate, conversione | `createImageService(limits)` → `transform` |
| `backend/storage/file-adapter.js` | adattatore sincrono su file con scritture atomiche | `createFileAdapter({directory})`, `fileNameForKey`, `StorageError` |

### 8.3 Dati e categorie

Il profilo è un record della categoria `interaction` con contenuto `friendliness_standing`:
livello, effort, sblocco degli accenti, ultima decisione, messaggi in sospeso, data. La
valutazione della ragione è un record `knowledge` con esito, confidenza, metodo e parole
corrispondenti; **la ragione grezza resta solo nella preferenza**, dove era già prevista.

Le scritture sono atomiche (file temporaneo + rename). Ogni utente ha un file separato. Un file
illeggibile produce `503 storage_unavailable`.

### 8.4 Decisioni nuove

| Decisione | Motivo | Alternativa scartata |
|---|---|---|
| Regole dichiarate prima, LLM solo per gli ambigui | il percorso comune resta offline, deterministica e verificabile; il modello non viene chiamato senza motivo | chiamare sempre il modello, che avrebbe reso ogni interazione dipendente da una chiave e da un servizio esterno |
| Una decisione LLM sotto confidenza 0.5 resta indecisa | un giudizio incerto non deve punire l'utente con un profilo not friendly | accettare qualunque verdetto del modello, anche con confidenza quasi nulla |
| I pattern lessicali restano in inglese | sono la lingua delle regole originali e del codice; tradurli avrebbe introdotto una seconda fonte di verità | fingere che le regole capiscano l'italiano: senza il modello, una ragione italiana resta `needs_review` |
| Nessuna scrittura senza `consent: true`, anche per il profilo | è la regola non negoziabile del progetto | salvare il profilo automaticamente perché il creatore ha detto "store the data", che avrebbe violato la regola sul consenso |
| Una ragione indecisa non cambia il profilo | un caso dubbio non deve essere trattato come personale | classificare per esclusione, che avrebbe punito una ragione solo perché ambigua |
| 5 suggerimenti friendly, 2 not friendly | traduce "lesser graphic suggestions" in un numero verificabile, modificabile nello standard | un numero scelto nel codice, non revisionabile senza toccare il programma |
| Gli sfondi rosso/giallo restano un accento | il testo chiede che i suggerimenti tendano ai cinque colori; l'accento soddisfa anche il caso cogente | sfondi interamente rossi o gialli, che avrebbero contraddetto la richiesta dei cinque colori |
| Suggerimenti come CSS + SVG, non immagini generate | sono ispezionabili, deterministici e testabili; non esiste un modello di image generation in questo progetto | simulare immagini generate, che sarebbe stato dichiarare una capacità inesistente |
| Immagini in base64 nel JSON | Node non offre multipart; una dipendenza in più non risolveva un problema di questa fase | parsing multipart scritto a mano, più codice non necessario |
| Solo png, jpeg e bmp | sono i formati verificati dai test; l'ingresso è controllato dai byte iniziali | dichiarare gif, tiff o webp senza test che li coprano |

### 8.5 Limiti del backend

1. **Nessuna autenticazione:** chi raggiunge il server può usare qualsiasi `userId`. Ascolto su
   `127.0.0.1` per default; non esporre senza autenticazione, autorizzazione, rate limiting e HTTPS.
2. **Frontend non collegato:** le API sono documentate in `docs/backend-api.md`, ma l'interfaccia
   continua a leggere e scrivere `localStorage`.
3. **Qualità del giudizio non misurata:** non esiste un insieme etichettato di ragioni; le soglie
   sono una convenzione. Il modello LLM è testato con un endpoint simulato, non con una chiave reale.
4. **Nessun modello di image generation:** i suggerimenti sono specifiche CSS/SVG.
5. **Nessuna transazione tra processi:** due server che scrivono lo stesso utente possono
   sovrascriversi. Un solo processo per cartella dati è il caso supportato.
6. **Nessuna latenza misurata sotto carico** per le API, e nessun limite di frequenza.
7. **Le regole lessicali sono in inglese.** Una ragione scritta in italiano che non contiene i
   pattern dichiarati resta `needs_review`; senza una chiave LLM non viene classificata e non
   viene salvata.
