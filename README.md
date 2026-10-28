<p align="center">
  <img src="https://raw.githubusercontent.com/ttsalpha/mirra/refs/heads/main/assets/icon.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Mirra</h1>

Two-way MCP server for Figma: an agent reads a design or a FigJam board and renders one
back through the Figma Plugin API, so it needs no REST token and has no monthly call limit.

https://github.com/user-attachments/assets/f736473e-24c4-486f-980d-e6c90bf4d63a

## Install

```sh
npx @ttsalpha/mirra init
```

Then restart your agent.

Requires Figma Desktop (macOS or Windows) and Node 24+.

<details>
<summary>Install notes</summary>

- Adds Mirra to Claude Desktop, Claude Code, Cursor, VS Code and Antigravity (`--no-config` skips)
- Figma open during `init`: import by hand, **Plugins → Development → Import plugin from
  manifest…** → `~/.mirra/plugin/manifest.json`
- Upgrading: run `init` again

</details>

## Use

1. Open a Figma or FigJam file
2. Run **Plugins → Development → Mirra**
3. Keep the panel open

The panel reads **Disconnected** until your agent has started Mirra. Open your agent; if the panel
still doesn't connect, run `npx @ttsalpha/mirra doctor`.

## Tools

| Tool                  | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `mirra_render`        | Build a whole screen, or a FigJam board, from one declarative tree                      |
| `mirra_read`          | Read the selection, or a node, back as that same tree                                   |
| `mirra_patch`         | `set` / `append` / `replace` / `move` / `component` / `remove` by key, as one undo step |
| `mirra_find`          | Locate layers by name, kind or key, and select them                                     |
| `mirra_pages`         | List the pages, add one, or switch to one                                               |
| `mirra_screenshot`    | Export a layer as PNG and hand the image back                                           |
| `mirra_tokens`        | List variables and styles, with the `$name` a tree refers to                            |
| `mirra_define_tokens` | Create or update variables, modes, aliases and paint/text/effect styles                 |
| `mirra_export_assets` | Write layers to disk as PNG or SVG                                                      |
| `mirra_ping`          | Check the connection and report the open file and editor                                |
| `mirra_exec`          | Run Plugin API code; off by default, see below                                          |

## Tree format

`mirra_render` and `mirra_read` share one format, so an agent can write code from what it reads.

- Nodes: `frame`, `text`, `rect`, `ellipse`, `instance`, `svg`, `image`
- Flexbox-like: `layout: {dir, gap, pad, …}`
- `w` / `h`: a number, `"fill"` or `"hug"`
- `"$name"` binds a field to a variable
- `key` lets `mirra_patch` address a node later

```json
{
  "type": "frame",
  "key": "card",
  "layout": { "dir": "vertical", "gap": 12, "pad": 16 },
  "fill": "#ffffff",
  "radius": 12,
  "children": [
    { "type": "text", "text": "Welcome back", "size": 24 },
    { "type": "rect", "w": "fill", "h": 1, "fill": "#eeeeee" }
  ]
}
```

### FigJam

- Nodes: `section`, `sticky`, `shape`, `connector`, `table`, `code`, `link`, `gif`
- A board is one `section`; FigJam has no frames, auto layout or variables
- Place a node with `at: {x, y}`, or let the section's `layout` place its children
- A connector joins nodes by `key` and routes itself
- `mirra_define_tokens` and `"$name"` need a Figma Design file
- Stamps, highlights, washi tape and widgets: found with `mirra_find`, never created or read

## Configuration

| Variable             | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `MIRRA_PORT`         | Pin one port instead of scanning 51730–51739                              |
| `MIRRA_ROOT`         | Directory that tool file paths resolve from; paths outside it are refused |
| `MIRRA_ALLOW_EXEC`   | Register `mirra_exec` at all; the panel still has to allow it             |
| `MIRRA_ALLOW_ORIGIN` | Accept one more browser origin on the socket                              |

Unset, `MIRRA_ROOT` falls back to the working directory. Set it for agents that start the server
outside a project, such as Claude Desktop.

## Running arbitrary code

- `mirra_exec` runs any Plugin API code the agent writes
- Needs two keys: `MIRRA_ALLOW_EXEC` on the server, and **Allow code execution** ticked in the
  panel (reset on every run)

```sh
claude mcp add -s user Mirra-exec -e MIRRA_ALLOW_EXEC=1 -- npx -y @ttsalpha/mirra serve
```

## How it works

```
Agent ⇄ stdio ⇄ MCP server ⇄ ws://localhost:51730 ⇄ plugin ⇄ Figma
```

- The socket listens on loopback and rejects browser origins other than Figma's
- No authentication against other processes running as you while the plugin is open

## Development

`packages/schema` holds the tree and wire protocol, `packages/plugin` the Figma side,
`packages/server` the MCP server and CLI. Tests run against a fake of the Figma sandbox, so
they don't need Figma open. The fake doesn't reproduce FigJam's quirks: try FigJam changes in a
real FigJam file.

## License

[MIT](LICENSE) © 2026 Son Tran [@ttsalpha](https://ttsalpha.com/)
