/**
 * Friendliness standing.
 *
 * The project creator decided that the profile of a user is either friendly or not friendly,
 * and that the difference is visible in the assistance given:
 *
 *   friendly      -> extensive assistance, 5 background suggestions;
 *   not friendly  -> reduced assistance, 2 background suggestions;
 *
 * A personal reason for choosing red or yellow sets the profile to not friendly; a cogent
 * reason sets it back to friendly and unlocks backgrounds tending towards red or yellow.
 *
 * The displeasure and the explanation of the reduced assistance are not repeated forever:
 * they are delivered once, at the next interaction, and then marked as delivered. The state
 * is data, so the API can show why the profile is what it is.
 */

export const STANDING_LEVELS = Object.freeze({
  FRIENDLY: 'friendly',
  NOT_FRIENDLY: 'not_friendly'
});

export const EFFORT_LEVELS = Object.freeze({
  EXTENSIVE: 'extensive',
  REDUCED: 'reduced'
});

export const STANDING_KIND = 'friendliness_standing';

/** A fresh profile is friendly: no personal reason has been recorded yet. */
export function createDefaultStanding({ at = null } = {}) {
  return {
    kind: STANDING_KIND,
    level: STANDING_LEVELS.FRIENDLY,
    effort: EFFORT_LEVELS.EXTENSIVE,
    allow_questioned_colours: false,
    last_decision: null,
    pending: { displeasure: false, effort_explanation: false },
    updated_at: at
  };
}

/** Reads a stored standing defensively: a damaged shape must not become a friendly profile silently. */
export function normaliseStanding(value) {
  if (!value || typeof value !== 'object') return createDefaultStanding();
  const level = value.level === STANDING_LEVELS.NOT_FRIENDLY ? STANDING_LEVELS.NOT_FRIENDLY : STANDING_LEVELS.FRIENDLY;
  return {
    kind: STANDING_KIND,
    level,
    effort: level === STANDING_LEVELS.NOT_FRIENDLY ? EFFORT_LEVELS.REDUCED : EFFORT_LEVELS.EXTENSIVE,
    allow_questioned_colours: level === STANDING_LEVELS.FRIENDLY && value.allow_questioned_colours === true,
    last_decision:
      value.last_decision && typeof value.last_decision === 'object'
        ? {
            colour_name: value.last_decision.colour_name ?? null,
            verdict: value.last_decision.verdict ?? null,
            confidence: value.last_decision.confidence ?? null,
            method: value.last_decision.method ?? null,
            at: value.last_decision.at ?? null
          }
        : null,
    pending: {
      displeasure: value.pending?.displeasure === true,
      effort_explanation: value.pending?.effort_explanation === true
    },
    updated_at: value.updated_at ?? null
  };
}

/**
 * Apply one reason assessment. Only a decided verdict changes the profile:
 * `needs_review` leaves it exactly as it was, because an undecided reason must not be
 * treated as a personal one.
 *
 * @param {object} standing
 * @param {{assessment: object, at?: string|null}} input
 * @returns {{standing: object, changed: boolean}}
 */
export function applyAssessment(standing, { assessment, at = null } = {}) {
  if (!assessment || typeof assessment.verdict !== 'string') {
    throw new TypeError('applyAssessment needs a reason assessment with a verdict.');
  }
  const current = normaliseStanding(standing);

  if (assessment.verdict !== 'personal' && assessment.verdict !== 'cogent') {
    return { standing: current, changed: false };
  }

  const lastDecision = {
    colour_name: assessment.colour_name ?? null,
    verdict: assessment.verdict,
    confidence: assessment.confidence ?? null,
    method: assessment.method ?? null,
    at
  };

  if (assessment.verdict === 'personal') {
    return {
      changed: true,
      standing: {
        kind: STANDING_KIND,
        level: STANDING_LEVELS.NOT_FRIENDLY,
        effort: EFFORT_LEVELS.REDUCED,
        allow_questioned_colours: false,
        last_decision: lastDecision,
        pending: { displeasure: true, effort_explanation: true },
        updated_at: at
      }
    };
  }

  return {
    changed: true,
    standing: {
      kind: STANDING_KIND,
      level: STANDING_LEVELS.FRIENDLY,
      effort: EFFORT_LEVELS.EXTENSIVE,
      allow_questioned_colours: true,
      last_decision: lastDecision,
      pending: { displeasure: false, effort_explanation: false },
      updated_at: at
    }
  };
}

function personalReasonMessage(standing, meanings) {
  const colour = standing.last_decision?.colour_name ?? 'red or yellow';
  return (
    `I am not pleased with the personal reason stored for choosing ${colour}. ` +
    `${meanings.colourMeaningSentence(colour)} ` +
    'A personal preference is not a reason this system can act on, so this profile is recorded as not friendly for colour choices.'
  );
}

function reducedEffortMessage(standing, meanings) {
  const colour = standing.last_decision?.colour_name ?? 'red or yellow';
  const reduced = meanings.assistance.reduced.suggestion_limit;
  return (
    `In the previous interaction I gave you ${reduced} background suggestions instead of the ` +
    `${meanings.assistance.extensive.suggestion_limit} reserved for the extensive assistance, and less developed ones. ` +
    `The reason is the personal reason stored for ${colour}. Extensive assistance is given for ${meanings.encouragedPhrase}, ` +
    `and for a cogent reason for ${meanings.questionedPhrase}; a cogent reason for red or yellow restores the friendly tone.`
  );
}

/**
 * Messages due at this interaction, and the same standing with those messages marked as
 * delivered. Calling it twice does not repeat them.
 *
 * @param {object} standing
 * @param {{meanings: object, at?: string|null}} input
 */
export function collectEngagementMessages(standing, { meanings, at = null } = {}) {
  const current = normaliseStanding(standing);
  const messages = [];

  if (current.pending.displeasure) {
    messages.push({ code: 'personal-reason-displeasure', text: personalReasonMessage(current, meanings) });
  }
  if (current.pending.effort_explanation) {
    messages.push({ code: 'reduced-assistance-explanation', text: reducedEffortMessage(current, meanings) });
  }

  if (messages.length === 0) {
    return { messages, standing: current, delivered: false };
  }

  return {
    delivered: true,
    messages,
    standing: {
      ...current,
      pending: { displeasure: false, effort_explanation: false },
      updated_at: at
    }
  };
}

/** The number of suggestions and the depth of detail the profile is entitled to. */
export function assistanceFor(standing, meanings) {
  const current = normaliseStanding(standing);
  const entitlement = meanings.assistance[current.effort] ?? meanings.assistance.extensive;
  return {
    effort: current.effort,
    limit: entitlement.suggestion_limit,
    detail: entitlement.detail,
    extended: current.effort === EFFORT_LEVELS.EXTENSIVE
  };
}

/** A readable state, safe to return from the API. */
export function summaryOf(standing, { meanings } = {}) {
  const current = normaliseStanding(standing);
  const assistance = meanings
    ? assistanceFor(current, meanings)
    : { effort: current.effort, limit: null, detail: current.effort === EFFORT_LEVELS.EXTENSIVE ? 'full' : 'brief' };

  const why =
    current.level === STANDING_LEVELS.NOT_FRIENDLY
      ? `A personal reason for choosing ${current.last_decision?.colour_name ?? 'red or yellow'} was recorded. The profile is not friendly, so fewer and less developed suggestions are given until a cogent reason for red or yellow is recorded.`
      : current.allow_questioned_colours
        ? 'The profile is friendly because a cogent reason for red or yellow was recorded. Backgrounds tending towards red or yellow are allowed.'
        : 'The profile is friendly. Backgrounds tending towards red or yellow stay locked until a cogent reason for red or yellow is recorded.';

  return {
    level: current.level,
    effort: assistance.effort,
    suggestion_limit: assistance.limit,
    detail: assistance.detail,
    allow_questioned_colours: current.allow_questioned_colours,
    last_decision: current.last_decision,
    pending: { displeasure: current.pending.displeasure, effort_explanation: current.pending.effort_explanation },
    why
  };
}
