/**
 * Backend integration tests.
 *
 * A real HTTP server is started on port 0 (a port chosen by the system) with a temporary data
 * directory. Every request goes through fetch, so routing, validation, error mapping, memory
 * on disk and image processing are exercised the way a client will use them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

import { loadConfig } from '../backend/config.js';
import { createServer } from '../backend/server.js';
import { loadStandards } from '../backend/standards-loader.js';
import { createInteractionService } from '../backend/services/interaction-service.js';
import { createLlmClassifier, LlmError } from '../backend/llm-classifier.js';
import { MemoryStore, createVolatileAdapter } from '../modules/memory/memory-store.js';
import { PALETTE } from '../modules/color_engine/palette.js';
import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import { createDefaultStanding } from '../modules/policy/standing-engine.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEANINGS_DIRECTORY = path.join(REPOSITORY_ROOT, 'standards');

let server;
let base;
let dataDir;
let config;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-backend-'));
  config = loadConfig({
    CHATMT_DATA_DIR: dataDir,
    PORT: '0',
    CHATMT_LLM_API_BASE: '',
    CHATMT_LLM_API_KEY: ''
  });
  server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(pathname, { method = 'GET', body, rawBody } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? null : JSON.parse(text)
  };
}

async function imageDataUrl(format = 'png', width = 20, height = 10) {
  const image = new Jimp({ width, height, color: 0xff0000ff });
  const buffer = await image.getBuffer(`image/${format}`);
  return `data:image/${format};base64,${buffer.toString('base64')}`;
}

test('health, standards, palette and meanings are exposed', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.standards.usage.id, 'usage-of-colours');
  assert.equal(health.body.standards.meanings.id, 'colour-meanings');
  assert.equal(health.body.llm.configured, false);
  assert.equal(health.body.storage.type, 'json-file');

  const meanings = await api('/api/meanings');
  assert.equal(meanings.status, 200);
  assert.deepEqual(
    meanings.body.encouraged.map((entry) => entry.colour_name),
    ['green', 'blue', 'orange', 'indigo', 'violet']
  );
  assert.deepEqual(meanings.body.questioned.map((entry) => entry.colour_name), ['red', 'yellow']);
  assert.match(meanings.body.biasExplanation, /danger or royalty/);
  assert.match(meanings.body.biasExplanation, /anger or determination/);
  assert.ok(meanings.body.noMeaningRecorded.some((entry) => entry.name === 'magenta'));
  assert.ok(meanings.body.policies.length >= 5);

  const palette = await api('/api/palette');
  assert.equal(palette.status, 200);
  assert.equal(palette.body.colours.length, 15);
  const green = palette.body.colours.find((entry) => entry.name === 'green');
  assert.equal(green.encouraged, true);
  assert.deepEqual(green.meanings, ['prosperity and peace']);
  const magenta = palette.body.colours.find((entry) => entry.name === 'magenta');
  assert.equal(magenta.meanings, null);
});

test('choosing green gives a friendly profile with five five-colour suggestions', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'green-user',
      colour: { name: 'green' },
      consent: true,
      design: { type: 'flyer', subject: 'Community market' }
    }
  });

  assert.equal(response.status, 200);
  assert.match(response.body.answer.headline, /colour-green/);
  assert.equal(response.body.profile.level, 'friendly');
  assert.equal(response.body.profile.suggestion_limit, 5);
  assert.equal(response.body.profile.decision, null);
  assert.equal(response.body.designSuggestions.suggestions.length, 5);
  assert.equal(response.body.designSuggestions.assistance.withheld.length, 1);
  assert.equal(typeof response.body.stored.preferenceId, 'string');
  assert.match(response.body.answer.policyNotice, /prosperity and peace/);

  for (const suggestion of response.body.designSuggestions.suggestions) {
    for (const entry of suggestion.palette) {
      assert.ok(['green', 'blue', 'orange', 'indigo', 'violet'].includes(entry.colour_name));
    }
  }

  const memory = await api('/api/users/green-user/memory');
  assert.equal(memory.body.count, 1);
  assert.equal(memory.body.records[0].category, 'preference');
  assert.equal(memory.body.records[0].content.reason, null);
  assert.equal(memory.body.profile.level, 'friendly');
});

test('red without a reason asks the question and stores nothing', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'question-user', colour: { name: 'red' }, consent: true }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.answer.question, 'Why did you choose Red?');
  assert.equal(response.body.answer.needsClarification, true);
  assert.equal(response.body.answer.storage.permitted, false);
  assert.equal(response.body.answer.storage.stored, false);
  assert.equal(response.body.reasonAssessment, null);
  assert.equal(response.body.stored.preferenceId, null);
  assert.equal(response.body.profile.level, 'friendly');
  assert.equal(response.body.profile.decision, null);

  const memory = await api('/api/users/question-user/memory');
  assert.equal(memory.body.count, 0);
  const standing = await api('/api/users/question-user/standing');
  assert.equal(standing.body.hasStoredProfile, false);
});

test('a personal reason stores a not friendly profile, then displeasure and the explanation arrive once', async () => {
  const first = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'personal-user',
      colour: { name: 'red' },
      reason: 'I just like it, it is my favourite colour',
      consent: true,
      design: { type: 'flyer' }
    }
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.reasonAssessment.verdict, 'personal');
  assert.equal(first.body.reasonAssessment.method, 'rules');
  assert.equal(first.body.profile.level, 'not_friendly');
  assert.equal(first.body.profile.suggestion_limit, 2);
  assert.equal(first.body.designSuggestions.suggestions.length, 2);
  assert.equal(first.body.standingMessages.length, 0, 'the displeasure is due at the next interaction');
  assert.equal(typeof first.body.stored.preferenceId, 'string');
  assert.equal(typeof first.body.stored.standingRecordId, 'string');
  assert.equal(typeof first.body.stored.assessmentRecordId, 'string');
  assert.match(first.body.answer.policyNotice, /not friendly/);

  const memory = await api('/api/users/personal-user/memory');
  assert.equal(memory.body.count, 3);
  assert.deepEqual(
    new Set(memory.body.records.map((record) => record.category)),
    new Set(['preference', 'interaction', 'knowledge'])
  );
  const preference = memory.body.records.find((record) => record.category === 'preference');
  assert.equal(preference.content.reason, 'I just like it, it is my favourite colour');

  const preview = await api('/api/users/personal-user/standing');
  assert.equal(preview.body.profile.level, 'not_friendly');
  assert.equal(preview.body.pendingMessages.length, 2);
  assert.equal(preview.body.pendingMessages[0].code, 'personal-reason-displeasure');

  const second = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'blue' }, consent: false }
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.standingMessages.length, 2);
  assert.equal(second.body.standingMessages[0].code, 'personal-reason-displeasure');
  assert.equal(second.body.standingMessages[1].code, 'reduced-assistance-explanation');
  assert.match(second.body.standingMessages[0].text, /not pleased/);
  assert.match(second.body.standingMessages[1].text, /previous interaction/);
  assert.equal(second.body.profile.level, 'not_friendly');
  assert.equal(second.body.designSuggestions.suggestions.length, 2);
  assert.equal(second.body.stored.preferenceId, null, 'consent was not given');
  assert.equal(second.body.stored.standingRecordId, null);

  const third = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'blue' }, consent: false }
  });
  assert.equal(third.body.standingMessages.length, 0, 'the messages must not repeat');

  const afterDelivery = await api('/api/users/personal-user/standing');
  assert.equal(afterDelivery.body.pendingMessages.length, 0);
  assert.equal(afterDelivery.body.profile.level, 'not_friendly');
});

test('the profile survives a new server instance on the same data directory', async () => {
  const secondServer = createServer(config);
  await new Promise((resolve) => secondServer.listen(0, '127.0.0.1', resolve));
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;
  try {
    const response = await fetch(`${secondBase}/api/users/personal-user/standing`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hasStoredProfile, true);
    assert.equal(body.profile.level, 'not_friendly');
    assert.equal(body.profile.last_decision.verdict, 'personal');
  } finally {
    await new Promise((resolve) => secondServer.close(resolve));
  }
});

test('a cogent reason keeps the friendly tone and unlocks a red accent', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'cogent-user',
      colour: { name: 'red' },
      reason: 'Red is our brand identity and it signals danger on the warning label',
      consent: true,
      design: { type: 'flyer' }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonAssessment.verdict, 'cogent');
  assert.equal(response.body.profile.level, 'friendly');
  assert.equal(response.body.profile.allow_questioned_colours, true);
  assert.equal(response.body.profile.suggestion_limit, 5);
  assert.equal(response.body.designSuggestions.suggestions.length, 5);
  assert.equal(response.body.designSuggestions.assistance.withheld.length, 0);
  assert.match(response.body.designSuggestions.assistance.note, /accent is allowed/);
  assert.match(response.body.answer.policyNotice, /friendly tone/);

  const last = response.body.designSuggestions.suggestions.at(-1);
  const accent = last.palette.find((entry) => entry.role === 'accent');
  assert.ok(accent);
  assert.ok(['red', 'yellow'].includes(accent.colour_name));
});

test('an ambiguous reason is stored nowhere and no profile is invented', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'ambiguous-user',
      colour: { name: 'yellow' },
      reason: 'It is a strong colour',
      consent: true
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonAssessment.verdict, 'needs_review');
  assert.equal(response.body.reasonAssessment.llm.status, 'not_configured');
  assert.equal(response.body.answer.storage.permitted, false);
  assert.equal(response.body.stored.preferenceId, null);
  assert.equal(response.body.profile.level, 'friendly');
  assert.match(response.body.answer.policyNotice, /undecided/);

  const memory = await api('/api/users/ambiguous-user/memory');
  assert.equal(memory.body.count, 0);
});

test('the LLM is used only for an ambiguous reason that the rules cannot decide', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  let calls = 0;
  const llm = {
    configured: true,
    async classify({ colourName }) {
      calls += 1;
      return {
        colour_name: colourName,
        reason_present: true,
        verdict: 'personal',
        confidence: 0.81,
        method: 'llm',
        scores: null,
        matched: [],
        explanation: ['The rules could not decide; the model classified it as personal.']
      };
    }
  };
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm
  });

  const result = await service.interact({
    userId: 'hybrid-user',
    colour: { name: 'red' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(calls, 1);
  assert.equal(result.reasonAssessment.method, 'llm');
  assert.equal(result.reasonAssessment.verdict, 'personal');
  assert.equal(result.profile.level, 'not_friendly');
  assert.equal(result.profile.decision.applied, true);
});

test('a failing LLM leaves the reason undecided instead of guessing', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm: {
      configured: true,
      async classify() {
        throw new LlmError('llm_timeout', 'timed out');
      }
    }
  });

  const result = await service.interact({
    userId: 'llm-failure-user',
    colour: { name: 'red' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(result.reasonAssessment.verdict, 'needs_review');
  assert.equal(result.reasonAssessment.llm.status, 'failed');
  assert.equal(result.reasonAssessment.llm.code, 'llm_timeout');
  assert.equal(result.stored.preferenceId, null);
});

test('a low-confidence LLM verdict is left undecided', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm: {
      configured: true,
      async classify({ colourName }) {
        return {
          colour_name: colourName,
          reason_present: true,
          verdict: 'personal',
          confidence: 0.2,
          method: 'llm',
          scores: null,
          matched: [],
          explanation: []
        };
      }
    }
  });

  const result = await service.interact({
    userId: 'low-confidence-user',
    colour: { name: 'yellow' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(result.reasonAssessment.verdict, 'needs_review');
  assert.equal(result.reasonAssessment.llm.status, 'low_confidence');
  assert.equal(result.stored.preferenceId, null);
  assert.equal(result.profile.level, 'friendly');
});

test('design suggestions are fewer for the not friendly profile and five for the cogent one', async () => {
  const reduced = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'green' }, design: { type: 'flyer' } }
  });
  assert.equal(reduced.status, 200);
  assert.equal(reduced.body.profile.level, 'not_friendly');
  assert.equal(reduced.body.designSuggestions.suggestions.length, 2);
  assert.match(reduced.body.designSuggestions.assistance.note, /Reduced assistance/);

  const extended = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'cogent-user', colour: { name: 'green' }, design: { type: 'poster' } }
  });
  assert.equal(extended.status, 200);
  assert.equal(extended.body.profile.level, 'friendly');
  assert.equal(extended.body.designSuggestions.suggestions.length, 5);

  const invalid = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'cogent-user', colour: { name: 'green' }, design: { type: 't-shirt' } }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'invalid_request');
});

test('crop, resize, rotate and format conversion work on a real image', async () => {
  const image = await imageDataUrl('png', 20, 10);

  const cropped = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'crop', x: 1, y: 1, width: 4, height: 6 }] }
  });
  assert.equal(cropped.status, 200);
  assert.equal(cropped.body.width, 4);
  assert.equal(cropped.body.height, 6);
  assert.equal(cropped.body.format, 'png');
  assert.equal(cropped.body.mime, 'image/png');
  assert.equal(cropped.body.source.format, 'png');
  const croppedImage = await Jimp.read(Buffer.from(cropped.body.image.split(',')[1], 'base64'));
  assert.equal(croppedImage.bitmap.width, 4);
  assert.equal(croppedImage.bitmap.height, 6);

  const resized = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'resize', width: 10 }] }
  });
  assert.equal(resized.status, 200);
  assert.equal(resized.body.width, 10);
  assert.equal(resized.body.height, 5, 'the aspect ratio is preserved');

  const rotated = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'rotate', degrees: 90 }] }
  });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.width, 10);
  assert.equal(rotated.body.height, 20);

  const converted = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'jpeg' }
  });
  assert.equal(converted.status, 200);
  assert.equal(converted.body.format, 'jpeg');
  assert.equal(converted.body.mime, 'image/jpeg');
  assert.match(converted.body.image, /^data:image\/jpeg;base64,/);

  const fromJpeg = await api('/api/design/transform', {
    method: 'POST',
    body: { image: await imageDataUrl('jpeg'), operations: [{ type: 'rotate', degrees: 180 }] }
  });
  assert.equal(fromJpeg.status, 200);
  assert.equal(fromJpeg.body.source.format, 'jpeg');
  assert.equal(fromJpeg.body.width, 20);
  assert.equal(fromJpeg.body.height, 10);

  const toBmp = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'bmp' }
  });
  assert.equal(toBmp.status, 200);
  assert.equal(toBmp.body.format, 'bmp');
  assert.equal(toBmp.body.mime, 'image/bmp');
  const bmpImage = await Jimp.read(Buffer.from(toBmp.body.image.split(',')[1], 'base64'));
  assert.equal(bmpImage.bitmap.width, 20);
  assert.equal(bmpImage.bitmap.height, 10);
});

test('invalid image requests are refused with specific errors', async () => {
  const image = await imageDataUrl('png', 20, 10);

  const outOfBounds = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'crop', x: 18, y: 0, width: 4, height: 4 }] }
  });
  assert.equal(outOfBounds.status, 400);
  assert.equal(outOfBounds.body.error.code, 'crop_out_of_bounds');

  const undecodable = await api('/api/design/transform', {
    method: 'POST',
    body: { image: Buffer.from('not an image').toString('base64'), format: 'png' }
  });
  assert.equal(undecodable.status, 400);
  assert.equal(undecodable.body.error.code, 'invalid_image');

  const gifHeader = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
  const gif = await api('/api/design/transform', {
    method: 'POST',
    body: { image: gifHeader.toString('base64'), format: 'png' }
  });
  assert.equal(gif.status, 400);
  assert.equal(gif.body.error.code, 'invalid_image');

  const nothing = await api('/api/design/transform', { method: 'POST', body: { image } });
  assert.equal(nothing.status, 400);
  assert.equal(nothing.body.error.code, 'invalid_request');

  const badFormat = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'webp' }
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.body.error.code, 'invalid_format');

  const unknownOperation = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'blur', radius: 3 }] }
  });
  assert.equal(unknownOperation.status, 400);
  assert.equal(unknownOperation.body.error.code, 'invalid_operation');

  const tooMany = await api('/api/design/transform', {
    method: 'POST',
    body: {
      image,
      operations: Array.from({ length: 11 }, () => ({ type: 'rotate', degrees: 90 }))
    }
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.code, 'too_many_operations');
});

test('memory can be written, read, corrected and deleted, and consent is enforced', async () => {
  const withoutConsent = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' }, consent: false }
  });
  assert.equal(withoutConsent.status, 403);
  assert.equal(withoutConsent.body.error.code, 'consent_required');

  const missingConsent = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' } }
  });
  assert.equal(missingConsent.status, 403);

  const preference = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' }, consent: true }
  });
  assert.equal(preference.status, 200);
  assert.equal(preference.body.preference.category, 'preference');
  assert.equal(preference.body.preference.content.hex, '#0000FF');

  const correction = await api('/api/users/crud-user/corrections', {
    method: 'POST',
    body: { hex: '#0000FF', proposedOutcome: 'question', note: 'blue should be questioned', consent: true }
  });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.correction.category, 'correction');

  const memory = await api('/api/users/crud-user/memory');
  assert.equal(memory.body.count, 2);

  const recordId = preference.body.preference.id;
  const deleted = await api(`/api/users/crud-user/memory/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);

  const missing = await api('/api/users/crud-user/memory/does-not-exist', { method: 'DELETE' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'record_not_found');

  const cleared = await api('/api/users/crud-user/memory', { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.deletedCount, 1);

  const empty = await api('/api/users/crud-user/memory');
  assert.equal(empty.body.count, 0);
  assert.equal(empty.body.profile.level, 'friendly');
});

test('request validation and routing errors are explicit', async () => {
  const unknownRoute = await api('/api/nope');
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.body.error.code, 'not_found');

  const wrongMethod = await api('/api/users/someone/standing', { method: 'POST', body: {} });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  assert.match(wrongMethod.headers.get('allow'), /GET/);

  const badUserId = await api('/api/users/bad%2Fid/standing');
  assert.equal(badUserId.status, 400);
  assert.equal(badUserId.body.error.code, 'invalid_user_id');

  const unknownColour = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { name: 'chartreuse' } }
  });
  assert.equal(unknownColour.status, 400);
  assert.equal(unknownColour.body.error.code, 'unknown_colour');

  const notInPalette = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { hex: '#123456' } }
  });
  assert.equal(notInPalette.status, 400);
  assert.equal(notInPalette.body.error.code, 'unknown_colour');

  const missingUser = await api('/api/interactions', {
    method: 'POST',
    body: { colour: { name: 'green' } }
  });
  assert.equal(missingUser.status, 400);
  assert.equal(missingUser.body.error.code, 'invalid_user_id');

  const invalidJson = await api('/api/interactions', { method: 'POST', rawBody: '{not json' });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.error.code, 'invalid_json');

  const longReason = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { name: 'red' }, reason: 'x'.repeat(1001) }
  });
  assert.equal(longReason.status, 400);
  assert.equal(longReason.body.error.code, 'reason_too_long');
});

test('two users never share a profile or a preference', async () => {
  const alice = await api('/api/users/separated-alice/memory');
  const bob = await api('/api/users/separated-bob/memory');
  assert.equal(alice.body.count, 0);
  assert.equal(bob.body.count, 0);

  await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'separated-alice',
      colour: { name: 'red' },
      reason: 'I just like it',
      consent: true
    }
  });

  const aliceAgain = await api('/api/users/separated-alice/standing');
  const bobAgain = await api('/api/users/separated-bob/standing');
  assert.equal(aliceAgain.body.profile.level, 'not_friendly');
  assert.equal(bobAgain.body.profile.level, 'friendly');
  assert.equal(bobAgain.body.hasStoredProfile, false);
});

test('the default standing is friendly and the meaning index is the same one the API uses', () => {
  assert.equal(createDefaultStanding().level, 'friendly');
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const meanings = createMeaningIndex(standards.meanings, { palette: PALETTE });
  assert.equal(meanings.encouraged.length, 5);
  assert.equal(meanings.questioned.length, 2);
});

test('the LLM classifier sends a strict JSON request and validates the answer', async () => {
  const requests = [];
  const classifier = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"cogent","confidence":0.92}' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  });

  assert.equal(classifier.configured, true);
  const result = await classifier.classify({ colourName: 'red', reason: 'Because it represents danger' });
  assert.equal(result.verdict, 'cogent');
  assert.equal(result.confidence, 0.92);
  assert.equal(result.method, 'llm');
  assert.equal(requests[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.temperature, 0);
  assert.match(sent.messages[0].content, /Return only a compact JSON object/);
  assert.match(sent.messages[1].content, /Because it represents danger/);
});

test('the LLM classifier refuses malformed, failing and unconfigured requests', async () => {
  const malformed = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })
  });
  await assert.rejects(() => malformed.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_invalid_response');
    return true;
  });

  const failing = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () => new Response('{}', { status: 500 })
  });
  await assert.rejects(() => failing.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_request_failed');
    return true;
  });

  const unconfigured = createLlmClassifier({});
  assert.equal(unconfigured.configured, false);
  await assert.rejects(() => unconfigured.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_not_configured');
    return true;
  });

  const unclear = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"unclear"}' } }] }), { status: 200 })
  });
  const result = await unclear.classify({ colourName: 'yellow', reason: 'hmm' });
  assert.equal(result.verdict, 'needs_review');
});
