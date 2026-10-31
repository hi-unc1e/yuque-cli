# Yuque CLI

A command-line client for [Yuque](https://www.yuque.com) with two interfaces:

- a keyboard-first REPL for browsing and editing documents
- a resource-oriented CLI for scripts, automation, and AI agents

中文文档: [`README.zh-CN.md`](README.zh-CN.md)

## Features

- REST-style commands: `repos`, `docs`, and the authenticated `api request` escape hatch
- Document CRUD: list, get, create, update, delete, and search
- JSON output for automation
- Markdown input from an argument, file, or stdin
- Standard error classes and predictable exit codes
- Request timeout, GET retries, and pagination options
- Existing interactive REPL and legacy commands remain available

## Requirements

- Node.js >= 18
- A Yuque personal access token

Create a token at <https://www.yuque.com/settings/tokens>.

## Install

Install this fork directly from GitHub:

```bash
npm install -g github:hi-unc1e/yuque-cli#main
```

Or work from a local checkout:

```bash
git clone git@github.com:hi-unc1e/yuque-cli.git
cd yuque-cli
npm install
npm link
```

## Authentication

Set `YUQUE_TOKEN`:

```bash
export YUQUE_TOKEN="your-token"
yuque auth status
```

The CLI also reads `~/.yuque/settings.json`, and the REPL supports
`auth login` / `auth logout`.

## Quick Start

```bash
# Repositories
yuque repos list
yuque repos list --quiet
yuque repos get owner/repo

# Documents
yuque docs list owner/repo
yuque docs list owner/repo --offset 20 --limit 10
yuque docs get owner/repo doc-slug
yuque docs get owner/repo doc-slug --meta
```

Create and update from a Markdown file:

```bash
yuque docs create owner/repo \
  --title "Deployment notes" \
  --slug deployment-notes \
  --body-file draft.md

yuque docs update owner/repo deployment-notes \
  --body-file draft.md \
  --json

cat draft.md | yuque docs update owner/repo deployment-notes --body-file -
```

Delete with explicit confirmation:

```bash
yuque docs delete owner/repo deployment-notes
yuque docs delete owner/repo deployment-notes --yes
```

Search and request raw API resources:

```bash
yuque docs search "HID" --repo owner/repo
yuque api request GET /user
yuque api request GET /search \
  --query q=HID \
  --query type=doc \
  --query scope=owner/repo
```

Every resource command supports `--json` where the result can be useful to a
script. Paths in `api request` are relative to `/api/v2`.

## REST Mapping

| Yuque API | CLI |
| --- | --- |
| `GET /user` | `yuque whoami` or `yuque auth status` |
| `GET /user/repos` | `yuque repos list` |
| `GET /repos/:namespace` | `yuque repos get <repo>` |
| `GET /repos/:namespace/docs` | `yuque docs list <repo>` |
| `GET /repos/:namespace/docs/:slug` | `yuque docs get <repo> <doc>` |
| `POST /repos/:namespace/docs` | `yuque docs create <repo>` |
| `PUT /repos/:namespace/docs/:id` | `yuque docs update <repo> <doc>` |
| `DELETE /repos/:namespace/docs/:id` | `yuque docs delete <repo> <doc>` |
| Any endpoint | `yuque api request <method> <path>` |

Yuque accepts a slug or ID for document reads, but mutations require the
numeric ID. `docs update` and `docs delete` resolve a slug automatically;
numeric IDs skip that extra lookup.

## JSON And Exit Codes

JSON is written to stdout; errors are written to stderr. Add `--json` to get a
structured error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Not Found",
    "status": 404
  }
}
```

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API, network, or general failure |
| `2` | Invalid command usage |
| `3` | Missing or invalid token |
| `4` | Resource not found |
| `5` | Rate limited |

## Interactive Mode

Run without a subcommand:

```bash
yuque
```

The REPL keeps the original browsing, Markdown pager, command completion, and
document editor workflows.

## Legacy Commands

The original one-shot commands still work:

```bash
yuque list repos
yuque list docs owner/repo
yuque open owner/repo/doc-slug
yuque show owner/repo/doc-slug
yuque search "HID" owner/repo
```

Prefer the resource-oriented commands for new scripts.

## Environment Variables

- `YUQUE_TOKEN`: Yuque API token
- `YUQUE_ENDPOINT`: API endpoint, default `https://www.yuque.com`
- `YUQUE_TIMEOUT_MS`: request timeout, default `30000`
- `YUQUE_RETRIES`: GET retry count, default `2`

## Development

```bash
npm install
npm test
node src/index.js --help
```

## License

MIT
