# ChatMT — Test e risultati misurati (Fase 2 e backend)

Ogni numero in questo documento è stato prodotto eseguendo il comando indicato su questa macchina.
Nessun risultato è stimato. Dove una metrica non è stata misurata, è scritto che non è stata misurata.

- **Data delle esecuzioni:** 26 ottobre 2026 (frontend) e 28 ottobre 2026 (backend)
- **Ultima esecuzione completa:** 28 ottobre 2026 — **87/87** test automatici, **47/47**
  controlli nel browser, `npm start` verificato su una porta temporanea
- **Ambiente:** Windows, Node.js v26.5.0, Python 3.13, Chrome 156, Docker 29.9.2

---

## 1. Come si eseguono

| Comando | Cosa serve | Cosa verifica |
|---|---|---|
| `node tests/run-tests.mjs` (o `npm test`) | Node.js e `jimp` (unica dipendenza) | la logica e il backend: spazio colore, CIEDE2000, bande, memoria, riflessione, risposte, regole della ragione, profilo, suggerimenti, immagini, API HTTP |
| `npm start` + richieste HTTP | Node.js e `jimp` | il server reale avviato con lo script di produzione: health, interazioni, memoria su disco, trasformazioni |
| `python -m http.server 8000` + `node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html` | server HTTP in esecuzione e Chrome installato | l'interfaccia reale: 47 controlli sul DOM di un browser vero |
| `docker build -t chatmt .` + `docker run --rm -p 8080:80 chatmt` | Docker | che il container serva il frontend statico (non avvia Node) |

I livelli sono complementari: i test automatici non vedono l'interfaccia, e i controlli nel browser non verificano i dati di riferimento della formula CIEDE2000 né il backend.

---

## 2. Test automatici (`tests/run-tests.mjs`)

### 2.1 `tests/color-engine.test.mjs`

| Test | Cosa dimostra |
|---|---|
| riproduzione delle 34 coppie pubblicate | la formula CIEDE2000 implementata coincide con i dati supplementari pubblicati con la formula stessa, entro 1e-4 |
| simmetria e distanza zero | la formula dà lo stesso valore scambiando i due colori, e 0 per colori uguali |
| bianco contro nero | la distanza è esattamente 100, cioè l'intera scala di luminosità |
| sRGB → CIELAB | bianco ≈ (100, 0, 0), nero esatto, rosso `#FF0000` ≈ (53.24, 80.09, 67.20) entro 0.05; l'asse b* separa il blu (negativo) dal giallo (positivo) |
| analisi del codice HEX | `#RGB` e `#RRGGBB` accettati; `#GGGGGG`, `#12345`, `rgb(0,0,0)`, `blue`, stringa vuota, `null`, numeri e oggetti rifiutati con errore esplicito |
| rappresentazione strutturata | HEX, RGB e CIELAB coerenti tra loro |
| colori identici e diversi | distanza 0 e banda "identical"; distanza positiva e simmetrica tra verde e porpora |
| bande di distanza | ordinate, coprono ogni valore, i confini sono verificati uno per uno, i valori negativi e `NaN` sollevano un errore |

**Fonte dei dati di riferimento:** G. Sharma, W. Wu, E. N. Dalal, *The CIEDE2000 Color-Difference
Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations*, Color
Research and Application, vol. 30, no. 1, pp. 21-30, febbraio 2005. I 34 valori usati nei test
sono copiati dal file ufficiale in formato testo pubblicato dagli autori
(`ciede2000testdata.txt`), non scelti da noi.

### 2.2 `tests/memory.test.mjs`

| Test | Cosa dimostra |
|---|---|
| consenso obbligatorio | senza `consent: true` la scrittura è rifiutata con `ConsentRequiredError` e la memoria resta vuota |
| campi del record | il record contiene tutti i campi richiesti dal §3 del brief, con i valori attesi |
| risposta alla domanda | la risposta dell'utente alla domanda di una regola viene conservata con la preferenza |
| persistenza | un secondo `MemoryStore` sullo stesso archivio ritrova il record |
| recupero | per identificativo, per categoria e per correzioni di uno specifico colore |
| separazione tra utenti | i dati di un utente non compaiono per un altro; cancellare un utente non tocca l'altro |
| aggiornamento | l'identificativo e `created_at` restano, `updated_at` cambia, il valore è persistito |
| sostituzione di una preferenza | cambiano colore, nome, risposta e stato di conferma |
| eliminazione | `delete` restituisce `true`/`false` e il record non è più recuperabile |
| cancellazione totale | `clear()` restituisce il numero di record rimossi e la voce sparisce dall'archivio |
| scadenza | un record con `expires_at` nel passato non viene più usato come contesto, ma è ancora presente con `includeExpired` |
| input non valido | colore non valido, esito di correzione vuoto, archivio illeggibile → errori espliciti |
| record generici | `addRecord` richiede consenso, una categoria dichiarata e un contenuto oggetto; `latestRecord` filtra per categoria e tipo |
| aggiornamento del contenuto | `updateContent` unisce i campi, conserva id e `created_at` e aggiorna `updated_at` |

Nota: nei test il tempo e gli identificativi sono iniettati (`now`, `idFactory`), quindi nessun test dipende dalla data reale né da un UUID generato.

### 2.3 `tests/reflection.test.mjs`

| Test | Cosa dimostra |
|---|---|
| le 9 regole della fonte | il file standard mantiene 7 regole `accepted` e 2 `question`; "majesta" è magenta `#FF00FF` |
| input corrispondente | la regola viene individuata con il suo identificativo, il testo originale e la distanza |
| regole che pongono una domanda | rosso e giallo portano con sé la domanda del file originale |
| input senza standard | viene dichiarato "non coperto" con incertezza alta e una motivazione scritta; il colore standard più vicino viene riportato come misura |
| tipi non implementati | testo, immagine, audio e tipi mancanti sollevano `UnsupportedInputError` invece di essere interpretati |
| colore non valido | `InvalidColourError` prima di qualsiasi altro effetto |
| etichetta contro valore | `green` con valore `#2ECC71` produce una contraddizione `label-value-mismatch` e incertezza media |
| confronto con la preferenza | il confronto con la preferenza memorizzata è calcolato e **la preferenza non viene sovrascritta** |
| selezione identica | distanza esattamente 0 e banda "identical" |
| contesto di un altro utente | non viene mai usato come contesto |
| correzione contro standard | la contraddizione è segnalata senza modificare lo standard |
| record non confermato | non viene trattato come preferenza stabile |
| memoria non conforme | un oggetto memoria senza l'interfaccia attesa viene rifiutato |
| risposta per colore accettato | regola, misura, giudizio, dati usati, possibilità di memorizzare |
| risposta per colore da interrogare | la domanda del file originale viene posta e la memorizzazione è bloccata |
| risposta per colore non coperto | l'incertezza è dichiarata e la memorizzazione è ammessa solo come osservazione non confermata |
| risposta senza preferenza | il sistema dichiara di non avere nulla con cui confrontare, invece di inventare un confronto |
| assenza di segnaposto | nessun `undefined` o `NaN` finisce nel testo della risposta |
| tutti i colori della tavolozza | 15 colori producono tutti una risposta completa senza errori |

### 2.4 `tests/reason-policy.test.mjs` (14 test)

| Test | Cosa dimostra |
|---|---|
| standard dei significati | cinque colori incoraggiati, rosso e giallo interrogati, limiti 5/2 |
| colori senza significato | magenta e purple sono dichiarati senza significato, non interpretati |
| spiegazione del bias | contiene "danger or royalty" e "anger or determination" |
| ragione personale | "mi piace e basta", colore preferito, nessun motivo, gusto personale → `personal` |
| ragione cogente | significato, marca, pubblico, contrasto, contesto di design → `cogent` |
| negazione | "non mi piace solo perché..." non viene contata come ragione personale |
| ragione ambigua o assente | resta `needs_review`; una ragione assente non è trattata come personale |
| transizioni del profilo | personale → `not_friendly` e 2 suggerimenti; cogente → `friendly`, 5 suggerimenti e accento sbloccato |
| consegna una sola volta | la displeasure e la spiegazione compaiono alla prima interazione successiva e non si ripetono |
| profilo danneggiato | un `not_friendly` con `allow_questioned_colours` forzato non sblocca gli accenti |

### 2.5 `tests/design-suggestions.test.mjs` (11 test)

| Test | Cosa dimostra |
|---|---|
| profilo friendly | 5 suggerimenti, tutti composti solo dai cinque colori, con CSS e SVG |
| determinismo | lo stesso input produce esattamente lo stesso output |
| profilo not friendly | 2 suggerimenti, dettaglio breve, nota di assistenza ridotta, nessun accento |
| ragione cogente | il quinto suggerimento porta un accento rosso/giallo e almeno due colori incoraggiati |
| accento coerente | l'accento segue il colore della ragione cogente, non quello del design |
| tipi di design | flyer, poster, social post, banner e background mantengono le proprie dimensioni |
| validazione | tipo sconosciuto, oggetto troppo lungo e campi non testuali sono rifiutati |
| operazioni immagine | crop, resize con proporzioni, rotazione a quarti di giro, formati png/jpeg/bmp e limiti |

### 2.6 `tests/backend.test.mjs` (19 test)

| Test | Cosa dimostra |
|---|---|
| health e standard | standard caricati, LLM non configurato, palette e significati esposti |
| interazione verde | profilo friendly, 5 suggerimenti, preferenza scritta su disco |
| rosso senza ragione | domanda posta, nessuna scrittura, profilo invariato |
| ragione personale | profilo `not_friendly`, 2 suggerimenti, tre record (preferenza, profilo, valutazione) |
| consegna differita | alla interazione successiva arrivano displeasure e spiegazione, una sola volta |
| persistenza | una seconda istanza del server sullo stesso archivio ritrova il profilo |
| ragione cogente | tono friendly, accento rosso/giallo sbloccato |
| ragione ambigua | nessuna scrittura e nessun profilo inventato |
| LLM simulato | viene usato solo per la ragione ambigua; il fallimento e una confidenza sotto 0.5 lasciano `needs_review` |
| suggerimenti HTTP | 2 per il profilo ridotto, 5 per quello esteso, tipo non valido → 400 |
| immagini | crop, resize, rotate, PNG/JPEG/BMP in uscita e JPEG in ingresso |
| errori immagine | crop fuori dai limiti, immagine non decodificabile, GIF rifiutata, formato e operazione non validi |
| memoria | consenso obbligatorio, preferenza, correzione, eliminazione, cancellazione totale |
| routing e validazione | 404, 405, userId non valido, colore fuori tavolozza, JSON non valido, ragione troppo lunga |
| separazione utenti | il profilo di un utente non compare per un altro |
| LLM (unità) | richiesta OpenAI-compatible, JSON stretta, risposte malformate, errori e assenza di chiave |

### Risultato dell'esecuzione

```
node tests/run-tests.mjs
tests 87   pass 87   fail 0   duration_ms 1050
```

87 test superati, 0 falliti. Sono inclusi i 34 confronti CIEDE2000 di riferimento, ciascuno verificato con tolleranza 1e-4. I 44 test nei tre nuovi file sono i 14 di `reason-policy`, gli 11 di `design-suggestions` e i 19 di `backend`; altri 2 test in `memory.test.mjs` coprono i metodi generici usati dal backend.

**Un risultato non ovvio emerso dai test** e conservato come caso di regressione: il colore
`lime` (`#00FF00`) senza standard risulta più vicino a **yellow** (23.40) che a **green**
(34.51). Non è un errore: il valore CSS di `green` è `#008000`, molto più scuro, mentre la tinta
di `lime` e `green` è quasi identica. Il test verifica entrambi i valori, così il risultato non
va perso.

---

## 3. Controlli dell'interfaccia (`tests/browser-checks.mjs`)

47 controlli eseguiti su un Chrome reale pilotato via DevTools Protocol, con asserzioni sul DOM
dopo ogni azione. **Rieseguiti il 28 ottobre 2026 dopo l'aggiunta del backend,** con lo stesso
risultato: il frontend non è stato modificato. Verificano, nell'ordine:

1. la tavolozza mostra 9 colori coperti da uno standard e 6 non coperti, senza errori all'avvio;
2. selezionando `green` la risposta cita il codice `colour-green`, dichiara l'accettazione, mostra la rappresentazione strutturata e **non offre alcuna memorizzazione senza consenso**;
3. dopo il consenso compare il pulsante di salvataggio, la preferenza appare nella memoria come "confirmed", e il confronto successivo riporta distanza zero;
4. la preferenza sopravvive a una ricarica della pagina, mentre **il consenso viene richiesto di nuovo**;
5. selezionando `blue` la risposta confronta con la preferenza memorizzata e propone di **sostituirla** invece di sovrascriverla;
6. selezionando `red` viene posta la domanda del file originale, la memorizzazione è bloccata finché non si risponde, e dopo la risposta il pulsante di sostituzione compare e conserva la risposta data;
7. selezionando `lime` (non coperto) la risposta dichiara che nessuno standard lo copre, l'incertezza è "high", e il pulsante dichiara che il valore sarà memorizzato come **osservazione non confermata**: la memoria lo registra come `unconfirmed`, non come accettato;
8. registrando una correzione la contraddizione `correction-against-standard` viene mostrata con la frase "the standard has not been changed automatically", e la correzione è un record separato;
9. eliminando un record ne sparisce uno solo, e la cancellazione totale svuota la memoria e rimuove la voce da `localStorage`;
10. nessuna eccezione non gestita e nessun errore in console durante tutto il percorso.

### Risultato dell'esecuzione

```
node tests/browser-checks.mjs http://127.0.0.1:8123/frontend/index.html
47/47 browser checks passed
```

**Difetto trovato da questi controlli** e poi corretto: per un colore non coperto da nessuno
standard, quando esisteva già una preferenza il pulsante diceva soltanto "Replace my stored
preference", senza dichiarare che il nuovo valore sarebbe stato memorizzato come osservazione
non confermata. Il pulsante ora lo dichiara in entrambi i casi, e il controllo che lo verifica
è rimasto nel test.

---

## 4. Backend HTTP (28 ottobre 2026)

Oltre ai test dentro `node --test`, il server è stato avviato con lo stesso comando di
produzione (`node backend/server.js`) su una porta e una cartella dati temporanee, e interrogato
con `curl`. I 19 test di `tests/backend.test.mjs` fanno la stessa cosa su una porta scelta dal
sistema e con un archivio temporaneo, quindi la verifica è ripetibile senza servizi esterni.

| Verifica eseguita a mano | Risultato |
|---|---|
| `GET /api/health` | `status: ok`, 9 regole di usage-of-colours, significati v1.0.0, LLM non configurato |
| `POST /api/interactions` con rosso e ragione personale | `verdict: personal`, profilo `not_friendly`, limite 2, 2 suggerimenti, tre identificativi salvati |
| seconda `POST /api/interactions` con violet e senza consenso | due messaggi (`personal-reason-displeasure`, `reduced-assistance-explanation`), profilo ancora `not_friendly`, 2 suggerimenti, nessuna nuova scrittura |
| avvio con `CHATMT_DATA_DIR` temporanea | log: server in ascolto, LLM non configurato, cartella dati dichiarata |

La chiamata reale al provider LLM **non è stata eseguita**: non era disponibile una chiave in
questa sessione. Il percorso ibrido è verificato con un classificatore simulato (risposta valida
e fallimento), non contro il servizio esterno.

---

## 5. Verifica del container Docker

```
docker build -t chatmt:verify .          -> immagine costruita
docker run -d --name chatmt-verify -p 8180:80 chatmt:verify
```

| Verifica | Risultato |
|---|---|
| `GET /` | 302 verso `/frontend/` |
| `GET /frontend/index.html`, `/frontend/css/styles.css`, `/frontend/js/app.js` | 200 |
| `GET /standards/usage-of-colours.json`, `/modules/reflection/reflection-engine.js`, `/modules/memory/memory-store.js` | 200 |
| `GET /nope.txt` | 404, non la pagina di benvenuto di nginx |
| healthcheck del container | `healthy` |
| 47 controlli nel browser sull'applicazione servita dal container (`http://127.0.0.1:8180/frontend/index.html`) | 47/47 superati |

Il container serve solo il frontend statico: **non avvia il backend Node** e non espone le API.

---

## 6. Latenza misurata

Misurata in Node.js v26.5.0, media su molte ripetizioni, con una preferenza già memorizzata:

| Operazione | Valore misurato | Ripetizioni |
|---|---|---|
| `reflect()` (confronto con 9 regole + memoria) | **0.0036 ms** per chiamata | 200.000 |
| `reflect()` + `buildResponse()` | **0.0129 ms** per chiamata | 20.000 |

L'interfaccia mostra inoltre, nel pannello "Why this answer", la latenza della singola
riflessione misurata nel browser dell'utente. Quel valore è una misura di quella sessione, non
un benchmark.

Non è stata misurata l'allocazione di memoria né l'uso di CPU.

---

## 7. Metriche richieste dal brief (§8): stato

| Metrica | Stato |
|---|---|
| Accuratezza delle operazioni deterministiche | misurata: 34/34 coppie CIEDE2000 entro 1e-4; conversioni sRGB→CIELAB entro 0.05; 87/87 test superati |
| Precisione e richiamo su classificazioni con etichette di riferimento | **non misurate**: non esiste un insieme etichettato di ragioni personali/cogenti. Le regole sono verificate su casi scritti a mano, non come percentuale |
| Operazioni immagine | verificate su un'immagine reale: crop, resize con proporzioni, rotazione, conversione png/jpeg/bmp, limiti e rifiuti |
| Qualità dei suggerimenti grafici | **non misurata**: non sono stati valutati da designer né su un insieme di prova |
| Qualità del recupero della memoria | verificata su casi funzionali (recupero, aggiornamento, scadenza, separazione tra utenti), **non** come percentuale su un insieme di prova |
| Tasso di risposte non supportate dalle informazioni disponibili | verificato per costruzione: un colore non coperto produce "non coperto" e incertezza alta, e non può essere memorizzato come accettato. Non è stato misurato su un campione casuale, perché la tavolozza è chiusa e ogni caso è coperto da un test |
| Latenza | misurata (§6) per il motore; **non misurata** per le API sotto carico |
| Consumo di risorse | **non misurato** |
| Percentuale di correzioni risolte correttamente | **non applicabile**: in questa fase nessuna correzione viene risolta automaticamente, quindi non esiste una percentuale da misurare |

---

## 8. Cosa questi risultati non dicono

- Non dicono che ChatMT risponda meglio di altri sistemi: **non è stato eseguito alcun confronto**. Il §9 del brief richiede benchmark riproducibili, confronti equi e documentazione dei limiti prima di qualsiasi affermazione di superiorità.
- Non dicono nulla sulla qualità del giudizio sui colori: il sistema misura distanze, non preferenze.
- Non dicono che l'interfaccia sia accessibile: non è stata verificata con strumenti di accessibilità né con uno screen reader.
- Non dicono che i comportamenti siano corretti su altri browser: i controlli sono stati eseguiti solo su Chrome.
- Non dicono che il giudizio personale/cogente sia accurato su ragioni reali: non esiste un insieme etichettato, e le soglie sono una convenzione dichiarata.
- Non dicono che il provider LLM funzioni: è stato usato un endpoint simulato, non una chiave reale.
- Non dicono che il backend sia sicuro da esporre: non ha autenticazione, HTTPS, rate limiting né autorizzazione per profilo.
