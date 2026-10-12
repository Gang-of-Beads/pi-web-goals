// src/server-plugin.ts
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join as join2, resolve } from "node:path";

// src/goalRecords.ts
import { join } from "node:path";
var GOALS_DIRECTORY = join(".pi", "goals");
var MAX_GOAL_FILES = 50;
var KNOWN_STATUSES = ["active", "paused", "blocked", "budget_limited", "complete"];
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var statusOf = (raw) => {
  for (const candidate of KNOWN_STATUSES) {
    if (raw["status"] === candidate || raw["currentStatus"] === candidate) return candidate;
  }
  return "active";
};
var taskListOf = (raw) => {
  const taskList = raw["taskList"];
  if (!isRecord(taskList)) return [];
  const tasks = taskList["tasks"];
  return Array.isArray(tasks) ? tasks.filter((task) => isRecord(task) || Array.isArray(task)) : [];
};
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
function parseGoalRecord(fileName, value) {
  if (!isRecord(value)) return void 0;
  const objective = value["objective"];
  if (typeof objective !== "string" || objective.trim() === "") return void 0;
  const tasks = taskListOf(value);
  return {
    id: typeof value["id"] === "string" && value["id"] !== "" ? value["id"] : fileName.replace(/\.md$/, ""),
    objective,
    status: statusOf(value),
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((task) => task.status === "complete").length,
    updatedAt: typeof value["updatedAt"] === "string" ? value["updatedAt"] : ""
  };
}
function sortGoalRecords(goals) {
  const settled = goals.filter((goal) => goal.status === "complete");
  const live = goals.filter((goal) => goal.status !== "complete");
  const byRecency = (left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  return [...live.sort(byRecency), ...settled.sort(byRecency)];
}

// src/server-plugin.ts
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function readGoalDirectory(workspacePath, sessionCwd) {
  const roots = [workspacePath];
  const candidate = typeof sessionCwd === "string" && sessionCwd !== "" && isAbsolute(sessionCwd) ? resolve(sessionCwd) : void 0;
  if (candidate !== void 0 && candidate !== workspacePath && candidate.startsWith(workspacePath)) roots.push(candidate);
  const byId = /* @__PURE__ */ new Map();
  let brokenFiles = 0;
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(join2(root, GOALS_DIRECTORY), { withFileTypes: true });
    } catch {
      continue;
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).slice(0, MAX_GOAL_FILES);
    for (const entry of files) {
      let text;
      try {
        text = await readFile(join2(root, GOALS_DIRECTORY, entry.name), "utf8");
      } catch {
        continue;
      }
      const goal = parseGoalRecord(entry.name, leadingJsonObject(text));
      if (goal === void 0) {
        brokenFiles += 1;
        continue;
      }
      byId.set(goal.id, goal);
    }
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
      surfaces: [{ surface: "goals", tools: ["create_goal", "get_goal", "update_goal", "focus_goal"] }]
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
