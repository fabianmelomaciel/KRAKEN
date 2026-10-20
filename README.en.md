# AI Monitor

A local panel to watch, live, what your coding agents are up to. Active
sessions on top, finished ones at the bottom, with tokens, cost, tools, diffs,
checklists and subagents. Everything runs on your machine: the monitor reads
what the IDEs already wrote and sends nothing anywhere.

![The panel on desktop](docs/img/visor-desktop.png)

It is a cross-platform product: Windows, macOS and Linux. Zero runtime
dependencies, no telemetry, no update check, no `postinstall`.

## Install

```bash
npm i -g git+https://github.com/fabianmelomaciel/visor-ia.git
```

Or without installing anything:

```bash
npx git+https://github.com/fabianmelomaciel/visor-ia.git serve
```

You need **Node 22.13 or newer**: the opencode database is read with
`node:sqlite`, which is still experimental. On an older Node the panel still
starts: it warns and keeps going with Claude Code and the events.

## Start

```bash
visor serve
```

It listens on `http://localhost:<port>` (ephemeral port by default) and opens
the browser. The first load carries the token in the query string:

```
http://localhost:51998/?token=<128 bits in hex>
```

The panel stores it in `localStorage`, takes it out of the URL and from then
on sends it in the header. To pin a port:

```bash
visor serve --port 8080
```

Flags: `--port N` (0 = ephemeral), `--host H`, `--no-browser`, `--lang es|en|pt`,
`--dir PATH` (state somewhere else, for testing).

The panel only listens on `127.0.0.1` and validates the `Host`: anything but
`127.0.0.1:<port>` or `localhost:<port>` gets a 403. With `--host` pointing
somewhere else it warns on the console that it is exposed to the network.

## The three sources

| Source | Where | What comes out |
| --- | --- | --- |
| opencode | `~/.local/share/opencode/opencode.db` | sessions, agent, model, tokens, cost, diff, todos, tool, subagents |
| Claude Code | `~/.claude/projects/*/*.jsonl` | sessions, model, tokens, tool, subagents |
| events | the state JSONL | triggers the tick and says which session finished |

**Official sources: opencode and Claude Code.** For Cursor, Antigravity and
Copilot there is an **ingestion contract**, not a native integration: those
IDEs leave no readable data in a stable format, so the monitor does not
guess. If your agent can expose events, send them yourself:

```bash
visor emit --kind session.step --sid my-agent --src cursor --tool read
```

or over HTTP:

```bash
curl -X POST http://127.0.0.1:51998/api/event \
  -H "X-Visor-Token: <the token>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"session.step","sid":"my-agent","src":"cursor","tool":"read"}'
```

The JSONL is no longer the source of truth: it **triggers** the read and is
the only thing that can mark a session as finished. If the plugin or the hook
does not say so, the panel says "idle for Xm" and never invents the end.

## Instrumenting the IDEs (opt-in)

The monitor **does not touch your IDEs** by default. `visor install-ide` is
for whoever wants the exact "it finished" signal and the live trigger:

```bash
visor install-ide          # install
visor install-ide --dry-run  # show what it would do
```

The installer does two things:

1. copies the plugin to `~/.config/opencode/plugins/` (`visor-feed.js` plus
   `visor-eventos.js`);
2. merges the Claude Code hooks into `~/.claude/settings.json` (backup in
   `.bak`, never replaces what was there).

It is idempotent: run it as many times as you want. And `visor uninstall`
takes everything back: it removes the plugin, restores the hooks from the
`.bak`, drops the autostart and clears the state (`--keep-state` leaves it).

### Claude Code hooks

| Hook | What it records |
| --- | --- |
| `SessionStart` | opens the card |
| `UserPromptSubmit` | the session moved again |
| `PreToolUse` | one more step (with the tool name) |
| `Stop` / `SessionEnd` | closes the card |

## What it shows and what it does not

Per session: name, project, IDE, agent, model, state, bar, tokens (input,
output, cache), cost, duration, last tool and its state, diff `+add/−del`,
message count, task checklist and nested subagents.

Global: active sessions, finished ones, live agents, accumulated tokens,
accumulated cost, global percentage (only with a real denominator), the clock
of the last read, the status light and the project column.

**Never leaves the machine**: the text of the prompts, the text of the
answers, `tool.input` nor `tool.output`. Everything that does leave goes
through a secret filter (`sk-…`, `ghp_…`, `AKIA…`, private keys, `Bearer …`,
JWT, `npm_…`) and a 200 character cap per field.

The snapshot **carries no absolute paths**: a project shows up with its name
and a short hash of the path, so the panel does not tell which folder you
live in. The allowlist inside still uses the full path.

The HTML render is `textContent` and `createElement` only: there is no
`innerHTML` anywhere.

## The allowlist

By default the allowlist is **your home directory**: what lives under it is
shown, nothing else. To tune it, write `permisos.json` in the config folder:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\VisorIA\permisos.json` |
| macOS | `~/Library/Application Support/VisorIA/permisos.json` |
| Linux | `$XDG_CONFIG_HOME/visor-ia/permisos.json` (or `~/.config/visor-ia/permisos.json`) |

```json
{
  "raices": ["C:\\proyectos\\mi-repo", "/home/usuario/codigo"],
  "dias": 30,
  "nivel": "metadata"
}
```

- `raices`: a session whose directory falls under no root is **not shown**.
  An empty list denies everything.
- `dias`: Claude Code transcripts older than this are not even read.
- `nivel`: `metadata` is the only implemented level. Prompt text is never
  exposed at any level.

`visor doctor` tells you where everything is and whether the sources are
there.

## Security

- A **128 bit token is mandatory** on every `/api/*` route: no token (or the
  wrong one) gets a 401. It lives in the state file, mode 0600.
- The IDE database is opened **read-only**: `readOnly`,
  `PRAGMA query_only=1` and `busy_timeout`. The monitor never creates the
  database and never indexes it.
- The HTML CSP carries a nonce per response and no `unsafe-inline`.
- The state lives in the OS folder (`%LOCALAPPDATA%\VisorIA`,
  `~/Library/Application Support/VisorIA`, `$XDG_STATE_HOME/visor-ia`).
  **Never** in Documents, Desktop, Dropbox or iCloud.
- `/api/events` caps at 24 clients and the frames have a byte cap.
- The state directory is created with mode `700` and the files with `600`
  (on Windows the mode is a warning: there are no POSIX permissions to honour).

## The panel

- Active sessions are **always on top** and, when the order changes, the
  panel scrolls itself up. If you scrolled by hand, it does not step on you.
- Finished sessions are **only the last 5**: the rest never enter the
  snapshot, so they are not in anyone's DOM either.
- In portrait it is a single column, with no horizontal scroll.
- The product name and the labels come in Spanish, English and Portuguese,
  with autodetection (`navigator.language`), `?lang=` and a selector in the
  bar.

![The panel in portrait](docs/img/visor-portrait.png)

## The commands

```bash
visor serve [--port N] [--host H] [--no-browser] [--lang es|en|pt]
visor install-ide [--dry-run]
visor uninstall [--keep-state]
visor autostart [--remove]
visor emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N] [--total N] [--project P]
visor doctor
```

`visor autostart` makes the monitor start on login: Startup folder on
Windows, a LaunchAgent on macOS, a `systemd --user` unit on Linux. **Always
with `--no-browser`**: opening a tab on every login is a nuisance, and on a
shared machine it is a problem. `visor autostart --remove` undoes it.

## Routes

| Route | What it is |
| --- | --- |
| `GET /` | the panel |
| `GET /api/state` | JSON snapshot (with an ETag: 304 when unchanged) |
| `GET /api/events` | SSE with the snapshot when it changes |
| `POST /api/event` | event ingestion |

Any other route gets a 404. The SSE sends the full snapshot to every new
client and then only when something changed: **in idle there are no pushes**.
If the SSE drops, the panel falls back to polling `/api/state`.

The clock adapts: with activity it reads every 3 seconds, idle every 30. A
new event triggers the refresh at 120 milliseconds. The timers are `unref`ed
and the JSONL rotates at 5 MB (three copies) resetting the offset.

## Test

```bash
node test/visor.test.js
```

It starts the server with invented fixture data — never with yours — and
checks the token, the allowlist, the snapshot without absolute paths, the cap
on finished sessions, the order, portrait, the i18n, the degradation without
`node:sqlite` and the privacy boundary. It runs on Windows, macOS and Linux.

## License

MIT. [Versión en español](README.md).
