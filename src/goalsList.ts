import type { PluginListModel, PluginListRead, PluginListRow } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalRecordSummary, GoalStatus } from "./goalRecords.js";

export interface GoalsSectionState {
  goals: GoalRecordSummary[];
  brokenFiles: number;
}

/** Where the latest goals read stands for the scope on screen. */
export type GoalsReadState = "reading" | "read" | "failed";

/**
 * What an answer with no readable goal says. Goal files that exist but could not be parsed are
 * not "no goals": the machine counted them, and saying none hid them (absence is not negation).
 */
export function emptyGoalsWords(brokenFiles: number): string {
  if (brokenFiles === 0) return "No goals in this project.";
  return `${String(brokenFiles)} goal ${brokenFiles === 1 ? "file" : "files"} in this project could not be read.`;
}

export function activeGoal(state: GoalsSectionState | undefined): GoalRecordSummary | undefined {
  return state?.goals[0];
}

export function progressLabel(goal: GoalRecordSummary): string | undefined {
  if (goal.tasksTotal === 0) return undefined;
  if (goal.status === "complete") return `${String(goal.tasksTotal)}/${String(goal.tasksTotal)} tasks`;
  return `${String(goal.tasksDone)}/${String(goal.tasksTotal)} tasks`;
}

export function badgeFor(state: GoalsSectionState | undefined): string | number | undefined {
  const goal = activeGoal(state);
  if (goal === undefined) return undefined;
  const remaining = goal.tasksTotal - goal.tasksDone;
  if (goal.status === "complete" || remaining <= 0) return undefined;
  return remaining;
}

type RowSide = Pick<PluginListRow, "status" | "value">;

const ROW_SIDE: Readonly<Record<GoalStatus, RowSide>> = {
  active: { status: { label: "active", tone: "good" } },
  paused: { status: { label: "paused", tone: "neutral" } },
  budget_limited: { status: { label: "budget limited", tone: "attention" } },
  blocked: { status: { label: "blocked", tone: "problem" } },
  complete: { value: "complete" },
};

function goalRow(goal: GoalRecordSummary): PluginListRow {
  const progress = progressLabel(goal);
  return { id: goal.id, title: goal.objective, ...ROW_SIDE[goal.status], ...(progress === undefined ? {} : { detail: progress }) };
}

/**
 * A read in flight over an earlier answer keeps showing that answer as read: the page re-reads
 * after every turn, and an empty project flipping to "Reading…" each time would be noise.
 */
function listRead(read: GoalsReadState, answer: GoalsSectionState | undefined): PluginListRead {
  if (read === "failed") return "failed";
  return read === "reading" && answer === undefined ? "reading" : "ready";
}

/**
 * The Goals page as the host's status list (owner, 2026-10-13): the same dashed box as the
 * Background and Subagents pages for reading, none and could-not-read, and the host's row
 * anatomy for the goals - objective as title, status on the right, task progress below.
 */
export function goalsListModel(read: GoalsReadState, answer: GoalsSectionState | undefined): PluginListModel {
  return {
    read: listRead(read, answer),
    words: {
      empty: emptyGoalsWords(answer?.brokenFiles ?? 0),
      reading: "Reading this project's goals…",
      failed: "Goal records could not be read on this machine.",
      stale: "Could not refresh - showing the last read.",
    },
    groups: [{ id: "goals", rows: (answer?.goals ?? []).map(goalRow) }],
  };
}
