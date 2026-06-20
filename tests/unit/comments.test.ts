import { describe, expect, it } from "vitest";
import type { Comment } from "../../src/model/types";
import {
  deleteComment,
  getCommentDeletionSet,
  setCommentsProjectStorage,
} from "../../src/services/comments";
import { setHistoryProjectStorage } from "../../src/services/history";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { setCurrentUser } from "../../src/services/permissions";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember } from "./factories";

function createComments(): Comment[] {
  return [
    {
      id: "comment-parent",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: "translator-1",
      body: "Parent",
      reply_to: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "comment-reply",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: "reviewer-1",
      body: "Reply",
      reply_to: "comment-parent",
      created_at: "2026-01-01T00:01:00.000Z",
    },
  ];
}

describe("comment deletion", () => {
  it("collects all nested replies in the deletion set", () => {
    const comments = createComments();

    expect(
      getCommentDeletionSet(comments, "comment-parent").map(
        (comment) => comment.id,
      ),
    ).toEqual(["comment-parent", "comment-reply"]);
  });

  it("does not let an author delete another member's reply indirectly", async () => {
    const comments = createComments();
    const entry = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
    });
    const root = createMemoryProjectDirectory(
      {
        "comments/file-1/000001.jsonl": comments
          .map((comment) => JSON.stringify(comment))
          .join("\n"),
      },
      "comments-test.hproj",
    );
    const storage = createProjectStorage(root);

    setCommentsProjectStorage(storage);
    setHistoryProjectStorage(storage);
    setCurrentUser(
      createMember(["translator"], {
        id: "translator-1",
      }),
    );

    await expect(
      deleteComment(entry, "comment-parent"),
    ).rejects.toThrow("没有删除整组评论的权限");
    await expect(
      storage.readJsonl<Comment>("comments/file-1/000001.jsonl"),
    ).resolves.toEqual(comments);
  });

  it("allows a member with delete-any permission to remove the thread", async () => {
    const comments = createComments();
    const entry = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
    });
    const root = createMemoryProjectDirectory(
      {
        "comments/file-1/000001.jsonl": comments
          .map((comment) => JSON.stringify(comment))
          .join("\n"),
      },
      "comments-owner-test.hproj",
    );
    const storage = createProjectStorage(root);

    setCommentsProjectStorage(storage);
    setHistoryProjectStorage(storage);
    setCurrentUser(createMember(["owner"], { id: "owner-1" }));

    await expect(deleteComment(entry, "comment-parent")).resolves.toBeUndefined();
    await expect(
      storage.readJsonl<Comment>("comments/file-1/000001.jsonl"),
    ).resolves.toEqual([]);
  });
});
