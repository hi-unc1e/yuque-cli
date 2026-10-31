import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as api from '../src/api.js';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

let originalFetch = global.fetch;
let originalXdg = process.env.XDG_CONFIG_HOME;
let originalToken = process.env.YUQUE_TOKEN;
let originalEndpoint = process.env.YUQUE_ENDPOINT;
let originalHome = process.env.HOME;

test.beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yuque-cli-test-'));
  process.env.XDG_CONFIG_HOME = tmp;
  process.env.HOME = tmp;
  process.env.YUQUE_TOKEN = 'tkn';
  delete process.env.YUQUE_ENDPOINT;
  global.fetch = originalFetch;
});

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalToken === undefined) delete process.env.YUQUE_TOKEN;
  else process.env.YUQUE_TOKEN = originalToken;
  if (originalEndpoint === undefined) delete process.env.YUQUE_ENDPOINT;
  else process.env.YUQUE_ENDPOINT = originalEndpoint;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

test('listRepos uses /user/repos directly when available', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse(200, { data: [{ namespace: 'a/b' }] });
  };

  const repos = await api.listRepos();
  assert.deepEqual(repos, [{ namespace: 'a/b' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v2\/user\/repos$/);
});

test('listRepos falls back to /users/{id}/repos on 404', async () => {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/api/v2/user/repos')) {
      return jsonResponse(404, { message: 'Not Found' });
    }
    if (u.endsWith('/api/v2/user')) {
      return jsonResponse(200, { data: { id: 11 } });
    }
    if (u.endsWith('/api/v2/users/11/repos')) {
      return jsonResponse(200, { data: [{ namespace: 'x/y' }] });
    }
    return jsonResponse(500, { message: 'unexpected url' });
  };

  const repos = await api.listRepos();
  assert.deepEqual(repos, [{ namespace: 'x/y' }]);
  assert.deepEqual(calls, [
    'https://www.yuque.com/api/v2/user/repos',
    'https://www.yuque.com/api/v2/user',
    'https://www.yuque.com/api/v2/users/11/repos'
  ]);
});

test('listDocs/searchDocs normalize array response shapes', async () => {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/repos/a/b/docs')) {
      return jsonResponse(200, { data: { data: [{ slug: 'd1' }] } });
    }
    if (u.includes('/search')) {
      return jsonResponse(200, { data: { items: [{ title: 'd2' }] } });
    }
    return jsonResponse(500, { message: 'unexpected url' });
  };

  const docs = await api.listDocs('a/b');
  const results = await api.searchDocs('a/b', 'k');
  assert.deepEqual(docs, [{ slug: 'd1' }]);
  assert.deepEqual(results, [{ title: 'd2' }]);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /scope=a%2Fb/);
});

test('createDoc posts JSON body and getDoc returns data', async () => {
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/repos/a/b/docs/s1')) {
      return jsonResponse(200, { data: { slug: 's1' } });
    }
    if (String(url).includes('/repos/a/b/docs')) {
      return jsonResponse(200, { data: { id: 9 } });
    }
    return jsonResponse(500, { message: 'unexpected url' });
  };

  const created = await api.createDoc('a/b', { title: 't', slug: 's1', body: 'x' });
  const found = await api.getDoc('a/b', 's1');

  assert.deepEqual(created, { id: 9 });
  assert.deepEqual(found, { slug: 's1' });

  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.body, JSON.stringify({ title: 't', slug: 's1', body: 'x' }));
});

test('throws AUTH_ERROR when auth missing', async () => {
  delete process.env.YUQUE_TOKEN;
  global.fetch = async () => jsonResponse(200, { data: [] });

  await assert.rejects(
    () => api.listRepos(),
    (err) => {
      assert.equal(err.code, 'AUTH_ERROR');
      assert.equal(err.exitCode, 3);
      return true;
    }
  );
});

test('updateDoc and deleteDoc use REST methods and JSON bodies', async () => {
  const seen = [];
  global.fetch = async (url, options) => {
    const request = { url: String(url), options };
    seen.push(request);
    if (request.options.method === 'GET') {
      return jsonResponse(200, { data: { id: 42, slug: 's1' } });
    }
    return jsonResponse(200, { data: { id: 42, slug: 's1' } });
  };

  const updated = await api.updateDoc('a/b', 's1', { title: 'New title' });
  const deleted = await api.deleteDoc('a/b', 's1');

  assert.deepEqual(updated, { id: 42, slug: 's1' });
  assert.deepEqual(deleted, { id: 42, slug: 's1' });
  assert.deepEqual(
    seen.map(({ options }) => options.method),
    ['GET', 'PUT', 'GET', 'DELETE']
  );
  assert.equal(seen[1].options.body, JSON.stringify({ title: 'New title' }));
  assert.equal(seen[3].options.body, undefined);
  assert.match(seen[0].url, /\/repos\/a\/b\/docs\/s1$/);
  assert.match(seen[1].url, /\/repos\/a\/b\/docs\/42$/);
  assert.match(seen[2].url, /\/repos\/a\/b\/docs\/s1$/);
  assert.match(seen[3].url, /\/repos\/a\/b\/docs\/42$/);
});

test('updateDoc and deleteDoc accept numeric document IDs without a lookup', async () => {
  const methods = [];
  global.fetch = async (_url, options) => {
    methods.push(options.method);
    return jsonResponse(200, { data: { id: 42 } });
  };

  await api.updateDoc('a/b', 42, { title: 'New title' });
  await api.deleteDoc('a/b', '42');

  assert.deepEqual(methods, ['PUT', 'DELETE']);
});

test('getRepo encodes the repository path', async () => {
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return jsonResponse(200, { data: { namespace: 'a/b' } });
  };

  assert.deepEqual(await api.getRepo('a/b'), { namespace: 'a/b' });
  assert.match(requestedUrl, /\/api\/v2\/repos\/a\/b$/);
});

test('apiRequest preserves the full response and serializes query values', async () => {
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return jsonResponse(200, { data: { total: 2 } });
  };

  const result = await api.apiRequest('GET', '/search', {
    params: { q: 'hello world', tag: ['a', 'b'] }
  });

  assert.deepEqual(result, { data: { total: 2 } });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get('q'), 'hello world');
  assert.deepEqual(url.searchParams.getAll('tag'), ['a', 'b']);
});

test('request rejects unsupported HTTP methods before calling fetch', async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    return jsonResponse(200, {});
  };

  await assert.rejects(
    () => api.apiRequest('TRACE', '/user'),
    (err) => err?.code === 'USAGE_ERROR'
  );
  assert.equal(called, false);
});

test('repository and raw API paths reject malformed traversal', async () => {
  await assert.rejects(
    () => api.getRepo('a/b/c'),
    (err) => err?.code === 'USAGE_ERROR'
  );
  await assert.rejects(
    () => api.apiRequest('GET', '/../user'),
    (err) => err?.code === 'USAGE_ERROR'
  );
  await assert.rejects(
    () => api.apiRequest('GET', '/%2e%2e/user'),
    (err) => err?.code === 'USAGE_ERROR'
  );
});

test('request maps HTTP errors to standard CLI errors', async () => {
  global.fetch = async () => jsonResponse(404, { message: 'No such doc' });
  await assert.rejects(
    () => api.getDoc('a/b', 'missing'),
    (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      assert.equal(err.exitCode, 4);
      assert.equal(err.status, 404);
      return true;
    }
  );

  global.fetch = async () => jsonResponse(429, { message: 'Slow down' });
  await assert.rejects(
    () => api.apiRequest('POST', '/repos/a/b/docs', { retries: 0 }),
    (err) => {
      assert.equal(err.code, 'RATE_LIMITED');
      assert.equal(err.exitCode, 5);
      return true;
    }
  );
});
