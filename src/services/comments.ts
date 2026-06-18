import type { Comment, Entry } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { getCurrentUser } from "./permissions";
import {
  ensureDirectory,
  fileExists,
  listFiles,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";
import { appendEvent } from "./history";

let currentProjectRoot: ProjectDirectoryHandle | null = null;

export function setCommentsProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function getCurrentUserId(): string {
  return getCurrentUser()?.id ?? "unknown_user";
}

function getEntryCommentPath(entry: Entry): string {
  return `comments/${entry.file_id}/${String(entry.index).padStart(6, "0")}.jsonl`;
}

async function loadEntryChunk(fileId: string): Promise<{
  path: string;
  entries: Entry[];
}[]> {
  const root = getProjectRoot();
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await listFiles(root, entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    chunkFiles.map(async (fileName) => {
      const path = `${entryDirectory}/${fileName}`;

      return {
        path,
        entries: await readJsonl<Entry>(root, path),
      };
    }),
  );
}

async function updateEntryStatus(
  entry: Entry,
  status: Entry["status"],
  userId: string,
): Promise<Entry> {
  const root = getProjectRoot();
  const chunks = await loadEntryChunk(entry.file_id);

  for (const chunk of chunks) {
    const entryIndex = chunk.entries.findIndex((row) => row.id === entry.id);

    if (entryIndex < 0) {
      continue;
    }

    const updatedEntry: Entry = {
      ...chunk.entries[entryIndex],
      status,
      updated_at: nowIso(),
      updated_by: userId,
    };

    chunk.entries[entryIndex] = updatedEntry;
    await writeJsonl(root, chunk.path, chunk.entries);

    return updatedEntry;
  }

  throw new Error("没有找到要更新的词条。请重新打开项目后再试。");
}

async function loadEntriesForAllFiles(): Promise<Entry[]> {
  const root = getProjectRoot();
  const fileIds = await listFiles(root, "entries");
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
  const root = getProjectRoot();
  const path = getEntryCommentPath(entry);

  if (!(await fileExists(root, path))) {
    return [];
  }

  return readJsonl<Comment>(root, path);
}

export async function addComment(
  entry: Entry,
  body: string,
): Promise<Comment> {
  const root = getProjectRoot();
  const text = body.trim();

  if (!text) {
    throw new Error("评论内容不能为空。");
  }

  const path = getEntryCommentPath(entry);
  const userId = getCurrentUserId();
  const comments = await loadComments(entry);
  const comment: Comment = {
    id: createId("comment"),
    entry_id: entry.id,
    user_id: userId,
    created_at: nowIso(),
    body: text,
    reply_to: null,
  };

  await ensureDirectory(root, `comments/${entry.file_id}`);
  await writeJsonl(root, path, [...comments, comment]);
  await appendEvent({
    type: "comment.added",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { comment_id: comment.id },
  });

  return comment;
}

export async function deleteComment(
  entry: Entry,
  commentId: string,
): Promise<void> {
  const root = getProjectRoot();
  const path = getEntryCommentPath(entry);
  const userId = getCurrentUserId();
  const comments = await loadComments(entry);
  const nextComments = comments.filter((comment) => comment.id !== commentId);

  await writeJsonl(root, path, nextComments);
  await appendEvent({
    type: "comment.deleted",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { comment_id: commentId },
  });
}

export async function markDisputed(
  entry: Entry,
  reason: string,
): Promise<Entry> {
  const userId = getCurrentUserId();
  const updatedEntry = await updateEntryStatus(entry, "disputed", userId);

  if (reason.trim()) {
    await addComment(updatedEntry, reason);
  }

  await appendEvent({
    type: "entry.mark_disputed",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { reason: reason.trim() },
  });

  return updatedEntry;
}

export async function resolveDispute(
  entry: Entry,
  resolution: string,
): Promise<Entry> {
  const userId = getCurrentUserId();
  const nextStatus: Entry["status"] = entry.target.trim()
    ? "translated"
    : "untranslated";
  const updatedEntry = await updateEntryStatus(entry, nextStatus, userId);

  if (resolution.trim()) {
    await addComment(updatedEntry, resolution);
  }

  await appendEvent({
    type: "entry.resolve_dispute",
    user_id: userId,
    entry_id: entry.id,
    file_id: entry.file_id,
    detail: { resolution: resolution.trim(), status: nextStatus },
  });

  return updatedEntry;
}

export async function loadRecentComments(): Promise<Comment[]> {
  const root = getProjectRoot();

  if (!(await fileExists(root, "comments"))) {
    return [];
  }

  const fileIds = await listFiles(root, "comments");
  const groups = await Promise.all(
    fileIds.map(async (fileId) => {
      const commentFiles = await listFiles(root, `comments/${fileId}`);
      const comments = await Promise.all(
        commentFiles
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => readJsonl<Comment>(root, `comments/${fileId}/${name}`)),
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

  return entries.filter((entry) => entry.status === "disputed");
}
