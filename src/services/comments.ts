import type { Comment, Entry } from "../model/types";
import { normalizeEntries, normalizeEntry } from "../model/status";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import {
  canCreateComment,
  canDeleteComment,
  canMarkDisputed,
  canReopenComment,
  canReplyComment,
  canResolveComment,
  canResolveDispute,
  getCurrentUser,
} from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { appendEvent } from "./history";

let currentProjectStorage: ProjectStorage | null = null;

type CommentStatus = NonNullable<Comment["status"]>;

interface CommentContext {
  entry?: Entry;
  fileId?: string;
}

interface AddCommentOptions {
  replyTo?: string | null;
  disputed?: boolean;
  status?: CommentStatus;
}

export function setCommentsProjectRoot(root: ProjectDirectoryHandle): void {
  setCommentsProjectStorage(createProjectStorage(root));
}

export function setCommentsProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

function getCurrentUserId(): string {
  const user = getCurrentUser();

  if (!user?.id) {
    throw new Error("Login required.");
  }

  return user.id;
}

function assertCommentWritePermission(canWrite: boolean): void {
  if (!canWrite) {
    throw new Error("Permission denied.");
  }
}

function getEntryCommentPath(entry: Entry): string {
  return `comments/${entry.file_id}/${String(entry.index).padStart(6, "0")}.jsonl`;
}

function normalizeComment(comment: Comment, context: CommentContext = {}): Comment {
  const createdAt = comment.created_at || comment.updated_at || nowIso();
  const status: CommentStatus =
    comment.status ?? (comment.resolved ? "resolved" : "open");

  return {
    ...comment,
    entry_id: comment.entry_id || context.entry?.id || "",
    file_id: comment.file_id || context.entry?.file_id || context.fileId,
    reply_to: comment.reply_to ?? null,
    status,
    resolved: status === "resolved",
    created_at: createdAt,
    updated_at: comment.updated_at || createdAt,
  };
}

async function loadEntryChunk(fileId: string): Promise<{
  path: string;
  entries: Entry[];
}[]> {
  const storage = getProjectStorage();
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await storage.listFiles(entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    chunkFiles.map(async (fileName) => {
      const path = `${entryDirectory}/${fileName}`;

      return {
        path,
        entries: normalizeEntries(await storage.readJsonl<Entry>(path)),
      };
    }),
  );
}

async function updateEntry(
  entry: Entry,
  patch: Partial<Entry>,
  userId: string,
): Promise<Entry> {
  const storage = getProjectStorage();
  const chunks = await loadEntryChunk(entry.file_id);

  for (const chunk of chunks) {
    const entryIndex = chunk.entries.findIndex((row) => row.id === entry.id);

    if (entryIndex < 0) {
      continue;
    }

    const updatedEntry: Entry = {
      ...normalizeEntry(chunk.entries[entryIndex]),
      ...patch,
      updated_at: nowIso(),
      updated_by: userId,
    };

    chunk.entries[entryIndex] = updatedEntry;
    await storage.writeJsonl(chunk.path, chunk.entries);

    return updatedEntry;
  }

  throw new Error("没有找到要更新的词条。请重新打开项目后再试。");
}

async function loadEntriesForAllFiles(): Promise<Entry[]> {
  const fileIds = await getProjectStorage().listFiles("entries");
  const groups = await Promise.all(
    fileIds.map(async (fileId) => {
      const chunks = await loadEntryChunk(fileId);

      return chunks.flatMap((chunk) => chunk.entries);
    }),
  );

  return groups
    .flat()
    .sort((a, b) => a.file_id.localeCompare(b.file_id) || a.index - b.index);
}

export async function loadComments(entry: Entry): Promise<Comment[]> {
  const storage = getProjectStorage();
  const path = getEntryCommentPath(entry);

  if (!(await storage.fileExists(path))) {
    return [];
  }

  return (await storage.readJsonl<Comment>(path))
    .map((comment) => normalizeComment(comment, { entry }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function addComment(
  entry: Entry,
  body: string,
  options: AddCommentOptions = {},
): Promise<Comment> {
  const storage = getProjectStorage();
  const text = body.trim();

  if (!text) {
    throw new Error("评论内容不能为空。");
  }

  const actor = getCurrentUser();
  assertCommentWritePermission(
    options.replyTo ? canReplyComment(actor) : canCreateComment(actor),
  );

  const path = getEntryCommentPath(entry);
  const userId = getCurrentUserId();
  const comments = await loadComments(entry);
  const createdAt = nowIso();
  const comment: Comment = {
    id: createId("comment"),
    entry_id: entry.id,
    file_id: entry.file_id,
    user_id: userId,
    body: text,
    reply_to: options.replyTo ?? null,
    status: options.status ?? "open",
    disputed: options.disputed,
    created_at: createdAt,
    updated_at: createdAt,
  };

  await storage.ensureDirectory(`comments/${entry.file_id}`);
  await storage.writeJsonl(path, [...comments, comment]);
  await appendEvent({
    type: comment.reply_to ? "comment.replied" : "comment.added",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { comment_id: comment.id, reply_to: comment.reply_to },
  });

  return comment;
}

export async function replyComment(
  entry: Entry,
  parentCommentId: string,
  body: string,
): Promise<Comment> {
  const comments = await loadComments(entry);

  if (!comments.some((comment) => comment.id === parentCommentId)) {
    throw new Error("没有找到要回复的评论。请刷新后再试。");
  }

  return addComment(entry, body, { replyTo: parentCommentId });
}

async function updateCommentStatus(
  entry: Entry,
  commentId: string,
  status: CommentStatus,
): Promise<Comment> {
  const storage = getProjectStorage();
  const path = getEntryCommentPath(entry);
  const actor = getCurrentUser();
  assertCommentWritePermission(
    status === "resolved" ? canResolveComment(actor) : canReopenComment(actor),
  );
  const userId = getCurrentUserId();
  const comments = await loadComments(entry);
  const commentIndex = comments.findIndex((comment) => comment.id === commentId);

  if (commentIndex < 0) {
    throw new Error("没有找到要更新的评论。请刷新后再试。");
  }

  const updatedAt = nowIso();
  const nextComment: Comment = {
    ...comments[commentIndex],
    status,
    resolved: status === "resolved",
    updated_at: updatedAt,
    resolved_at: status === "resolved" ? updatedAt : "",
    resolved_by: status === "resolved" ? userId : "",
  };
  const nextComments = [...comments];

  nextComments[commentIndex] = nextComment;
  await storage.writeJsonl(path, nextComments);
  await appendEvent({
    type: status === "resolved" ? "comment.resolved" : "comment.reopened",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { comment_id: commentId },
  });

  return nextComment;
}

export async function resolveComment(
  entry: Entry,
  commentId: string,
): Promise<Comment> {
  return updateCommentStatus(entry, commentId, "resolved");
}

export async function reopenComment(
  entry: Entry,
  commentId: string,
): Promise<Comment> {
  return updateCommentStatus(entry, commentId, "open");
}

export function getCommentDeletionSet(
  comments: Comment[],
  commentId: string,
): Comment[] {
  const deleteIds = new Set([commentId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const comment of comments) {
      if (
        comment.reply_to &&
        deleteIds.has(comment.reply_to) &&
        !deleteIds.has(comment.id)
      ) {
        deleteIds.add(comment.id);
        changed = true;
      }
    }
  }

  return comments.filter((comment) => deleteIds.has(comment.id));
}

export async function deleteComment(
  entry: Entry,
  commentId: string,
): Promise<void> {
  const storage = getProjectStorage();
  const path = getEntryCommentPath(entry);
  const actor = getCurrentUser();
  const userId = getCurrentUserId();
  const comments = await loadComments(entry);
  const targetComment = comments.find((comment) => comment.id === commentId);
  assertCommentWritePermission(canDeleteComment(actor, targetComment));
  const commentsToDelete = getCommentDeletionSet(comments, commentId);

  if (commentsToDelete.some((comment) => !canDeleteComment(actor, comment))) {
    throw new Error(
      "这条评论包含其他成员的回复，当前成员没有删除整组评论的权限。",
    );
  }

  const deleteIds = new Set(commentsToDelete.map((comment) => comment.id));
  const nextComments = comments.filter((comment) => !deleteIds.has(comment.id));

  await storage.writeJsonl(path, nextComments);
  await appendEvent({
    type: "comment.deleted",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { comment_id: commentId, deleted_replies: deleteIds.size - 1 },
  });
}

export async function markDisputed(
  entry: Entry,
  reason: string,
): Promise<Entry> {
  const actor = getCurrentUser();
  assertCommentWritePermission(canMarkDisputed(actor, entry));

  const userId = getCurrentUserId();
  const text = reason.trim();
  const updatedEntry = await updateEntry(
    entry,
    {
      disputed: true,
      dispute_reason: text || entry.dispute_reason,
      dispute_resolved_at: "",
      dispute_resolved_by: "",
    },
    userId,
  );

  if (text) {
    await addComment(updatedEntry, text, { disputed: true });
  }

  await appendEvent({
    type: "entry.mark_disputed",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { reason: text, status: updatedEntry.status },
  });

  return updatedEntry;
}

export async function resolveDispute(
  entry: Entry,
  resolution: string,
): Promise<Entry> {
  const actor = getCurrentUser();
  assertCommentWritePermission(canResolveDispute(actor, entry));

  const userId = getCurrentUserId();
  const text = resolution.trim();
  const updatedEntry = await updateEntry(
    entry,
    {
      disputed: false,
      dispute_resolved_at: nowIso(),
      dispute_resolved_by: userId,
    },
    userId,
  );

  if (text) {
    await addComment(updatedEntry, text);
  }

  await appendEvent({
    type: "entry.resolve_dispute",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { resolution: text, status: updatedEntry.status },
  });

  return updatedEntry;
}

export async function loadRecentComments(): Promise<Comment[]> {
  return (await loadAllComments()).slice(0, 30);
}

export async function loadAllComments(): Promise<Comment[]> {
  const storage = getProjectStorage();

  if (!(await storage.fileExists("comments"))) {
    return [];
  }

  const fileIds = await storage.listFiles("comments");
  const groups = await Promise.all(
    fileIds.map(async (fileId) => {
      const commentFiles = await storage.listFiles(`comments/${fileId}`);
      const comments = await Promise.all(
        commentFiles
          .filter((name) => name.endsWith(".jsonl"))
          .map(async (name) =>
            (await storage.readJsonl<Comment>(`comments/${fileId}/${name}`)).map(
              (comment) => normalizeComment(comment, { fileId }),
            ),
          ),
      );

      return comments.flat();
    }),
  );

  return groups
    .flat()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function loadDisputedEntries(): Promise<Entry[]> {
  const entries = await loadEntriesForAllFiles();

  return entries.filter((entry) => entry.disputed === true);
}
