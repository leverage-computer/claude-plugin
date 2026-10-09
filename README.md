# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/leverage-dark.svg"><img src="docs/leverage-light.svg" alt="Leverage Computer" height="32"></picture> Leverage for Claude Code

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3f3f46?labelColor=0a0a0a" alt="MIT license"></a>
<a href="https://github.com/leverage-computer/claude-plugin/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/leverage-computer/claude-plugin/ci.yml?branch=main&label=CI&labelColor=0a0a0a&color=3f3f46" alt="CI status"></a>
<a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fleverage-computer%2Fclaude-plugin%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=Version&labelColor=0a0a0a&color=3f3f46" alt="Plugin version"></a>
<a href="#requirements"><img src="https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.286-3f3f46?labelColor=0a0a0a" alt="Claude Code 2.1.286 or later"></a>

[leverage.computer](https://leverage.computer) · [Install](#install) · [Use](#use) ·
[What you get](#what-you-get) · [Access](#access)

**Use Claude Code as a window on a Leverage session.** The turn runs in Leverage,
and Claude Code shows it as its own. Your teammates see the same session in
Leverage, and they can join it from there.

[![Setting up Leverage in Claude Code: add the marketplace, install the plugin, open a session from /leverage, and prompt it](docs/setup.gif)](docs/setup.mp4)

## Requirements

- Claude Code 2.1.286 or later
- A Leverage account

## Install

In Claude Code:

```
/plugin marketplace add leverage-computer/claude-plugin
/plugin install leverage@leverage
```

Pick "Install for you (user scope)". The plugin is active right away, with no
restart.

Or from a terminal:

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
  them. Tool calls show as Claude Code's own. Esc stops the turn in Leverage.
- **Teammates.** A prompt a teammate sends from Leverage opens a turn here,
  under their name. Above the prompt, you see who else has the session open,
  and who types. They see you type too.
- **Steering.** Enter over a running turn steers it. ctrl+x enter keeps the
  prompt in Claude Code's queue, where you can edit it or take it back, until
  its turn starts.
- **Approvals and questions** show in Claude Code's own dialogs.
- **Subagents** run as Claude Code's own agents: their steps show under the
  Agent call and in Claude Code's agents view.
- **The Leverage pane** lists your spaces, their sessions and connections,
  with who else has each session open and who types there. Press a session to
  open it in this window. Under the session open here, the pane shows the
  calls that wait on you, the queue, the files its last turn wrote and its
  changes, and lets you act on each.
  `/leverage` opens the pane again.
- **`/leverage help`** lists the actions: approvals, rename, archive and
  restore, model and effort, the queue, outputs, files, a shell command, changes
  and pull requests, skills, connectors and history. `/compact` and
  `/rename` act on the Leverage session.

## Access

- The plugin uses the token in `~/.claude/leverage.json`, or your Leverage CLI
  config.
- `/leverage login` sets it up. `/leverage logout` removes it.
- Leverage Settings → Integrations revokes it.

## License

[MIT](LICENSE)
