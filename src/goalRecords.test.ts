import { describe, expect, it } from "vitest";
import { agentDirectory, parseGoalRecord, sortGoalRecords, type GoalRecordSummary } from "./goalRecords.js";

const goalFile = (overrides: Record<string, unknown> = {}): unknown => JSON.parse(JSON.stringify({
  version: 3,
  id: "active_goal_1_test",
  objective: "Ship the thing",
  status: "active",
  updatedAt: "2026-09-08T10:00:00.000Z",
  taskList: { tasks: [{ id: "task-1", title: "One", status: "complete" }, { id: "task-2", title: "Two", status: "pending" }] },
  ...overrides,
}));

/** A goal file in the shape pi-goal 1.0 writes: text as the goal, TODOs with their statuses. */
const currentGoalFile = (overrides: Record<string, unknown> = {}): unknown => ({
  uuid: "018f0f7e-6a1b-7c2d-8e3f-4a5b6c7d8e9f",
  id: 7,
  workspace: "/w",
  text: "Ship the thing",
  status: "running",
  updatedAt: "2026-09-08T10:00:00.000Z",
  planConfirmed: true,
  todos: [{ id: 1, text: "One", status: "done" }, { id: 2, text: "Two", status: "running" }, { id: 3, text: "Three", status: "pending" }],
  ...overrides,
});

describe("parseGoalRecord", () => {
  it("parses a current goal file: its text, its TODOs and its uuid", () => {
    const goal = parseGoalRecord("018f0f7e-6a1b-7c2d-8e3f-4a5b6c7d8e9f.json", currentGoalFile());
    expect(goal).toMatchObject({ id: "018f0f7e-6a1b-7c2d-8e3f-4a5b6c7d8e9f", objective: "Ship the thing", status: "running", tasksTotal: 3, tasksDone: 1 });
  });

  it("counts only done TODOs as done", () => {
    expect(parseGoalRecord("g.json", currentGoalFile())?.tasksDone).toBe(1);
    expect(parseGoalRecord("g.json", currentGoalFile({ todos: [{ id: 1, text: "One", status: "blocked" }] }))).toMatchObject({ tasksTotal: 1, tasksDone: 0 });
  });

  it("keeps a status it does not know yet as it is spelled", () => {
    expect(parseGoalRecord("g.json", currentGoalFile({ status: "budget_exhausted" }))?.status).toBe("budget_exhausted");
  });

  it("parses a version-3 goal file into a summary", () => {
    const goal = parseGoalRecord("active_goal_1_test.md", goalFile());
    expect(goal).toMatchObject({ id: "active_goal_1_test", objective: "Ship the thing", status: "active", tasksTotal: 2, tasksDone: 1, updatedAt: "2026-09-08T10:00:00.000Z" });
  });

  it("derives the id from the file name when the record has none", () => {
    const goal = parseGoalRecord("active_goal_2_fallback.md", goalFile({ id: undefined }));
    expect(goal?.id).toBe("active_goal_2_fallback");
  });

  it("reads currentStatus when status is absent", () => {
    const goal = parseGoalRecord("g.md", goalFile({ status: undefined, currentStatus: "paused" }));
    expect(goal?.status).toBe("paused");
  });

  it("defaults a record without a status to active", () => {
    const goal = parseGoalRecord("g.md", goalFile({ status: undefined }));
    expect(goal?.status).toBe("active");
  });

  it("returns undefined for non-object bodies and empty objectives", () => {
    expect(parseGoalRecord("b.md", "just a string")).toBeUndefined();
    expect(parseGoalRecord("c.md", goalFile({ objective: "   " }))).toBeUndefined();
  });

  it("tolerates a goal without a task list", () => {
    const goal = parseGoalRecord("g.md", goalFile({ taskList: undefined }));
    expect(goal).toMatchObject({ tasksTotal: 0, tasksDone: 0 });
  });
});

describe("agentDirectory", () => {
  it("follows PI_CODING_AGENT_DIR, expanding a leading tilde, and falls back to ~/.pi/agent", () => {
    expect(agentDirectory({ PI_CODING_AGENT_DIR: "/agent" }, "/home/me")).toBe("/agent");
    expect(agentDirectory({ PI_CODING_AGENT_DIR: "~/agent" }, "/home/me")).toBe("/home/me/agent");
    expect(agentDirectory({}, "/home/me")).toBe("/home/me/.pi/agent");
    expect(agentDirectory({ PI_CODING_AGENT_DIR: "" }, "/home/me")).toBe("/home/me/.pi/agent");
  });
});

describe("sortGoalRecords", () => {
  const record = (id: string, status: GoalRecordSummary["status"], updatedAt: string): GoalRecordSummary => ({
    id, objective: id, status, tasksTotal: 0, tasksDone: 0, updatedAt,
  });

  it("leads with live goals by recency and trails completed ones", () => {
    const sorted = sortGoalRecords([
      record("old-live", "active", "2026-09-01T00:00:00.000Z"),
      record("done", "complete", "2026-09-09T00:00:00.000Z"),
      record("new-live", "active", "2026-09-08T00:00:00.000Z"),
    ]);
    expect(sorted.map((goal) => goal.id)).toEqual(["new-live", "old-live", "done"]);
  });

  it("trails cancelled goals with done ones", () => {
    const sorted = sortGoalRecords([
      record("cancelled", "cancelled", "2026-09-09T00:00:00.000Z"),
      record("running", "running", "2026-09-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((goal) => goal.id)).toEqual(["running", "cancelled"]);
  });

  it("breaks recency ties by id", () => {
    const sorted = sortGoalRecords([record("b", "active", "2026-09-08T00:00:00.000Z"), record("a", "active", "2026-09-08T00:00:00.000Z")]);
    expect(sorted.map((goal) => goal.id)).toEqual(["b", "a"]);
  });
});
