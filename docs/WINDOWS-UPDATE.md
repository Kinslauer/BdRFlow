# Updating the fork on Windows

The app's built-in updater pulls upstream Flow releases, not this fork. To get
the fork's latest changes, run `scripts\windows\update-flow.bat` (or the
"Update Flow" shortcut on the desktop). It:

1. checks for Git, pnpm and Rust,
2. pulls the latest `main` into the build copy at `E:\BdRFlow-build\BdRFlow`
   (cloning it if missing, and stashing any local edits there),
3. runs `pnpm install`,
4. builds the NSIS installer with
   `pnpm tauri build --config src-tauri/tauri.local.conf.json --bundles nsis`
   (MSI is skipped because the beta version string isn't numeric), retrying
   once with fewer parallel jobs if the Rust compile runs out of memory,
5. closes Flow if it is running from `E:\Flow` and installs silently there
   (`/S /D=E:\Flow`). The separate "Flow Beta" app is never touched,
6. starts the updated Flow.

All build output, caches and temp files stay on `E:\BdRFlow-build` because C:
is nearly full. Each run writes a log to `E:\BdRFlow-build\logs`. If nothing
changed since the last install, it asks before rebuilding; pass `--force` to
skip that question. Folder settings are at the top of the script.
