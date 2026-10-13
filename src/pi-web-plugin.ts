import type { PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { html, svg } from "lit";
import { badgeFor, goalsListModel, type GoalsReadState, type GoalsSectionState } from "./goalsList.js";
import type { GoalRecordSummary } from "./goalRecords.js";
import { goalEventSummary } from "./goalEventSummary.js";

/** Goal lifecycle messages this plugin draws; the shell knows none of them. */
const GOAL_EVENT_TAGS = ["pi-goal-audit-event", "pi-goal-guard", "pi-goal-draft", "pi-goal-focus"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isGoalSummary = (value: unknown): value is GoalRecordSummary => {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string"
    && typeof value["objective"] === "string"
    && typeof value["status"] === "string"
    && typeof value["tasksTotal"] === "number"
    && typeof value["tasksDone"] === "number"
    && typeof value["updatedAt"] === "string";
};

/**
 * What the section knows for one scope. `read` names where the latest read stands; `answer` is
 * the last answer that arrived, kept while a refresh runs or after a refresh failed.
 */
interface GoalsRead {
  key: string;
  seq: number;
  read: GoalsReadState;
  answer?: GoalsSectionState;
}

/**
 * The scope a goals read answers for. `goals.list` takes the session's cwd as well as the
 * workspace, and a narrower session cwd overlays its own goals, so a key on the workspace
 * alone showed one session's goals while another was selected and never asked again.
 */
function readKey(workspacePath: string, sessionCwd: string | undefined): string {
  return JSON.stringify([workspacePath, sessionCwd ?? null]);
}

type ReadFailure = { kind: "retry"; delayMs: number } | { kind: "final" };

/**
 * The host's answer for a failed read (`ui.readFailure`, PI WEB 2.202610.5 and later), read
 * structurally because the published API types this plugin builds against predate it. An older
 * host gets the same rule: retry after 1, 2, 4, 8 s, then every 15 s.
 */
function readFailureOf(ui: PluginActivationContext["ui"], error: unknown, attempt: number): ReadFailure {
  const host = ui as { readFailure?: (error: unknown, attempt: number) => { kind: string; delayMs?: number } } | undefined;
  const answer = host?.readFailure?.(error, attempt);
  if (answer?.kind === "final") return { kind: "final" };
  return { kind: "retry", delayMs: answer?.delayMs ?? Math.min(1000 * 2 ** attempt, 15_000) };
}

/** The goals surface as a plugin: one page in the Go to page, carrying the
 *  scope's goal records. Owner, 2026-09-30: plugins do not draw bars over the
 *  transcript; a plugin declares an entry and draws its own page behind it
 *  (PI WEB design rule: plugins own their pages). The page owns its
 *  read-through-cache keyed by the scope it was asked for - a read that lands
 *  for another scope never reaches this one. A read that failed says so, so a
 *  machine that could not be read never looks like one with no goals. The page
 *  reads again when a turn of the selected session settles and each time it is
 *  opened (the host's `onInvalidate`), as Background and Subagents re-read
 *  without a refresh button. A read that got no answer is not a failure: it keeps
 *  what was shown and tries again by itself (the host's B48 rule, owner
 *  2026-10-13); only a refusal the machine stated ends in "failed". */
const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goals",
  activate: (context: PluginActivationContext) => {
    const { ui, callOperation } = context;
    let cache: GoalsRead | undefined;
    let issued = 0;
    let misses = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let readLatestAgain: (() => void) | undefined;

    const listGoals = async (workspacePath: string, sessionCwd: string | undefined): Promise<GoalsSectionState> => {
      if (callOperation === undefined) return { goals: [], brokenFiles: 0 };
      const input = sessionCwd === undefined ? { workspacePath } : { workspacePath, sessionCwd };
      const answer = await callOperation("goals.list", input);
      if (!isRecord(answer)) throw new Error("the machine answered without a goal list");
      const rawGoals: unknown[] = Array.isArray(answer["goals"]) ? answer["goals"] : [];
      const brokenFiles: unknown = answer["brokenFiles"];
      return { goals: rawGoals.filter(isGoalSummary), brokenFiles: typeof brokenFiles === "number" && Number.isInteger(brokenFiles) && brokenFiles > 0 ? brokenFiles : 0 };
    };

    const read = (workspacePath: string, sessionCwd: string | undefined, requestUpdate: () => void): void => {
      const key = readKey(workspacePath, sessionCwd);
      if (cache?.key !== key) misses = 0;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      const seq = ++issued;
      cache = { key, seq, read: "reading", ...(cache?.key === key && cache.answer !== undefined ? { answer: cache.answer } : {}) };
      const settle = (next: Pick<GoalsRead, "read" | "answer">): void => {
        if (cache?.key !== key || cache.seq !== seq) return;
        cache = { key, seq, read: next.read, ...(next.answer === undefined ? {} : { answer: next.answer }) };
        requestUpdate();
      };
      void listGoals(workspacePath, sessionCwd).then(
        (answer) => { misses = 0; settle({ read: "read", answer }); },
        (error: unknown) => {
          if (cache?.key !== key || cache.seq !== seq) return;
          const failure = readFailureOf(ui, error, misses++);
          if (failure.kind === "final") {
            settle({ read: "failed", ...(cache.answer === undefined ? {} : { answer: cache.answer }) });
            return;
          }
          retryTimer = setTimeout(() => { if (cache?.key === key && cache.seq === seq) read(workspacePath, sessionCwd, requestUpdate); }, failure.delayMs);
        },
      );
    };
    const cacheFor = (workspacePath: string, sessionCwd: string | undefined): GoalsRead | undefined => (cache?.key === readKey(workspacePath, sessionCwd) ? cache : undefined);
    const reading = (panel: WorkspacePanelContext): GoalsRead | undefined => {
      const workspacePath = panel.workspace.path;
      const sessionCwd = panel.state?.selectedSession?.cwd;
      const requestUpdate = () => { panel.host.requestRender(); };
      readLatestAgain = () => { read(workspacePath, sessionCwd, requestUpdate); };
      if (cacheFor(workspacePath, sessionCwd) === undefined) read(workspacePath, sessionCwd, requestUpdate);
      return cacheFor(workspacePath, sessionCwd);
    };
    context.on?.("session-activity-settled", () => { readLatestAgain?.(); });

    return {
      contributions: {
        messageRenderers: GOAL_EVENT_TAGS.map((tag) => ({
          id: `message.${tag}`,
          tag,
          render: (view: { payload: unknown }) => {
            const summary = goalEventSummary(tag, view.payload);
            return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
          },
        })),
        workspacePanels: [
          {
            id: "goals",
            title: "Goals",
            fronts: "goals",
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.5"></circle><circle cx="12" cy="12" r="0.8"></circle></svg>`,
            order: 30,
            badge: (panel) => badgeFor(reading(panel)?.answer),
            onInvalidate: (panel) => { read(panel.workspace.path, panel.state?.selectedSession?.cwd, () => { panel.host.requestRender(); }); },
            render: (panel) => {
              if (ui?.renderList === undefined) return html`<p class="muted">This list needs a newer PI WEB on this device.</p>`;
              const known = reading(panel);
              return ui.renderList(goalsListModel(known?.read ?? "reading", known?.answer));
            },
          },
        ],
      },
    };
  },
};

export default plugin;
