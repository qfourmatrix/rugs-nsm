# RUGS NSM

Project workspace for the Product Shot Queue app and its local rug data. The app is portable between Macs and supports a full initial data handoff followed by code-only updates.

## Mac handoff

- `Create Transfer Copy.command`: creates a complete recipient copy containing the current rugs, images, generated files, resources, code, and update metadata.
- `1 First Setup.command`: installs a verified private Node.js runtime and Mac-native dependencies without Homebrew or administrator access.
- `2 Start RUGS NSM.command`: builds, starts, and opens the local app.
- `3 Update RUGS NSM.command`: anonymously pulls approved code updates from the public repository without replacing local data or secrets; the recipient needs no GitHub account.

See [MAC_HANDOFF.md](MAC_HANDOFF.md) for the owner and recipient workflow.

The runnable app lives in `app/`. Project-level data, generated artifacts, docs, and tools stay at the root.

## Layout

```txt
.
  app/                    Product Shot Queue Node/Vite app
    server/               Backend API, scanner, queue, providers
    src/                  React/Vite client
    shared/               Shared TypeScript types
    tests/                Vitest contract tests
    public/               Static client assets
    scripts/              App helper scripts
  artifacts/              Local generated/build output, ignored by git
  data/                   Local product data, ignored by git
    legacy-rugs/          Older source folders that use first_image.*
    nsm100k/              Active product root, created on startup
  docs/                   PRD and project notes
  tools/                  Local analysis/scraping helpers
```

## App

Local workstation app for generating, reviewing, retrying, and validating product shots from prepared product folders.

The app is intentionally filesystem-first. By default it uses the `data/nsm100k` folder beside `app/`, regardless of the Mac username or where the project was copied:

```txt
<project folder>/data/nsm100k
```

It must not silently fall back to the older `data/legacy-rugs/` folder or to `first_image.*` files.

## Setup

```bash
cd app
npm install
cp .env.example .env.local
```

Default `.env.local` for safe local development:

```bash
APP_PORT=8787
APP_PRODUCT_ROOT=../data/nsm100k
PROVIDER_MODE=mock
LAOZHANG_API_KEY=
```

Keep `PROVIDER_MODE=mock` until scanner, queue, review actions, provider parsing, and tests are passing.

## Run

```bash
cd app
npm run dev
```

Expected local URLs:

- Client: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

Build and preview:

```bash
cd app
npm run build
npm run preview
```

## Test

```bash
cd app
npm test
npm run test:watch
```

The tests under `tests/**` are contract tests for the backend/shared seams described in the PRD. If backend file names differ, update the imports at the top of the relevant test file rather than weakening the behavior checks.

Current test coverage:

- `tests/scanner.test.ts`: root bootstrap, no legacy-folder fallback, direct-child scanning, exact `base.*` detection, duplicate bases, missing base warnings, path traversal rejection.
- `tests/master-shots.test.ts`: placeholder creation, valid master-shot loading, duplicate shot ID rejection, unsupported aspect ratio/image size rejection.
- `tests/product-state.test.ts`: product-scoped prompt box persistence and shot-load state replacement without cross-product leakage.
- `tests/asset-store.test.ts`: filename collision shape, accepted asset idempotency, rejected asset idempotency, generated-to-trash movement.
- `tests/queue.test.ts`: Generate Missing enqueues only `empty` shots and skips `review_needed`, `accepted`, `failed`, `generating`, and `rejected_only`.
- `tests/security-provider.test.ts`: nested secret redaction and LaoZhang HTTP 200/no-image response normalization to `NO_IMAGE_DATA`.

Expected backend exports used by tests:

```txt
server/scanner
  ensureProductRoot({ productRoot })
  scanProducts({ productRoot })
  resolveProductImagePath({ productRoot, scan, products, productId, kind, filename })

server/master-shots
  loadMasterShots({ productRoot })
  validateMasterShots(value)

server/product-state
  loadProductState({ productRoot, productId })
  saveProductState({ productRoot, productId, state })
  applyShotToProductState({ state, shot, now })

server/asset-store
  buildAssetBasename({ shotId, now, existingAssetIds })
  acceptAsset({ productRoot, productId, assetId })
  rejectAsset({ productRoot, productId, assetId })

server/queue
  selectGenerateMissingShots({ shots, aggregates })

server/security
  redactSecrets(value, { additionalSecrets })

server/providers/laozhang
  parseLaoZhangImageResponse(responseBody)
```

Prepared product folders must be direct children of `data/nsm100k/`. Each valid product needs exactly one supported base image whose basename is `base`, case-insensitive:

- `base.png`
- `base.jpg`
- `base.jpeg`
- `base.webp`

Examples that must not count as bases:

- `first_image.jpg`
- `base-final.jpg`
- `base.old.png`

## Environment Variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `APP_PORT` | Yes | `8787` | Backend port. |
| `APP_PRODUCT_ROOT` | No | `../data/nsm100k` | Relative paths resolve from `app/`; absolute external-drive paths are also supported. |
| `PROVIDER_MODE` | Yes | `mock` | Use `mock` first. Use real provider only after tests pass. |
| `LAOZHANG_API_KEY` | Only for real provider | empty | Store only in `.env.local`. Never put it in URLs, logs, metadata, or frontend code. |

## Mock-First Workflow

1. Keep `PROVIDER_MODE=mock`.
2. Start the app and let the backend create `data/nsm100k/` and `master-shots.json`.
3. Add 2-3 sample product folders under `data/nsm100k/`.
4. Include one valid `base.*`, one missing-base product, and one duplicate-base product.
5. Generate mock shots for the valid product.
6. Accept one output, reject one output, and retry one failed or rejected output.
7. Restart the app and confirm state, generated cards, trash, and compare mode persist.
8. Run `npm test`.
9. Only then set real provider mode and test one paid generation with concurrency `1`.

## Security Warning

Treat any LaoZhang API key that was pasted into chat, logs, screenshots, or committed files as exposed. Rotate it before enabling real provider mode.

The app must redact secrets before saving metadata or job logs. `.env.local` must stay out of git.
