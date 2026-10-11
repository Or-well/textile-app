import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick, type VNode } from "vue";
import TasksPage from "../../src/pages/TasksPage.vue";
import TaskEditDialog from "../../src/components/TaskEditDialog.vue";
import type { Task } from "../../src/model/types";
import { createMember, createProject } from "./factories";

const services = vi.hoisted(() => ({ load: vi.fn(), progress: vi.fn(), summary: vi.fn(), complete: vi.fn() }));
vi.mock("../../src/services/tasks", async (original) => ({
  ...await original<typeof import("../../src/services/tasks")>(),
  loadTasks: services.load, getTaskProgress: services.progress,
  getTaskFilesEntrySummary: services.summary, completeTask: services.complete,
}));
vi.mock("../../src/components/TaskPanel.vue", () => ({
  default: defineComponent({ name: "TaskPanel", render: () => h("aside") }),
}));
vi.mock("../../src/components/TaskListItem.vue", () => ({
  default: defineComponent({ name: "TaskListItem", render: () => h("button") }),
}));

type HostNode = {
  children: HostNode[]; parent: HostNode | null; text: string; tagName: string;
  value: string; _value?: unknown; composing: boolean; selectedIndex: number;
  selected: boolean; multiple: boolean; options: HostNode[];
  props: Record<string, unknown>; listeners: Record<string, (event: unknown) => void>;
  addEventListener: (name: string, handler: (event: unknown) => void) => void;
  removeEventListener: (name: string) => void;
  getRootNode: () => { activeElement: null };
};
function node(tag = "", text = ""): HostNode {
  return {
    children: [], parent: null, text, tagName: tag.toUpperCase(), value: "", composing: false,
    selectedIndex: -1, selected: false, multiple: false, props: {}, listeners: {},
    get options() { return this.children.filter(child => child.tagName === "OPTION"); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    removeEventListener(name) { delete this.listeners[name]; },
    getRootNode() { return { activeElement: null }; },
  };
}
const body = node("body");
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node("", text),
  createComment: text => node("", text), querySelector: () => body,
  setText: (el, text) => { el.text = text; },
  setElementText: (el, text) => { el.text = text; el.children = []; },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  patchProp(el, key, _old, value) {
    el.props[key] = value;
    if (key === "value") { el.value = String(value ?? ""); el._value = value; }
  },
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    el.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
  },
  remove(el) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    el.parent = null;
  },
});
function component(vnode: VNode, name: string): VNode | undefined {
  const type = vnode.type as { name?: string; __name?: string };
  if (type.name === name || type.__name === name) return vnode;
  if (vnode.component) return component(vnode.component.subTree, name);
  for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
    if (typeof child !== "object" || !child) continue;
    const found = component(child as VNode, name);
    if (found) return found;
  }
  return undefined;
}
function nodes(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(nodes)];
}
const member = createMember(["owner"]);
function task(id: string, status: Task["status"] = "assigned"): Task {
  return { id, title: id, type: "custom", file_id: "", range_start: 1, range_end: 1,
    entry_ids: [], assignee: member.id, status, target: "", submit_method: "change_package",
    created_by: member.id, created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", due_at: "" };
}
async function settle() {
  for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); }
}
let unmount: (() => void) | undefined;
async function mountPage() {
  const root = node();
  const app = renderer.createApp(TasksPage, { project: createProject(), members: [member], currentUser: member });
  const page = app.mount(root);
  unmount = () => app.unmount();
  await settle();
  const panel = () => component(page.$.subTree, "TaskPanel")!.props!;
  const select = (value: Task) => component(page.$.subTree, "TaskListItem")!.props!.onSelect(value);
  const click = async (label: string) => {
    const button = nodes(root).find(el => el.tagName === "BUTTON" && el.text === label)!;
    (button.props.onClick as () => void)();
    await settle();
  };
  return { root, panel, select, click };
}
beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("Document", class {}); vi.stubGlobal("ShadowRoot", class {});
  services.load.mockReset(); services.progress.mockReset(); services.summary.mockReset(); services.complete.mockReset();
  services.progress.mockResolvedValue({ taskId: "a", progressAvailable: false });
  services.summary.mockResolvedValue({ fileCount: 0, totalEntries: 0, files: [] });
});
afterEach(() => { unmount?.(); unmount = undefined; body.children = []; vi.unstubAllGlobals(); });

describe("task page behavior", () => {
  it("removes the retired filter and clears details when a filter has no matches", async () => {
    services.load.mockResolvedValue([task("a")]);
    const page = await mountPage();
    expect(nodes(page.root).some(el => el.tagName === "BUTTON" && el.text === "进行中")).toBe(false);
    expect(page.panel().task.id).toBe("a");
    await page.click("已完成");
    expect(page.panel().task).toBeUndefined();
    expect(page.panel().progress).toBeUndefined();
    await page.click("我的任务");
    expect(page.panel().task.id).toBe("a");
  });

  it("ignores progress from an earlier selection and from a cleared selection", async () => {
    services.load.mockResolvedValue([task("a"), task("b")]);
    const page = await mountPage();
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    services.progress.mockImplementation((id: string) => new Promise(resolve => {
      if (id === "a") resolveA = resolve; else resolveB = resolve;
    }));
    page.select(task("a"));
    page.select(task("b"));
    await nextTick();
    expect(page.panel().progress).toBeUndefined();
    resolveB({ taskId: "b", progressPercent: 80 }); await settle();
    resolveA({ taskId: "a", progressPercent: 10 }); await settle();
    expect(page.panel().task.id).toBe("b");
    expect(page.panel().progress.taskId).toBe("b");
    page.select(task("a"));
    await page.click("已完成");
    resolveA({ taskId: "a", progressPercent: 10 }); await settle();
    expect(page.panel().task).toBeUndefined();
    expect(page.panel().progress).toBeUndefined();
  });

  it("reports current progress failures and hides unavailable assignment actions", async () => {
    services.load.mockResolvedValue([task("a", "completed")]);
    services.progress.mockRejectedValue(new Error("损坏的词条文件"));
    const page = await mountPage();
    expect(page.panel().actions.assign).toBe(false);
    expect(nodes(page.root).some(el => el.text === "损坏的词条文件")).toBe(true);
  });

  it("clears a progress error when retrying the current task successfully", async () => {
    services.load.mockResolvedValue([task("a")]);
    services.progress.mockRejectedValueOnce(new Error("暂时无法读取进度"));
    const page = await mountPage();
    expect(nodes(page.root).some(el => el.text === "暂时无法读取进度")).toBe(true);
    await page.select(task("a"));
    await settle();
    expect(page.panel().progress.taskId).toBe("a");
    expect(nodes(page.root).some(el => el.text === "暂时无法读取进度")).toBe(false);
  });

  it.each(["progress", "list"] as const)(
    "keeps a %s refresh error visible after a successful task action",
    async (failure) => {
      services.load.mockResolvedValue([task("a", "submitted")]);
      const page = await mountPage();
      services.complete.mockResolvedValue(task("a", "completed"));
      if (failure === "progress") {
        services.load.mockResolvedValue([task("a", "completed")]);
        services.progress.mockRejectedValue(new Error("刷新进度失败"));
      } else {
        services.load.mockRejectedValue(new Error("刷新列表失败"));
      }
      page.panel().onCompleteTask("a");
      await settle();
      expect(nodes(page.root).some(el => el.text === "任务已完成。")).toBe(true);
      expect(nodes(page.root).some(el => el.text === (failure === "progress" ? "刷新进度失败" : "刷新列表失败"))).toBe(true);
    },
  );

  it("shows read-only status and assignee without submitting stale workflow fields", async () => {
    const onSave = vi.fn();
    const app = renderer.createApp(TaskEditDialog, {
      open: true, mode: "edit", task: task("a", "submitted"),
      project: createProject(), members: [member], onSave,
    });
    app.mount(node()); unmount = () => app.unmount(); await settle();
    const readOnlyInputs = nodes(body).filter(el => el.tagName === "INPUT" && "readonly" in el.props);
    expect(readOnlyInputs.map(el => el.value)).toEqual(["已提交", member.name]);
    const form = nodes(body).find(el => el.tagName === "FORM")!;
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("status");
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("assignee");
  });
});
