# Privacy

The KnobDeck VS Code Companion:

- **collects nothing and sends nothing.** It has no analytics, no telemetry and no crash
  reporting, and it connects to nothing but KnobDeck on your own computer.
- **listens only on your own computer** (`127.0.0.1`), so other devices on your network can't reach
  it, and it refuses requests from web pages.
- **answers only KnobDeck**, which asks it to run editor commands and to list your tasks, launch
  configurations, terminals and open files so you can pick one on a button. That information goes
  no further than KnobDeck on the same computer.
- **stores only its own settings** (port, optional password, on/off) in VS Code's settings.

The password, if you set one, is stored in plain text in VS Code's settings and in KnobDeck's
plugin settings on the same computer. It stops other programs on your computer from using the
companion; it isn't meant to protect anything beyond that.

For KnobDeck itself see the [KnobDeck privacy policy](https://knobdeck.harshalkudale.com/legal/privacy).
Questions: support@harshalkudale.com.
