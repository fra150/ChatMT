# ChatMT — Architettura (Fase 2: motore delle preferenze cromatiche)

- **Stato:** implementata e verificata (41 test unitari + 47 controlli nel browser)
- **Data:** 26 ottobre 2026
- **Ambito:** confronto di un colore scelto dalla tavolozza con i codici standard, memoria delle preferenze, correzioni

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
| HTML + CSS + JavaScript vanilla, nessuna dipendenza, nessun passo di build | il creatore conosce HTML e CSS; il primo modulo è aritmetica deterministica; il §6 del brief chiede componenti semplici e verificabili | framework frontend, che avrebbe aggiunto dipendenze e un passo di build senza risolvere alcun problema di questa fase |
| Nessun backend | non serve a questa fase: la memoria locale basta. Un backend diventa necessario solo per la memoria condivisa, un modello linguistico via API, immagini e audio | server Python fin dall'inizio, che avrebbe aggiunto codice non verificabile in questa fase |
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
- **Memoria** — le categorie `conversational`, `knowledge` e `interaction` sono già previste nello schema; andranno scritte quando esisterà un contenuto da conservare.
- **Backend** — necessario quando la memoria dovrà essere condivisa tra dispositivi o quando servirà una chiave API che non può stare nel browser.

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
- Nessun dato lascia il dispositivo: in questa versione non esiste alcun server e nessuna chiave API.
- Se l'archivio è illeggibile, il sistema **solleva un errore** invece di mostrare una memoria vuota: un dato danneggiato non deve sembrare un dato assente.
