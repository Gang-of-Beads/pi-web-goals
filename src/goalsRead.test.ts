// @vitest-environment happy-dom
import { html as litHtml, render as litRender, svg as litSvg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginActivationContext, PluginListModel, WorkspacePanelContext, WorkspacePanelContribution } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalRecordSummary } from "./goalRecords.js";
import plugin from "./pi-web-plugin.js";

/**
 * The goals section is a network read keyed by a cache, and its key is what
 * decides whether a new read happens at all. Two things have to hold: the key
 * carries every fact the read depends on (goals.list takes a session cwd as
 * well as the workspace, and a narrower session cwd overlays its own goals),
 * and a read that failed may not look like a workspace with no goals.
 */

const WORKSPACE = "/w";

const goal = (id: string): GoalRecordSummary => ({
  id, objective: `goal ${id}`, status: "active", tasksTotal: 2, tasksDone: 0, updatedAt: "2026-01-01T00:00:00.000Z",
});

interface Harness {
  readonly container: HTMLElement;
  readonly context: WorkspacePanelContext;
  draw: () => void;
  setSessionCwd(cwd: string): void;
}

function harnessFor(section: WorkspacePanelContribution, sessionCwd: string): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const state = { selectedSession: { id: "s", cwd: sessionCwd } };
  let opened = false;
  const context = {
    machine: { id: "m", name: "m" },
    workspace: { id: "w", projectId: "p", path: WORKSPACE, label: "w", isMain: true },
    state,
    host: { requestRender: () => { if (opened) harness.draw(); }, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
  } as unknown as WorkspacePanelContext;
  const harness: Harness = {
    container,
    context,
    draw: () => { opened = true; litRender(section.render(context), container); },
    setSessionCwd: (cwd) => { Reflect.set(state.selectedSession, "cwd", cwd); },
  };
  return harness;
}

/** The host's list, reduced to its text: the rows' titles, or the empty box's words for the read state. */
function listText(model: PluginListModel): string {
  const titles = model.groups.flatMap((group) => group.rows.map((row) => row.title));
  const box = { reading: model.words.reading, ready: model.words.empty, failed: model.words.failed }[model.read];
  const banner = model.read === "failed" ? `${model.words.stale} ` : "";
  return titles.length === 0 ? `[box] ${box}` : `${banner}${titles.join(" ")}`;
}

const LIST_UI = { renderList: (model: PluginListModel) => litHtml`${listText(model)}` };

interface Section {
  readonly panel: WorkspacePanelContribution;
  settleActivity(): void;
}

type ReadFailureAnswer = { kind: "retry"; delayMs: number } | { kind: "final"; words: string };

function sectionOf(callOperation: (operation: string, input: unknown) => Promise<unknown>, readFailure?: () => ReadFailureAnswer): Section {
  const settledListeners: (() => void)[] = [];
  const on = (kind: string, listener: () => void) => {
    if (kind === "session-activity-settled") settledListeners.push(listener);
    return () => undefined;
  };
  const context = { apiVersion: 2, pluginId: "goals", runtimePluginId: "goals", html: litHtml, svg: litSvg, callOperation, on, ui: readFailure === undefined ? LIST_UI : { ...LIST_UI, readFailure } } as unknown as PluginActivationContext;
  const panel = plugin.activate(context).contributions.workspacePanels?.[0];
  if (panel === undefined) throw new Error("the goals plugin contributes no page");
  return { panel, settleActivity: () => { for (const listener of settledListeners) listener(); } };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
};

async function shownText(container: HTMLElement): Promise<string> {
  await flush();
  return (container.textContent ?? "").replace(/\s+/gu, " ").trim();
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("the goals section read", () => {
  /**
   * The drawer drew the section even while folded, so its count filled in by itself. A page is
   * drawn only when opened, and a Go to entry that waited for that showed "Goals" with no count
   * over a workspace with open tasks. The entry asks for the reading itself.
   */
  it("fills the Go to count without the page being opened", async () => {
    const callOperation = vi.fn(async () => ({ goals: [goal("a")], brokenFiles: 0 }));
    const { panel: section } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");

    expect(section.badge?.(harness.context)).toBeUndefined();
    await flush();

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(section.badge?.(harness.context)).toBe(2);
    expect(callOperation).toHaveBeenCalledTimes(1);
  });

  it("reads once per workspace and shows what it read", async () => {
    const callOperation = vi.fn(async () => ({ goals: [goal("a")], brokenFiles: 0 }));
    const { panel: section } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(await shownText(harness.container)).toContain("goal a");
  });

  /**
   * The read's input carries the session cwd, so a different session in the
   * same workspace is a different reading. With the key on the workspace only,
   * the section shows one session's goals while the other is selected and
   * never asks again.
   */
  it("re-reads when the selected session moves inside the same workspace", async () => {
    const callOperation = vi.fn(async (_operation: string, input: unknown) => {
      const cwd = (input as { sessionCwd?: string }).sessionCwd;
      return { goals: [goal(cwd === "/w/session-b" ? "from-b" : "from-a")], brokenFiles: 0 };
    });
    const { panel: section } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(await shownText(harness.container)).toContain("goal from-a");

    harness.setSessionCwd("/w/session-b");
    harness.draw();
    await flush();
    expect(callOperation).toHaveBeenCalledTimes(2);
    expect(await shownText(harness.container)).toContain("goal from-b");
  });

  /**
   * A refused read answered as an empty goal list once, which is also what a workspace with no
   * goals answers, so a machine that refused looked like one with nothing in it.
   */
  it("says a read the machine refused could not be read instead of showing an empty workspace", async () => {
    const callOperation = vi.fn(async () => { throw new Error("forbidden"); });
    const { panel: section } = sectionOf(callOperation, () => ({ kind: "final", words: "forbidden" }));
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(await shownText(harness.container)).toContain("could not");
  });

  /** B48 (owner, 2026-10-13): a read that got no answer is retried, never shown as a failure. */
  it("keeps reading after a read that got no answer, and shows the answer when it comes", async () => {
    const callOperation = vi.fn()
      .mockRejectedValueOnce(new Error("The server did not answer within 30s."))
      .mockResolvedValueOnce({ goals: [goal("later")], brokenFiles: 0 });
    const { panel: section } = sectionOf(callOperation, () => ({ kind: "retry", delayMs: 1 }));
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    await flush();

    expect({ calls: callOperation.mock.calls.length, text: await shownText(harness.container) }).toEqual({ calls: 2, text: "goal later" });
  });

  /**
   * Owner, 2026-09-30: "just say there are no goals". Owner, 2026-10-13: in the same dashed box
   * the Background and Subagents pages use for none.
   */
  it("says there are no goals in the host list's empty box", async () => {
    const callOperation = vi.fn(async () => ({ goals: [], brokenFiles: 0 }));
    const { panel: section } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();

    expect(await shownText(harness.container)).toBe("[box] No goals in this project.");
  });

  /**
   * The section once left the drawer when empty and nothing read it again, so a goal created later
   * in the same session never appeared. With no refresh button, a settled turn reads again.
   */
  it("re-reads when a turn of the selected session settles", async () => {
    const callOperation = vi.fn()
      .mockResolvedValueOnce({ goals: [], brokenFiles: 0 })
      .mockResolvedValueOnce({ goals: [goal("created")], brokenFiles: 0 });
    const { panel: section, settleActivity } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    expect(await shownText(harness.container)).toBe("[box] No goals in this project.");

    settleActivity();

    expect({ calls: callOperation.mock.calls.length, text: await shownText(harness.container) }).toEqual({ calls: 2, text: "goal created" });
  });

  /** Goals belong to the project: another session of it can create one while this page is closed. */
  it("re-reads each time the page is opened, and once when first shown", async () => {
    const callOperation = vi.fn()
      .mockResolvedValueOnce({ goals: [], brokenFiles: 0 })
      .mockResolvedValueOnce({ goals: [goal("elsewhere")], brokenFiles: 0 });
    const { panel: section } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(callOperation).toHaveBeenCalledTimes(1);

    await section.onInvalidate?.(harness.context);

    expect({ calls: callOperation.mock.calls.length, text: await shownText(harness.container) }).toEqual({ calls: 2, text: "goal elsewhere" });
  });

  it("keeps a newer read's answer when an earlier read answers late", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const callOperation = vi.fn(() => new Promise<unknown>((resolve) => { answers.push(resolve); }));
    const { panel: section, settleActivity } = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    settleActivity();
    answers[1]?.({ goals: [goal("newer")], brokenFiles: 0 });
    await flush();
    answers[0]?.({ goals: [goal("older")], brokenFiles: 0 });
    await flush();

    expect(await shownText(harness.container)).toContain("goal newer");
  });
});
