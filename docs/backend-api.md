# ChatMT — Backend (API, regole e limiti)

- **Stato:** implementato e verificato il 28 ottobre 2026
- **Ambito:** solo backend. Il frontend esistente non è stato modificato e continua a usare
  `localStorage`; il collegamento dell'interfaccia a queste API è un passo successivo.
- **Test:** 87 test automatici superati (41 esistenti + 2 nuovi sulla memoria + 44 nei nuovi file), 47 controlli nel browser
  rieseguiti sul frontend invariato.
- **Linguaggio:** codice e identificativi in inglese, documentazione in italiano, come nel resto
  del progetto.

---

## 1. Cosa aggiunge il backend

Il prototipo della fase 2 calcolava distanze di colore e memorizzava preferenze nel browser.
Il backend aggiunge ciò che il browser non poteva fare da solo:

| Funzione | Dove |
|---|---|
| Memoria condivisa su disco, separata per utente | `backend/storage/file-adapter.js` |
| Giudizio della ragione per rosso e giallo (regole + modello linguistico) | `modules/reflection/reason-assessment.js`, `backend/llm-classifier.js` |
| Profilo *friendly / not_friendly*, displeasure e spiegazione differita | `modules/policy/standing-engine.js` |
| Suggerimenti di sfondi tendenti ai cinque colori, ridotti per il profilo non friendly | `modules/policy/design-suggestions.js` |
| Ritaglio, ridimensionamento, rotazione e conversione formato | `backend/services/image-service.js` |
| API HTTP senza framework, con validazione ed errori espliciti | `backend/server.js` |

Le regole nuove non sono state inventate dal codice: vengono dai messaggi del creatore del
28 ottobre 2026 ed è stata scritta una versione leggibile da una macchina in
`standards/colour-meanings.json`.

---

## 2. Avvio

```bash
cd ChatMT
npm install          # una sola dipendenza: jimp, per le immagini
npm start            # node backend/server.js
# http://127.0.0.1:3080/api/health
```

In sviluppo, con dati in una cartella temporanea e porta diversa:

```bash
PORT=3099 CHATMT_DATA_DIR=./data-dev npm start
```

Il frontend resta servito a parte:

```bash
python -m http.server 8000
# http://localhost:8000/frontend/
```

L'immagine Docker esistente serve solo il frontend statico: non avvia Node. Il backend va
avviato con `npm start` (o con un'immagine Node dedicata, non inclusa in questa fase).

---

## 3. Configurazione

Nessuna variabile è obbligatoria. Un valore non valido ferma il server all'avvio invece di
essere sostituito in silenzio.

| Variabile | Default | Uso |
|---|---|---|
| `PORT` o `CHATMT_PORT` | `3080` | porta HTTP (`0` = porta scelta dal sistema) |
| `CHATMT_HOST` | `127.0.0.1` | interfaccia di ascolto |
| `CHATMT_DATA_DIR` | `./data` | cartella dei profili JSON |
| `CHATMT_ALLOWED_ORIGINS` | `http://localhost:8000`, `http://127.0.0.1:8000`, `http://localhost:8080`, `http://127.0.0.1:8080` | origini CORS ammesse; `*` ammette tutte |
| `CHATMT_MAX_BODY_BYTES` | `12582912` (12 MiB) | limite del corpo JSON |
| `CHATMT_MAX_IMAGE_BYTES` | `8388608` (8 MiB) | limite dell'immagine decodificata |
| `CHATMT_MAX_IMAGE_DIMENSION` | `8000` | limite per lato dell'immagine |
| `CHATMT_MAX_IMAGE_PIXELS` | `40000000` | limite dei pixel totali |
| `CHATMT_LLM_API_BASE` o `ZAI_API_BASE` | assente | endpoint OpenAI-compatible, senza `/chat/completions` finale |
| `CHATMT_LLM_API_KEY` o `ZAI_API_KEY` | assente | chiave del modello, solo sul server |
| `CHATMT_LLM_MODEL` o `ZAI_MODEL` | `glm-4-flash` | nome del modello |
| `CHATMT_LLM_TIMEOUT_MS` | `6000` | timeout della chiamata al modello |

La chiave non viene mai restituita dall'API, non viene scritta nei dati e non compare nei log.
Non esiste un file `.env` caricato automaticamente: le variabili vanno esportate nella shell.

---

## 4. Regole implementate

### 4.1 Significati dei colori

| Colore | Significato registrato | Trattamento |
|---|---|---|
| green | prosperity and peace | incoraggiato |
| blue | abundance | incoraggiato |
| orange | joy and happiness | incoraggiato |
| indigo | victory | incoraggiato |
| violet | safety | incoraggiato |
| red | danger or royalty | interrogato |
| yellow | anger or determination | interrogato |

Magenta e purple non hanno un significato nei messaggi del creatore: il sistema lo dichiara
(`noMeaningRecorded`) e **non ne inventa uno**.

### 4.2 Ragione personale o cogente

Per rosso e giallo la domanda del codice standard resta. La risposta viene classificata:

| Esito | Come viene deciso | Effetto |
|---|---|---|
| `personal` | regole dichiarate: gusto, "mi piace e basta", colore preferito, nessun motivo | profilo `not_friendly`; 2 suggerimenti brevi; nessun accento rosso/giallo; displeasure e spiegazione alla interazione successiva |
| `cogent` | regole dichiarate: significato, scopo, pubblico, marca, contrasto, contesto di design | profilo `friendly`; 5 suggerimenti completi; accento rosso/giallo sbloccato |
| `needs_review` | le regole non decidono e il modello linguistico non è configurato, fallisce, resta incerto o ha confidenza sotto 0.5 | nessun profilo e nessuna preferenza salvati; si chiede una ragione più concreta |

Le regole sono in `modules/reflection/reason-assessment.js`, con pesi e soglie dichiarati
(`DECISION_THRESHOLDS`). Non sono una misura linguistica: sono una convenzione del progetto,
scritta per poter essere verificata e modificata.

I pattern lessicali sono **in inglese**, la lingua del codice e delle regole originali. Una
ragione scritta in italiano che non contiene quei pattern resta `needs_review`: se il modello
linguistico è configurato viene passata a quello, altrimenti non viene classificata e non viene
salvata. Non esiste una traduzione automatica delle regole.

### 4.3 Profilo e assistenza

- Il profilo nasce `friendly`.
- Una ragione personale lo porta a `not_friendly`; resta così anche scegliendo green, blue,
  orange, indigo o violet, finché non arriva una ragione cogente per rosso o giallo.
- `not_friendly` significa 2 suggerimenti invece di 5 e descrizioni brevi invece che complete.
- La displeasure e la spiegazione delle meno suggerimenti vengono consegnate **una sola volta**,
  alla prima interazione successiva, e poi non si ripetono. Lo stato resta visibile in
  `GET /api/users/:id/standing`.
- Gli sfondi tendenti a rosso o giallo sono offerti solo dopo una ragione cogente. Restano
  comunque composti da almeno due dei cinque colori incoraggiati più un accento.

### 4.4 Interpretazioni registrate

Queste sono le scelte fatte dove il testo del creatore lasciava spazio. Sono dichiarate qui
perché possano essere corrette, non perché siano le uniche possibili.

| Domanda | Scelta | Motivo |
|---|---|---|
| Il consenso serve anche per il profilo? | sì | la regola del progetto vieta scritture senza consenso esplicito. Senza consenso la risposta viene calcolata, ma profilo e preferenza non vengono salvati e la displeasure non potrà arrivare alla interazione successiva |
| "Lesser effort" quanto vale? | 2 suggerimenti invece di 5, dettaglio breve | è un numero verificabile e modificabile in `standards/colour-meanings.json` |
| Una ragione cogente per rosso sblocca anche il giallo? | sì | il testo dice "yellow and red ... for users who give a cogent reason for choosing yellow or red" |
| Il profilo torna friendly scegliendo un colore incoraggiato? | no | il testo lega il ritorno a una ragione cogente per rosso o giallo |
| La displeasure si ripete? | no, una volta | "when next the users ... engages the app" indica la prima interazione successiva |
| Un motivo assente è personale? | no | senza risposta la domanda resta aperta: nessun profilo viene toccato |
| "majesta" e i colori senza significato? | nessun significato inventato | il file dei significati copre solo i colori elencati dal creatore |

---

## 5. Flusso di una interazione

```
POST /api/interactions
   |
   +--> memoria su disco dell'utente
   |       +--> messaggi in sospeso (displeasure / spiegazione) consegnati e marcati
   |
   +--> Reflection Engine: colore scelto vs 9 codici standard
   |       +--> risposta: regola, misura, incertezza, memoria
   |
   +--> se il colore è rosso o giallo e c'è una ragione:
   |       +--> regole dichiarate
   |       +--> solo se indecise: modello linguistico (se configurato)
   |       +--> profilo friendly / not_friendly
   |
   +--> suggerimenti: 5 o 2, sempre tendenti ai cinque colori
   |
   +--> scrittura solo con consent: true
```

---

## 6. Endpoint

Base: `http://127.0.0.1:3080`. Tutte le risposte sono JSON. Gli errori hanno la forma
`{"error":{"code":"...","message":"..."}}`.

| Metodo | Percorso | Scopo |
|---|---|---|
| GET | `/api/health` | stato, standard caricati, LLM configurato o no |
| GET | `/api/standards` | i due file standard completi |
| GET | `/api/palette` | i 15 colori con copertura, significato, incoraggiato/interrogato |
| GET | `/api/meanings` | i cinque colori, rosso/giallo, colori senza significato, politiche e risposta alla domanda sul bias |
| POST | `/api/interactions` | l'interazione principale |
| GET | `/api/users/:userId/standing` | profilo e messaggi in sospeso (anteprima, non consuma) |
| GET | `/api/users/:userId/memory` | record dell'utente, `?includeExpired=1` per includere scaduti |
| POST | `/api/users/:userId/preferences` | salvataggio diretto di una preferenza, con la stessa politica |
| POST | `/api/users/:userId/corrections` | correzione di una risposta, record separato |
| DELETE | `/api/users/:userId/memory/:recordId` | elimina un record |
| DELETE | `/api/users/:userId/memory` | elimina tutti i record dell'utente |
| POST | `/api/design/suggestions` | suggerimenti senza salvare nulla |
| POST | `/api/design/transform` | crop, resize, rotate, conversione |

`userId` deve corrispondere a `[A-Za-z0-9_-]{1,64}`.

### 6.1 `POST /api/interactions`

Richiesta:

```json
{
  "userId": "local-user",
  "colour": { "name": "red" },
  "reason": "Rappresenta il pericolo sull'etichetta del nostro prodotto",
  "consent": true,
  "design": { "type": "flyer", "subject": "Serata jazz", "audience": "studenti" }
}
```

- `colour`: `{ "name": "..." }` oppure `{ "hex": "#RRGGBB" }`, deve appartenere alla tavolozza.
- `reason`: solo per rosso e giallo; stringa fino a 1000 caratteri.
- `consent`: `true` per salvare; assente o `false` per non salvare nulla.
- `design`: opzionale. Tipi: `flyer`, `poster`, `social_post`, `banner`, `background`.
  Senza `design` viene usato un flyer.

Risposta (campi principali):

| Campo | Contenuto |
|---|---|
| `input` | nome e HEX risolti |
| `answer` | risposta del motore esistente, più `storage`, `reasonAssessment`, `standingMessages`, `policyNotice` |
| `reasonAssessment` | esito, confidenza, metodo (`rules` / `llm` / `none`), punteggi, parole corrispondenti, spiegazione, stato LLM |
| `profile` | livello, effort, limite suggerimenti, sblocco rosso/giallo, ultima decisione, messaggi in sospeso, `why`, `decision.applied` |
| `standingMessages` | displeasure e spiegazione dovute a questa interazione (vuoto se non ancora dovute o già consegnate) |
| `designSuggestions` | `design`, `assistance` (limite, nota, blocco rosso/giallo) e `suggestions` (CSS + SVG) |
| `stored` | identificativi di preferenza, profilo e valutazione; `null` se non salvati |

Esempio di risposta personale alla prima interazione: `standingMessages` è vuoto e
`profile.level` è `not_friendly`. Alla interazione successiva `standingMessages` contiene
`personal-reason-displeasure` e `reduced-assistance-explanation`.

Estratto della risposta (non tutti i campi, ma JSON valido):

```json
{
  "userId": "local-user",
  "input": { "colourName": "red", "hex": "#FF0000" },
  "reasonAssessment": {
    "verdict": "personal",
    "confidence": 0.7,
    "method": "rules",
    "scores": { "cogent": 0, "personal": 3 }
  },
  "profile": {
    "level": "not_friendly",
    "effort": "reduced",
    "suggestion_limit": 2,
    "allow_questioned_colours": false,
    "decision": { "verdict": "personal", "applied": true }
  },
  "standingMessages": [],
  "stored": {
    "preferenceId": "id-preference",
    "standingRecordId": "id-standing",
    "assessmentRecordId": "id-assessment"
  }
}
```

### 6.2 `GET /api/users/:userId/standing`

```json
{
  "userId": "local-user",
  "profile": {
    "level": "not_friendly",
    "effort": "reduced",
    "suggestion_limit": 2,
    "detail": "brief",
    "allow_questioned_colours": false,
    "last_decision": { "colour_name": "red", "verdict": "personal" },
    "pending": { "displeasure": false, "effort_explanation": false },
    "why": "..."
  },
  "pendingMessages": [],
  "hasStoredProfile": true
}
```

`pendingMessages` è un'anteprima: leggerla non consuma i messaggi. Solo una interazione li
consegna e li marca come consegnati.

### 6.3 Memoria e correzioni

```bash
# preferenza diretta (stessa politica delle interazioni)
curl -s -X POST http://127.0.0.1:3080/api/users/local-user/preferences \
  -H 'Content-Type: application/json' \
  -d '{"colour":{"name":"blue"},"consent":true}'

# correzione: non modifica lo standard
curl -s -X POST http://127.0.0.1:3080/api/users/local-user/corrections \
  -H 'Content-Type: application/json' \
  -d '{"hex":"#0000FF","proposedOutcome":"question","note":"...","consent":true}'
```

Senza `consent: true` la risposta è `403 consent_required`. Per rosso e giallo la preferenza
direzionale richiede `reason`; se la ragione resta indecisa la risposta è
`400 reason_unclear` e non viene scritto nulla.

### 6.4 `POST /api/design/suggestions`

```json
{
  "userId": "local-user",
  "colour": { "name": "green" },
  "design": { "type": "poster", "subject": "Concerto", "audience": "famiglie" }
}
```

Restituisce gli stessi suggerimenti dell'interazione, senza scrivere memoria. Un profilo
`not_friendly` riceve 2 suggerimenti brevi; uno `friendly` ne riceve 5. L'ultimo suggerimento di
un profilo sbloccato porta un accento rosso o giallo.

### 6.5 `POST /api/design/transform`

L'immagine viaggia in base64 dentro il JSON (niente multipart: Node non lo offre e non è stata
aggiunta una dipendenza per questo). Formati di ingresso ammessi: **png, jpeg, bmp**, verificati
dai byte iniziali. Formati di uscita: **png, jpeg, bmp**; default `png`.

```json
{
  "image": "data:image/png;base64,...",
  "operations": [
    { "type": "crop", "x": 10, "y": 10, "width": 400, "height": 300 },
    { "type": "resize", "width": 800 },
    { "type": "rotate", "degrees": 90 }
  ],
  "format": "jpeg"
}
```

Risposta:

```json
{
  "format": "jpeg",
  "mime": "image/jpeg",
  "source": { "width": 1200, "height": 800, "format": "png" },
  "width": 600,
  "height": 800,
  "bytes": 48213,
  "operations": [ ... ],
  "image": "data:image/jpeg;base64,..."
}
```

Regole:

- massimo 10 operazioni;
- `crop` controllato contro le dimensioni **in quel punto** della sequenza;
- `resize` con un solo lato conserva le proporzioni;
- `rotate` solo 90, 180 o 270 gradi;
- limiti di byte, lato e pixel da configurazione;
- nessun ridimensionamento oltre 8000 px per lato.

### 6.6 Codici di errore

| Stato | Codici |
|---|---|
| 400 | `invalid_json`, `invalid_request`, `invalid_user_id`, `invalid_record_id`, `colour_required`, `unknown_colour`, `colour_mismatch`, `invalid_colour`, `invalid_consent`, `invalid_reason`, `reason_too_long`, `reason_required`, `reason_unclear`, `invalid_operation`, `too_many_operations`, `crop_out_of_bounds`, `invalid_format`, `invalid_image` |
| 403 | `consent_required` |
| 404 | `not_found`, `record_not_found` |
| 405 | `method_not_allowed` |
| 413 | `payload_too_large`, `image_too_large` |
| 503 | `storage_unavailable` |
| 500 | `internal_error` |

---

## 7. Modello linguistico (solo per i casi ambigui)

Il percorso normale è offline: le regole dichiarate decidono i casi chiari. Il modello viene
chiamato **solo** quando le regole restituiscono `needs_review` e una chiave è configurata.

Il backend parla il protocollo OpenAI-compatible (`POST {base}/chat/completions`). Il provider
raccomandato è **Z.ai** (modelli GLM, endpoint compatibile, chiave gratuita disponibile), ma
qualunque endpoint compatibile funziona:

```bash
# esempio: Z.ai
export ZAI_API_BASE="https://api.z.ai/api/paas/v4"
export ZAI_API_KEY="..."
export ZAI_MODEL="glm-4-flash"
npm start
```

Comportamento dichiarato:

- senza chiave: `reasonAssessment.llm.status === "not_configured"`, esito `needs_review`,
  niente viene salvato;
- con chiave ma errore o timeout: `llm.status === "failed"` con il codice, esito
  `needs_review`, niente viene salvato;
- con risposta valida: `reasonAssessment.method === "llm"` e la confidenza restituita dal
  modello viene registrata; una decisione con confidenza inferiore a **0.5** viene trattata
  come indecisa (`llm.status === "low_confidence"`), per non punire un utente su un giudizio
  incerto;
- la ragione viene inviata al provider **solo** in questo caso: è un dato che esce dal
  dispositivo, e va detto all'utente prima di configurare la chiave;
- se il provider rifiuta `response_format: {"type":"json_object"}` o restituisce un corpo non
  conforme, la chiamata fallisce e la ragione resta indecisa: non c'è un ripiego silenzioso a
  una classificazione inventata.

La qualità del classificatore LLM **non è stata misurata** su un insieme etichettato: i test
usano un endpoint simulato. La chiamata reale a Z.ai non è stata eseguita in questa sessione
perché non era disponibile una chiave.

---

## 8. Dati su disco

Ogni utente ha un file:

```
data/chatmt.memory.<userId>.json
```

Contiene `{ version, userId, records }`. Le scritture sono atomiche (file temporaneo + rename).
Un file illeggibile produce `503 storage_unavailable`, non una memoria vuota.

Categorie usate dal backend:

| Categoria | Contenuto |
|---|---|
| `preference` | colore scelto, nome, ragione |
| `correction` | correzione di una risposta (non modifica lo standard) |
| `interaction` | profilo `friendliness_standing` con livello, pending e ultima decisione |
| `knowledge` | valutazione `colour_reason_assessment` (esito, confidenza, metodo, parole corrispondenti) |

`conversational` resta dichiarata e non usata: non esiste ancora una conversazione.

---

## 9. Privacy e sicurezza

- Nessuna scrittura senza `consent: true`, applicato nel Memory Engine e nell'API.
- I file sono separati per utente e il nome del file deriva dall'identificativo validato.
- La chiave del modello resta sul server e non viene restituita.
- CORS limitato alle origini configurate.
- Ascolto predefinito su `127.0.0.1`: il server non è raggiungibile dalla rete locale se non
  cambiando `CHATMT_HOST`.
- **Non esiste autenticazione.** Chi può raggiungere il server può leggere e scrivere il
  profilo di qualsiasi `userId`. È accettabile solo su localhost; prima di esporlo servono
  autenticazione, autorizzazione per profilo, rate limiting e HTTPS.
- Nessun log del contenuto delle ragioni: gli errori 5xx registrano metodo, percorso, codice e
  messaggio, non il corpo della richiesta.

---

## 10. Cosa il backend non fa

Dichiarato per non promettere ciò che non è stato costruito:

1. **Non collega il frontend.** Le API sono pronte e documentate; `frontend/js/app.js` continua
   a usare `localStorage`.
2. **Non genera immagini con un modello.** I suggerimenti sono specifiche deterministiche
   (CSS + SVG), non fotografie né rendering. Non c'è un modello di image generation.
3. **Non è un editor grafico completo.** Fa crop, resize, rotazione a quarti di giro e
   conversione png/jpeg/bmp. Non fa livelli, testi, filtri, maschere, webp o gif in uscita.
4. **Non capisce il linguaggio.** Le regole lessicali non sono comprensione del testo; il
   modello linguistico è usato solo per la classificazione binaria della ragione, non per
   conversare.
5. **Non addestra alcun modello.** I profili sono record scritti e riletti, non pesi aggiornati.
6. **Non misura la qualità del giudizio.** Non esiste un insieme etichettato di ragioni
   personali/cogenti: accuratezza e richiamo non sono misurati. Le soglie sono una convenzione.
7. **Non gestisce più dispositivi in concorrenza in modo transazionale.** Le scritture sono
   atomiche per file, ma due processi che scrivono lo stesso utente possono sovrascriversi.
8. **Non è pronto per la produzione.** Manca autenticazione, HTTPS, rate limiting, backup e
   rotazione dei dati.

---

## 11. Test misurati

Eseguiti il 28 ottobre 2026 su Windows, Node.js v26.5.0.

| Comando | Risultato |
|---|---|
| `node tests/run-tests.mjs` | **87/87** test superati |
| `node tests/browser-checks.mjs http://127.0.0.1:8123/frontend/index.html` | **47/47** controlli superati (frontend invariato) |

I 46 test nuovi coprono:

- `tests/reason-policy.test.mjs` — significati, regole personali/cogenti, negazioni, casi
  ambigui, transizioni del profilo, consegna una sola volta di displeasure e spiegazione;
- `tests/design-suggestions.test.mjs` — 5 vs 2 suggerimenti, solo colori incoraggiati, accento
  rosso/giallo solo con ragione cogente, determinismo, validazione delle operazioni immagine;
- `tests/backend.test.mjs` — server HTTP reale su porta effimera, health, interazioni,
  persistenza tra due istanze del server, isolamento tra utenti, memoria e consenso, errori,
  LLM simulato (incluso il fallimento e la confidenza bassa), crop/resize/rotate e conversione png/jpeg/bmp,
  rifiuto di gif e di immagini non decodificabili;
- `tests/memory.test.mjs` — due test aggiunti per `addRecord`, `latestRecord` e
  `updateContent`, i metodi generici usati dal backend per profilo e valutazioni.

Non misurati: accuratezza del classificatore su dati reali, latenza sotto carico, consumo di
risorse, e qualità dei suggerimenti grafici percepita da persone.

---

## 12. Prossimi passi possibili

1. Collegare il frontend alle API (sostituendo l'adapter `localStorage` con `fetch`).
2. Aggiungere autenticazione e autorizzazione per profilo prima di esporre il server.
3. Costruire un insieme etichettato di ragioni per misurare precisione e richiamo delle regole
   e del modello.
4. Aggiungere anteprima e download dei suggerimenti SVG nel frontend.
5. Valutare un editor grafico più ampio come fase separata, con requisiti e test propri.
