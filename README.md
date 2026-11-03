# claude-watch

A live terminal view of a Claude Code session: the main agent, every subagent
it spawns, what each one is doing right now, and how many tokens each has used.

```
                      ╔════════════════════════════════════════════════════╗
                      ║ main session                                       ║
                      ║ opus 5.5                                           ║
                      ║ ◐ Agent Map the repo                               ║
                      ║ 1.2M tok · ctx 157k                                ║
                      ║ 61 tools · 14m05s                                  ║
                      ╚════════════════════════════════════════════════════╝
                                                │
                               delegated to 2 subagents · 1 running
                                                ▼
                   ╭────────────────────────────╮ ╭────────────────────────────╮
                   │ Map the repo               │ │ Find call sites            │
                   │ Explore · haiku 5.5        │ │ general-purpose · sonnet 5.5│
                   │ ✓ done                     │ │ ◑ Grep login\(             │
                   │ 280k tok · ctx 51.7k       │ │ 31k tok · ctx 18.2k        │
                   │ 7 tools · 42s              │ │ 3 tools · 9s               │
                   ╰────────────────────────────╯ ╰────────────────────────────╯
┌──────────────────────────────────────────────────────────────────────────────┐
│ session log                                                                  │
│ 12:37:42 main             → Agent Find call sites                            │
│ 12:37:44 Find call sites  → Grep login\(                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

It only **reads** Claude Code's session logs (`~/.claude/projects/<project>/<session>.jsonl`
and `<session>/subagents/agent-*.jsonl`); it never talks to Claude or changes anything.

## Install

Requires Node 20+ and macOS (for opening iTerm2/Terminal automatically).

```sh
git clone https://github.com/<you>/claude-watch ~/.claude/claude-watch
cd ~/.claude/claude-watch
npm ci && npm run build
cp config.example.json config.json   # optional
```

## Use it by hand

```sh
node ~/.claude/claude-watch/dist/cli.js                 # most recently active session
node ~/.claude/claude-watch/dist/cli.js <session-id>
node ~/.claude/claude-watch/dist/cli.js <path/to/session.jsonl>
```

Press `q` to quit.

## Open it automatically when subagents start

Add a `SubagentStart` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "node ~/.claude/claude-watch/dist/cli.js hook", "timeout": 15 }
        ]
      }
    ]
  }
}
```

When a subagent starts and at least `minSubagents` are running, the hook opens
the watcher for that session, **once per session**. It tries each placement in
`placement` order until one works:

| placement | what happens                                                       |
|-----------|--------------------------------------------------------------------|
| `split`   | splits Claude's iTerm2 pane; the watcher appears beside it         |
| `tab`     | new tab in Claude's iTerm2 window                                  |
| `window`  | new iTerm2 window (or a Terminal.app window outside iTerm2)        |

The hook never prints anything, always exits 0, and does nothing when Claude
isn't running in a terminal (SDK, CI). Its decisions are logged to
`state/hook.log`.

The first time it runs, macOS asks whether your terminal may control iTerm2.
Allow it, or no pane will open.

## Config

`~/.claude/claude-watch/config.json` (or the path in `$CLAUDE_WATCH_CONFIG`):

| key              | default                       | meaning                                                      |
|------------------|-------------------------------|--------------------------------------------------------------|
| `enabled`        | `true`                        | `false` stops the hook from opening anything                 |
| `placement`      | `["split", "tab", "window"]`  | where to open, tried in order                                |
| `splitDirection` | `"vertical"`                  | `vertical` = side by side, `horizontal` = below              |
| `minSubagents`   | `1`                           | open once this many subagents are running at the same time   |
| `keepFocus`      | `true`                        | give keyboard focus back to Claude after opening a split/tab |
| `intervalMs`     | `500`                         | how often the watcher checks the logs                        |

## What the numbers mean

- **tok**: tokens processed by that agent so far: input + cache reads + cache
  writes + output, summed over every model reply (each reply counted once).
- **ctx**: size of the agent's most recent prompt, i.e. how full its context is.
- **tools**: number of tool calls made.
- Status: `◐` running, `○` idle (waiting for you), `✓` done.

## Develop

```sh
npm test          # vitest
npm run dev       # tsc --watch
```

## License

MIT
