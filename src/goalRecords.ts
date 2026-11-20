import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Goal files of pi-goal 0.1.x, kept as the fallback where they are all a workspace has. */
export const GOALS_DIRECTORY = join(".pi", "goals");
export const MAX_GOAL_FILES = 50;

export type GoalStatus =
  | "running" | "review" | "awaiting review" | "clarifying" | "awaiting clarification" | "pending"
  | "paused" | "blocked" | "budget_limited" | "done" | "cancelled"
  | "active" | "complete";

export interface GoalRecordSummary {
  id: string;
  objective: string;
  /** pi-goal's status, kept as it is spelled; a status not known here still gets a row. */
  status: string;
  tasksTotal: number;
  tasksDone: number;
  updatedAt: string;
}

export interface GoalDirectoryReading {
  goals: GoalRecordSummary[];
  brokenFiles: number;
  roots: string[];
}

/** Statuses a goal is ordered and counted by, from pi-goal 1.0 (`GoalStatus`) and, at the end, from its 0.1.x records. */
const KNOWN_STATUSES: readonly string[] = [
  "running", "review", "awaiting review", "clarifying", "awaiting clarification", "pending",
  "paused", "blocked", "budget_limited", "done", "cancelled", "active", "complete",
];

/** Statuses of finished goals; everything else, unknown ones included, still has work expected.
 *  goalsList mirrors this list to stay free of node imports in the browser bundle. */
const FINISHED_STATUSES: readonly string[] = ["done", "cancelled", "complete"];

export function isFinishedStatus(status: string): boolean {
  return FINISHED_STATUSES.includes(status);
}

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
/** pi-goal keeps a workspace directory's own file beside the goal files. */
export const WORKSPACE_FILE = "workspace.json";

/** The agent directory, by pi's own rule: `PI_CODING_AGENT_DIR` (a leading `~` expanded), else `~/.pi/agent`. */
export function agentDirectory(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const configured = env[AGENT_DIR_ENV];
  if (configured === undefined || configured === "") return join(home, ".pi", "agent");
  if (configured === "~") return home;
  return configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
}

/** Where pi-goal 1.0 stores goals, one directory per workspace: <agent dir>/pi-goal/goals. */
export function goalsRoot(agentDir: string): string {
  return join(agentDir, "pi-goal", "goals");
}

/** A workspace's directory name: SHA-256 of its absolute path (pi-goal's `workspaceKey`). */
export function workspaceKey(workspace: string): string {
  return createHash("sha256").update(resolve(workspace)).digest("hex");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A status this list does not know yet is kept as pi-goal spelled it, so the goal still gets a row. */
const statusOf = (raw: Record<string, unknown>): string => {
  for (const candidate of KNOWN_STATUSES) {
    if (raw["status"] === candidate || raw["currentStatus"] === candidate) return candidate;
  }
  const stated = raw["status"] ?? raw["currentStatus"];
  return typeof stated === "string" && stated.trim() !== "" ? stated : "active";
};

const taskListOf = (raw: Record<string, unknown>): { status?: unknown }[] => {
  const taskList = raw["taskList"];
  if (!isRecord(taskList)) return [];
  const tasks = taskList["tasks"];
  return Array.isArray(tasks) ? tasks.filter((task): task is { status?: unknown } => isRecord(task) || Array.isArray(task)) : [];
};

/** Current records list `todos`, 0.1.x ones a `taskList`; both are counted, and `done` and `complete` both count as done. */
const countsOf = (raw: Record<string, unknown>): { total: number; done: number } => {
  const todos = Array.isArray(raw["todos"]) ? raw["todos"] : taskListOf(raw);
  const statuses = todos.map((todo) => (isRecord(todo) ? todo["status"] : undefined));
  return { total: todos.length, done: statuses.filter((status) => status === "done" || status === "complete").length };
};

/**
 * A goal file's record: the whole file for a pi-goal 1.0 JSON goal, the JSON object the file
 * starts with for a 0.1.x markdown goal, which pi-goal wrote and then a markdown copy of the
 * prompt and progress for people (`# Goal Prompt`). Parsing the whole file failed on every goal
 * pi-goal wrote, so the Goals page said "No goals in this workspace" beside a workspace full of
 * them (owner, 2026-10-08). undefined when the file holds no whole JSON object.
 */
export function goalRecordFromFile(fileName: string, text: string): unknown {
  return fileName.endsWith(".json") ? parsedOrUndefined(text) : leadingJsonObject(text);
}

/** The JSON object a 0.1.x markdown goal file starts with, before the prose pi-goal appended. */
export function leadingJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1 || text.slice(0, start).trim() !== "") return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth === 0) return parsedOrUndefined(text.slice(start, index + 1));
  }
  return undefined;
}

function parsedOrUndefined(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

const textOf = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

/** The id a row is keyed by: the goal's uuid, else its display id, else the file name without extension. */
const idOf = (raw: Record<string, unknown>, fileName: string): string => {
  const uuid = textOf(raw["uuid"]);
  if (uuid !== undefined) return uuid;
  const id = raw["id"];
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number") return String(id);
  return fileName.replace(/\.(?:md|json)$/, "");
};

/** A goal record, in the current shape (`text`, `todos`) or the 0.1.x one (`objective`, `taskList`);
 *  read tolerantly, the way the goal runtime reads it (a broken file is counted, never fatal). */
export function parseGoalRecord(fileName: string, value: unknown): GoalRecordSummary | undefined {
  if (!isRecord(value)) return undefined;
  const objective = textOf(value["text"]) ?? textOf(value["objective"]);
  if (objective === undefined) return undefined;
  const counts = countsOf(value);
  return {
    id: idOf(value, fileName),
    objective,
    status: statusOf(value),
    tasksTotal: counts.total,
    tasksDone: counts.done,
    updatedAt: typeof value["updatedAt"] === "string" ? value["updatedAt"] : "",
  };
}

/** Active-shaped goals lead (newest first); finished ones trail. */
export function sortGoalRecords(goals: GoalRecordSummary[]): GoalRecordSummary[] {
  const settled = goals.filter((goal) => isFinishedStatus(goal.status));
  const live = goals.filter((goal) => !isFinishedStatus(goal.status));
  const byRecency = (left: GoalRecordSummary, right: GoalRecordSummary): number => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  return [...live.sort(byRecency), ...settled.sort(byRecency)];
}
