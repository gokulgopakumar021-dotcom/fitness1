# Dependency overrides

## `glob` and `minimatch` (IL-05)

`package.json` forces `glob` to `^14.0.3` and `minimatch` to `^11.0.4`:

```json
"overrides": { "glob": "^14.0.3", "minimatch": "^11.0.4" }
```

**Why.** `npm audit` reports GHSA-3g3m-2fjr-6pw4 (`glob` 9.0.0 to 14.0.1: an abort signal does not stop a running search)
and GHSA-g3hv-75wg-m249 (`minimatch` before 11.0.1: denial of service through crafted patterns). Both are reached only
through `@capacitor/cli` -> `rimraf` -> `glob` -> `minimatch`, all **dev** dependencies (`npm audit --omit=dev`: 0
vulnerabilities). The Capacitor CLI uses `rimraf` in two places, `cap migrate` and the iOS archive build, on its own build folders.

**Why an override and not an upgrade.** `@capacitor/cli` 8.6.0 is the latest stable release and needs `rimraf ^6.0.1`;
the newest `rimraf` (6.1.3) needs `glob ^13`, the vulnerable range. `9.0.0-beta.0` still uses `rimraf ^6` and needs Node 24 or later.
`npm audit fix --force` would downgrade the CLI to 4.8.2 and is not used.

**Trade-off.** `rimraf` 6 declares `glob ^13`, so `glob` 14 is a combination its maintainers have not published. Checked
here: `cap --version` runs; `rimraf` deletes plain folders and glob patterns; `glob` rejects an already-aborted search.
**Not checked:** the CLI against real Android or iOS projects (none exist in the repo yet), and Windows installs.
`minimatch` 11 and `path-scurry` 3 need Node 20 or later (the CLI already needs Node 22 or later).

**When to remove it.** Delete the `overrides` block, run `npm install`, and check `npm audit` as soon as a
`@capacitor/cli` release ships a dependency chain that resolves `glob >= 14.0.2` and `minimatch >= 11.0.1` by itself.
Then delete `src/test/devDependencyOverrides.test.ts`, which fails while the override is missing or a vulnerable copy is locked.
