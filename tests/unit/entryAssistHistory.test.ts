import { beforeEach, expect, it, vi } from "vitest";
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

function findButtons(node: HostNode, matches: (label: string) => boolean): HostNode[] {
  if (node.tag === "button" && matches(node.content.trim())) return [node];
  return node.children.flatMap((child) => findButtons(child, matches));
}

function click(button: HostNode | undefined): void {
  expect(button).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  (button!.props.onClick as () => void)();
}

function versionRow(button: HostNode | undefined): HostNode | undefined {
  while (button && button.tag !== "li") button = button.parent ?? undefined;
  return button;
}

const actor = createMember(["owner"]);
const proofreader = createMember(["proofreader"], { id: "proofreader-1", name: "测试校对员" });
const first = createEntry({ id: "file-1:1", source: "", target: "第一版", status: "translated" });
const second = { ...first, target: "第二版" };
const third = { ...first, target: "第三版" };
const secondEdit = createEntryVersionEvent(first, second, actor.id);

beforeEach(() => {
  services.load.mockReset();
  services.restore.mockReset();
});

function mountHistory(entry: Entry, draft?: string) {
  const selected = ref(entry);
  const draftTarget = ref(draft);
  const confirm = vi.fn((_message: string) => true);
  vi.stubGlobal("window", { confirm });
  setCurrentUser(actor);
  const root = new HostNode();
  const app = renderer.createApp({
    render: () => h(EntryAssistPanel, {
      entry: selected.value,
      draftTarget: draftTarget.value ?? selected.value.target,
      activeTab: "history",
      members: [actor, proofreader],
      onHistoryApplied: (updated: Entry) => {
        selected.value = updated;
        draftTarget.value = undefined;
      },
    }),
  });
  app.mount(root);

  return {
    root,
    selected,
    confirm,
    versionButtons: (target: string) => findButtons(root, (label) => label.includes(target)),
    actionButtons: () => findButtons(root, (label) => label === "设为当前译文"),
    unmount() {
      app.unmount();
      setCurrentUser(null);
      vi.unstubAllGlobals();
    },
  };
}

it("moves the current marker between saved versions and clears history when selecting another entry", async () => {
  const proofreadSecond: Entry = {
    ...second, status: "proofread", proofread_by: [proofreader.id], proofread_count: 1,
  };
  const statusEvent = createEntryVersionEvent(second, proofreadSecond, proofreader.id, {
    operation: "proofread",
  });
  const thirdEdit = createEntryVersionEvent(proofreadSecond, third, actor.id);
  const restoreSecond = createEntryVersionEvent(third, second, actor.id, {
    type: "entry.restored",
    operation: "restore",
    restoredFromEventId: secondEdit.id,
    restoredFromSnapshot: "after",
  });
  const restoreThird = createEntryVersionEvent(second, third, actor.id, {
    type: "entry.restored",
    operation: "restore",
    restoredFromEventId: thirdEdit.id,
    restoredFromSnapshot: "after",
  });
  const pendingHistory = Promise.withResolvers<ProjectEvent[]>();
  const events: ProjectEvent[] = [secondEdit, statusEvent, thirdEdit];
  services.load.mockImplementation((entryId: string) =>
    entryId === first.id ? Promise.resolve([...events]) : pendingHistory.promise,
  );
  services.restore.mockImplementationOnce(async () => {
    events.push(restoreSecond);
    return second;
  }).mockImplementationOnce(async () => {
    events.push(restoreThird);
    return third;
  });
  const history = mountHistory(third);
  const { root, versionButtons, actionButtons } = history;

  try {
    await vi.waitFor(() => {
      expect(versionRow(versionButtons(third.target)[0])?.content).toContain("当前译文");
    });
    expect(root.content).toContain(proofreader.name);
    expect(findButtons(root, (label) => label === "撤销" || label === "重做")).toHaveLength(0);
    click(versionButtons(third.target)[0]);
    await nextTick();
    expect(actionButtons()).toHaveLength(0);

    click(versionButtons(second.target)[0]);
    await nextTick();
    expect(services.restore).not.toHaveBeenCalled();
    expect(actionButtons()).toHaveLength(1);
    click(actionButtons()[0]);
    await vi.waitFor(() => {
      expect(versionRow(versionButtons(second.target)[0])?.content).toContain("当前译文");
    });
    expect(services.restore).toHaveBeenLastCalledWith(
      first.id, secondEdit.id, expect.objectContaining({ snapshot: "after" }),
    );
    expect(versionButtons(second.target)).toHaveLength(1);
    expect(versionButtons(third.target)).toHaveLength(1);
    expect(actionButtons()).toHaveLength(0);

    await vi.waitFor(() => expect(versionButtons(third.target)[0]?.props.disabled).toBe(false));
    click(versionButtons(third.target)[0]);
    await vi.waitFor(() => expect(actionButtons()[0]?.props.disabled).toBe(false));
    click(actionButtons()[0]);
    await vi.waitFor(() => {
      expect(versionRow(versionButtons(third.target)[0])?.content).toContain("当前译文");
    });
    expect(services.restore).toHaveBeenLastCalledWith(
      first.id, thirdEdit.id, expect.objectContaining({ snapshot: "after" }),
    );
    expect(versionButtons(second.target)).toHaveLength(1);
    expect(versionButtons(third.target)).toHaveLength(1);
    expect(history.confirm).not.toHaveBeenCalled();

    history.selected.value = createEntry({ id: "file-1:2", source: "" });
    await nextTick();
    expect(root.content).toContain("正在读取历史记录");
    expect(root.content).not.toContain("当前译文");
    expect(root.content).not.toContain(second.target);
    pendingHistory.resolve([]);
    await vi.waitFor(() => expect(root.content).toContain("暂无历史记录"));
  } finally {
    history.unmount();
  }
});

const reviewed: Entry = {
  ...second, status: "reviewed", proofread_by: [proofreader.id], proofread_count: 1, reviewed_by: actor.id,
};

it.each([
  { entry: second, draft: "未保存的改动", warnings: ["未保存"] },
  { entry: reviewed, draft: undefined, warnings: ["校对", "审核"] },
])("keeps the current version when cancelling the confirmation for $warnings", async ({ entry, draft, warnings }) => {
  const statusEvent = createEntryVersionEvent(second, reviewed, actor.id, { operation: "review" });
  services.load.mockResolvedValue(entry === reviewed ? [secondEdit, statusEvent] : [secondEdit]);
  const history = mountHistory(entry, draft);
  history.confirm.mockReturnValue(false);

  try {
    await vi.waitFor(() => expect(history.versionButtons(first.target)).toHaveLength(1));
    click(history.versionButtons(first.target)[0]);
    await nextTick();
    click(history.actionButtons()[0]);
    expect(history.confirm).toHaveBeenCalledOnce();
    const [[warning]] = history.confirm.mock.calls;
    for (const consequence of warnings) expect(warning).toContain(consequence);
    expect(services.restore).not.toHaveBeenCalled();
    expect(versionRow(history.versionButtons(second.target)[0])?.content).toContain("当前译文");
  } finally {
    history.unmount();
  }
});
