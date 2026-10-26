<p align="center">
  <img src="https://raw.githubusercontent.com/ttsalpha/mirra/refs/heads/main/assets/icon.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Mirra</h1>

Two-way MCP server for Figma: an agent reads a design and renders one back through the
Figma Plugin API, so it needs no REST token and has no monthly call limit.

```
Claude ⇄ stdio ⇄ MCP server ⇄ ws://localhost:51730 ⇄ plugin ⇄ Figma
```

## Requirements

- **Figma Desktop** (a development plugin can't be imported in the browser app).
- **Node 24+**, and pnpm to build.
- **macOS or Windows.**

## Install

```sh
npx @ttsalpha/mirra init
```

- Copies the plugin to `~/.mirra/plugin` and asks which clients to add Mirra to: Claude
  Desktop, Cursor, VS Code, Antigravity, Claude Code. Detected ones are pre-selected.
- `-y` accepts the detected clients without asking (also the behaviour with no terminal or
  `CI` set); `--no-config` leaves client configs alone. Existing config files are backed up
  first.
- Registers the plugin with Figma Desktop, which only works while Figma is **closed**. If
  it is running, do it by hand: Plugins → Development → Import plugin from manifest… →
  `~/.mirra/plugin/manifest.json`.

Then **restart your clients**. To upgrade, run the same command again, since the plugin only
updates when `init` copies it (`mirra_ping` warns when it is out of date).

Each release also ships a `.mcpb` bundle for Claude Desktop: one double-click, no terminal.

## Use

Once per session: open a file in Figma, run the Mirra plugin, leave its panel open.
`mirra doctor` checks the port, the plugin and the connection if something is off.

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
| `mirra_exec`          | Run Plugin API code; off by default, see below                                          |

The tree is flexbox-like (`layout: {dir, gap, pad, …}`, `w`/`h` as number, `"fill"` or
`"hug"`), and `"$name"` binds a field to a variable. `mirra_read` and `mirra_render` share
one format, so an agent can write code from what it reads.

## Configuration

| Variable             | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `MIRRA_PORT`         | Pin one port instead of scanning 51730–51739                                |
| `MIRRA_ROOT`         | Resolve the paths tools are given from here, and refuse anything outside it |
| `MIRRA_ALLOW_EXEC`   | Register `mirra_exec` at all; the panel still has to allow it               |
| `MIRRA_ALLOW_ORIGIN` | Accept one more browser origin on the socket                                |

Without `MIRRA_ROOT`, paths resolve from the working directory, so set it for clients that
start the server outside a project (Claude Desktop, for one).

### Running arbitrary code

`mirra_exec` runs any Plugin API code the agent writes. It needs two keys: the server
registers it only with `MIRRA_ALLOW_EXEC` set, and the plugin runs it only while **Allow
code execution** is ticked in its panel (reset on every run).

```sh
claude mcp add -s user Mirra-exec -e MIRRA_ALLOW_EXEC=1 -- npx -y @ttsalpha/mirra serve
```

The socket listens on loopback and rejects browser origins other than Figma's, but it is
unauthenticated against other processes running as you while the plugin is open.

## Development

`packages/schema` holds the tree and wire protocol, `packages/plugin` the Figma side,
`packages/server` the MCP server and CLI. Tests run against a fake of the Figma sandbox, so
they don't need Figma open.

## License

[MIT](LICENSE) © 2026 Son Tran [@ttsalpha](https://ttsalpha.com/)
