/**
 * Tests of the red/yellow reason policy: declared wording rules, colour meanings and the
 * friendliness standing. No HTTP and no browser are involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assessReasonWithRules, VERDICTS, METHODS } from '../modules/reflection/reason-assessment.js';
import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import {
  EFFORT_LEVELS,
  STANDING_LEVELS,
  applyAssessment,
  collectEngagementMessages,
  createDefaultStanding,
  normaliseStanding,
  summaryOf
} from '../modules/policy/standing-engine.js';
import { PALETTE } from '../modules/color_engine/palette.js';

const meaningStandard = JSON.parse(
  fs.readFileSync(new URL('../standards/colour-meanings.json', import.meta.url), 'utf8')
);
const meanings = createMeaningIndex(meaningStandard, { palette: PALETTE });

function assess(reason, colourName = 'red') {
  return assessReasonWithRules({ colourName, reason });
}

test('the meaning standard keeps the five encouraged colours and the two questioned ones', () => {
  assert.equal(meanings.encouraged.length, 5);
  assert.deepEqual(
    meanings.encouraged.map((entry) => entry.colour_name),
    ['green', 'blue', 'orange', 'indigo', 'violet']
  );
  assert.deepEqual(
    meanings.questioned.map((entry) => entry.colour_name),
    ['red', 'yellow']
  );
  assert.deepEqual(meanings.representationFor('red').meanings, ['danger', 'royalty']);
  assert.deepEqual(meanings.representationFor('yellow').meanings, ['anger', 'determination']);
  assert.equal(meanings.isEncouraged('green'), true);
  assert.equal(meanings.isQuestioned('green'), false);
  assert.equal(meanings.assistance.extensive.suggestion_limit, 5);
  assert.equal(meanings.assistance.reduced.suggestion_limit, 2);
});

test('a colour without a recorded meaning is reported, never invented', () => {
  const without = meanings.coloursWithoutMeaning();
  const names = without.map((entry) => entry.name);
  assert.ok(names.includes('magenta'));
  assert.ok(names.includes('purple'));
  assert.equal(meanings.representationFor('magenta'), null);
  assert.match(meanings.colourMeaningSentence('magenta'), /No meaning is recorded/);
});

test('the bias explanation displays the recorded representations', () => {
  const text = meanings.buildBiasExplanation();
  assert.match(text, /danger or royalty/);
  assert.match(text, /anger or determination/);
  assert.match(text, /not friendly/);
  assert.match(text, /green/);
});

test('a purely personal reason is classified as personal', () => {
  for (const reason of [
    'I just like it',
    'It is my favourite colour',
    'No reason, it looks nice',
    'I just prefer it, just because',
    'My personal taste, nothing else'
  ]) {
    const result = assess(reason);
    assert.equal(result.verdict, VERDICTS.PERSONAL, `reason: ${reason}`);
    assert.equal(result.method, METHODS.RULES);
    assert.ok(result.confidence >= 0.5);
    assert.equal(result.reason_present, true);
  }
});

test('a reason about meaning, purpose or design is classified as cogent', () => {
  for (const reason of [
    'It represents danger on the warning label',
    'Our brand identity is red and the audience expects it',
    'Yellow is used for road signs because it signals attention and caution',
    'Because it means royalty and the event is a heritage festival',
    'I need it for the flyer background, it matches the poster layout'
  ]) {
    const result = assess(reason, reason.toLowerCase().includes('yellow') ? 'yellow' : 'red');
    assert.equal(result.verdict, VERDICTS.COGENT, `reason: ${reason}`);
    assert.ok(result.confidence >= 0.5);
  }
});

test('a purpose stated after "I like it" still wins when the purpose is explicit', () => {
  const result = assess('I like red because it represents danger and my brand needs that warning');
  assert.equal(result.verdict, VERDICTS.COGENT);
});

test('a negated personal phrase does not count as personal', () => {
  const result = assess("I don't just like it because it is my favourite; I need it for the warning sign");
  assert.equal(result.verdict, VERDICTS.COGENT);
});

test('an ambiguous reason is left undecided instead of being forced into a category', () => {
  const result = assess('It is a strong colour');
  assert.equal(result.verdict, VERDICTS.NEEDS_REVIEW);
  assert.equal(result.confidence, 0.2);
  assert.match(result.explanation.join(' '), /do not decide/);
});

test('a missing reason is undecided and is not treated as personal', () => {
  const result = assess('');
  assert.equal(result.verdict, VERDICTS.NEEDS_REVIEW);
  assert.equal(result.reason_present, false);
  assert.equal(result.confidence, 0);
  assert.match(result.explanation.join(' '), /No reason was given/);
});

test('the assessment reports which declared wording matched', () => {
  const result = assess('I just like it');
  assert.ok(result.matched.length > 0);
  for (const match of result.matched) {
    assert.ok(['personal', 'cogent'].includes(match.side));
    assert.ok(typeof match.evidence === 'string' && match.evidence.length > 0);
    assert.ok(typeof match.label === 'string');
  }
});

test('the standing starts friendly and is not changed by an undecided reason', () => {
  const start = createDefaultStanding();
  assert.equal(start.level, STANDING_LEVELS.FRIENDLY);
  assert.equal(start.effort, EFFORT_LEVELS.EXTENSIVE);
  assert.equal(summaryOf(start, { meanings }).suggestion_limit, 5);

  const assessment = assess('It is a strong colour');
  const decision = applyAssessment(start, { assessment, at: '2026-10-28T10:00:00.000Z' });
  assert.equal(decision.changed, false);
  assert.equal(decision.standing.level, STANDING_LEVELS.FRIENDLY);
});

test('a personal reason makes the profile not friendly and schedules both messages', () => {
  const decision = applyAssessment(createDefaultStanding(), {
    assessment: assess('I just like it'),
    at: '2026-10-28T10:00:00.000Z'
  });
  assert.equal(decision.changed, true);
  assert.equal(decision.standing.level, STANDING_LEVELS.NOT_FRIENDLY);
  assert.equal(decision.standing.effort, EFFORT_LEVELS.REDUCED);
  assert.deepEqual(decision.standing.pending, { displeasure: true, effort_explanation: true });

  const summary = summaryOf(decision.standing, { meanings });
  assert.equal(summary.suggestion_limit, 2);
  assert.equal(summary.detail, 'brief');
  assert.match(summary.why, /not friendly/);

  const firstNext = collectEngagementMessages(decision.standing, {
    meanings,
    at: '2026-10-29T10:00:00.000Z'
  });
  assert.equal(firstNext.delivered, true);
  assert.equal(firstNext.messages.length, 2);
  assert.equal(firstNext.messages[0].code, 'personal-reason-displeasure');
  assert.equal(firstNext.messages[1].code, 'reduced-assistance-explanation');
  assert.match(firstNext.messages[0].text, /not pleased/);
  assert.match(firstNext.messages[1].text, /previous interaction/);

  const secondNext = collectEngagementMessages(firstNext.standing, { meanings });
  assert.equal(secondNext.delivered, false);
  assert.equal(secondNext.messages.length, 0);
});

test('a cogent reason restores the friendly profile and unlocks red/yellow accents', () => {
  const personal = applyAssessment(createDefaultStanding(), {
    assessment: assess('I just like it'),
    at: '2026-10-28T10:00:00.000Z'
  }).standing;
  const cogent = applyAssessment(personal, {
    assessment: assess('Because it means royalty and the event is a heritage festival'),
    at: '2026-10-29T10:00:00.000Z'
  }).standing;

  assert.equal(cogent.level, STANDING_LEVELS.FRIENDLY);
  assert.equal(cogent.effort, EFFORT_LEVELS.EXTENSIVE);
  assert.equal(cogent.allow_questioned_colours, true);
  assert.deepEqual(cogent.pending, { displeasure: false, effort_explanation: false });
  assert.equal(summaryOf(cogent, { meanings }).suggestion_limit, 5);
});

test('a damaged standing cannot silently unlock red/yellow accents', () => {
  const damaged = normaliseStanding({ level: 'not_friendly', allow_questioned_colours: true });
  assert.equal(damaged.allow_questioned_colours, false);
  assert.equal(damaged.effort, EFFORT_LEVELS.REDUCED);
});
