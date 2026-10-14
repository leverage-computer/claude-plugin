# Changelog

## 0.1.0 - 2026-10-13

The first release. A Claude Code session runs as a client of a Leverage
session: the turn runs in Leverage, and Claude Code draws it. Needs Claude
Code 2.1.286 or later.

### Added

- **Sign-in.** `/leverage login [workspace]` signs in in the browser and keeps
  the token in Claude Code's config. `/leverage logout` forgets it. A window
  `leverage claude` did not start uses that token, or the Leverage CLI's.
- **One session, two places.** Text and thinking stream as Leverage writes
  them. Esc stops the turn in Leverage too.
- **The Leverage pane.** `/leverage` lists your spaces and their sessions, with
  search. Pressing a session opens it in this window, on the terminal, Claude
  Desktop and VS Code.
- **Session history.** A session opened here draws its earlier turns as Claude
  Code's own: prompts, text, tool calls and results.
- **Teammates.** Above the prompt, who else has the session open, in which
  app, and who is typing. Their prompts and steers show in the transcript.
- **Steering.** Enter over a running turn steers it in Leverage. ctrl+x enter
  keeps the prompt in Claude Code's queue until its turn starts.
- **Approvals and questions** in Claude Code's own dialogs, plan approval
  included. `/leverage approvals` asks again for calls that wait on you.
- **Subagents.** Leverage's subagents run as Claude Code's own agents.
- **Leverage's tool calls** are answered by Leverage and never run here.
  `/compact` and `/rename` act on the Leverage session.
- **`/leverage help`** lists the rest: model, queue, files, outputs, changes,
  skills, connectors, archive and restore, and running a command in the
  session's sandbox.

### Security

- When Leverage fails mid-call, this window fails closed: Leverage's tool call
  is refused instead of running here, a prompt goes back to the box instead of
  starting a turn here, and compaction, `/rename` and subagents are not done
  here either.
