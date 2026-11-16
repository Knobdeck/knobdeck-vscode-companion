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
them in both test runs. CI does this on Linux and Windows (macOS too when run by hand).

`test/compat/driver.mjs` is a copy of `compat/driver.mjs` in knobdeck-companion; keep them in step.

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Merge to `master`, then tag and push: `git tag v1.2.3 && git push origin v1.2.3`.

`.github/workflows/release.yml` runs the tests, packages the `.vsix`, publishes it to the Visual
Studio Marketplace and Open VSX, and creates a GitHub release with it.

Publishing uses **Trusted Publishing** (GitHub OIDC); the repo holds no store tokens. Both stores
have a policy trusting `Knobdeck/knobdeck-vscode-companion`, workflow `release.yml`, environment
`release`. Renaming the workflow, environment or repo breaks publishing until the policies are
updated:

- Visual Studio Marketplace: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
  → publisher `knobdeck` → **Trusted Publishing**.
- Open VSX: [open-vsx.org/user-settings/trusted-publishers](https://open-vsx.org/user-settings/trusted-publishers),
  namespace `knobdeck`.
