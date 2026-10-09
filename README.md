# Mission Control

A Claude Code mod that keeps you and Claude aware of context and usage limits, picks the right model for each job, and keeps working while you're away, safely.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install mission-control --marketplace ShagnikPal123/mission-control
```

Answer `y` to add the marketplace and pick a scope. It loads straight away, and in the desktop Code tab too.

## What you get

**Band above the chat box**
- A zone badge: OK / WATCH / WARN / HIGH / DANGER. In DANGER it pulses until you press **Got it**.
- Context, 5-hour limit and weekly limit, each with a bar and its reset time.
- A context sparkline.
- A pace marker that shows whether you are burning through the 5-hour window faster than the clock.
- Agents running against the cap, and session cost.
- **⇄ Layout** cycles Bar / Side / Compact; **🔒** locks the layout.
- **▤ panel** (key `1`) opens the side panel.

**Side panel**
- Meters, model, a quality trend for the session, live agents and approvals, task progress, and split tasks still queued.
- Each agent's model, effort and type with a **tell** button; projects (this chat marked); a token-analysis line.
- Agent messages, the last proof card, cost today with a 14-day sparkline, and quick `@doc` buttons.
- Notes: anything that failed, said plainly.

**Limits and resuming**
- Phone and desktop alerts at 90% and when you hit a limit.
- Automatic resume after the reset. A bare "try again" sent while you are still limited is held.
- **Good morning:** if you've been away, the resume starts an unattended run that stops as soon as you type.

**Router**
- Haiku reads each prompt and picks the model and effort: Haiku for reading, Sonnet for everyday edits, Opus for big work.
- It steps up after repeated failures, and gets thriftier as the 5-hour window fills.
- Subagents get the cheapest model that fits, a cap on how many run at once, approve / deny / auto-approve, and ≤80-word reports.

**Proof card:** every turn that changed files ends with `✓ tests 12 pass · ✓ build · ✗ not browser-checked · ✓ committed · – not pushed`.

**Context health:** scores each turn. When quality drops significantly as context fills, or the trend says it soon will, Claude writes `.mission-control/HANDOFF.md`, the session compacts, and work continues from the handoff.

**Split:** a message holding several separate requests runs as one task at a time. Say "same chat" to keep them together.

**Language:** fixes common typos (whole words, never inside code or paths), adds a glossary of your own terms, and includes an `interpret-owner` skill.

**`/midnight [hours] [--ship]`:** an unattended run.
- Claude decides on its own, logs each decision to `MIDNIGHT_LOG.md`, keeps going, and stops at the time limit, the weekly budget, `MIDNIGHT_DONE`, or 3 errors in a row.
- It won't push, deploy or delete outside the project without `--ship`, which also runs the secret scan.

**`/god [minutes]`:** no permission prompts for a limited time, after a confirmation pop-up.
- Hard stops still ask: deleting outside the project, disk and registry changes, credentials, money, force-push, piping a downloaded script into a shell.
- Medium-risk calls get a quick Haiku check against what you asked for.
- It never overrides your deny rules.

**`/ship`:** tests, build, the never-ship check (`AI_HANDOFF/`, `.env`, keys, plus your own patterns from `/ship never <pattern>`), secret scan, commit, push, deploy. Every `git push` is checked against the never-ship list, even outside `/ship`.

**Projects:** `/project add <name> = <folder>` registers a project. In the desktop app, each chat is filed under "<project> · Updates" or "<project> · Questions".

**Overlay (Windows):** a slim pill at the top centre of the screen while Claude isn't the window in use. Hover to see the details; **Open Claude** brings Claude back. It needs Python on PATH. `/mc overlay off` turns it off.

## Commands

| Command | What it does |
|---|---|
| `/mc` | State, and switches: `panel` (open the side panel), `model pin <haiku\|sonnet\|opus>`, `model auto`, `router on\|off`, `opus on\|off`, `agents <n>`, `resume on\|off`, `alerts on\|off`, `overlay on\|off`, `typo <wrong> <right>`, `glossary <term> = <meaning>`, `tokens` |
| `/midnight` | `[hours] [--ship]`, `off`, `status` |
| `/god` | `[minutes]`, `off`, `log` |
| `/look` | Quote the text you selected into the prompt and ask Claude to check it |
| `/ship` | `/ship`, `/ship never <pattern>`, `/ship never` |
| `/project` | `/project`, `/project add <name> = <folder>` |

## Your own settings

Personal words, docs and projects live in `~/.claude/mission-control/config.json`, which is never published:

```json
{
  "glossary": { "second mind": "the Second Brain panel" },
  "docs": ["AI_HANDOFF/START_HERE.md"],
  "projects": [{ "name": "My App", "path": "C:/code/my-app" }]
}
```

## Development

```
claude plugin validate .
claude plugin test .
python -m unittest discover overlay
```

Mods run with your full user permissions. Read the code before you install any mod, this one included.

## License

MIT
