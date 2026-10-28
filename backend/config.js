/**
 * Backend configuration.
 *
 * No dependency reads a .env file: the variables are read from the process environment, so a
 * secret never has to be written into the repository. Every value has a declared default, and
 * an invalid value stops the server at startup instead of being silently replaced.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const DEFAULT_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

function integer(value, fallback, { minimum, maximum, name }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function originList(value) {
  const raw = text(value);
  if (raw === null) return DEFAULT_ORIGINS;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * @param {Record<string, string|undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const llmApiBase = text(env.CHATMT_LLM_API_BASE) ?? text(env.ZAI_API_BASE);
  const llmApiKey = text(env.CHATMT_LLM_API_KEY) ?? text(env.ZAI_API_KEY);

  return Object.freeze({
    host: text(env.CHATMT_HOST) ?? '127.0.0.1',
    port: integer(env.PORT ?? env.CHATMT_PORT, 3080, { minimum: 0, maximum: 65535, name: 'PORT' }),
    dataDir: path.resolve(REPOSITORY_ROOT, text(env.CHATMT_DATA_DIR) ?? 'data'),
    standardsDir: path.join(REPOSITORY_ROOT, 'standards'),
    allowedOrigins: Object.freeze(originList(env.CHATMT_ALLOWED_ORIGINS)),
    maxBodyBytes: integer(env.CHATMT_MAX_BODY_BYTES, 12 * 1024 * 1024, {
      minimum: 1024,
      maximum: 64 * 1024 * 1024,
      name: 'CHATMT_MAX_BODY_BYTES'
    }),
    image: Object.freeze({
      maxBytes: integer(env.CHATMT_MAX_IMAGE_BYTES, 8 * 1024 * 1024, {
        minimum: 1024,
        maximum: 32 * 1024 * 1024,
        name: 'CHATMT_MAX_IMAGE_BYTES'
      }),
      maxDimension: integer(env.CHATMT_MAX_IMAGE_DIMENSION, 8000, {
        minimum: 16,
        maximum: 12000,
        name: 'CHATMT_MAX_IMAGE_DIMENSION'
      }),
      maxPixels: integer(env.CHATMT_MAX_IMAGE_PIXELS, 40_000_000, {
        minimum: 10_000,
        maximum: 80_000_000,
        name: 'CHATMT_MAX_IMAGE_PIXELS'
      })
    }),
    llm: Object.freeze({
      apiBase: llmApiBase,
      apiKey: llmApiKey,
      model: text(env.CHATMT_LLM_MODEL) ?? text(env.ZAI_MODEL) ?? 'glm-4-flash',
      timeoutMs: integer(env.CHATMT_LLM_TIMEOUT_MS, 6000, {
        minimum: 500,
        maximum: 30_000,
        name: 'CHATMT_LLM_TIMEOUT_MS'
      }),
      configured: Boolean(llmApiBase && llmApiKey)
    })
  });
}
