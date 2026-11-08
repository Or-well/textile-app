import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick } from "vue";
import ConflictResolver from "../../src/components/ConflictResolver.vue";
import type { ConflictResolution, TaskChangeConflict } from "../../src/services/changes";
import type { Task } from "../../src/model/types";

type HostNode = {
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  tagName: string;
  value: string;
  _value?: unknown;
  selected: boolean;
  multiple: boolean;
  options: HostNode[];
  props: Record<string, unknown>;
  addEventListener: () => void;
};

function node(tag = "", text = ""): HostNode {
  return {
    children: [], parent: null, text, tagName: tag.toUpperCase(), value: "",
    selected: false, multiple: false, props: {}, addEventListener() {},
    get options() { return this.children.filter((child) => child.tagName === "OPTION"); },
  };
}

const renderer = createRenderer<HostNode, HostNode>({
  createElement: (tag) => node(tag), createText: (text) => node("", text),
  createComment: (text) => node("", text),
  setText: (el, text) => { el.text = text; },
  setElementText: (el, text) => { el.text = text; el.children = []; },
  parentNode: (el) => el.parent,
  nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
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

function nodes(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const task: Task = {
  id: "task-1", type: "translate", title: "Completed task", description: "",
  file_id: "file-1", range_start: 1, range_end: 1, entry_ids: [],
  assignee: "member-1", status: "completed", target: "", submit_method: "change_package",
  created_by: "owner-1", created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z", due_at: "",
};

let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
});
afterEach(() => { unmount?.(); vi.unstubAllGlobals(); });

async function mountResolver(conflicts: TaskChangeConflict[], isProjectUpdate = false) {
  const root = node();
  const apply = vi.fn<(resolutions: ConflictResolution[]) => void>();
  const app = renderer.createApp(ConflictResolver, { conflicts, isProjectUpdate, canApply: true, onApply: apply });
  app.mount(root);
  unmount = () => app.unmount();
  await nextTick();
  const button = (label: string) => nodes(root).find((el) => el.tagName === "BUTTON" && el.text === label)!;
  const click = async (label: string) => {
    (button(label).props.onClick as () => void)();
    await nextTick();
  };
  return { root, apply, button, click };
}

describe("task conflict choices", () => {
  it("leaves unsupported task states unresolved when applying all package choices", async () => {
    const conflict: TaskChangeConflict = {
      kind: "task", conflictId: "task:task-1", taskId: task.id,
      mainTask: task, packageTask: { ...task, status: "submitted" }, reasons: ["status"],
      packageStatusError: "这个任务状态不能通过普通修改包采用。",
    };
    const validConflict: TaskChangeConflict = {
      ...conflict, conflictId: "task:task-2", taskId: "task-2",
      mainTask: { ...task, id: "task-2", status: "submitted" },
      packageTask: { ...task, id: "task-2", status: "assigned" },
      packageStatusError: undefined,
    };
    const page = await mountResolver([conflict, validConflict]);
    const packageOptions = nodes(page.root).filter((el) => el.tagName === "OPTION" && el.value === "use_package");
    expect(packageOptions.map((option) => option.props.disabled)).toEqual([true, false]);
    await page.click("全部使用修改包");
    expect(page.button("应用处理结果").props.disabled).toBe(true);
    expect(page.apply).not.toHaveBeenCalled();
    expect(nodes(page.root).some((el) => el.text.includes("仍有 1 项未选择"))).toBe(true);

    await page.click("全部保留当前项目");
    expect(page.button("应用处理结果").props.disabled).toBe(false);
    await page.click("应用处理结果");
    expect(page.apply).toHaveBeenCalledWith([
      expect.objectContaining({ conflictId: conflict.conflictId, action: "keep_main" }),
      expect.objectContaining({ conflictId: validConflict.conflictId, action: "keep_main" }),
    ]);
  });

  it("allows keeping a complete local task record during a project update", async () => {
    const conflict: TaskChangeConflict = {
      kind: "task", conflictId: "workspace:task:task-1", taskId: task.id,
      mainTask: task, packageTask: { ...task, status: "assigned" }, reasons: ["status"],
    };
    const page = await mountResolver([conflict], true);
    await page.click("全部保留本地修改");
    expect(page.button("应用处理结果").props.disabled).toBe(false);
    await page.click("应用处理结果");
    expect(page.apply).toHaveBeenCalledWith([
      expect.objectContaining({ conflictId: conflict.conflictId, action: "use_package" }),
    ]);
  });
});
