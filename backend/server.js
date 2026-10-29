/**
 * ChatMT backend — HTTP API.
 *
 * Node.js built-in http, no framework. The server adds the pieces the browser prototype did
 * not have: shared memory on disk, the red/yellow reason policy, the friendliness profile,
 * design suggestions and the four image operations.
 *
 * It also serves the interface from /frontend, on the same origin as /api: one command starts
 * the whole application.
 *
 * Start:  npm start
 * Open:   http://127.0.0.1:3080/
 * Docs:   docs/backend-api.md
 */

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { loadStandards } from './standards-loader.js';
import { createFileAdapter, StorageError } from './storage/file-adapter.js';
import { createLlmClassifier } from './llm-classifier.js';
import { createInteractionService } from './services/interaction-service.js';
import { createImageService } from './services/image-service.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { readStaticFile } from './static-files.js';

import { PALETTE } from '../modules/color_engine/palette.js';
import { DESIGN_TYPES } from '../modules/policy/design-suggestions.js';
import { ConsentRequiredError, MemoryStore, RecordNotFoundError } from '../modules/memory/memory-store.js';
import { InvalidColourError } from '../modules/color_engine/color-engine.js';
import { UnsupportedInputError } from '../modules/reflection/reflection-engine.js';
import { ImageOperationError } from '../modules/design/image-operations.js';

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function applyCors(req, res, config) {
  const origin = req.headers.origin;
  const allowed = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw new ApiError(413, 'payload_too_large', `The request body is larger than ${limit} bytes.`);
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('invalid_json', 'The request body is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('invalid_json', 'The request body must be a JSON object.');
  }
  return parsed;
}

function userIdFrom(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw badRequest('invalid_user_id', 'The user id is not valid URL encoding.');
  }
  if (!USER_ID.test(decoded)) {
    throw badRequest('invalid_user_id', 'The user id must be 1 to 64 characters: letters, digits, dash or underscore.');
  }
  return decoded;
}

function recordIdFrom(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw badRequest('invalid_record_id', 'The record id is not valid URL encoding.');
  }
}

/**
 * @param {ReturnType<typeof loadConfig>} [config]
 */
export function createServer(config = loadConfig()) {
  const standards = loadStandards({ directory: config.standardsDir });
  const adapter = createFileAdapter({ directory: config.dataDir });
  const llm = createLlmClassifier(config.llm);
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter, userId }),
    llm
  });
  const images = createImageService(config.image);

  const routes = [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      handler: () => ({
        status: 'ok',
        service: 'chatmt-backend',
        standards: {
          usage: { id: standards.usage.id, version: standards.usage.version, rules: standards.usage.rules?.length ?? 0 },
          meanings: { id: standards.meanings.id, version: standards.meanings.version }
        },
        llm: { configured: llm.configured, model: llm.configured ? llm.model : null },
        storage: { type: 'json-file' },
        frontend: { served_at: '/frontend/' }
      })
    },
    {
      method: 'GET',
      pattern: /^\/api\/standards$/,
      handler: () => ({ usage: standards.usage, meanings: standards.meanings })
    },
    {
      method: 'GET',
      pattern: /^\/api\/palette$/,
      handler: () => service.palette
    },
    {
      method: 'GET',
      pattern: /^\/api\/meanings$/,
      handler: () => service.meaningsView()
    },
    {
      method: 'POST',
      pattern: /^\/api\/interactions$/,
      handler: async ({ body }) => {
        const userId = userIdFrom(String(body.userId ?? ''));
        return service.interact({
          userId,
          colour: body.colour,
          reason: body.reason,
          consent: body.consent,
          design: body.design
        });
      }
    },
    {
      method: 'GET',
      pattern: /^\/api\/users\/([^/]+)\/standing$/,
      handler: ({ params }) => service.standingFor(userIdFrom(params[0]))
    },
    {
      method: 'GET',
      pattern: /^\/api\/users\/([^/]+)\/memory$/,
      handler: ({ params, query }) =>
        service.memoryFor(userIdFrom(params[0]), { includeExpired: query.get('includeExpired') === '1' })
    },
    {
      method: 'POST',
      pattern: /^\/api\/users\/([^/]+)\/preferences$/,
      handler: async ({ params, body }) =>
        service.savePreference({
          userId: userIdFrom(params[0]),
          colour: body.colour ?? { name: body.name, hex: body.hex },
          reason: body.reason,
          consent: body.consent
        })
    },
    {
      method: 'POST',
      pattern: /^\/api\/users\/([^/]+)\/corrections$/,
      handler: ({ params, body }) =>
        service.addCorrection({
          userId: userIdFrom(params[0]),
          hex: body.hex,
          name: body.name,
          targetStandardId: body.targetStandardId,
          proposedOutcome: body.proposedOutcome,
          note: body.note,
          consent: body.consent
        })
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/users\/([^/]+)\/memory\/([^/]+)$/,
      handler: ({ params }) => service.deleteRecord(userIdFrom(params[0]), recordIdFrom(params[1]))
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/users\/([^/]+)\/memory$/,
      handler: ({ params }) => service.clearMemory(userIdFrom(params[0]))
    },
    {
      method: 'POST',
      pattern: /^\/api\/design\/suggestions$/,
      handler: ({ body }) =>
        service.suggestionsFor({
          userId: userIdFrom(String(body.userId ?? '')),
          colour: body.colour ?? { name: body.colourName, hex: body.hex },
          design: body.design
        })
    },
    {
      method: 'GET',
      pattern: /^\/api\/design\/types$/,
      handler: () => ({
        types: Object.entries(DESIGN_TYPES).map(([id, type]) => ({
          id,
          label: type.label,
          width: type.width,
          height: type.height
        }))
      })
    },
    {
      method: 'POST',
      pattern: /^\/api\/design\/backgrounds$/,
      handler: async ({ body }) =>
        service.requestBackground({
          userId: userIdFrom(String(body.userId ?? '')),
          colour: body.colour ?? { name: body.colourName, hex: body.hex },
          reason: body.reason,
          consent: body.consent,
          design: body.design
        })
    },
    {
      method: 'POST',
      pattern: /^\/api\/design\/transform$/,
      handler: async ({ body }) =>
        images.transform({ image: body.image, operations: body.operations, format: body.format })
    }
  ];

  async function handle(req, res) {
    applyCors(req, res, config);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const route = routes.find((candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname));
    if (route === undefined) {
      const otherMethods = routes.filter((candidate) => candidate.pattern.test(url.pathname));
      if (otherMethods.length > 0) {
        res.setHeader('Allow', otherMethods.map((candidate) => candidate.method).join(', '));
        throw new ApiError(405, 'method_not_allowed', `${req.method} is not allowed on ${url.pathname}.`);
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = await readStaticFile({ root: config.frontendDir, urlPath: url.pathname });
        if (file.found) {
          if (file.status === 302) {
            res.writeHead(302, file.headers);
            res.end();
            return;
          }
          res.writeHead(200, file.headers);
          res.end(req.method === 'HEAD' ? undefined : file.body);
          return;
        }
      }
      throw notFound('not_found', `No route ${req.method} ${url.pathname}.`);
    }

    const match = route.pattern.exec(url.pathname);
    const body = req.method === 'POST' ? await readJsonBody(req, config.maxBodyBytes) : {};
    const payload = await route.handler({ params: match.slice(1), query: url.searchParams, body, req });
    sendJson(res, 200, payload);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const mapped = mapError(error);
      if (mapped.status >= 500) {
        console.error(`[chatmt] ${req.method} ${req.url} -> ${mapped.status} ${mapped.code}: ${error.message}`);
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    });
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return server;
}

function mapError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof ConsentRequiredError) {
    return new ApiError(403, 'consent_required', 'Nothing is stored without consent: true.');
  }
  if (error instanceof RecordNotFoundError) {
    return new ApiError(404, 'record_not_found', `No record ${JSON.stringify(error.id)} for this user.`);
  }
  if (error instanceof ImageOperationError) {
    const status = error.code === 'image_too_large' ? 413 : 400;
    return new ApiError(status, error.code, error.message);
  }
  if (error instanceof StorageError) {
    return new ApiError(503, error.code, error.message);
  }
  if (error instanceof InvalidColourError) {
    return new ApiError(400, 'invalid_colour', error.message);
  }
  if (error instanceof UnsupportedInputError) {
    return new ApiError(400, 'unsupported_input', error.message);
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return new ApiError(400, 'invalid_request', error.message);
  }
  return new ApiError(500, 'internal_error', 'The server could not complete the request.');
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.port;
    const llmState = config.llm.configured ? `LLM: ${config.llm.model}` : 'LLM: not configured (ambiguous reasons stay undecided)';
    console.log(`ChatMT backend listening on http://${config.host}:${port} — ${llmState}`);
    console.log(`Data directory: ${config.dataDir}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
