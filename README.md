# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/leverage-dark.svg"><img src="docs/leverage-light.svg" alt="Leverage Computer" height="24"></picture> Claude on Leverage

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3f3f46?labelColor=0a0a0a" alt="MIT license"></a>
<a href="https://github.com/leverage-computer/claude-plugin/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/leverage-computer/claude-plugin/ci.yml?branch=main&label=CI&labelColor=0a0a0a&color=3f3f46" alt="CI status"></a>
<a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fleverage-computer%2Fclaude-plugin%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=Version&labelColor=0a0a0a&color=3f3f46" alt="Plugin version"></a>
<a href="#requirements"><img src="https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.286-3f3f46?labelColor=0a0a0a" alt="Claude Code 2.1.286 or later"></a>

[Features](#features) · [Recordings](#recordings) · [Install](#install) ·
[Usage](#usage) · [leverage.computer](https://leverage.computer)

[![Setting up Leverage in Claude Code: add the marketplace, install the plugin, open a session from /leverage, and prompt it](docs/setup.gif)](docs/setup.mp4)

## Features

- [**Multiplayer harness**](#multiplayer-harness): shared visibility of our
  messages, status, typing indicators inside of Claude Code.
- [**Company computer**](#company-computer): one session, two places. Turns run
  in Leverage, so Claude Code needs no model sign-in. Text and thinking stream
  as Leverage writes them.
- [**Steering**](#steering): Enter over a running turn steers it. ctrl+x enter
  keeps the prompt in Claude Code's queue, where you can edit it or take it
  back, until its turn starts.
- [**Governance**](#governance): approvals and questions show in Claude Code's
  own dialogs.

## Recordings

### Multiplayer harness

[![A teammate joins the session, types, and sends a prompt from Leverage](docs/teammates.gif)](docs/teammates.mp4)

### Company computer

[![Starting a session in a space and getting an answer](docs/first-session.gif)](docs/first-session.mp4)

### Steering

[![Typing over a running turn: the agent skips the e2e tests and runs the type check instead](docs/steering.gif)](docs/steering.mp4)

### Governance

[![Approving a command in Claude Code's own dialog](docs/approvals.gif)](docs/approvals.mp4)

### The Leverage pane

[![Opening the pane, jumping to a session with its whole history, and working in it](docs/sessions.gif)](docs/sessions.mp4)

The pane lists your spaces, their sessions. A session you open shows its whole
history: prompts, text, tool calls and results. `/leverage` opens the pane
again.

### Also

- **Subagents** run Leverage subagents as Claude Code's own agents.
- **`/leverage help`** lists the actions you can do with Leverage mod.

## Install

### Requirements

- Claude Code 2.1.286 or later
- A Leverage account

```sh
claude plugin marketplace add leverage-computer/claude-plugin
claude plugin install leverage@leverage
```

### Claude Desktop

Claude Desktop's Code tab runs Claude Code, so the plugin works there too.
Add it from Claude Desktop's plugin directory:

1. Open Customize → Plugins and click Discover.
2. Click +, then Add from a repository.
3. Enter `leverage-computer/claude-plugin` and click Sync.
4. Open Leverage and click Install.

[![Setting up Leverage in Claude Desktop: add the marketplace from its plugin directory, install the plugin, sign in with /leverage login, and open a session from the pane](docs/claude-desktop.gif)](docs/claude-desktop.mp4)

## Usage

- `/leverage login`: sign in, and approve in the browser.
- `/leverage`: open the pane.
- Press a session to run it here: click it, or ctrl+x tab, Tab to it, Enter.

To start a new session in a space, use the Leverage CLI:

```sh
leverage claude <space>
```

## License

[MIT](LICENSE)
