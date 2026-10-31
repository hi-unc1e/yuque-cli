import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../src/index.js';
import { AuthError } from '../src/errors.js';

function makeIo() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line)
  };
}

test('main starts repl when no args', async () => {
  let called = 0;
  const io = makeIo();
  await main(['node', 'src/index.js'], {
    ...io,
    startReplFn: async () => {
      called += 1;
    }
  });
  assert.equal(called, 1);
});

test('repl command starts interactive mode', async () => {
  let called = 0;
  const io = makeIo();
  await main(['node', 'src/index.js', 'repl'], {
    ...io,
    startReplFn: async () => {
      called += 1;
    }
  });
  assert.equal(called, 1);
});

test('whoami command prints formatted user', async () => {
  const io = makeIo();
  await main(['node', 'src/index.js', 'whoami'], {
    ...io,
    whoamiFn: async () => ({ id: 7, login: 'foo' })
  });
  assert.deepEqual(io.out, ['foo (7)']);
});

test('list repos prints each namespace', async () => {
  const io = makeIo();
  await main(['node', 'src/index.js', 'list', 'repos'], {
    ...io,
    listReposFn: async () => [{ namespace: 'a/b' }, { namespace: 'x/y' }]
  });
  assert.deepEqual(io.out, ['a/b', 'x/y']);
});

test('list docs prints each slug with repo argument', async () => {
  const io = makeIo();
  await main(['node', 'src/index.js', 'list', 'docs', 'a/b'], {
    ...io,
    listDocsFn: async (repo) => {
      assert.equal(repo, 'a/b');
      return [{ slug: 'd1' }, { slug: 'd2' }];
    }
  });
  assert.deepEqual(io.out, ['d1', 'd2']);
});

test('list docs requires repo argument', async () => {
  const io = makeIo();
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  await main(['node', 'src/index.js', 'list', 'docs'], {
    ...io,
    listDocsFn: async () => [{ slug: 'd1' }]
  });

  assert.match(io.err[0], /Repo required/);
  assert.equal(process.exitCode, 2);
  process.exitCode = originalExitCode;
});

test('commander usage errors use the standard exit code', async () => {
  const io = makeIo();
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  await main(['node', 'src/index.js', 'docs', 'get', 'a/b'], io);

  assert.equal(process.exitCode, 2);
  assert.match(io.err[0], /missing required argument/i);
  process.exitCode = originalExitCode;
});

test('open command delegates to openDoc', async () => {
  let got = null;
  const io = makeIo();
  await main(['node', 'src/index.js', 'open', 'a/b/d1'], {
    ...io,
    openDocFn: async (repoDoc) => {
      got = repoDoc;
    }
  });
  assert.equal(got, 'a/b/d1');
});

test('show command prints markdown body', async () => {
  const io = makeIo();
  await main(['node', 'src/index.js', 'show', 'a/b/d1'], {
    ...io,
    readDocFn: async (repo, slug) => {
      assert.equal(repo, 'a/b');
      assert.equal(slug, 'd1');
      return { body: '# doc' };
    }
  });
  assert.deepEqual(io.out, ['# doc']);
});

test('search command prints title or slug', async () => {
  const io = makeIo();
  await main(['node', 'src/index.js', 'search', 'k', 'a/b'], {
    ...io,
    searchDocsFn: async () => [{ title: 'T1' }, { slug: 's2' }]
  });
  assert.deepEqual(io.out, ['T1', 's2']);
});

test('auth status forwards connection options', async () => {
  const io = makeIo();
  await main(
    [
      'node',
      'src/index.js',
      'auth',
      'status',
      '--endpoint',
      'https://example.test',
      '--timeout',
      '1234'
    ],
    {
      ...io,
      whoamiFn: async (options) => {
        assert.deepEqual(options, {
          endpoint: 'https://example.test',
          timeoutMs: '1234'
        });
        return { id: 7, login: 'foo' };
      }
    }
  );

  assert.deepEqual(io.out, ['foo (7)']);
});

test('docs list supports pagination and quiet output', async () => {
  const io = makeIo();
  await main(
    [
      'node',
      'src/index.js',
      'docs',
      'list',
      'a/b',
      '--offset',
      '20',
      '--limit',
      '5',
      '--quiet'
    ],
    {
      ...io,
      listDocsFn: async (repo, options) => {
        assert.equal(repo, 'a/b');
        assert.deepEqual(options.params, { offset: 20, limit: 5 });
        return [{ slug: 'd1' }, { slug: 'd2' }];
      }
    }
  );

  assert.deepEqual(io.out, ['d1', 'd2']);
});

test('docs update reads a Markdown file and sends only provided fields', async () => {
  const io = makeIo();
  await main(
    [
      'node',
      'src/index.js',
      'docs',
      'update',
      'a/b',
      'd1',
      '--title',
      'New title',
      '--body-file',
      'draft.md',
      '--json'
    ],
    {
      ...io,
      readFileFn: async (file, encoding) => {
        assert.equal(file, 'draft.md');
        assert.equal(encoding, 'utf8');
        return '# Updated';
      },
      updateDocFn: async (repo, doc, payload) => {
        assert.equal(repo, 'a/b');
        assert.equal(doc, 'd1');
        assert.deepEqual(payload, {
          title: 'New title',
          body: '# Updated'
        });
        return { slug: 'd1', title: 'New title' };
      }
    }
  );

  assert.equal(JSON.parse(io.out[0]).title, 'New title');
});

test('docs update can read Markdown from stdin', async () => {
  const io = makeIo();
  await main(
    ['node', 'src/index.js', 'docs', 'update', 'a/b', 'd1', '--body-file', '-'],
    {
      ...io,
      readStdinFn: async () => '# From stdin',
      updateDocFn: async (_repo, _doc, payload) => {
        assert.deepEqual(payload, { body: '# From stdin' });
        return { slug: 'd1' };
      }
    }
  );

  assert.deepEqual(io.out, ['Updated a/b/d1']);
});

test('docs delete requires confirmation unless --yes is used', async () => {
  const io = makeIo();
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  await main(['node', 'src/index.js', 'docs', 'delete', 'a/b', 'd1'], {
    ...io,
    confirmFn: async () => false,
    deleteDocFn: async () => {
      assert.fail('deleteDocFn must not be called without confirmation');
    }
  });

  assert.match(io.err[0], /Deletion cancelled/);
  assert.equal(process.exitCode, 1);

  process.exitCode = 0;
  let deleted = null;
  await main(['node', 'src/index.js', 'docs', 'delete', 'a/b', 'd1', '--yes'], {
    ...io,
    confirmFn: async () => assert.fail('confirmation must be skipped'),
    deleteDocFn: async (repo, doc) => {
      deleted = { repo, doc };
    }
  });

  assert.deepEqual(deleted, { repo: 'a/b', doc: 'd1' });
  assert.deepEqual(io.out, ['Deleted a/b/d1']);
  process.exitCode = originalExitCode;
});

test('api request passes query parameters and JSON data', async () => {
  const io = makeIo();
  await main(
    [
      'node',
      'src/index.js',
      'api',
      'request',
      'POST',
      '/repos/a/b/docs',
      '--query',
      'draft=true',
      '--query',
      'tag=one',
      '--query',
      'tag=two',
      '--data',
      '{"title":"T"}'
    ],
    {
      ...io,
      apiRequestFn: async (method, path, options) => {
        assert.equal(method, 'POST');
        assert.equal(path, '/repos/a/b/docs');
        assert.deepEqual(options.params, {
          draft: 'true',
          tag: ['one', 'two']
        });
        assert.deepEqual(options.body, { title: 'T' });
        return { data: { id: 1 } };
      }
    }
  );

  assert.deepEqual(JSON.parse(io.out[0]), { data: { id: 1 } });
});

test('--json prints a structured error and sets the standard exit code', async () => {
  const io = makeIo();
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  await main(
    ['node', 'src/index.js', 'docs', 'get', 'a/b', 'd1', '--json'],
    {
      ...io,
      readDocFn: async () => {
        throw new AuthError('Invalid token');
      }
    }
  );

  assert.equal(process.exitCode, 3);
  assert.deepEqual(JSON.parse(io.err[0]), {
    ok: false,
    error: {
      code: 'AUTH_ERROR',
      message: 'Invalid token'
    }
  });
  process.exitCode = originalExitCode;
});
