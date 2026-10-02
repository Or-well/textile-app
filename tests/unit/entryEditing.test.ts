import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick, type VNode } from "vue";
import EntryPage from "../../src/pages/EntryPage.vue";
import { createEntry, createMember, createProject } from "./factories";

const services = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), resolve: vi.fn() }));
vi.mock("../../src/services/entries", () => ({
  saveEntry: services.save, loadEntries: services.load, updateEntryAccess: vi.fn(),
}));
vi.mock("../../src/services/comments", () => ({
  markDisputed: vi.fn(), resolveDispute: services.resolve,
}));
vi.mock("../../src/services/permissions", async (original) => ({
  ...await original<typeof import("../../src/services/permissions")>(),
  getCurrentUser: () => createMember(["admin"]),
}));
vi.mock("../../src/components/EntryAssistPanel.vue", () => ({
  default: defineComponent({ name: "EntryAssistPanel", render: () => h("aside") }),
}));
vi.mock("../../src/components/EntrySideList.vue", () => ({
  default: defineComponent({ name: "EntrySideList", render: () => h("aside") }),
}));

// A minimal Vue host exercises component events and watchers without a browser dependency.
type HostNode = {
  children: HostNode[]; parent: HostNode | null; text: string; tagName: string;
  value: string; composing: boolean; props: Record<string, unknown>;
  listeners: Record<string, (event: unknown) => void>;
  addEventListener: (name: string, handler: (event: unknown) => void) => void;
  removeEventListener: (name: string) => void;
  getRootNode: () => { activeElement: null };
};
function node(tag = "", text = ""): HostNode {
  const result: HostNode = {
    children: [], parent: null, text, tagName: tag.toUpperCase(), value: "", composing: false,
    listeners: {}, props: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    removeEventListener(name) { delete this.listeners[name]; },
    getRootNode() { return { activeElement: null }; },
  };
  return result;
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (tag) => node(tag), createText: (text) => node("", text),
  createComment: (text) => node("", text),
  setText: (el, text) => { el.text = text; },
  setElementText: (el, text) => { el.text = text; el.children = []; },
  parentNode: (el) => el.parent,
  nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  patchProp: (el, key, _previous, value) => { el.props[key] = value; },
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
function findNode(root: HostNode, matches: (node: HostNode) => boolean): HostNode | undefined {
  if (matches(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, matches);
    if (found) return found;
  }
  return undefined;
}
const first = createEntry({ id: "a:1", file_id: "a", target: "原译文", disputed: true });
const second = createEntry({ id: "b:1", file_id: "b", target: "第二条" });
let unmount: (() => void) | undefined;
async function mount() {
  const root = node();
  const app = renderer.createApp(EntryPage, {
    project: createProject(), fileId: first.file_id,
    scopeEntries: [first, second], targetEntryId: first.id,
  });
  const page = app.mount(root);
  unmount = () => app.unmount();
  await nextTick();
  const get = (name: string) => Object.fromEntries(
    Object.entries(component(page.$.subTree, name)!.props!).map(([key, value]) =>
      [key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]),
  );
  const draft = async (text: string) => {
    const input = findNode(root, (el) => el.tagName === "TEXTAREA")!;
    input.value = text;
    input.listeners.input!({ target: input });
    await nextTick();
  };
  const draftValue = () => findNode(root, (el) => el.tagName === "TEXTAREA")!.value;
  const click = async (label: string) => {
    const button = findNode(root, (el) => el.tagName === "BUTTON" && el.text.trim() === label)!;
    await (button.props.onClick as () => unknown)();
    await nextTick();
  };
  return { get, draft, draftValue, click };
}
beforeEach(() => {
  vi.stubGlobal("window", { confirm: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  services.save.mockReset(); services.load.mockReset(); services.resolve.mockReset();
});
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals(); });

describe("continuous editing component behavior", () => {
  it("preserves the editor and parent draft when only context or access metadata changes", async () => {
    const { get, draft, draftValue } = await mount();
    await draft("尚未保存的译文");
    get("EntryAssistPanel").onEntryUpdated({ ...first, context: "新上下文", locked: true });
    await nextTick();
    expect(get("EntryAssistPanel").draftTarget).toBe("尚未保存的译文");
    expect(draftValue()).toBe("尚未保存的译文");
    get("EntryAssistPanel").onEntryUpdated({ ...first, target: "恢复的历史译文" });
    await nextTick();
    expect(draftValue()).toBe("恢复的历史译文");
    expect(get("EntryAssistPanel").draftTarget).toBe("恢复的历史译文");
  });
  it("does not switch back when an earlier entry's asynchronous update completes", async () => {
    const { get } = await mount();
    get("EntryEditor").onNext();
    await nextTick();
    get("EntryAssistPanel").onEntryUpdated({ ...first, context: "后台完成的上下文修改" });
    await nextTick();
    expect(get("EntryEditor").entry.id).toBe(second.id);
    expect(get("EntrySideList").entries[0].context).toBe("后台完成的上下文修改");
  });
  it("retains the current entry and draft when saving before next fails", async () => {
    const { get, draft } = await mount();
    await draft("待保存");
    services.save.mockRejectedValue(new Error("写入失败"));
    await get("EntryEditor").onSaveNext({ ...first, target: "待保存" });
    await nextTick();
    expect(get("EntryEditor").entry.id).toBe(first.id);
    expect(get("EntryAssistPanel").draftTarget).toBe("待保存");
  });
  it("saves and advances across files while keeping the original scope", async () => {
    const { get } = await mount();
    services.save.mockImplementation(async (entry) => entry);
    services.resolve.mockImplementation(async (entry) => ({ ...entry, disputed: false }));
    await get("EntryEditor").onResolveDisputeNext({ ...first, target: "修正译文" });
    await nextTick();
    expect(services.save).toHaveBeenCalledOnce();
    expect(get("EntryEditor").entry.id).toBe(second.id);
    expect(get("EntrySideList").entries.map((entry: { id: string }) => entry.id)).toEqual([first.id, second.id]);
    expect(get("EntrySideList").entries[0].disputed).toBe(false);
  });
  it("keeps the selected entry when discarding a draft is cancelled", async () => {
    const { get, draft } = await mount();
    await draft("未保存");
    vi.mocked(window.confirm).mockReturnValue(false);
    get("EntryEditor").onNext();
    await nextTick();
    expect(get("EntryEditor").entry.id).toBe(first.id);
    expect(get("EntryAssistPanel").draftTarget).toBe("未保存");
  });
  it("returns from file context to the original scope position", async () => {
    const { get, click } = await mount();
    const neighbor = createEntry({ id: "a:2", file_id: "a" });
    services.load.mockResolvedValue([first, neighbor]);
    await click("查看文件上下文");
    get("EntryEditor").onNext();
    await nextTick();
    expect(get("EntryEditor").entry.id).toBe(neighbor.id);
    await click("返回本次结果");
    expect(get("EntryEditor").entry.id).toBe(first.id);
    expect(get("EntrySideList").entries.map((entry: { id: string }) => entry.id)).toEqual([first.id, second.id]);
  });
});
