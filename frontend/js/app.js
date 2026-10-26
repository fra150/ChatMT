/**
 * ChatMT frontend (Phase 2 prototype).
 *
 * This file only connects the interface to the modules. It contains no colour arithmetic and
 * no rule logic: those live in modules/, so that they stay testable without a browser.
 *
 * Deliberate choices, recorded so they can be reviewed:
 * - nothing is stored automatically. Choosing a colour only produces an answer; storing a
 *   preference requires the consent box and an explicit button;
 * - no innerHTML anywhere: every string that can contain user input is inserted with
 *   textContent, so a stored note cannot inject markup;
 * - the memory lives in the browser (localStorage) under a key that includes the user id.
 */

import { coveredColours, uncoveredColours } from '../../modules/color_engine/palette.js';
import { rgbToCss } from '../../modules/color_engine/color-engine.js';
import { INPUT_TYPES, createReflectionEngine } from '../../modules/reflection/reflection-engine.js';
import { buildResponse } from '../../modules/response/response-engine.js';
import { CATEGORIES, MemoryStore, createVolatileAdapter } from '../../modules/memory/memory-store.js';

/** Single local profile. The store supports several users; see docs/architettura.md. */
const USER_ID = 'local-user';

// ---------------------------------------------------------------------------------------
// Tiny DOM helper (no template literals with data, no innerHTML)
// ---------------------------------------------------------------------------------------

function h(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [event, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(event, handler);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function formatTimestamp(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString();
}

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

const dom = {
  status: document.getElementById('app-status'),
  paletteCovered: document.getElementById('palette-covered'),
  paletteUncovered: document.getElementById('palette-uncovered'),
  selection: document.getElementById('selection'),
  consent: document.getElementById('consent'),
  consentNote: document.getElementById('consent-note'),
  clearMemory: document.getElementById('clear-memory'),
  answer: document.getElementById('answer'),
  clarification: document.getElementById('clarification'),
  clarificationText: document.getElementById('clarification-text'),
  clarificationSend: document.getElementById('clarification-send'),
  correction: document.getElementById('correction'),
  correctionOutcome: document.getElementById('correction-outcome'),
  correctionNote: document.getElementById('correction-note'),
  correctionRecord: document.getElementById('correction-record'),
  matches: document.getElementById('matches'),
  memoryStatus: document.getElementById('memory-status'),
  memoryList: document.getElementById('memory-list'),
  why: document.getElementById('why')
};

const state = {
  engine: null,
  standards: null,
  memory: null,
  persistentStorage: true,
  selection: null,
  reflection: null,
  answer: null,
  clarificationAnswer: null,
  durationMs: null
};

// ---------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------

function showStatus(message) {
  dom.status.hidden = false;
  dom.status.textContent = message;
}

function createStorage() {
  try {
    const probe = 'chatmt.probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { adapter: window.localStorage, persistent: true };
  } catch {
    // Private mode, quota exceeded or storage disabled: fall back to a temporary memory and
    // say so, instead of pretending that data was saved.
    return { adapter: createVolatileAdapter(), persistent: false };
  }
}

async function loadStandards() {
  const url = new URL('../standards/usage-of-colours.json', document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url.pathname}`);
  return response.json();
}

async function init() {
  try {
    state.standards = await loadStandards();
  } catch (error) {
    showStatus(
      `ChatMT could not load standards/usage-of-colours.json (${error.message}). ` +
        'ES modules and fetch need the project to be served over HTTP: in the project folder run ' +
        '"python -m http.server 8000" and open http://localhost:8000/frontend/ instead of double-clicking the file.'
    );
    return;
  }

  state.engine = createReflectionEngine({ standards: state.standards });
  const storage = createStorage();
  state.persistentStorage = storage.persistent;
  state.memory = new MemoryStore({ adapter: storage.adapter, userId: USER_ID });

  if (!state.persistentStorage) {
    showStatus('Browser storage is unavailable, so this session uses a temporary memory that disappears on reload.');
  }

  renderPalette();
  renderSelection();
  renderMemory();
  renderPlaceholders();
}

// ---------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------

function paletteButton(colour) {
  return h(
    'button',
    {
      class: 'swatch-button',
      attrs: {
        type: 'button',
        'aria-pressed': state.selection?.hex === colour.hex ? 'true' : 'false',
        'aria-label': `${colour.name} ${colour.hex}`
      },
      on: { click: () => selectColour(colour) }
    },
    h('span', { class: 'swatch', attrs: { style: `background:${colour.hex}`, 'aria-hidden': 'true' } }),
    h('span', { class: 'swatch-name', text: colour.name }),
    h('span', { class: 'swatch-hex', text: colour.hex })
  );
}

function renderPalette() {
  dom.paletteCovered.replaceChildren(...coveredColours().map(paletteButton));
  dom.paletteUncovered.replaceChildren(...uncoveredColours().map(paletteButton));
}

// ---------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------

function selectColour(colour) {
  state.selection = colour;
  state.clarificationAnswer = null;
  dom.clarificationText.value = '';
  dom.correctionNote.value = '';
  reflectAndRender();
}

function reflectAndRender() {
  const input = {
    type: INPUT_TYPES.PALETTE_SELECTION,
    hex: state.selection.hex,
    name: state.selection.name
  };

  const startedAt = performance.now();
  state.reflection = state.engine.reflect(input, { memory: state.memory });
  state.answer = buildResponse(state.reflection);
  state.durationMs = performance.now() - startedAt;

  renderPalette();
  renderSelection();
  renderAnswer();
  renderMatches();
  renderMemory();
  renderWhy();
}

function renderSelection() {
  const colour = state.selection;
  if (colour === null) {
    dom.selection.replaceChildren(h('p', { class: 'hint', text: 'No colour selected yet.' }));
    return;
  }

  const structured = state.reflection.features;
  dom.selection.replaceChildren(
    h(
      'div',
      { class: 'lab-row' },
      h('span', {
        class: 'big-swatch',
        attrs: { style: `background:${colour.hex}`, role: 'img', 'aria-label': `Selected colour ${colour.name} ${colour.hex}` }
      }),
      h(
        'div',
        {},
        h('h3', { text: colour.name }),
        h('p', {
          class: 'hint',
          text: colour.covered ? 'This colour has a standard code.' : 'This colour has no standard code.'
        })
      )
    ),
    h(
      'dl',
      { class: 'facts' },
      h('dt', { text: 'HEX' }),
      h('dd', { text: structured.hex }),
      h('dt', { text: 'RGB' }),
      h('dd', { text: rgbToCss(structured.rgb) }),
      h('dt', { text: 'CIELAB' }),
      h('dd', {
        text: `L* ${structured.lab.l.toFixed(2)}  a* ${structured.lab.a.toFixed(2)}  b* ${structured.lab.b.toFixed(2)}`
      })
    )
  );
}

// ---------------------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------------------

function storageBlock() {
  const { answer, selection } = state;
  const block = h('div', { class: 'answer-block' }, h('h4', { text: 'Storing this preference' }));
  block.append(h('p', { text: answer.storage.explanation }));

  const existing = state.memory.currentPreference();
  const consented = dom.consent.checked;

  if (!consented) {
    block.append(h('p', { class: 'hint', text: 'Nothing is stored: tick the consent box in section 2 first.' }));
    return block;
  }
  if (answer.storage.requiresQuestionAnswer && state.clarificationAnswer === null) {
    block.append(h('p', { class: 'hint', text: 'Answer the question first: the standard asks for an explanation before accepting this colour.' }));
    return block;
  }
  if (existing !== null && existing.content.hex === selection.hex) {
    block.append(h('p', { class: 'hint', text: `Already stored as your preference (record ${existing.id}).` }));
    return block;
  }

  // The label must not hide the difference between a preference the standard code permits
  // and an observation it does not cover: those two are stored with different confirmation
  // states, so the button says which one it is doing.
  const existingLabel = existing === null ? '' : (existing.content.name ?? existing.content.hex);
  let label;
  if (answer.storage.permitted) {
    label = existing === null ? 'Save as my preferred colour' : `Replace my stored preference (${existingLabel})`;
  } else {
    label =
      existing === null
        ? 'Store as an unconfirmed observation'
        : `Replace my stored preference (${existingLabel}) with an unconfirmed observation`;
  }

  block.append(h('div', { class: 'row' }, h('button', { text: label, attrs: { type: 'button' }, on: { click: savePreference } })));
  return block;
}

function savePreference() {
  const colour = state.selection;
  const answer = state.answer;
  if (colour === null || answer === null) return;

  const existing = state.memory.currentPreference();
  try {
    if (existing !== null && existing.content.hex !== colour.hex) {
      state.memory.updatePreference(existing.id, {
        hex: colour.hex,
        name: colour.name,
        reason: state.clarificationAnswer,
        confirmation: answer.storage.confirmation
      });
    } else {
      state.memory.addPreference({
        hex: colour.hex,
        name: colour.name,
        reason: state.clarificationAnswer,
        confirmation: answer.storage.confirmation,
        origin: answer.storage.permitted ? 'palette_selection' : 'palette_selection_uncovered',
        consent: true
      });
    }
    reflectAndRender();
  } catch (error) {
    showStatus(`The preference was not stored: ${error.message}`);
  }
}

function renderAnswer() {
  const { answer, reflection } = state;
  if (answer === null) return;

  const nodes = [h('p', { class: 'answer-headline', text: answer.headline })];
  for (const paragraph of answer.paragraphs) {
    nodes.push(h('p', { class: 'answer-paragraph', text: paragraph }));
  }

  if (answer.measurement !== null) {
    nodes.push(
      h(
        'div',
        { class: 'answer-block' },
        h('h4', { text: 'Measurement' }),
        h('p', { text: answer.measurement.sentence }),
        h('p', { class: 'hint', text: `Compared with: ${answer.measurement.comparedWith.name ?? ''} ${answer.measurement.comparedWith.hex}` })
      )
    );
  }

  nodes.push(h('div', { class: 'answer-block judgement' }, h('h4', { text: 'Not a judgement about you' }), h('p', { text: answer.judgement })));

  if (answer.question !== null) {
    nodes.push(h('p', { class: 'question', text: answer.question }));
  }

  nodes.push(storageBlock());

  dom.answer.replaceChildren(...nodes);

  // The clarification block appears only when the standard asks a question, and disappears
  // once the answer has been given.
  const needsAnswer = answer.needsClarification && state.clarificationAnswer === null;
  dom.clarification.hidden = !needsAnswer;
  if (needsAnswer) {
    document.getElementById('clarification-label').textContent = `Your answer — ${answer.question}`;
  }
  if (state.clarificationAnswer !== null) {
    dom.answer.append(h('p', { class: 'hint', text: `Your answer was recorded with the preference: "${state.clarificationAnswer}"` }));
  }

  // A correction can only be about an answer that exists.
  dom.correction.hidden = reflection === null;
}

// ---------------------------------------------------------------------------------------
// Matches, contradictions, uncertainty
// ---------------------------------------------------------------------------------------

function renderMatches() {
  const { reflection, answer } = state;
  if (reflection === null) {
    dom.matches.replaceChildren(h('p', { class: 'hint', text: 'Nothing to show yet.' }));
    return;
  }

  const nodes = [];

  nodes.push(h('h3', { text: 'Standards that matched' }));
  if (answer.appliedRules.length === 0) {
    nodes.push(h('p', { class: 'hint', text: 'No standard code matched this colour.' }));
  } else {
    nodes.push(
      h(
        'ul',
        {},
        answer.appliedRules.map((rule) =>
          h(
            'li',
            {},
            h('span', { class: `badge ${rule.outcome === 'accepted' ? 'badge-ok' : 'badge-warn'}`, text: rule.outcome }),
            `${rule.id} (${rule.colour_name}) — "${rule.source_text}"`
          )
        )
      )
    );
  }

  nodes.push(
    h('p', {
      class: 'hint',
      text: `Nearest standard colour: ${answer.nearestStandard.colour_name} (${answer.nearestStandard.hex}) at a distance of ${answer.nearestStandard.deltaE.toFixed(4)}.`
    })
  );

  nodes.push(h('h3', { text: 'Contradictions' }));
  if (reflection.contradictions.length === 0) {
    nodes.push(h('p', { class: 'hint', text: 'None found.' }));
  } else {
    nodes.push(
      h(
        'ul',
        {},
        reflection.contradictions.map((item) =>
          h(
            'li',
            {},
            h('span', { class: `badge badge-${item.severity === 'conflict' ? 'conflict' : 'warn'}`, text: item.severity }),
            h('code', { text: item.code }),
            ' ',
            item.message
          )
        )
      )
    );
  }

  nodes.push(h('h3', { text: 'Uncertainty' }));
  const uncertaintyList = [
    h('li', {}, h('span', { class: `badge badge-${reflection.uncertainty.level === 'low' ? 'ok' : 'warn'}`, text: reflection.uncertainty.level }), 'declared level')
  ];
  for (const reason of reflection.uncertainty.reasons) {
    uncertaintyList.push(h('li', {}, reason));
  }
  nodes.push(h('ul', {}, uncertaintyList));

  dom.matches.replaceChildren(...nodes);
}

// ---------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------

function memoryRecordNode(record) {
  const isPreference = record.category === CATEGORIES.PREFERENCE;
  const head = h('div', { class: 'record-head' });

  if (isPreference) {
    head.append(
      h('span', { class: 'mini-swatch', attrs: { style: `background:${record.content.hex}`, 'aria-hidden': 'true' } }),
      h('strong', { text: `Preference: ${record.content.name ?? record.content.hex} (${record.content.hex})` })
    );
  } else {
    head.append(
      h('span', { class: 'mini-swatch', attrs: { style: `background:${record.content.hex}`, 'aria-hidden': 'true' } }),
      h('strong', { text: `Correction: ${record.content.hex} should be "${record.content.proposed_outcome}"` })
    );
  }

  const meta = h('div', { class: 'meta' });
  meta.append(
    h('div', {}, `category: ${record.category} · confirmation: ${record.confirmation} · origin: ${record.origin}`),
    h('div', {}, `created: ${formatTimestamp(record.created_at)} · updated: ${formatTimestamp(record.updated_at)}`),
    h('div', {}, `confidence: ${record.confidence} · expires: ${record.expires_at === null ? 'never' : formatTimestamp(record.expires_at)}`)
  );
  if (record.content.reason) {
    meta.append(h('div', {}, `your answer: "${record.content.reason}"`));
  }
  if (record.content.note) {
    meta.append(h('div', {}, `note: "${record.content.note}"`));
  }

  const actions = h('div', { class: 'actions' });
  if (isPreference) {
    const replace = h('button', {
      class: 'secondary',
      text: 'Replace with selected colour',
      attrs: { type: 'button', disabled: state.selection === null },
      on: {
        click: () => {
          try {
            state.memory.updatePreference(record.id, { hex: state.selection.hex, name: state.selection.name });
            refreshAfterMemoryChange();
          } catch (error) {
            showStatus(`The record was not changed: ${error.message}`);
          }
        }
      }
    });
    actions.append(replace);
  }
  actions.append(
    h('button', {
      class: 'danger',
      text: 'Delete',
      attrs: { type: 'button' },
      on: {
        click: () => {
          state.memory.delete(record.id);
          refreshAfterMemoryChange();
        }
      }
    })
  );

  return h('li', {}, head, meta, actions);
}

function refreshAfterMemoryChange() {
  if (state.selection !== null) {
    reflectAndRender();
  } else {
    renderMemory();
  }
}

function renderMemory() {
  let records;
  try {
    records = state.memory.list({ includeExpired: true }).reverse();
  } catch (error) {
    dom.memoryStatus.textContent = `The stored memory could not be read: ${error.message}`;
    dom.memoryList.replaceChildren();
    return;
  }

  const storageDescription = state.persistentStorage
    ? `browser localStorage, key "${state.memory.storageKey}"`
    : 'temporary memory for this session only';

  dom.memoryStatus.replaceChildren(
    h('div', {}, `User: ${state.memory.userId} · records: ${records.length} · storage: ${storageDescription}`),
    h('div', {
      class: 'hint',
      text:
        'Categories declared by the memory schema: preference and correction are used by this prototype; ' +
        'conversational, knowledge and interaction are declared but not written yet.'
    })
  );

  if (records.length === 0) {
    dom.memoryList.replaceChildren(h('li', { class: 'hint', text: 'Empty. No preference or correction is stored yet.' }));
    return;
  }
  dom.memoryList.replaceChildren(...records.map(memoryRecordNode));
}

// ---------------------------------------------------------------------------------------
// Why this answer
// ---------------------------------------------------------------------------------------

function renderWhy() {
  const { answer, reflection } = state;
  if (answer === null) {
    dom.why.replaceChildren(h('p', { class: 'hint', text: 'The data used, the rules applied and the uncertainty are listed here, in short form.' }));
    return;
  }

  const rulesApplied =
    answer.appliedRules.length === 0
      ? ['No rule applied: the colour is not covered by the standard set.']
      : answer.appliedRules.map((rule) => `${rule.id} (${rule.outcome}): "${rule.source_text}"`);

  dom.why.replaceChildren(
    h('h3', { text: 'Data used' }),
    h('ul', {}, answer.dataUsed.map((entry) => h('li', { text: entry }))),
    h('h3', { text: 'Rules applied' }),
    h('ul', {}, rulesApplied.map((entry) => h('li', { text: entry }))),
    h('h3', { text: 'Uncertainty' }),
    h('p', { text: `Declared level: ${reflection.uncertainty.level}.` }),
    h('ul', {}, reflection.uncertainty.reasons.map((entry) => h('li', { text: entry }))),
    h('h3', { text: 'Latency measured on this device' }),
    h('p', {
      text: `Reflection and answer construction: ${state.durationMs.toFixed(2)} ms (measurement of this browser session, not a benchmark).`
    }),
    h('p', {
      class: 'hint',
      text:
        'No private reasoning chain is shown: only the data used, the rules applied and the declared uncertainty, ' +
        'which is what can be checked against the code and the standard file.'
    })
  );
}

function renderPlaceholders() {
  dom.selection.replaceChildren(h('p', { class: 'hint', text: 'No colour selected yet.' }));
  dom.matches.replaceChildren(h('p', { class: 'hint', text: 'Nothing to show yet.' }));
  renderWhy();
}

// ---------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------

dom.consent.addEventListener('change', () => {
  dom.consentNote.textContent = dom.consent.checked
    ? 'Consent given: a preference can now be stored, but only when you press the button.'
    : 'Consent withdrawn: nothing new will be stored. Data already stored stays until you delete it.';
  if (state.selection !== null) {
    reflectAndRender();
  }
});

dom.clearMemory.addEventListener('click', () => {
  try {
    const removed = state.memory.clear();
    dom.consentNote.textContent = `${removed} record(s) deleted from this browser.`;
    refreshAfterMemoryChange();
  } catch (error) {
    showStatus(`The stored data could not be deleted: ${error.message}`);
  }
});

dom.clarificationSend.addEventListener('click', () => {
  const value = dom.clarificationText.value.trim();
  if (value === '') {
    dom.clarificationText.focus();
    showStatus('The standard asks a question: write an answer before sending it.');
    return;
  }
  state.clarificationAnswer = value;
  dom.status.hidden = true;
  renderAnswer();
});

dom.correctionRecord.addEventListener('click', () => {
  if (state.selection === null) return;
  const proposedOutcome = dom.correctionOutcome.value === 'no-standard' ? 'no-standard' : dom.correctionOutcome.value;
  try {
    state.memory.addCorrection({
      hex: state.selection.hex,
      name: state.selection.name,
      targetStandardId: state.reflection?.rule?.id ?? null,
      proposedOutcome,
      note: dom.correctionNote.value.trim(),
      consent: true
    });
    reflectAndRender();
  } catch (error) {
    showStatus(`The correction was not recorded: ${error.message}`);
  }
});

init();
