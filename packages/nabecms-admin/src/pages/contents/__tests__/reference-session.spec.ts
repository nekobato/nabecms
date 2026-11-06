import { describe, expect, it } from "vitest";
import { createReferenceSession } from "../entry-edit/referenceSession";
const a = { modelId: "posts", entryId: "a" };
const b = { modelId: "authors", entryId: "b" };
const c = { modelId: "organizations", entryId: "c" };

describe("reference editing session", () => {
  it("keeps opaque model and entry IDs distinct when their separators overlap", () => {
    const first = { modelId: "victim", entryId: "a/b" };
    const second = { modelId: "victim/a", entryId: "b" };
    const session = createReferenceSession(first);
    session.update(first, { dirty: true });
    session.open(second);
    expect(session.panes).toHaveLength(2);
    expect(session.current.value).toMatchObject({ ...second, dirty: false });
    session.open(first);
    expect(session.current.value).toMatchObject({ ...first, dirty: true });
  });
  it("returns to an ancestor without duplicating or discarding an off-path draft", () => {
    const session = createReferenceSession(a);
    session.open(b);
    session.open(c);
    session.update(c, { dirty: true });
    session.open(a);
    expect(session.path.value).toEqual(["posts/a"]);
    expect(session.panes).toHaveLength(3);
    expect(session.dirtyPanes.value.map((p) => p.entryId)).toEqual(["c"]);
    session.open(c);
    expect(session.current.value.dirty).toBe(true);
    expect(session.panes).toHaveLength(3);
  });
  it("handles self references and arbitrarily deep paths without recursively loading a graph", () => {
    const session = createReferenceSession(a);
    session.open(a);
    expect(session.panes).toHaveLength(1);
    for (let i = 0; i < 25; i++) session.open({ modelId: "nodes", entryId: String(i) });
    expect(session.breadcrumbs.value).toHaveLength(26);
    session.back();
    expect(session.current.value.entryId).toBe("23");
  });
  it("blocks switching or discarding while saving, then clears related drafts only", () => {
    const session = createReferenceSession(a);
    session.update(a, { dirty: true });
    session.open(b);
    session.update(b, { dirty: true, busy: true });
    session.open(c);
    session.back();
    session.resetRelated();
    expect(session.current.value.entryId).toBe("b");
    session.update(b, { busy: false, dirty: false });
    expect(session.dirtyPanes.value.map((p) => p.entryId)).toEqual(["a"]);
    session.resetRelated();
    expect(session.panes).toHaveLength(1);
    expect(session.current.value.dirty).toBe(true);
  });
});
