# Changelog

## 1.2.1

- Build tooling only: the packager's glob matcher (minimatch) updated for a security advisory. No changes to
  the extension.

## 1.2.0

- Released from the new one-click release workflow (tests on Linux and Windows, then the Visual
  Studio Marketplace and Open VSX). No changes to the extension.

## 1.1.1

- Licensed under MIT (needed to publish on Open VSX). No changes to the extension.

## 1.1.0

- Links to KnobDeck through its **companion hub**: every window links on its own and reports when
  it gains focus, so KnobDeck drives the window you used last. No port and no password; the link
  re-reads KnobDeck's discovery file, so it survives KnobDeck restarts.
- The HTTP action server stays for older KnobDeck versions (`knobdeck.legacyServer`, on by default).
- Status bar and **KnobDeck: Link / Unlink This Window** cover both.

## 1.0.0

- First release as **KnobDeck VS Code Companion**.
- Local action server for the KnobDeck `vscode` plugin: commands, tasks, launch configurations, terminals and open editors.
- With several VS Code windows open, KnobDeck controls the one you used last; the others wait and take over when focused.
- Listens on `127.0.0.1` only, refuses requests from web pages, optional password.
- Works in Remote (SSH, WSL, containers) windows: the extension runs on your machine, next to KnobDeck.
- Status bar item and **KnobDeck: Copy a Command ID** for the Custom Command action.
