import http from 'node:http';
import { loadSettings } from '../config/settings.js';

function sendJson(res, status, data) {
  if (res.headersSent || res.destroyed) return;

  const payload = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(payload);
}

function sendError(res, status, message, type, code) {
  sendJson(res, status, {
    error: { message, type, code }
  });
}

function readJsonBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;

      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('BODY_TOO_LARGE'), {
          code: 'BODY_TOO_LARGE'
        }));
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('INVALID_JSON'), {
          code: 'INVALID_JSON'
        }));
      }
    });

    req.on('error', () => {
      reject(Object.assign(new Error('REQUEST_READ_FAILED'), {
        code: 'REQUEST_READ_FAILED'
      }));
    });
  });
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (typeof authorization !== 'string') return null;

  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

function providerError(error) {
  if (error.message === 'GROQ_TIMEOUT') {
    return [504, 'The model request timed out.', 'gateway_timeout'];
  }

  if (
    error.message === 'NO_HEALTHY_KEYS' ||
    error.message === 'GROQ_RATE_LIMITED'
  ) {
    return [503, 'The AI service is temporarily unavailable.', 'service_unavailable'];
  }

  if (
    error.message === 'INVALID_MESSAGES' ||
    error.message === 'UNKNOWN_VIRTUAL_MODEL' ||
    error.message === 'GROQ_BAD_REQUEST'
  ) {
    return [400, 'The request is invalid.', 'invalid_request_error'];
  }

  return [502, 'The AI service returned an error.', 'api_error'];
}

// Explicitly expose only fields supported by the public chat API.
// Provider-specific fields such as reasoning, x_groq, and service_tier
// are intentionally excluded.
function sanitizeChatResponse(result, requestedModel) {
  const response = {
    model: requestedModel
  };

  if (typeof result.id === 'string') response.id = result.id;
  if (typeof result.object === 'string') response.object = result.object;
  if (Number.isFinite(result.created)) response.created = result.created;

  if (Array.isArray(result.choices)) {
    response.choices = result.choices.map(choice => {
      const safeChoice = {};

      if (Number.isInteger(choice.index)) {
        safeChoice.index = choice.index;
      }

      if (choice.message && typeof choice.message === 'object') {
        const message = {};

        if (typeof choice.message.role === 'string') {
          message.role = choice.message.role;
        }

        if (
          typeof choice.message.content === 'string' ||
          choice.message.content === null
        ) {
          message.content = choice.message.content;
        }

        if (typeof choice.message.refusal === 'string') {
          message.refusal = choice.message.refusal;
        }

        if (Array.isArray(choice.message.tool_calls)) {
          message.tool_calls = choice.message.tool_calls.map(tool => ({
            ...(typeof tool.id === 'string' ? { id: tool.id } : {}),
            ...(typeof tool.type === 'string' ? { type: tool.type } : {}),
            ...(tool.function && typeof tool.function === 'object'
              ? {
                  function: {
                    ...(typeof tool.function.name === 'string'
                      ? { name: tool.function.name }
                      : {}),
                    ...(typeof tool.function.arguments === 'string'
                      ? { arguments: tool.function.arguments }
                      : {})
                  }
                }
              : {})
          }));
        }

        safeChoice.message = message;
      }

      if (
        typeof choice.finish_reason === 'string' ||
        choice.finish_reason === null
      ) {
        safeChoice.finish_reason = choice.finish_reason;
      }

      return safeChoice;
    });
  }

  if (result.usage && typeof result.usage === 'object') {
    const usage = {};

    for (const field of [
      'prompt_tokens',
      'completion_tokens',
      'total_tokens'
    ]) {
      if (Number.isFinite(result.usage[field])) {
        usage[field] = result.usage[field];
      }
    }

    response.usage = usage;
  }

  return response;
}

export function createHttpServer({
  runtime,
  apiKeyService,
  models,
  settings = loadSettings()
} = {}) {
  if (
    !runtime ||
    typeof runtime.chat !== 'function' ||
    !apiKeyService ||
    typeof apiKeyService.authenticateApiKey !== 'function' ||
    !models ||
    typeof models !== 'object'
  ) {
    throw new Error('HTTP_SERVER_CONFIGURATION_REQUIRED');
  }

  const registry = models.models ?? models;

  return http.createServer(async (req, res) => {
    let pathname;

    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendError(res, 400, 'Invalid request URL.', 'invalid_request_error', 'invalid_url');
      return;
    }

    try {
      if (pathname === '/health') {
        if (req.method !== 'GET') {
          sendError(res, 405, 'Method not allowed.', 'invalid_request_error', 'method_not_allowed');
          return;
        }

        sendJson(res, 200, {
          status: 'ok',
          service: 'VELZX AI'
        });
        return;
      }

      if (
        pathname !== '/v1/models' &&
        pathname !== '/v1/chat/completions'
      ) {
        sendError(res, 404, 'Endpoint not found.', 'invalid_request_error', 'not_found');
        return;
      }

      if (!['GET', 'POST'].includes(req.method)) {
        sendError(res, 405, 'Method not allowed.', 'invalid_request_error', 'method_not_allowed');
        return;
      }

      if (pathname === '/v1/models' && req.method !== 'GET') {
        sendError(res, 405, 'Method not allowed.', 'invalid_request_error', 'method_not_allowed');
        return;
      }

      if (pathname === '/v1/chat/completions' && req.method !== 'POST') {
        sendError(res, 405, 'Method not allowed.', 'invalid_request_error', 'method_not_allowed');
        return;
      }

      const token = getBearerToken(req);

      if (!token) {
        sendError(res, 401, 'A valid Bearer API key is required.', 'authentication_error', 'invalid_api_key');
        return;
      }

      let authenticated;

      try {
        authenticated = await apiKeyService.authenticateApiKey(token);
      } catch {
        sendError(res, 503, 'Authentication service is temporarily unavailable.', 'service_unavailable', 'authentication_unavailable');
        return;
      }

      if (!authenticated) {
        sendError(res, 401, 'Invalid or revoked API key.', 'authentication_error', 'invalid_api_key');
        return;
      }

      if (pathname === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: Object.keys(registry).map(id => ({
            id,
            object: 'model',
            owned_by: 'velzx-ai'
          }))
        });
        return;
      }

      const contentType = req.headers['content-type'] ?? '';
      const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();

      if (mediaType !== 'application/json') {
        sendError(res, 415, 'Content-Type must be application/json.', 'invalid_request_error', 'unsupported_media_type');
        return;
      }

      let body;

      try {
        body = await readJsonBody(req, settings.http.maxBodyBytes);
      } catch (error) {
        if (error.code === 'BODY_TOO_LARGE') {
          sendError(res, 413, 'Request body exceeds the configured size limit.', 'invalid_request_error', 'request_too_large');
        } else {
          sendError(res, 400, 'Request body must contain valid JSON.', 'invalid_request_error', 'invalid_json');
        }
        return;
      }

      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof body.model !== 'string' ||
        !body.model.trim() ||
        !Array.isArray(body.messages) ||
        body.messages.length === 0
      ) {
        sendError(res, 400, 'model and a non-empty messages array are required.', 'invalid_request_error', 'invalid_request');
        return;
      }

      if (!registry[body.model]) {
        sendError(res, 400, 'The requested model does not exist.', 'invalid_request_error', 'model_not_found');
        return;
      }

      if (body.stream === true) {
        sendError(res, 400, 'Streaming is not supported yet.', 'invalid_request_error', 'stream_not_supported');
        return;
      }

      const { model, messages, ...options } = body;

      try {
        const result = await runtime.chat({
          model,
          messages,
          ...options
        });

        if (
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          !Array.isArray(result.choices)
        ) {
          sendError(res, 502, 'The AI service returned an invalid response.', 'api_error', 'invalid_response');
          return;
        }

        sendJson(res, 200, sanitizeChatResponse(result, model));
      } catch (error) {
        const [status, message, code] = providerError(error);

        sendError(res, status, message, 'api_error', code);
      }
    } catch {
      sendError(res, 500, 'Internal server error.', 'server_error', 'internal_error');
    }
  });
}
