# Changelog

## 0.2.1

- Require plugin API alpha.10.
- Ship the BSD-3 notice for the Lit the browser bundle inlines.

## 0.2.0

- Follow pi-goal 1.0, which keeps its goals as JSON files in the agent directory (`<agent dir>/pi-goal/goals/<sha256 of the project path>/`) and no longer in the project: the Goals tab reads that layout, from `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The old `.pi/goals/*.md` files are still read for a workspace whose goals were never moved.
- Goals are drawn with pi-goal's current states and their TODO progress; a status a later pi-goal adds is drawn as it is spelled instead of being dropped.
- The plugin declares `goal_plan` and `goal_todo`, the tools pi-goal 1.0 registers, so the tab appears with it on its own; the 0.1.x tool names stay declared for the markdown fallback.
- The goal turn pi-goal injects (`pi-goal-continue`) is drawn as a short row; the 0.1.x event rows stay.

## 0.1.2

- Built against `@gang-of-beads/pi-web-plugin-api`, the plugin contract package PI WEB publishes for plugin repositories, instead of the whole PI WEB package. Only the build changed: the published plugin code is the same as 0.1.1's.

## 0.1.1

- The Goals tab is drawn by PI WEB's status list, like the Background and Subagents tabs: "reading", "no goals" and "could not read" show in the same centred box, and every goal of the project is a row with its objective, its status and its task progress.
- The refresh button is gone; neither the Background nor the Subagents tab has one. The tab reads the goals again when a turn of the selected session ends and each time the tab is opened, since another session of the project can create a goal while it is closed.
- A read that gets no answer is no longer shown as "could not read": the tab keeps what it showed and tries again by itself (after 1, 2, 4, 8 s, then every 15 s). Only a read the machine refused says it could not be read.
- Published to npm: install with `pi install npm:@gang-of-beads/pi-web-goals`.

## 0.1.0

- First release. The Goals plugin moves out of PI WEB's bundled plugins into this repository, unchanged in behaviour: the Goals tab and the goal event rows. The plugin id stays `goals`, so an existing `plugins.goals` setting keeps applying.
