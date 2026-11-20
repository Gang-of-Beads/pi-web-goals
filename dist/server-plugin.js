// src/server-plugin.ts
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join as join2, resolve as resolve2 } from "node:path";

// src/goalRecords.ts
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var GOALS_DIRECTORY = join(".pi", "goals");
var MAX_GOAL_FILES = 50;
var KNOWN_STATUSES = [
  "running",
  "review",
  "awaiting review",
  "clarifying",
  "awaiting clarification",
  "pending",
  "paused",
  "blocked",
  "budget_limited",
  "done",
  "cancelled",
  "active",
  "complete"
];
var FINISHED_STATUSES = ["done", "cancelled", "complete"];
function isFinishedStatus(status) {
  return FINISHED_STATUSES.includes(status);
}
var AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
var WORKSPACE_FILE = "workspace.json";
function agentDirectory(env = process.env, home = homedir()) {
  const configured = env[AGENT_DIR_ENV];
  if (configured === void 0 || configured === "") return join(home, ".pi", "agent");
  if (configured === "~") return home;
  return configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
}
function goalsRoot(agentDir) {
  return join(agentDir, "pi-goal", "goals");
}
function workspaceKey(workspace) {
  return createHash("sha256").update(resolve(workspace)).digest("hex");
}
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var statusOf = (raw) => {
  for (const candidate of KNOWN_STATUSES) {
    if (raw["status"] === candidate || raw["currentStatus"] === candidate) return candidate;
  }
  const stated = raw["status"] ?? raw["currentStatus"];
  return typeof stated === "string" && stated.trim() !== "" ? stated : "active";
};
var taskListOf = (raw) => {
  const taskList = raw["taskList"];
  if (!isRecord(taskList)) return [];
  const tasks = taskList["tasks"];
  return Array.isArray(tasks) ? tasks.filter((task) => isRecord(task) || Array.isArray(task)) : [];
};
var countsOf = (raw) => {
  const todos = Array.isArray(raw["todos"]) ? raw["todos"] : taskListOf(raw);
  const statuses = todos.map((todo) => isRecord(todo) ? todo["status"] : void 0);
  return { total: todos.length, done: statuses.filter((status) => status === "done" || status === "complete").length };
};
function goalRecordFromFile(fileName, text) {
  return fileName.endsWith(".json") ? parsedOrUndefined(text) : leadingJsonObject(text);
}
function leadingJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1 || text.slice(0, start).trim() !== "") return void 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth === 0) return parsedOrUndefined(text.slice(start, index + 1));
  }
  return void 0;
}
function parsedOrUndefined(json) {
  try {
    return JSON.parse(json);
  } catch {
    return void 0;
  }
}
var textOf = (value) => typeof value === "string" && value.trim() !== "" ? value : void 0;
var idOf = (raw, fileName) => {
  const uuid = textOf(raw["uuid"]);
  if (uuid !== void 0) return uuid;
  const id = raw["id"];
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number") return String(id);
  return fileName.replace(/\.(?:md|json)$/, "");
};
function parseGoalRecord(fileName, value) {
  if (!isRecord(value)) return void 0;
  const objective = textOf(value["text"]) ?? textOf(value["objective"]);
  if (objective === void 0) return void 0;
  const counts = countsOf(value);
  return {
    id: idOf(value, fileName),
    objective,
    status: statusOf(value),
    tasksTotal: counts.total,
    tasksDone: counts.done,
    updatedAt: typeof value["updatedAt"] === "string" ? value["updatedAt"] : ""
  };
}
function sortGoalRecords(goals) {
  const settled = goals.filter((goal) => isFinishedStatus(goal.status));
  const live = goals.filter((goal) => !isFinishedStatus(goal.status));
  const byRecency = (left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  return [...live.sort(byRecency), ...settled.sort(byRecency)];
}

// src/server-plugin.ts
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function readGoalsIn(directory, extension) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { goals: [], brokenFiles: 0 };
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension) && entry.name !== WORKSPACE_FILE).slice(0, MAX_GOAL_FILES);
  const goals = [];
  let brokenFiles = 0;
  for (const entry of files) {
    let text;
    try {
      text = await readFile(join2(directory, entry.name), "utf8");
    } catch {
      brokenFiles += 1;
      continue;
    }
    const goal = parseGoalRecord(entry.name, goalRecordFromFile(entry.name, text));
    if (goal === void 0) {
      brokenFiles += 1;
      continue;
    }
    goals.push(goal);
  }
  return { goals, brokenFiles };
}
async function readGoalDirectory(workspacePath, sessionCwd, agentDir = agentDirectory()) {
  const workspace = resolve2(workspacePath);
  const roots = [workspace];
  const candidate = typeof sessionCwd === "string" && sessionCwd !== "" && isAbsolute(sessionCwd) ? resolve2(sessionCwd) : void 0;
  if (candidate !== void 0 && candidate !== workspace && candidate.startsWith(workspace)) roots.push(candidate);
  const byId = /* @__PURE__ */ new Map();
  let brokenFiles = 0;
  for (const root of roots) {
    const current = await readGoalsIn(join2(goalsRoot(agentDir), workspaceKey(root)), ".json");
    const legacy = current.goals.length === 0 ? await readGoalsIn(join2(root, GOALS_DIRECTORY), ".md") : { goals: [], brokenFiles: 0 };
    brokenFiles += current.brokenFiles + legacy.brokenFiles;
    for (const goal of [...current.goals, ...legacy.goals]) byId.set(goal.id, goal);
  }
  return { goals: sortGoalRecords([...byId.values()]), brokenFiles, roots };
}
var listGoalsOperation = async (input) => {
  const request = isRecord2(input) ? input : {};
  const workspacePath = typeof request["workspacePath"] === "string" && request["workspacePath"] !== "" ? request["workspacePath"] : void 0;
  if (workspacePath === void 0 || !isAbsolute(workspacePath)) return { goals: [], brokenFiles: 0, roots: [] };
  const sessionCwd = typeof request["sessionCwd"] === "string" ? request["sessionCwd"] : void 0;
  const reading = await readGoalDirectory(workspacePath, sessionCwd);
  return {
    goals: reading.goals.map((goal) => ({ id: goal.id, objective: goal.objective, status: goal.status, tasksTotal: goal.tasksTotal, tasksDone: goal.tasksDone, updatedAt: goal.updatedAt })),
    brokenFiles: reading.brokenFiles,
    roots: reading.roots
  };
};
var plugin = {
  apiVersion: 1,
  name: "Goals",
  activate: () => ({
    agentFacts: {
      // goal_plan and goal_todo are what pi-goal 1.0 registers; the 0.1.x names stay listed because
      // the page also serves a workspace whose goals only its old .pi/goals files have.
      surfaces: [{ surface: "goals", tools: ["goal_plan", "goal_todo", "create_goal", "get_goal", "update_goal", "focus_goal"] }]
    },
    operations: {
      "goals.list": listGoalsOperation
    }
  })
};
var server_plugin_default = plugin;
export {
  server_plugin_default as default,
  listGoalsOperation,
  readGoalDirectory
};
