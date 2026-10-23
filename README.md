<p align="center">
  <img src="https://raw.githubusercontent.com/ttsalpha/mirra/refs/heads/main/assets/icon.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Mirra</h1>

Two-way MCP server for Figma: an agent reads a design and renders one back through the
Figma Plugin API, so it needs no REST token and has no per-month call limit.

```
Claude ⇄ stdio ⇄ MCP server ⇄ ws://localhost:51730 ⇄ plugin iframe ⇄ plugin sandbox ⇄ Figma
```

`mirra_read` returns the same tree `mirra_render` accepts, so one format covers reading a
design and building one, and an agent can write code from that tree without learning a
second shape.

## Requirements

- **Figma Desktop.** A development plugin can only be imported there, so the browser app
  and Linux (which has no desktop build) are both out.
- **Node 24 or newer**, and pnpm to build.
- **macOS or Windows.** Only macOS has been run end to end so far.

## Tools

| Tool                  | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `mirra_render`        | Build a whole screen from one declarative tree                                          |
| `mirra_read`          | Read the selection, or a node, back as that same tree                                   |
| `mirra_patch`         | `set` / `append` / `replace` / `move` / `component` / `remove` by key, as one undo step |
| `mirra_find`          | Locate layers by name, kind or key, and select them                                     |
| `mirra_pages`         | List the pages, add one, or switch to one                                               |
| `mirra_screenshot`    | Export a layer as PNG and hand the image back                                           |
| `mirra_tokens`        | List variables and styles, with the `$name` a tree refers to                            |
| `mirra_define_tokens` | Create or update variables, modes, aliases and paint/text/effect styles                 |
| `mirra_export_assets` | Write layers to disk as PNG or SVG                                                      |
| `mirra_ping`          | Check the connection and report the open file                                           |
| `mirra_exec`          | Run Plugin API code; see **Running arbitrary code** below                               |

The tree mirrors flexbox: `layout: {dir, gap, pad, justify, align}`, and `w`/`h` take a
number, `"fill"` or `"hug"`; a frame with a layout hugs its content by default. Node types
are `frame`, `text`, `rect`, `ellipse`, `instance`, `svg` and `image`. Colours are hex
strings or a gradient. Every node also takes `rotation` in degrees,
`minW`/`maxW`/`minH`/`maxH`, `constraints: {h, v}` and `at: {x, y}` to pin it: inside an
auto layout that lifts the node out of the flow, which is how a badge sits on a corner.

A `"$name"` follows a variable instead of repeating a value: a colour on `fill`, `stroke`
or a text `color`, a number on `gap`, `pad`, `radius`, the stroke `width` and a text
`size`, `lineHeight` or `letterSpacing`. Figma binds the field, so changing the variable
moves every layer that uses it. `w`/`h` are the exception: they stay numbers.

The DSL has no type of its own for a component, a component set, a group or a section, so
`mirra_read` hands each back as a frame, and a vector, star, polygon, line or boolean
operation as the `svg` that redraws it. Rendering that tree makes plain frames again, which
`mirra_patch` can turn into components.

`svg` and `image` take `src` as inline content or as a path on disk: the server reads the
file and inlines it, then records the path so `mirra_read` names it again rather than
handing back a data URI.

## Install

```sh
npx @ttsalpha/mirra init
```

That copies the plugin to `~/.mirra/plugin`, the server to `~/.mirra/server` when it is
running from an npx cache that npm may clear later, and registers the server with every
client it finds: Claude Desktop, Cursor, VS Code and Antigravity by merging one entry into their config,
Claude Code through its own CLI. Each file is backed up beside itself first, and
`--no-config` skips all of it. The command is written with the real path of the Node binary
that ran it, because a version manager puts `node` behind a path that changes with every
shell and a GUI client never sees it.

It also registers the plugin with Figma Desktop by writing into Figma's own settings,
which only works while Figma is **closed** — that file is rewritten from memory on quit.
If Figma is running, or the format turns out to be one Mirra does not recognise, `init` says
so and falls back to the manual route: Figma Desktop → Plugins → Development → Import plugin
from manifest… → `~/.mirra/plugin/manifest.json`.

Either way, **restart the clients**, or they will not see the tools.

Upgrading is the same command. Half the features live in the plugin, which only changes
when `init` copies it over, so a new server against an old plugin quietly does less;
`mirra_ping` says so when the two drift apart.

Every release also attaches a `.mcpb` bundle for anyone who would rather not open a
terminal: one double-click, Claude Desktop's own Node, and the variables below become a
form.

## Day to day

Once per working session: open a file in Figma, run the Mirra plugin, leave its panel open.
Figma has no background plugins, so closing the panel ends the connection.

The plugin holds a connection to every server it finds, so several clients can work on the
same file at once, and one that starts later is picked up within a few seconds. Operations
run one at a time, so two clients cannot interleave or land in the same undo step.

`mirra doctor` checks the port, the installed plugin and the live connection, so it says
which half is broken.

| Variable             | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `MIRRA_PORT`         | Pin one port instead of scanning 51730–51739                                |
| `MIRRA_ROOT`         | Resolve the paths tools are given from here, and refuse anything outside it |
| `MIRRA_ALLOW_EXEC`   | Register `mirra_exec` at all; the panel still has to allow it               |
| `MIRRA_ALLOW_ORIGIN` | Accept one more browser origin on the socket                                |

Without `MIRRA_ROOT`, paths are read and written relative to the working directory, so a
client that starts the server outside a project, Claude Desktop among them, should set it.

## Running arbitrary code

`mirra_exec` runs whatever Plugin API code the agent writes against the open document. It
takes two keys, which are deliberately held by different people: the server only registers
the tool when `MIRRA_ALLOW_EXEC` is set, and the plugin only runs it while **Allow code
execution** is ticked in its panel. The tick resets every time the plugin runs.

```sh
claude mcp add -s user Mirra-exec -e MIRRA_ALLOW_EXEC=1 -- npx -y @ttsalpha/mirra serve
```

The socket listens on loopback and refuses any browser origin other than Figma's, so a page
you happen to have open cannot reach it. It is still unauthenticated against other
processes on the same machine: anything already running as you can talk to it while the
plugin is open.

## How it fits together

`packages/schema` holds the zod tree and the wire protocol, `packages/plugin` the Figma
side, `packages/server` the MCP server and CLI. The plugin bundle ships inside the server
package, which is what `mirra init` installs.

Tests run `render` and `read` against a hand-written fake of the Figma sandbox, so the
round trip is checked without Figma open; the server tests spawn `mirra serve` over stdio
with a stub plugin on the socket.

Three things Figma imposes on this setup. Its manifest validator rejects an IP literal, so
`networkAccess` lists `ws://localhost:<port>` rather than `127.0.0.1`, and the server
listens on both loopback addresses because the plugin's renderer resolves `localhost` to
`::1` first. That renderer also opens sockets slowly, so the plugin races every candidate
port at once instead of trying them one at a time; the panel probes `/health` over HTTP
when a round fails, which tells a missing server apart from a blocked one.

## License

[MIT](LICENSE) © 2026 Son Tran [@ttsalpha](https://ttsalpha.com/)
