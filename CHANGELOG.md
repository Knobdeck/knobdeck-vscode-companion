# Changelog

## 1.0.0

- First release as **KnobDeck VS Code Companion**.
- Local action server for the KnobDeck `vscode` plugin: commands, tasks, launch configurations, terminals and open editors.
- With several VS Code windows open, KnobDeck controls the one you used last; the others wait and take over when focused.
- Listens on `127.0.0.1` only, refuses requests from web pages, optional password.
- Works in Remote (SSH, WSL, containers) windows: the extension runs on your machine, next to KnobDeck.
- Status bar item and **KnobDeck: Copy a Command ID** for the Custom Command action.
