# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/leverage-dark.svg"><img src="docs/leverage-light.svg" alt="Leverage Computer" height="32"></picture> Leverage for Claude Code

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3f3f46?labelColor=0a0a0a" alt="MIT license"></a>
<a href="https://github.com/leverage-computer/claude-plugin/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/leverage-computer/claude-plugin/ci.yml?branch=main&label=CI&labelColor=0a0a0a&color=3f3f46" alt="CI status"></a>
<a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fleverage-computer%2Fclaude-plugin%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=Version&labelColor=0a0a0a&color=3f3f46" alt="Plugin version"></a>
<a href="#requirements"><img src="https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.286-3f3f46?labelColor=0a0a0a" alt="Claude Code 2.1.286 or later"></a>

[Install](#install) · [Use](#use) ·
[What you get](#what-you-get) · [Access](#access) · [leverage.computer](https://leverage.computer)

[![Setting up Leverage in Claude Code: add the marketplace, install the plugin, open a session from /leverage, and prompt it](docs/setup.gif)](docs/setup.mp4)


## Install


### Requirements

- Claude Code 2.1.286 or later
- A Leverage account

```sh
claude plugin marketplace add leverage-computer/claude-plugin
claude plugin install leverage@leverage
```

## Use

- `/leverage login`: sign in, and approve in the browser.
- `/leverage`: open the pane.
- Press a session to run it here: click it, or ctrl+x tab, Tab to it, Enter.

To start a new session in a space, use the Leverage CLI:

```sh
leverage claude <space>
```

## What you get

- **One session, two places.** Text and thinking stream as Leverage writes
  them.
- **Teammates.** Shared visibility of our messages, status, typing indicators
  inside of Claude Code.
- **Steering.** Enter over a running turn steers it. ctrl+x enter keeps the
  prompt in Claude Code's queue, where you can edit it or take it back, until
  its turn starts.
- **Approvals and questions** show in Claude Code's own dialogs.
- **Subagents** run Leverage subagents as Claude Code's own agents.
- **The Leverage pane** lists your spaces, their sessions.
  `/leverage` opens the pane again.
- **`/leverage help`** lists the actions you can do with Leverage mod.

## Access

- The plugin uses the token in `~/.claude/leverage.json`, or your Leverage CLI
  config.
- `/leverage login` sets it up. `/leverage logout` removes it.
- Leverage Settings → Integrations revokes it.

## License

[MIT](LICENSE)
