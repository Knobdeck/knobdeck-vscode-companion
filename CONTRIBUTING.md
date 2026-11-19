# Developing the KnobDeck VS Code Companion

One of the [KnobDeck companions](https://github.com/Knobdeck/knobdeck-companion). The HTTP
interface for older KnobDeck versions is in that repo's
[PROTOCOL.md](https://github.com/Knobdeck/knobdeck-companion/blob/master/PROTOCOL.md); ids are a
contract: add, never rename.

## Build and test

Node 20+:

```sh
npm ci
npm test                       # protocol tests with a stand-in vscode module
npm run test:e2e               # in a real VS Code (downloads it; needs a display)
npx vsce package
```

Point `KNOBDECK_VSCODE_PLUGIN` / `KNOBDECK_VSCODE_SETUP` at a built `vscode` / `vscode-setup` from
[knobdeck-plugins](https://github.com/Knobdeck/knobdeck-plugins) (`cargo build -p vscode`) to drive
them in both test runs. CI does this on Linux and Windows (and macOS on pull requests and manual CI runs; releases skip macOS).

`test/compat/driver.mjs` is a copy of `compat/driver.mjs` in knobdeck-companion; keep them in step.

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Merge to `master`; that
   starts the Release workflow, which ships the new version. A push that doesn't bump the version
   only runs CI. To retry the stores for a released version, use **Actions → Release → Run workflow** on `master`.

`.github/workflows/release.yml` runs the tests (Linux and Windows), packages the `.vsix`, creates
the tag `v<version>` and a GitHub release with it, then publishes it to the Visual Studio
Marketplace and Open VSX. Re-running it for a released version only retries the stores.

Publishing uses **Trusted Publishing** (GitHub OIDC); the repo holds no store tokens. Both stores
have a policy trusting `Knobdeck/knobdeck-vscode-companion`, workflow `release.yml`, environment
`release`. Renaming the workflow, environment or repo breaks publishing until the policies are
updated:

- Visual Studio Marketplace: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
  → publisher `knobdeck` → **Trusted Publishing**.
- Open VSX: [open-vsx.org/user-settings/trusted-publishers](https://open-vsx.org/user-settings/trusted-publishers),
  namespace `knobdeck`.
