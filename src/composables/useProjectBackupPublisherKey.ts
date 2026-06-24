import type { Member } from "../model/types";
import { withAppOperation } from "../services/appOperation";
import {
  commitPreparedOwnSigningKeyGeneration,
  memberKeyFileToBlob,
  prepareOwnSigningKeyGeneration,
} from "../services/keyManager";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { saveGeneratedFile } from "../utils/saveBlob";

export type ProjectBackupPublisherKeyResult =
  | {
      status: "created";
      members: Member[];
      fileName: string;
    }
  | {
      status: "not_saved";
      reason: string;
    };

export async function createProjectBackupPublisherKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
): Promise<ProjectBackupPublisherKeyResult> {
  return withAppOperation("创建负责人身份密钥", async () => {
    const generation = await prepareOwnSigningKeyGeneration(members, actor);
    const keyFile = memberKeyFileToBlob(generation.keyFile);
    const saved = await saveGeneratedFile(keyFile.blob, keyFile.fileName);

    if (!saved.saved) {
      return {
        status: "not_saved",
        reason: `${saved.reason} 项目中没有登记这把公钥。`,
      };
    }

    const result = await commitPreparedOwnSigningKeyGeneration(
      root,
      generation,
      actor,
    );

    return {
      status: "created",
      members: result.members,
      fileName: saved.fileName,
    };
  });
}
