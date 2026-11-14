'use strict';

// Launches a real VS Code with the companion loaded and runs test/e2e/suite.js inside it.
// KNOBDECK_VSCODE_PLUGIN (a built KnobDeck `vscode` plugin) makes the suite drive VS Code through it.
// VSCODE_VERSION picks the VS Code build (default: stable).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const workspace = path.join(__dirname, 'workspace');
  for (const f of fs.readdirSync(path.join(workspace, 'out'))) if (f.endsWith('.marker')) fs.rmSync(path.join(workspace, 'out', f));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-vscode-user-'));
  await runTests({
    version: process.env.VSCODE_VERSION || 'stable',
    extensionDevelopmentPath: path.resolve(__dirname, '../..'),
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    launchArgs: [workspace, '--user-data-dir', userData, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { KNOBDECK_VSCODE_PLUGIN: process.env.KNOBDECK_VSCODE_PLUGIN || '' },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
