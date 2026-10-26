# ChatMT — Test e risultati misurati (Fase 2)

Ogni numero in questo documento è stato prodotto eseguendo il comando indicato su questa macchina.
Nessun risultato è stimato. Dove una metrica non è stata misurata, è scritto che non è stata misurata.

- **Data delle esecuzioni:** 26 ottobre 2026
- **Ambiente:** Windows, Node.js v26.5.0, Python 3.13, Chrome 156, Docker 29.9.2

---

## 1. Come si eseguono

| Comando | Cosa serve | Cosa verifica |
|---|---|---|
| `node tests/run-tests.mjs` (o `npm test`) | solo Node.js, nessuna dipendenza | la logica: spazio colore, CIEDE2000, bande, memoria, riflessione, risposte |
| `python -m http.server 8000` + `node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html` | server HTTP in esecuzione e Chrome installato | l'interfaccia reale: 47 controlli sul DOM di un browser vero |
| `docker build -t chatmt .` + `docker run --rm -p 8080:80 chatmt` | Docker | che il container serva l'applicazione funzionante |

I tre livelli sono complementari: i test unitari non vedono l'interfaccia, e i controlli nel browser non verificano i dati di riferimento della formula CIEDE2000.

---

## 2. Test unitari (`tests/run-tests.mjs`)

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

### Risultato dell'esecuzione

```
node tests/run-tests.mjs
tests 41   pass 41   fail 0   duration_ms 213
```

41 test superati, 0 falliti. Sono inclusi i 34 confronti CIEDE2000 di riferimento, ciascuno verificato con tolleranza 1e-4.

**Un risultato non ovvio emerso dai test** e conservato come caso di regressione: il colore
`lime` (`#00FF00`) senza standard risulta più vicino a **yellow** (23.40) che a **green**
(34.51). Non è un errore: il valore CSS di `green` è `#008000`, molto più scuro, mentre la tinta
di `lime` e `green` è quasi identica. Il test verifica entrambi i valori, così il risultato non
va perso.

---

## 3. Controlli dell'interfaccia (`tests/browser-checks.mjs`)

47 controlli eseguiti su un Chrome reale pilotato via DevTools Protocol, con asserzioni sul DOM
dopo ogni azione. Verificano, nell'ordine:

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

## 4. Verifica del container Docker

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

---

## 5. Latenza misurata

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

## 6. Metriche richieste dal brief (§8): stato

| Metrica | Stato |
|---|---|
| Accuratezza delle operazioni deterministiche | misurata: 34/34 coppie CIEDE2000 entro 1e-4; conversioni sRGB→CIELAB entro 0.05; 41/41 test superati |
| Precisione e richiamo su classificazioni con etichette di riferimento | **non misurate**: non esiste un insieme etichettato di riferimento. Sarebbe un lavoro a sé, con dati raccolti da persone |
| Qualità del recupero della memoria | verificata su casi funzionali (recupero, aggiornamento, scadenza, separazione tra utenti), **non** come percentuale su un insieme di prova |
| Tasso di risposte non supportate dalle informazioni disponibili | verificato per costruzione: un colore non coperto produce "non coperto" e incertezza alta, e non può essere memorizzato come accettato. Non è stato misurato su un campione casuale, perché la tavolozza è chiusa e ogni caso è coperto da un test |
| Latenza | misurata (§5) |
| Consumo di risorse | **non misurato** |
| Percentuale di correzioni risolte correttamente | **non applicabile**: in questa fase nessuna correzione viene risolta automaticamente, quindi non esiste una percentuale da misurare |

---

## 7. Cosa questi risultati non dicono

- Non dicono che ChatMT risponda meglio di altri sistemi: **non è stato eseguito alcun confronto**. Il §9 del brief richiede benchmark riproducibili, confronti equi e documentazione dei limiti prima di qualsiasi affermazione di superiorità.
- Non dicono nulla sulla qualità del giudizio sui colori: il sistema misura distanze, non preferenze.
- Non dicono che l'interfaccia sia accessibile: non è stata verificata con strumenti di accessibilità né con uno screen reader.
- Non dicono che i comportamenti siano corretti su altri browser: i controlli sono stati eseguiti solo su Chrome.
