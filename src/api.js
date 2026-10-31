import { getToken } from './config.js';
import { AuthError, CliError, UsageError, errorFromResponse } from './errors.js';

const DEFAULT_ENDPOINT = 'https://www.yuque.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

function encodePath(segment) {
  return encodeURIComponent(segment);
}

export function encodeNamespace(namespace) {
  const parts = String(namespace || '').split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new UsageError('Repository must use <owner>/<slug> format');
  }

  return parts.map((part) => encodeURIComponent(part)).join('/');
}

export function repoPath(repo) {
  return `/repos/${encodeNamespace(repo)}`;
}

export function docPath(repo, doc) {
  if (!doc) {
    throw new UsageError('Document slug or ID must not be empty');
  }
  return `${repoPath(repo)}/docs/${encodePath(doc)}`;
}

export function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function unwrap(value) {
  return value?.data ?? value;
}

function normalizePath(path) {
  const text = String(path || '').trim();
  if (!text.startsWith('/')) {
    throw new UsageError('API path must start with "/"');
  }
  if (text.startsWith('//')) {
    throw new UsageError('API path must not start with "//"');
  }
  const pathname = text.split(/[?#]/, 1)[0];
  if (pathname.split('/').includes('..')) {
    throw new UsageError('API path must not contain ".." segments');
  }
  return text;
}

function getEndpoint(endpoint) {
  return String(endpoint || process.env.YUQUE_ENDPOINT || DEFAULT_ENDPOINT).replace(
    /\/$/,
    ''
  );
}

function getTimeoutMs(timeoutMs) {
  const value = Number(
    timeoutMs ?? process.env.YUQUE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  );
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError('Timeout must be a positive number of milliseconds');
  }
  return value;
}

function getRetries(retries) {
  const value = Number(retries ?? process.env.YUQUE_RETRIES ?? DEFAULT_RETRIES);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError('Retries must be a non-negative integer');
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt, response) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1000, 5_000);
  }
  return 250 * 2 ** attempt;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw errorFromResponse(
        response.status,
        null,
        text.trim().slice(0, 500) ||
          `Yuque API request failed with status ${response.status}`
      );
    }
    throw new CliError(
      `Yuque API returned invalid JSON with HTTP ${response.status}`,
      {
        code: 'INVALID_RESPONSE',
        status: response.status,
        payload: text
      }
    );
  }
}

export async function request(path, options = {}) {
  const {
    method = 'GET',
    params,
    body,
    token,
    endpoint,
    timeoutMs,
    retries,
    unwrapResponse = true
  } = options;

  const upperMethod = String(method).toUpperCase();
  if (!HTTP_METHODS.has(upperMethod)) {
    throw new UsageError(
      `Unsupported HTTP method "${method}"; use ${[...HTTP_METHODS].join(', ')}`
    );
  }

  const authToken = token || (await getToken());
  if (!authToken) {
    throw new AuthError();
  }

  const apiPath = normalizePath(path);
  let url;
  try {
    url = new URL(`${getEndpoint(endpoint)}/api/v2${apiPath}`);
  } catch (error) {
    throw new UsageError(`Invalid API endpoint or path: ${error.message}`, {
      cause: error
    });
  }
  if (url.pathname !== '/api/v2' && !url.pathname.startsWith('/api/v2/')) {
    throw new UsageError('API path must stay below /api/v2');
  }
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const maxRetries =
    upperMethod === 'GET' ? getRetries(retries) : 0;
  const requestTimeout = getTimeoutMs(timeoutMs);

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    let response;

    try {
      response = await fetch(url, {
        method: upperMethod,
        headers: {
          'User-Agent': 'yuque-cli',
          'X-Auth-Token': authToken,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      if (
        RETRYABLE_STATUS.has(response.status) &&
        upperMethod === 'GET' &&
        attempt < maxRetries
      ) {
        await response.body?.cancel();
        await sleep(retryDelay(attempt, response));
        continue;
      }

      const payload = await parseResponse(response);
      if (!response.ok) {
        throw errorFromResponse(
          response.status,
          payload,
          `Yuque API request failed with status ${response.status}`
        );
      }

      return unwrapResponse ? unwrap(payload) : payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new CliError(`Request timed out after ${requestTimeout} ms`, {
          code: 'TIMEOUT',
          cause: error
        });
      }
      if (error instanceof CliError) throw error;
      throw new CliError(`Unable to reach the Yuque API: ${error.message}`, {
        code: 'NETWORK_ERROR',
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function getUser(options = {}) {
  return request('/user', options);
}

export async function listRepos(options = {}) {
  try {
    return normalizeArray(await request('/user/repos', options));
  } catch (error) {
    if (error?.status !== 404) throw error;
  }

  const user = await getUser(options);
  if (!user?.id) {
    throw new CliError('Unable to resolve the authenticated user ID', {
      code: 'INVALID_RESPONSE'
    });
  }
  return normalizeArray(await request(`/users/${encodePath(user.id)}/repos`, options));
}

export async function getRepo(repo, options = {}) {
  return request(repoPath(repo), options);
}

export async function listDocs(repo, options = {}) {
  return normalizeArray(await request(`${repoPath(repo)}/docs`, options));
}

export async function getDoc(repo, slug, options = {}) {
  return request(docPath(repo, slug), options);
}

export async function searchDocs(repo, query, options = {}) {
  return normalizeArray(
    await request('/search', {
      ...options,
      params: {
        ...(options.params || {}),
        q: query,
        type: 'doc',
        scope: repo
      }
    })
  );
}

export async function createDoc(repo, payload, options = {}) {
  return request(`${repoPath(repo)}/docs`, {
    ...options,
    method: 'POST',
    body: payload
  });
}

async function resolveDocId(repo, identifier, options) {
  const value = String(identifier || '');
  if (/^\d+$/.test(value)) return value;

  const doc = await getDoc(repo, value, options);
  if (doc?.id === undefined || doc.id === null || doc.id === '') {
    throw new CliError(
      `Unable to resolve the document ID for "${value}"`,
      { code: 'INVALID_RESPONSE' }
    );
  }
  return String(doc.id);
}

export async function updateDoc(repo, identifier, payload, options = {}) {
  const id = await resolveDocId(repo, identifier, options);
  return request(`${repoPath(repo)}/docs/${encodePath(id)}`, {
    ...options,
    method: 'PUT',
    body: payload
  });
}

export async function deleteDoc(repo, identifier, options = {}) {
  const id = await resolveDocId(repo, identifier, options);
  return request(`${repoPath(repo)}/docs/${encodePath(id)}`, {
    ...options,
    method: 'DELETE'
  });
}

export async function apiRequest(method, path, options = {}) {
  return request(path, {
    ...options,
    method,
    unwrapResponse: false
  });
}
