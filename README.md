# OTK CLI

**OpenTokens in your terminal.** Not a pile of subcommands — a chat.

```
  ██████╗ ████████╗██╗  ██╗
 ██╔═══██╗╚══██╔══╝██║ ██╔╝
 ██║   ██║   ██║   █████╔╝
 ██║   ██║   ██║   ██╔═██╗
 ╚██████╔╝   ██║   ██║  ██╗
  ╚═════╝    ╚═╝   ╚═╝  ╚═╝

             O P E N T O K E N S
                CLI v1.0.0
```

Everything happens **inside** the interactive session: signing in, picking a
model, checking credits, quitting. There is no `otk-cli login`, no
`otk-cli models`. You run one thing:

```bash
otk-cli
```

## Install

```bash
npm install -g otk-cli
otk-cli
```

Or run it straight from a checkout:

```bash
node bin/otk-cli.js
```

Requirements: Node.js 18.17+. Zero runtime dependencies.

## What it feels like

```
  ╭──────────────────────────────────────────────╮
  │ ◉  Agnes 3.0 Flash                           │
  │ Credits · $0.05 / $0.15 per 1M               │
  ╰──────────────────────────────────────────────╯
  ● Luciano   ◈ 12.48 C   ◷ 4 sessions remaining

  You:
  │ Explain WebSockets in two lines

  Toeky:
  ▎ Short answer
  Think of a persistent connection between client and server — no handshake
  per message.

  ╭─ js ──────────────────────────────────────────────────────────────────────╮
  │ const socket = new WebSocket("wss://api.example.com/stream");             │
  ╰───────────────────────────────────────────────────────────────────────────╯
```

- **Dark, neon green, boxed.** Accent colour is reserved for signals
  (bullet, gutter, labels) so the prose stays readable.
- **`You:` gets a gutter (`│`), `Toeky:` never does.** Assistant replies are
  plain rendered markdown.
- **Streaming.** Replies appear token by token; finished blocks are committed
  to the scrollback while the block being written is repainted in place.
- **Model cards, not a text list.** The first thing you do after signing in is
  confirm a model from cards built entirely from backend data.

## The unauthenticated state

With no valid session the CLI shows a dedicated setup screen and then runs the
whole browser login for you:

1. The CLI asks OpenTokens for a one-time code + secret.
2. It opens `https://opentokens.is-so.pro/cli/login?code=…` in your browser
   (and prints the link plus the code, in case there is no browser).
3. It polls until you approve, then says `✓ Successfully signed in.` and drops
   you straight into model selection.

You never copy a token. The session is stored at `~/.otk/config.json` with
owner-only permissions and reused on the next run; if it expires or the server
rejects it (HTTP 401), OTK CLI returns to the setup screen on its own.

## Commands

Commands start with `/` and are handled by the CLI, never sent to the model.
`/help` lists exactly what is supported:

| Command | What it does |
| --- | --- |
| `/help` | The command list |
| `/models` | Every available model, as cards |
| `/model [name]` | Switch model (opens the selector, or matches a name) |
| `/account` | Email, credits, sessions, member since |
| `/credits` | Current balance |
| `/clear` | Clear the conversation and the screen |
| `/login` | Sign in again |
| `/version` | CLI and runtime versions |
| `/exit` | Leave cleanly |

## Credits vs free sessions

Models that spend credits and models that use your daily free sessions are
presented differently, so you always know what a message costs:

```
  ◉ Free session started
  ⏱ 58:12 remaining
```

The composer footer always shows the current model, and either the credit
balance (`◈ 12.48 C`) or the live session countdown. After every reply a single
faint line reports what it cost (`0.0023 C · 412 tokens`). Problems like an
insufficient balance or exhausted sessions arrive as a friendlier message with
a hint about what to do next.

## Input

The composer is a box with a status footer. It supports:

- multi-line input (`Ctrl+J` or `Alt/Option+Enter` for a newline)
- `↑`/`↓` history, `←`/`→` and `Ctrl+←`/`Ctrl+→` word movement
- `Ctrl+A`/`Home`, `Ctrl+E`/`End`, `Ctrl+U`, `Ctrl+K`, `Ctrl+W`, `Esc` to clear
- `Ctrl+C` clears the composer, and exits when it is already empty
- `Ctrl+D` exits on an empty composer

## Flags

```bash
otk-cli --version     # print the version
otk-cli --help        # short help page
otk-cli --no-color    # disable colour for this run
otk-cli --ascii       # plain ASCII borders and glyphs
```

Unknown arguments are not errors: the CLI explains that it is interactive and
starts the session.

When stdout is not a TTY, OTK CLI degrades to a quiet line-based mode so it can
be piped.

## Configuration

| Path | Contents |
| --- | --- |
| `~/.otk/config.json` | CLI token + expiry (mode `600`) |
| `~/.otk/prefs.json` | Last model used, account email |

Environment overrides (mostly useful for development and tests):
`OTK_CONFIG_DIR`, `OTK_API_BASE`, `OTK_WEB_BASE_URL`, `OTK_NO_COLOR`,
`OTK_ASCII`.

## Layout

```
bin/otk-cli.js        executable shim
src/index.js          flag parsing and boot
src/app.js            banner -> setup -> model -> chat, plus re-login recovery
src/api.js            OpenTokens client (login, models, chat, SSE streaming, account)
src/config.js         token + preference persistence
src/format.js         model names, prices, credits, durations
src/help.js           --help page
src/screens/setup.js  unauthenticated welcome and browser login flow
src/screens/chat.js   chat loop, streaming, commands, session timer
src/screens/panels.js /help, /account, /credits, /models, error cards
src/screens/modelCards.js  model cards shared by every surface
src/ui/               banner, boxes, markdown, highlighter, composer, selector, live renderer
src/util/             ANSI-aware width/wrapping helpers, browser opener
```

## Tests

```bash
npm test
```

The suite covers the ANSI wrapping primitives, markdown rendering (including
streaming stability), the editor and caret layout, the API client, the live
renderer and composer drawing (asserted through a small terminal emulator that
applies cursor moves and erases), and an end-to-end run against a mock
OpenTokens backend.
