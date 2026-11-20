import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { PiWebServerPlugin, ServerPluginOperation } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
import { GOALS_DIRECTORY, MAX_GOAL_FILES, WORKSPACE_FILE, agentDirectory, goalRecordFromFile, goalsRoot, parseGoalRecord, sortGoalRecords, workspaceKey, type GoalDirectoryReading, type GoalRecordSummary } from "./goalRecords.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

interface DirectoryGoals {
  goals: GoalRecordSummary[];
  brokenFiles: number;
}

/** One directory's goal files of one extension; a file that will not parse is counted, never fatal. */
async function readGoalsIn(directory: string, extension: ".json" | ".md"): Promise<DirectoryGoals> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { goals: [], brokenFiles: 0 };
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension) && entry.name !== WORKSPACE_FILE).slice(0, MAX_GOAL_FILES);
  const goals: GoalRecordSummary[] = [];
  let brokenFiles = 0;
  for (const entry of files) {
    let text: string;
    try {
      text = await readFile(join(directory, entry.name), "utf8");
    } catch {
      brokenFiles += 1;
      continue;
    }
    const goal = parseGoalRecord(entry.name, goalRecordFromFile(entry.name, text));
    if (goal === undefined) {
      brokenFiles += 1;
      continue;
    }
    goals.push(goal);
  }
  return { goals, brokenFiles };
}

/**
 * A workspace's goals. pi-goal 1.0 keeps them in the agent directory, keyed by the workspace
 * path; a workspace with none there is still read from its own 0.1.x `.pi/goals` files. A
 * session cwd narrower than the workspace overlays its own goals by id, and both roots stay
 * inside the workspace.
 */
export async function readGoalDirectory(workspacePath: string, sessionCwd: string | undefined, agentDir: string = agentDirectory()): Promise<GoalDirectoryReading> {
  const workspace = resolve(workspacePath);
  const roots = [workspace];
  const candidate = typeof sessionCwd === "string" && sessionCwd !== "" && isAbsolute(sessionCwd) ? resolve(sessionCwd) : undefined;
  if (candidate !== undefined && candidate !== workspace && candidate.startsWith(workspace)) roots.push(candidate);
  const byId = new Map<string, GoalRecordSummary>();
  let brokenFiles = 0;
  for (const root of roots) {
    const current = await readGoalsIn(join(goalsRoot(agentDir), workspaceKey(root)), ".json");
    const legacy = current.goals.length === 0 ? await readGoalsIn(join(root, GOALS_DIRECTORY), ".md") : { goals: [], brokenFiles: 0 };
    brokenFiles += current.brokenFiles + legacy.brokenFiles;
    for (const goal of [...current.goals, ...legacy.goals]) byId.set(goal.id, goal);
  }
  return { goals: sortGoalRecords([...byId.values()]), brokenFiles, roots };
}

export const listGoalsOperation: ServerPluginOperation = async (input) => {
  const request = isRecord(input) ? input : {};
  const workspacePath = typeof request["workspacePath"] === "string" && request["workspacePath"] !== "" ? request["workspacePath"] : undefined;
  if (workspacePath === undefined || !isAbsolute(workspacePath)) return { goals: [], brokenFiles: 0, roots: [] };
  const sessionCwd = typeof request["sessionCwd"] === "string" ? request["sessionCwd"] : undefined;
  const reading = await readGoalDirectory(workspacePath, sessionCwd);
  return {
    goals: reading.goals.map((goal) => ({ id: goal.id, objective: goal.objective, status: goal.status, tasksTotal: goal.tasksTotal, tasksDone: goal.tasksDone, updatedAt: goal.updatedAt })),
    brokenFiles: reading.brokenFiles,
    roots: reading.roots,
  };
};

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Goals",
  activate: () => ({
    agentFacts: {
      // goal_plan and goal_todo are what pi-goal 1.0 registers; the 0.1.x names stay listed because
      // the page also serves a workspace whose goals only its old .pi/goals files have.
      surfaces: [{ surface: "goals", tools: ["goal_plan", "goal_todo", "create_goal", "get_goal", "update_goal", "focus_goal"] }],
    },
    operations: {
      "goals.list": listGoalsOperation,
    },
  }),
};

export default plugin;
