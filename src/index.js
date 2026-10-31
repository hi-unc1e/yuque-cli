#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import chalk from 'chalk';
import { startRepl } from './repl.js';
import { splitRepoDoc } from './utils.js';
import {
  whoami,
  listRepos,
  listDocs,
  openDoc,
  readDoc,
  readRepo,
  searchDocs,
  createDoc,
  updateDoc,
  deleteDoc,
  apiRequest
} from './commands.js';
import { CliError, EXIT_CODES, UsageError } from './errors.js';
import {
  printDocTable,
  printError,
  printJson,
  printRepoTable
} from './output.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

async function readStdinText() {
  process.stdin.setEncoding('utf8');
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function confirmOnTty(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const answer = await new Promise((resolve) => rl.question(`${message} [y/N] `, resolve));
  rl.close();
  return /^y(?:es)?$/i.test(answer.trim());
}

function addOutputOptions(command) {
  return command.option('--json', 'Print the complete API response as JSON');
}

function addConnectionOptions(command) {
  return command
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds');
}

function addListOptions(command) {
  addOutputOptions(command);
  addConnectionOptions(command);
  return command.option('-q, --quiet', 'Print identifiers only');
}

function parseNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new InvalidArgumentError(`Expected a non-negative integer, received "${value}"`);
  }
  return number;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError(`Expected a positive integer, received "${value}"`);
  }
  return number;
}

function apiOptions(options) {
  return {
    endpoint: options.endpoint,
    timeoutMs: options.timeout
  };
}

function emitJson(value, options, stdout) {
  if (options.json) {
    printJson(value, stdout);
    return true;
  }
  return false;
}

function requireRepoDoc(input) {
  const parsed = splitRepoDoc(input);
  if (!parsed?.repo || !parsed?.doc) {
    throw new UsageError('Use <repo>/<doc> format');
  }
  return parsed;
}

function parseVisibility(payload, options) {
  if (options.public && options.private) {
    throw new UsageError('Use only one of --public or --private');
  }
  if (options.public) payload.public = 1;
  if (options.private) payload.public = 0;
}

function parseQueryPairs(values) {
  const params = {};
  for (const pair of values || []) {
    const index = pair.indexOf('=');
    const key = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? 'true' : pair.slice(index + 1);
    if (!key) throw new UsageError('Query parameters must use key=value format');
    if (params[key] === undefined) {
      params[key] = value;
    } else if (Array.isArray(params[key])) {
      params[key].push(value);
    } else {
      params[key] = [params[key], value];
    }
  }
  return params;
}

export function createProgram(deps = {}) {
  const {
    startReplFn = startRepl,
    whoamiFn = whoami,
    listReposFn = listRepos,
    listDocsFn = listDocs,
    openDocFn = openDoc,
    readDocFn = readDoc,
    readRepoFn = readRepo,
    searchDocsFn = searchDocs,
    createDocFn = createDoc,
    updateDocFn = updateDoc,
    deleteDocFn = deleteDoc,
    apiRequestFn = apiRequest,
    readFileFn = fs.readFile,
    readStdinFn = readStdinText,
    confirmFn = confirmOnTty,
    stdout = console.log,
    stderr = (message) => console.error(chalk.red(message))
  } = deps;

  const program = new Command();

  program
    .name('yuque')
    .description('Scriptable REST-style client for the Yuque Open API')
    .version(packageJson.version)
    .showHelpAfterError()
    .showSuggestionAfterError();
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => stdout(text.replace(/\n$/, '')),
    writeErr: (text) => stderr(text.replace(/\n$/, ''))
  });

  const run = async (options, action) => {
    try {
      await action();
    } catch (error) {
      const err =
        error instanceof CliError
          ? error
          : new CliError(error?.message || String(error), { cause: error });
      printError(err, { json: Boolean(options?.json), stderr });
      process.exitCode = err.exitCode;
    }
  };

  const readBody = async (options) => {
    if (options.body !== undefined && options.bodyFile !== undefined) {
      throw new UsageError('Use only one of --body or --body-file');
    }
    if (options.body !== undefined) {
      return { present: true, value: options.body };
    }
    if (options.bodyFile !== undefined) {
      const value =
        options.bodyFile === '-'
          ? await readStdinFn()
          : await readFileFn(options.bodyFile, 'utf8');
      return { present: true, value };
    }
    return { present: false, value: undefined };
  };

  const addBodyOptions = (command) =>
    command
      .option('--body <markdown>', 'Markdown body')
      .option('--body-file <path>', 'Read Markdown from a file, or "-" for stdin');

  const addVisibilityOptions = (command) =>
    command
      .option('--public', 'Set visibility to public')
      .option('--private', 'Set visibility to private');

  program
    .command('repl')
    .description('Start interactive mode')
    .action(async () => {
      await startReplFn();
    });

  const auth = program.command('auth').description('Authentication helpers');
  auth
    .command('status')
    .description('Show the authenticated Yuque account')
    .option('--json', 'Print the complete API response as JSON')
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .action(async (options) => {
      await run(options, async () => {
        const user = await whoamiFn(apiOptions(options));
        if (emitJson(user, options, stdout)) return;
        stdout(`${user.name || user.login} (${user.id})`);
      });
    });

  program
    .command('whoami')
    .description('Show the authenticated Yuque account')
    .option('--json', 'Print the complete API response as JSON')
    .action(async (options) => {
      await run(options, async () => {
        const user = await whoamiFn(apiOptions(options));
        if (emitJson(user, options, stdout)) return;
        stdout(`${user.name || user.login} (${user.id})`);
      });
    });

  const repos = program
    .command('repos')
    .alias('repo')
    .alias('books')
    .description('Work with repositories (knowledge bases)');

  addListOptions(repos.command('list').description('List visible repositories')).action(
    async (options) => {
      await run(options, async () => {
        const items = await listReposFn(apiOptions(options));
        if (emitJson(items, options, stdout)) return;
        if (options.quiet) {
          items.forEach((item) => stdout(item.namespace));
          return;
        }
        printRepoTable(items, stdout);
      });
    }
  );

  addOutputOptions(
    addConnectionOptions(repos.command('get').argument('<repo>').description('Get one repository'))
  ).action(async (repo, options) => {
    await run(options, async () => {
      const item = await readRepoFn(repo, apiOptions(options));
      if (emitJson(item, options, stdout)) return;
      stdout(`${item.namespace || repo}\t${item.name || '-'}`);
    });
  });

  const docs = program
    .command('docs')
    .alias('doc')
    .description('Work with documents');

  addListOptions(
    docs
      .command('list')
      .argument('<repo>')
      .option('--offset <n>', 'Result offset', parseNonNegativeInteger)
      .option('--limit <n>', 'Maximum results', parsePositiveInteger)
      .description('List documents')
  ).action(
    async (repo, options) => {
      await run(options, async () => {
        const items = await listDocsFn(repo, {
          ...apiOptions(options),
          params: {
            offset: options.offset,
            limit: options.limit
          }
        });
        if (emitJson(items, options, stdout)) return;
        if (options.quiet) {
          items.forEach((item) => stdout(item.slug));
          return;
        }
        printDocTable(items, stdout);
      });
    }
  );

  addOutputOptions(
    addConnectionOptions(
      docs
        .command('get')
        .argument('<repo>')
        .argument('<doc>', 'Document slug or numeric ID')
        .option('--meta', 'Print metadata instead of the Markdown body')
        .description('Get one document')
    )
  ).action(async (repo, doc, options) => {
    await run(options, async () => {
      const item = await readDocFn(repo, doc, apiOptions(options));
      if (emitJson(item, options, stdout)) return;
      if (options.meta) {
        stdout(`${item.title || '-'}\t${repo}/${item.slug || doc}\t${item.updated_at || '-'}`);
        return;
      }
      stdout(item.body || item.body_draft || '');
    });
  });

  addVisibilityOptions(
    addBodyOptions(
      addOutputOptions(
        addConnectionOptions(
          docs
            .command('create')
            .argument('<repo>')
            .option('--title <title>', 'Document title')
            .option('--slug <slug>', 'Document slug')
            .description('Create a document')
        )
      )
    )
  ).action(async (repo, options) => {
    await run(options, async () => {
      if (!options.title) throw new UsageError('--title is required when creating a document');
      const body = await readBody(options);
      const payload = {
        title: options.title,
        slug: options.slug,
        body: body.present ? body.value : ''
      };
      parseVisibility(payload, options);
      const item = await createDocFn(repo, payload, apiOptions(options));
      if (emitJson(item, options, stdout)) return;
      stdout(`Created ${repo}/${item.slug || options.slug || item.id}`);
    });
  });

  addVisibilityOptions(
    addBodyOptions(
      addOutputOptions(
        addConnectionOptions(
          docs
            .command('update')
            .argument('<repo>')
            .argument('<doc>')
            .option('--title <title>', 'New document title')
            .option('--slug <slug>', 'New document slug')
            .description('Update a document body or metadata')
        )
      )
    )
  ).action(async (repo, doc, options) => {
    await run(options, async () => {
      const body = await readBody(options);
      const payload = {};
      if (options.title !== undefined) payload.title = options.title;
      if (options.slug !== undefined) payload.slug = options.slug;
      if (body.present) payload.body = body.value;
      parseVisibility(payload, options);
      if (!Object.keys(payload).length) {
        throw new UsageError(
          'Nothing to update; provide --body, --body-file, --title, --slug, --public, or --private'
        );
      }
      const item = await updateDocFn(repo, doc, payload, apiOptions(options));
      if (emitJson(item, options, stdout)) return;
      stdout(`Updated ${repo}/${item.slug || doc}`);
    });
  });

  addOutputOptions(
    addConnectionOptions(
      docs
        .command('delete')
        .argument('<repo>')
        .argument('<doc>')
        .option('-y, --yes', 'Skip the interactive confirmation')
        .description('Delete a document')
    )
  ).action(async (repo, doc, options) => {
    await run(options, async () => {
      if (!options.yes) {
        const confirmed = await confirmFn(`Delete ${repo}/${doc}?`);
        if (!confirmed) {
          throw new CliError('Deletion cancelled', { code: 'CANCELLED' });
        }
      }
      const result = await deleteDocFn(repo, doc, apiOptions(options));
      if (emitJson(result, options, stdout)) return;
      stdout(`Deleted ${repo}/${doc}`);
    });
  });

  addListOptions(
    docs
      .command('search')
      .argument('<query>')
      .requiredOption('--repo <repo>', 'Repository namespace')
      .option('--offset <n>', 'Result offset', parseNonNegativeInteger)
      .option('--limit <n>', 'Maximum results', parsePositiveInteger)
      .description('Search documents in a repository')
  ).action(async (query, options) => {
    await run(options, async () => {
      const items = await searchDocsFn(options.repo, query, {
        ...apiOptions(options),
        params: {
          offset: options.offset,
          limit: options.limit
        }
      });
      if (emitJson(items, options, stdout)) return;
      if (options.quiet) {
        items.forEach((item) => stdout(item.slug));
        return;
      }
      printDocTable(items, stdout);
    });
  });

  const api = program.command('api').description('Call any Yuque REST API endpoint');
  api
    .command('request')
    .argument('<method>', 'HTTP method')
    .argument('<path>', 'Path below /api/v2, for example /user')
    .option('--query <key=value>', 'Repeatable query parameter', (value, previous) => previous.concat(value), [])
    .option('--data <json>', 'JSON request body')
    .option('--data-file <path>', 'Read a JSON request body from a file, or "-" for stdin')
    .option('--json', 'Print the complete REST response as JSON')
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .description('Make an authenticated REST request')
    .action(async (method, path, options) => {
      await run(options, async () => {
        if (options.data !== undefined && options.dataFile !== undefined) {
          throw new UsageError('Use only one of --data or --data-file');
        }

        let body;
        if (options.data !== undefined) {
          body = parseJson(options.data, '--data');
        } else if (options.dataFile !== undefined) {
          const text =
            options.dataFile === '-'
              ? await readStdinFn()
              : await readFileFn(options.dataFile, 'utf8');
          body = parseJson(text, options.dataFile);
        }

        const result = await apiRequestFn(method, path, {
          ...apiOptions(options),
          params: parseQueryPairs(options.query),
          body
        });
        printJson(result, stdout);
      });
    });

  program
    .command('list')
    .argument('<type>', 'repos|docs')
    .argument('[repo]', 'Repository namespace')
    .option('--json', 'Print the complete API response as JSON')
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .description('Legacy alias for repos list / docs list')
    .action(async (type, repo, options) => {
      await run(options, async () => {
        const runtime = apiOptions(options);
        if (type === 'repos') {
          const items = await listReposFn(runtime);
          if (emitJson(items, options, stdout)) return;
          items.forEach((item) => stdout(item.namespace));
          return;
        }
        if (type === 'docs') {
          if (!repo) throw new UsageError('Repo required');
          const items = await listDocsFn(repo, runtime);
          if (emitJson(items, options, stdout)) return;
          items.forEach((item) => stdout(item.slug));
          return;
        }
        throw new UsageError('Type must be repos or docs');
      });
    });

  program
    .command('open')
    .argument('<repoDoc>', 'repo/doc')
    .description('Open a document in the browser')
    .action(async (repoDoc) => {
      await run({}, async () => {
        await openDocFn(repoDoc);
      });
    });

  program
    .command('show')
    .argument('<repoDoc>', 'repo/doc')
    .option('--json', 'Print the complete API response as JSON')
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .description('Show a document body (legacy alias for docs get)')
    .action(async (repoDoc, options) => {
      await run(options, async () => {
        const { repo, doc } = requireRepoDoc(repoDoc);
        const item = await readDocFn(repo, doc, apiOptions(options));
        if (emitJson(item, options, stdout)) return;
        stdout(item?.body || item?.body_draft || '');
      });
    });

  program
    .command('search')
    .argument('<query>')
    .argument('<repo>', 'Repository namespace')
    .option('--json', 'Print the complete API response as JSON')
    .option('--endpoint <url>', 'Yuque endpoint (default: https://www.yuque.com)')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .description('Search documents (legacy alias for docs search)')
    .action(async (query, repo, options) => {
      await run(options, async () => {
        const items = await searchDocsFn(repo, query, apiOptions(options));
        if (emitJson(items, options, stdout)) return;
        items.forEach((item) => stdout(item.title || item.slug));
      });
    });

  return program;
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new UsageError(`Invalid JSON from ${source}: ${error.message}`, {
      cause: error
    });
  }
}

export async function main(argv = process.argv, deps = {}) {
  const program = createProgram(deps);
  if (argv.length <= 2) {
    const startReplFn = deps.startReplFn || startRepl;
    await startReplFn();
    return;
  }
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode !== 0) process.exitCode = EXIT_CODES.USAGE;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    const entryPath = realpathSync(process.argv[1]);
    const currentFilePath = realpathSync(fileURLToPath(import.meta.url));
    return entryPath === currentFilePath;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.stdout.on('error', (error) => {
    if (error?.code === 'EPIPE') process.exit(0);
    throw error;
  });
  await main();
}
