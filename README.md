# Leverage for Claude Code

Use Claude Code as a window on a Leverage session. The turn runs in Leverage,
and Claude Code shows it as its own. Your teammates see the same session in
Leverage, and they can join it from there.

[![Setting up Leverage in Claude Code: add the marketplace, install the plugin, open a session from /leverage, and prompt it](docs/setup.gif)](docs/setup.mp4)

[Watch the video](docs/setup.mp4) (15s): install the plugin from Claude Code,
open a session from `/leverage`, and send it a prompt.

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

Run `/leverage login` and approve in the browser, then `/leverage` to open the
pane. Press a session to run it here: click it, or ctrl+x tab, Tab to it,
Enter.

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

The plugin uses the token in `~/.claude/leverage.json`, or your Leverage CLI
config. Set it up with `/leverage login`; `/leverage logout` removes it.
Leverage Settings → Integrations revokes it.

## License

[MIT](LICENSE)
