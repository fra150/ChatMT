/**
 * Colour meanings.
 *
 * The meanings of the colours are not computed: they were written down by the project
 * creator and live in standards/colour-meanings.json. This module only indexes that file,
 * checks it, and exposes it to the rest of the system.
 *
 * A meaning that is not in the file is never invented. Colours without a recorded meaning
 * are reported as such, because "this colour has no meaning here" is information, while a
 * plausible-sounding meaning chosen by the code would be a fabrication.
 */

const REQUIRED_SECTIONS = ['encouraged', 'questioned'];

function normaliseHex(hex, fallbackName) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new TypeError(`Colour meaning for ${JSON.stringify(fallbackName)} has no valid HEX value.`);
  }
  return hex.toUpperCase();
}

function normaliseName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('Every colour meaning needs a colour_name.');
  }
  return name.trim().toLowerCase();
}

function normaliseEncouraged(entry) {
  if (typeof entry?.meaning !== 'string' || entry.meaning.trim() === '') {
    throw new TypeError(`Encouraged colour ${JSON.stringify(entry?.colour_name)} needs a meaning.`);
  }
  return Object.freeze({
    colour_name: normaliseName(entry.colour_name),
    hex: normaliseHex(entry.hex, entry.colour_name),
    meaning: entry.meaning.trim(),
    meanings: Object.freeze([entry.meaning.trim()])
  });
}

function normaliseQuestioned(entry) {
  const meanings = Array.isArray(entry?.meanings)
    ? entry.meanings.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (meanings.length === 0) {
    throw new TypeError(`Questioned colour ${JSON.stringify(entry?.colour_name)} needs at least one meaning.`);
  }
  return Object.freeze({
    colour_name: normaliseName(entry.colour_name),
    hex: normaliseHex(entry.hex, entry.colour_name),
    meaning: meanings.join(' or '),
    meanings: Object.freeze(meanings)
  });
}

function normaliseAssistance(assistance) {
  const result = {};
  for (const effort of ['extensive', 'reduced']) {
    const entry = assistance?.[effort];
    if (!entry || !Number.isInteger(entry.suggestion_limit) || entry.suggestion_limit < 1) {
      throw new TypeError(`The meaning standard needs an integer suggestion_limit for "${effort}".`);
    }
    result[effort] = Object.freeze({
      suggestion_limit: entry.suggestion_limit,
      detail: entry.detail === 'brief' ? 'brief' : 'full'
    });
  }
  return Object.freeze(result);
}

function listPhrase(items) {
  const names = items.map((item) => item.colour_name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * @param {object} standard the parsed content of standards/colour-meanings.json
 * @param {{palette?: ReadonlyArray<{name: string, hex: string}>}} [options]
 */
export function createMeaningIndex(standard, { palette = [] } = {}) {
  if (!standard || typeof standard !== 'object') {
    throw new TypeError('createMeaningIndex needs the colour meaning standard.');
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!Array.isArray(standard[section]) || standard[section].length === 0) {
      throw new TypeError(`The colour meaning standard needs a non-empty "${section}" list.`);
    }
  }

  const encouraged = Object.freeze(standard.encouraged.map(normaliseEncouraged));
  const questioned = Object.freeze(standard.questioned.map(normaliseQuestioned));
  const assistance = normaliseAssistance(standard.assistance);

  const byName = new Map();
  for (const entry of [...encouraged, ...questioned]) {
    if (byName.has(entry.colour_name)) {
      throw new TypeError(`Colour ${entry.colour_name} has a meaning in more than one section.`);
    }
    byName.set(entry.colour_name, entry);
  }

  function representationFor(colourName) {
    return byName.get(String(colourName).toLowerCase()) ?? null;
  }

  function isEncouraged(colourName) {
    return encouraged.some((entry) => entry.colour_name === String(colourName).toLowerCase());
  }

  function isQuestioned(colourName) {
    return questioned.some((entry) => entry.colour_name === String(colourName).toLowerCase());
  }

  /** Colours of the palette for which no meaning was written down. */
  function coloursWithoutMeaning() {
    return palette
      .filter((colour) => !byName.has(String(colour.name).toLowerCase()))
      .map((colour) => ({ name: colour.name, hex: colour.hex.toUpperCase() }));
  }

  /**
   * The answer to "why are you biased against red and yellow?": the recorded
   * representations, the five encouraged colours, and the rule that is applied.
   */
  function buildBiasExplanation() {
    const encouragedText = encouraged.map((entry) => `${entry.colour_name} (${entry.meaning})`).join(', ');
    const questionedText = questioned
      .map((entry) => `${entry.colour_name} (${entry.meanings.join(' or ')})`)
      .join(', ');
    return (
      `The system is not biased against red and yellow as colours: the standard code questions them instead of ` +
      `accepting them. The meanings recorded for them are ${questionedText}. ` +
      `The five encouraged colours are ${encouragedText}. ` +
      `A personal reason for choosing red or yellow is stored as a not friendly profile and receives fewer ` +
      `graphic suggestions; a cogent reason is stored with the same friendly tone as the five encouraged ` +
      `colours. Backgrounds tending towards yellow or red are suggested only to users who gave a cogent ` +
      `reason for choosing yellow or red.`
    );
  }

  function colourMeaningSentence(colourName) {
    const entry = representationFor(colourName);
    if (entry === null) {
      return `No meaning is recorded for ${colourName}; none is invented.`;
    }
    return `${entry.colour_name} is recorded here as ${entry.meanings.join(' or ')}.`;
  }

  return Object.freeze({
    id: standard.id ?? 'colour-meanings',
    version: standard.version ?? '0.0.0',
    encouraged,
    questioned,
    assistance,
    representationFor,
    isEncouraged,
    isQuestioned,
    coloursWithoutMeaning,
    buildBiasExplanation,
    colourMeaningSentence,
    encouragedPhrase: listPhrase(encouraged),
    questionedPhrase: listPhrase(questioned)
  });
}
