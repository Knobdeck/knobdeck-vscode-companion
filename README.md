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

1. Install this extension. Its action server starts on `127.0.0.1:32145`, and the status bar shows
   **KnobDeck**.
2. Optional: set a password under **Settings → Extensions → KnobDeck VS Code Companion**.
3. In KnobDeck, install the **VS Code** plugin and enter the same port and password in its setup.

To find a command ID for **Custom Command**, run **KnobDeck: Copy a Command ID** from the Command
Palette.

### Several windows

Every VS Code window runs the extension, but only one can hold the port. KnobDeck controls the
window you used last: when you focus another window, it takes over. The status bar shows
**KnobDeck** with a broadcast icon in the connected window, and a disconnected icon in the others.

### Remote windows

In Remote SSH, WSL and Dev Container windows the extension runs on your own computer, next to
KnobDeck, so nothing needs forwarding.

## Settings

| Setting | Default | |
|---|---|---|
| `knobdeck.port` | `32145` | Port of the action server. |
| `knobdeck.password` | empty | KnobDeck must send this password. |
| `knobdeck.autostart` | `true` | Start the server when VS Code starts. |

## Privacy and security

The extension sends nothing anywhere and collects no data. Its server listens only on `127.0.0.1`,
so other computers can't reach it. It also refuses requests from web pages, so a website you visit
can't drive your editor. See the [KnobDeck privacy policy](https://knobdeck.harshalkudale.com/legal/privacy).

## Commands

- **KnobDeck: Connect This Window to KnobDeck**
- **KnobDeck: Stop the Action Server**
- **KnobDeck: Show Connection Status**
- **KnobDeck: Copy a Command ID**

The HTTP interface is documented in
[PROTOCOL.md](https://github.com/HarshalKudale/knobdeck-companion/blob/master/PROTOCOL.md).
