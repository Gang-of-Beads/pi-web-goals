// @vitest-environment happy-dom
import { html, svg } from "lit";
import { describe, expect, it } from "vitest";
import { badgeFor, goalsListModel, progressLabel } from "./goalsList.js";
import type { GoalRecordSummary } from "./goalRecords.js";
import plugin from "./pi-web-plugin.js";

const activationContext = {
  apiVersion: 2,
  pluginId: "goals",
  runtimePluginId: "goals",
  html,
  svg,
} as const;

const record = (overrides: Partial<GoalRecordSummary> = {}): GoalRecordSummary => ({
  id: "goal-1", objective: "Ship the thing", status: "active", tasksTotal: 5, tasksDone: 2, updatedAt: "2026-09-08T10:00:00.000Z",
  ...overrides,
});

describe("the Goals page", () => {
  /**
   * Owner, 2026-09-30: "don't add a separate goal bar… it belongs in the three-bar Go to menu. Once a plugin declares it, a new plugin button appears, and tapping it opens the plugin's own custom display".
   * Goals is one entry in the Go to page, opening its own page; nothing sits over the transcript.
   */
  it("is a Go to page entry named Goals, and no bar over the transcript", () => {
    const contributions = plugin.activate(activationContext).contributions;
    expect({
      panels: (contributions.workspacePanels ?? []).map((panel) => [panel.id, panel.title]),
      drawer: Reflect.has(contributions, "drawerSections"),
    }).toEqual({ panels: [["goals", "Goals"]], drawer: false });
  });

  /** pi-goal 1.0's own states; a status it adds later still gets a row, spelled as pi-goal wrote it. */
  it("draws pi-goal's states in its own words and an unknown one as it is spelled", () => {
    const rows = goalsListModel("read", {
      goals: [record({ status: "review" }), record({ id: "goal-3", status: "cancelled" }), record({ id: "goal-4", status: "budget_exhausted" })],
      brokenFiles: 0,
    }).groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.status?.label ?? row.value)).toEqual(["awaiting review", "cancelled", "budget_exhausted"]);
  });

  it("draws the goal turns pi-goal 1.0 injects, and the 0.1.x events", () => {
    const tags = (plugin.activate(activationContext).contributions.messageRenderers ?? []).map((renderer) => renderer.tag);
    expect(tags).toEqual(["pi-goal-audit-event", "pi-goal-guard", "pi-goal-draft", "pi-goal-focus", "pi-goal-continue"]);
  });

  it("lists each goal with its objective, status and task progress", () => {
    const model = goalsListModel("read", { goals: [record(), record({ id: "goal-2", objective: "Done one", status: "complete" })], brokenFiles: 0 });
    expect(model.groups.flatMap((group) => group.rows)).toEqual([
      { id: "goal-1", title: "Ship the thing", status: { label: "active", tone: "good" }, detail: "2/5 tasks" },
      { id: "goal-2", title: "Done one", value: "complete", detail: "5/5 tasks" },
    ]);
  });

  it("keeps showing the last answer as read while a re-read runs, and says reading before any answer", () => {
    expect(goalsListModel("reading", { goals: [], brokenFiles: 0 }).read).toBe("ready");
    expect(goalsListModel("reading", undefined).read).toBe("reading");
    expect(goalsListModel("failed", { goals: [], brokenFiles: 0 }).read).toBe("failed");
  });

  it("badges the remaining task count and stays quiet when nothing remains", () => {
    expect(badgeFor({ goals: [record()], brokenFiles: 0 })).toBe(3);
    expect(badgeFor({ goals: [record({ status: "complete" })], brokenFiles: 0 })).toBeUndefined();
    expect(badgeFor({ goals: [record({ tasksTotal: 0 })], brokenFiles: 0 })).toBeUndefined();
    expect(badgeFor(undefined)).toBeUndefined();
  });

  it("labels progress from the done/total pair", () => {
    expect(progressLabel(record())).toBe("2/5 tasks");
    expect(progressLabel(record({ status: "complete" }))).toBe("5/5 tasks");
    expect(progressLabel(record({ tasksTotal: 0 }))).toBeUndefined();
  });
});
