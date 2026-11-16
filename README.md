# KnobDeck VS Code Companion

Lets the [KnobDeck](https://knobdeck.harshalkudale.com) dial and deck control Visual Studio Code. It
works in VS Code and in editors built on it that install from Open VSX (VSCodium, Cursor, Windsurf).

KnobDeck's **VS Code** plugin talks to this extension instead of sending keyboard shortcuts, so its
buttons work whatever your keybindings are, and VS Code doesn't need to be focused.

## What KnobDeck can do with it

- Command Palette, Quick Open, Explorer, Search, Source Control, Extensions, Problems
- Save All, Format Document, Split Editor, Zen Mode, toggle the sidebar, panel and terminal
- **Run Task** and a **Task Wheel** listing your tasks
- **Start Debugging** and a **Debug Wheel** listing your launch configurations; Stop Debugging
- **Focus Terminal**, New Terminal
- **Open Editor** and an **Open Editor Wheel** listing your open files
- **Custom Command**: any VS Code command ID

## Setup

1. Install this extension and, in KnobDeck, the **VS Code** plugin.
2. That's it: each VS Code window links to KnobDeck by itself (through KnobDeck's companion hub,
   on `127.0.0.1`), and the status bar shows **KnobDeck** with a broadcast icon once linked. No port
   or password to set; the link survives KnobDeck restarts.

**Older KnobDeck versions** (without the companion hub) reach the extension's HTTP action server on
`127.0.0.1:32145` instead; enter its port and optional password in the plugin's setup. Turn
`knobdeck.legacyServer` off once KnobDeck is up to date.

To find a command ID for **Custom Command**, run **KnobDeck: Copy a Command ID** from the Command
Palette.

### Several windows

Every VS Code window links to KnobDeck on its own, and tells KnobDeck when it gains focus, so
KnobDeck controls the window you used last. (With an older KnobDeck, only one window can hold the
HTTP port; focusing another window hands it over.)

### Remote windows

In Remote SSH, WSL and Dev Container windows the extension runs on your own computer, next to
KnobDeck, so nothing needs forwarding.

## Settings

| Setting | Default | |
|---|---|---|
| `knobdeck.autostart` | `true` | Link to KnobDeck when VS Code starts. |
| `knobdeck.legacyServer` | `true` | Also run the HTTP action server for older KnobDeck versions. |
| `knobdeck.port` | `32145` | Port of that action server. |
| `knobdeck.password` | empty | Password for that action server. |

## Privacy and security

The extension sends nothing anywhere and collects no data. It talks only to KnobDeck on your own
computer: the hub link goes to `127.0.0.1` with a token only your user can read, and its server
listens only on `127.0.0.1`, so other computers can't reach it. It also refuses requests from web pages, so a website you visit
can't drive your editor. See the [KnobDeck privacy policy](https://knobdeck.harshalkudale.com/legal/privacy).

## Commands

- **KnobDeck: Link This Window to KnobDeck**
- **KnobDeck: Unlink This Window from KnobDeck**
- **KnobDeck: Show Connection Status**
- **KnobDeck: Copy a Command ID**

The hub link uses KnobDeck's companion protocol
([REFERENCE.md](https://github.com/Knobdeck/knobdeck-sdk/blob/master/knobdeck-protocol/REFERENCE.md),
via [`@knobdeck/companion`](https://www.npmjs.com/package/@knobdeck/companion)); the HTTP interface
for older KnobDeck versions is in
[PROTOCOL.md](https://github.com/Knobdeck/knobdeck-companion/blob/master/PROTOCOL.md).
