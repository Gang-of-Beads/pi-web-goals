# pi-web-goals

A [PI WEB](https://github.com/Gang-of-Beads/pi-web) plugin for [pi-goal](https://github.com/Gang-of-Beads/pi-goal), the goal-mode extension for pi.

- A **Goals** tab beside the conversation lists the project's goals with their status and task progress; its badge shows how many tasks the active goal has left. The tab shows only where the extension is loaded.
- Goal events pi-goal writes into the conversation (audits, guards, drafts, focus changes) are drawn as short rows instead of raw payloads.

## Requirements

- PI WEB 2.202610.5 or later. Earlier releases bundle their own copy of this plugin, which wins over an installed one (Settings → PI WEB plugins reports the duplicate id).
- The pi-goal extension installed in pi.

## Install

```sh
pi install npm:@gang-of-beads/pi-web-goals
```

To follow `main` instead of releases, install `git:github.com/Gang-of-Beads/pi-web-goals`.

The plugin has a server part, so restart the PI WEB session daemon, then reload the PI WEB tab. To remove it, run `pi remove npm:@gang-of-beads/pi-web-goals` and restart the daemon again.

## How it works

The server part runs inside the PI WEB session daemon and only reads. It answers the browser's `goals.list` operation from the goal files pi-goal keeps in the project (`.pi/goals/*.md`); a session working in a subfolder of the project also sees that folder's goals, which take precedence by id. A goal file that cannot be parsed is skipped and counted; when no goal could be read, the tab says how many files failed instead of claiming the project has none. The tab reads the goals again when a turn of the selected session ends and each time it is opened. It declares the `goals` surface for pi-goal's tools, so PI WEB shows the tab only where those tools are loaded. The plugin is machine-specific: with several machines, each machine's own copy reads that machine's goals.

## Development

```sh
npm install
npm run check
```

`npm run check` type-checks, runs the tests, and builds two bundles with esbuild: `dist/browser/pi-web-plugin.js` (with Lit inlined) for the page and `dist/server-plugin.js` for the daemon. `dist/` is committed so that `pi install git:` works without a build step, and the check fails when it is out of date.

To try a change in a running PI WEB, link the working copy as a local plugin, restart the session daemon and reload the tab:

```sh
mkdir -p ~/.pi-web/plugins
ln -s "$PWD" ~/.pi-web/plugins/goals
```

See [PI WEB's plugin documentation](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugins.md) for the plugin contract.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, run `npm run check` before opening a pull request, and describe what you changed and how you checked it in a running PI WEB.

## Releasing

Update `version` in `package.json` and `package-lock.json`, give `CHANGELOG.md` a section for it, commit, and push a matching `v<version>` tag. The release workflow checks the package, publishes it to npm, and creates the GitHub Release from that CHANGELOG section.

## License

[MIT](LICENSE)
