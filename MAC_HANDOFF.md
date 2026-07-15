# RUGS NSM Mac handoff

This project is designed to be copied once with the complete working library and then updated without replacing either person's local data.

## What the transfer includes

`Create Transfer Copy.command` copies the current code, `data/`, reference media, generated files, project resources, and clean update metadata. The current transfer payload is approximately 5.5 GB.

The transfer intentionally excludes:

- `app/.env.local`, because it contains private per-Mac configuration and may contain an API key;
- `app/node_modules/`, because native dependencies such as Sharp must be installed for the recipient Mac;
- `.runtime/`, because First Setup downloads the correct verified Node.js build for Apple Silicon or Intel;
- `artifacts/dist/`, because it is recreated during setup.

## Owner: create the first copy

1. Commit and push approved application changes to the public GitHub repository.
2. Double-click `Create Transfer Copy.command`.
3. Choose an external drive or another destination with at least 7 GB free.
4. Give the resulting `RUGS NSM Transfer …` folder to the recipient.

The transfer copy includes ignored working data even though GitHub does not. Do not manually zip only the files visible in GitHub.

## Recipient: first setup

1. Copy the entire transfer folder to a local folder such as Documents. Do not run the app directly from a removable drive.
2. Control-click `1 First Setup.command`, choose **Open**, and confirm the first launch if macOS asks.
3. Enter a LaoZhang key when prompted, or leave it blank to use mock mode.
4. Wait for dependency installation, tests, and the production build to finish.
5. Double-click `2 Start RUGS NSM.command` and keep its Terminal window open while using the app.
6. Press Control-C in that Terminal window to stop the app.

First Setup downloads Node.js 24.18.0 from the official Node.js distribution, verifies its published SHA-256 checksum, and installs it only inside this project. It does not require Homebrew or administrator access.

## Recipient: future updates

1. Stop the app with Control-C.
2. Double-click `3 Update RUGS NSM.command`.
3. If macOS offers to install its free Command Line Tools, accept once and rerun Update afterward.
4. Wait for the pull, dependency refresh, tests, and build to finish.
5. Start the app again.

The recipient does not need a GitHub account, an invitation, or a GitHub sign-in. Updates are read anonymously from the public repository.

The updater uses a fast-forward-only Git pull and refuses to overwrite locally modified application code. The following remain local and are excluded from Git updates:

- `data/` — products, base images, references, generated assets, job history, and product state;
- `app/.env.local` — API key and provider settings;
- `artifacts/`, `Inspo/`, and `Theme FIles/` — local/generated/reference media.

## Publishing an update

1. Make and test the application change on the owner Mac.
2. Commit the code change.
3. Push it to the public repository's `main` branch.
4. Tell the recipient to run `3 Update RUGS NSM.command`.

Never commit `.env.local`, API keys, or the working `data/` tree.
