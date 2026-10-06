# Leverage for Claude Code

Use Claude Code as a window on a Leverage session. The turn runs in Leverage,
and Claude Code shows it as its own. Your teammates see the same session in
Leverage, and they can join it from there.

## Requirements

- Claude Code 2.1.286 or later
- The Leverage CLI, signed in (`leverage login`)

## Install

```sh
claude plugin marketplace add thepresciencecompany/claude
claude plugin install leverage@leverage
```

## Use

Open Claude Code on a space, or on one session:

```sh
leverage claude <space>
leverage claude --session <id>
```

The first prompt starts a session in the space. Like every new session in a
space, it is private until you share it.

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
- **The Leverage pane** lists your spaces, their sessions and connections.
  Press a session to open it in this window. `/leverage` opens the pane again.
- **`/leverage help`** lists the actions: approvals, rename, archive and
  restore, model and effort, the queue, outputs, files, a shell command, changes
  and pull requests, skills, subagents, connectors and history. `/compact` and
  `/rename` act on the Leverage session.

## Your token

`leverage claude` keeps a Claude Code token for your workspace and starts
Claude Code with it. The plugin acts only with that token. In any other Claude
Code session it does nothing. To revoke the token, open Leverage Settings →
External harnesses → Claude Code.

## License

[MIT](LICENSE)
