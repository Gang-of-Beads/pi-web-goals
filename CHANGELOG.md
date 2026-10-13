# Changelog

## 0.1.1

- The Goals tab is drawn by PI WEB's status list, like the Background and Subagents tabs: "reading", "no goals" and "could not read" show in the same centred box, and every goal of the project is a row with its objective, its status and its task progress.
- The refresh button is gone; neither the Background nor the Subagents tab has one. The tab reads the goals again when a turn of the selected session ends and each time the tab is opened, since another session of the project can create a goal while it is closed.
- A read that gets no answer is no longer shown as "could not read": the tab keeps what it showed and tries again by itself (after 1, 2, 4, 8 s, then every 15 s). Only a read the machine refused says it could not be read.
- Published to npm: install with `pi install npm:@gang-of-beads/pi-web-goals`.

## 0.1.0

- First release. The Goals plugin moves out of PI WEB's bundled plugins into this repository, unchanged in behaviour: the Goals tab and the goal event rows. The plugin id stays `goals`, so an existing `plugins.goals` setting keeps applying.
