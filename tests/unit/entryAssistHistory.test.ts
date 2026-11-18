import { expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref } from "vue";
import EntryAssistPanel from "../../src/components/EntryAssistPanel.vue";
import type { Entry, ProjectEvent } from "../../src/model/types";
import { createEntryVersionEvent } from "../../src/services/history";
import { setCurrentUser } from "../../src/services/permissions";
import { createEntry, createMember } from "./factories";

const services = vi.hoisted(() => ({ load: vi.fn(), restore: vi.fn() }));
vi.mock("../../src/services/history", async (original) => ({
  ...await original<typeof import("../../src/services/history")>(),
  getEntryHistory: services.load,
}));
vi.mock("../../src/services/entries", async (original) => ({
  ...await original<typeof import("../../src/services/entries")>(),
  restoreEntryVersion: services.restore,
}));

class HostNode {
  parent: HostNode | null = null;
  children: HostNode[] = [];
  props: Record<string, unknown> = {};

  constructor(public tag = "", public text = "") {}

  get content(): string {
    return this.text + this.children.map((child) => child.content).join("");
  }
}

function detach(node: HostNode) {
  if (!node.parent) return;
  node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = null;
}

const renderer = createRenderer<HostNode, HostNode>({
  createElement: (tag) => new HostNode(tag),
  createText: (text) => new HostNode("", text),
  createComment: () => new HostNode(),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; node.children = []; },
  patchProp: (node, key, _previous, value) => { node.props[key] = value; },
  insert(node, parent, anchor) {
    detach(node);
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    parent.children.splice(index, 0, node);
    node.parent = parent;
  },
  remove: detach,
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});

function findButton(node: HostNode, label: string): HostNode | undefined {
  if (node.tag === "button" && node.content.trim() === label) return node;
  for (const child of node.children) {
    const button = findButton(child, label);
    if (button) return button;
  }
}

it("keeps the version list after undo and clears the old entry while the next history loads", async () => {
  const actor = createMember(["owner"]);
  const before = createEntry({ id: "file-1:1", source: "", target: "第一版" });
  const after = { ...before, target: "第二版" };
  const edit = createEntryVersionEvent(before, after, actor.id);
  const undo = createEntryVersionEvent(after, before, actor.id, {
    type: "entry.restored",
    operation: "undo",
    restoredFromEventId: edit.id,
    restoredFromSnapshot: "before",
  });
  const selected = ref<Entry>(after);
  const pendingHistory = Promise.withResolvers<ProjectEvent[]>();
  services.load.mockResolvedValueOnce([edit]).mockResolvedValueOnce([edit, undo])
    .mockReturnValueOnce(pendingHistory.promise);
  services.restore.mockResolvedValueOnce(before);
  setCurrentUser(actor);

  const root = new HostNode();
  const app = renderer.createApp({
    render: () => h(EntryAssistPanel, {
      entry: selected.value,
      draftTarget: selected.value.target,
      activeTab: "history",
      onHistoryApplied: (entry: Entry) => { selected.value = entry; },
    }),
  });
  app.mount(root);

  try {
    await vi.waitFor(() => expect(findButton(root, "撤销")?.props.disabled).toBe(false));
    const clickUndo = findButton(root, "撤销")!.props.onClick as () => void;
    clickUndo();
    await vi.waitFor(() => expect(findButton(root, "重做")?.props.disabled).toBe(false));
    expect(root.content).toContain("已撤销译文修改");
    expect(root.content).toContain("第二版");
    expect(root.content).toContain("当前版本");

    selected.value = createEntry({ id: "file-1:2", source: "" });
    await nextTick();
    expect(root.content).toContain("正在读取历史记录");
    expect(root.content).not.toContain("已撤销译文修改");
    expect(root.content).not.toContain("第二版");
    pendingHistory.resolve([]);
    await vi.waitFor(() => expect(root.content).toContain("暂无历史记录"));
  } finally {
    app.unmount();
    setCurrentUser(null);
  }
});
