/**
 * Vercel entry point.
 *
 * The project is a long-lived Node server; on Vercel it becomes one serverless function. The
 * adapter reuses the router unchanged: it only makes sure the path still starts with /api, and
 * that a host which pre-parsed the JSON body still appears as a body the router can read.
 *
 * The page itself is served by Vercel as static files from frontend/ (outputDirectory), on the
 * same origin as /api, exactly like the local single-server setup.
 *
 * Limits of this deployment, declared instead of hidden:
 * - the function filesystem is read-only except /tmp, so the JSON memory needs
 *   CHATMT_DATA_DIR=/tmp/chatmt-data and survives only while the instance stays warm;
 * - the model key stays in the project environment variables, never in the repository.
 */

import { loadConfig } from '../backend/config.js';
import { createServer } from '../backend/server.js';

let server = null;

function instance() {
  if (server === null) server = createServer(loadConfig());
  return server;
}

export default function handler(req, res) {
  const url = typeof req.url === 'string' && req.url !== '' ? req.url : '/';
  if (!url.startsWith('/api')) req.url = `/api${url.startsWith('/') ? '' : '/'}${url}`;

  // A host that parsed the body for us leaves an object behind; the router reads a stream.
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const payload = Buffer.from(JSON.stringify(req.body), 'utf8');
    req[Symbol.asyncIterator] = async function* () {
      yield payload;
    };
    req.headers['content-length'] = String(payload.length);
  }

  instance().emit('request', req, res);
}
