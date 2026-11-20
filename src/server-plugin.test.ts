import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerPluginActivationContext } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
import { WORKSPACE_FILE, goalsRoot, workspaceKey } from "./goalRecords.js";
import plugin, { listGoalsOperation, readGoalDirectory } from "./server-plugin.js";

let root: string;

const goalFile = (objective: string, status: string, updatedAt: string): string => `${JSON.stringify({
  version: 3, id: `goal-${objective.replace(/\W+/g, "-").toLowerCase()}`, objective, status, updatedAt,
  taskList: { tasks: [{ id: "t1", title: "One", status: "complete" }, { id: "t2", title: "Two", status: "pending" }] },
}, null, 2)}\n\n# Goal Prompt\n\n${objective}\n`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "goals-plugin-"));
  await mkdir(join(root, ".pi", "goals"), { recursive: true });
  await writeFile(join(root, ".pi", "goals", "active_goal_a.md"), goalFile("Alpha", "active", "2026-09-08T10:00:00.000Z"));
  await writeFile(join(root, ".pi", "goals", "active_goal_b.md"), goalFile("Beta", "complete", "2026-09-09T00:00:00.000Z"));
  await writeFile(join(root, ".pi", "goals", "broken.md"), "{ not json");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readGoalDirectory", () => {
  it("reads workspace goal records, sorted live-first, counting broken files", async () => {
    const reading = await readGoalDirectory(root, undefined);
    expect(reading.goals.map((goal) => goal.objective)).toEqual(["Alpha", "Beta"]);
    expect(reading.brokenFiles).toBe(1);
  });

  let nestedRoot: string;

  it("overlays session-cwd goals on the workspace's by id", async () => {
    nestedRoot = join(root, "nested");
    await mkdir(join(nestedRoot, ".pi", "goals"), { recursive: true });
    await writeFile(join(nestedRoot, ".pi", "goals", "active_goal_a.md"), goalFile("Nested Alpha", "active", "2026-09-08T11:00:00.000Z"));
    const reading = await readGoalDirectory(root, nestedRoot);
    expect(reading.goals.map((goal) => goal.objective)).toEqual(["Nested Alpha", "Alpha", "Beta"]);
  });

  it("ignores a session cwd outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "goals-outside-"));
    try {
      const reading = await readGoalDirectory(root, outside);
      expect(reading.goals.map((goal) => goal.objective)).toEqual(["Alpha", "Beta"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns an empty reading for a workspace without goals", async () => {
    const empty = await mkdtemp(join(tmpdir(), "goals-empty-"));
    try {
      const reading = await readGoalDirectory(empty, undefined);
      expect(reading).toEqual({ goals: [], brokenFiles: 0, roots: [empty] });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("listGoalsOperation", () => {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

  const goalObjectives = async (input: unknown): Promise<string[]> => {
    const answer = await listGoalsOperation(input, { signal: new AbortController().signal });
    if (!isRecord(answer) || !Array.isArray(answer["goals"])) throw new Error("Expected a goals array");
    const goals: unknown[] = answer["goals"];
    return goals.map((goal) => (isRecord(goal) && typeof goal["objective"] === "string" ? goal["objective"] : ""));
  };

  it("answers the workspace read through the operation channel", async () => {
    expect(await goalObjectives({ workspacePath: root })).toEqual(["Alpha", "Beta"]);
  });

  it("answers empty for a missing or relative workspace path", async () => {
    const signal = { signal: new AbortController().signal };
    expect(await listGoalsOperation({}, signal)).toEqual({ goals: [], brokenFiles: 0, roots: [] });
    expect(await listGoalsOperation({ workspacePath: "relative/path" }, signal)).toEqual({ goals: [], brokenFiles: 0, roots: [] });
  });
});

describe("the agent directory's goal layout", () => {
  let agentDir: string;
  let workspace: string;

  const uuid = (suffix: string): string => `018f0f7e-0000-7000-8000-0000000000${suffix}`;

  const currentGoalFile = (name: string, text: string, status: string, todoStatuses: string[]): string => JSON.stringify({
    uuid: name, id: 1, workspace, createdAt: "2026-09-08T10:00:00.000Z", updatedAt: "2026-09-08T10:00:00.000Z",
    text, status, planConfirmed: true, todos: todoStatuses.map((todoStatus, index) => ({ id: index + 1, text: `TODO ${index + 1}`, status: todoStatus })),
  });

  beforeAll(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "goals-agent-"));
    workspace = await mkdtemp(join(tmpdir(), "goals-workspace-"));
    const goals = join(goalsRoot(agentDir), workspaceKey(workspace));
    await mkdir(goals, { recursive: true });
    await writeFile(join(goals, WORKSPACE_FILE), JSON.stringify({ workspace }));
    await writeFile(join(goals, `${uuid("01")}.json`), currentGoalFile(uuid("01"), "Running one", "running", ["done", "running"]));
    await writeFile(join(goals, `${uuid("02")}.json`), currentGoalFile(uuid("02"), "Finished one", "done", ["done"]));
    await writeFile(join(goals, "not-a-goal.txt"), "ignored");
  });

  afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("reads the JSON goals of the workspace's hashed directory, live ones first", async () => {
    const reading = await readGoalDirectory(workspace, undefined, agentDir);
    expect(reading.goals.map((goal) => [goal.objective, goal.tasksTotal, goal.tasksDone])).toEqual([["Running one", 2, 1], ["Finished one", 1, 1]]);
  });

  /** pi-goal 0.1.x wrote the project's `.pi/goals/*.md`, and those are only read where no JSON goal exists. */
  it("falls back to the project's markdown goals and prefers JSON ones when there are any", async () => {
    const legacyOnly = await mkdtemp(join(tmpdir(), "goals-legacy-"));
    try {
      await mkdir(join(legacyOnly, ".pi", "goals"), { recursive: true });
      await writeFile(join(legacyOnly, ".pi", "goals", "active_goal_old.md"), goalFile("Old one", "active", "2026-09-01T00:00:00.000Z"));
      const fallback = await readGoalDirectory(legacyOnly, undefined, agentDir);
      expect(fallback.goals.map((goal) => goal.objective)).toEqual(["Old one"]);

      await writeFile(join(legacyOnly, ".pi", "goals", "active_goal_newer.md"), goalFile("Shadowed one", "active", "2026-09-02T00:00:00.000Z"));
      const goals = join(goalsRoot(agentDir), workspaceKey(legacyOnly));
      await mkdir(goals, { recursive: true });
      await writeFile(join(goals, `${uuid("03")}.json`), currentGoalFile(uuid("03"), "Current one", "pending", ["pending"]));
      const current = await readGoalDirectory(legacyOnly, undefined, agentDir);
      expect(current.goals.map((goal) => goal.objective)).toEqual(["Current one"]);
    } finally {
      await rm(legacyOnly, { recursive: true, force: true });
    }
  });

  it("reads the agent directory PI_CODING_AGENT_DIR names", async () => {
    const previous = process.env["PI_CODING_AGENT_DIR"];
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    try {
      const reading = await readGoalDirectory(workspace, undefined);
      expect(reading.goals.map((goal) => goal.objective)).toEqual(["Running one", "Finished one"]);
    } finally {
      if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
      else process.env["PI_CODING_AGENT_DIR"] = previous;
    }
  });
});

describe("the goals surface", () => {
  it("declares pi-goal 1.0's tools and keeps the 0.1.x names for the markdown fallback", async () => {
    const activation = await plugin.activate({} as ServerPluginActivationContext);
    expect(activation.agentFacts?.surfaces).toEqual([{ surface: "goals", tools: ["goal_plan", "goal_todo", "create_goal", "get_goal", "update_goal", "focus_goal"] }]);
  });
});
