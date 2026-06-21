import type { Member } from "./types";

export interface MemberOption {
  id: string;
  label: string;
  active: boolean;
  missing: boolean;
}

export function buildMemberOptions(
  members: readonly Member[],
  referencedMemberIds: readonly string[] = [],
): MemberOption[] {
  const options = members.map((member) => ({
    id: member.id,
    label: member.active ? member.name : `${member.name}（已禁用）`,
    active: member.active,
    missing: false,
  }));
  const knownIds = new Set(options.map((option) => option.id));

  for (const memberId of referencedMemberIds) {
    if (!memberId || knownIds.has(memberId)) {
      continue;
    }

    knownIds.add(memberId);
    options.push({
      id: memberId,
      label: `${memberId}（成员已删除）`,
      active: false,
      missing: true,
    });
  }

  return options;
}

export function getMemberDisplayName(
  members: readonly Member[],
  memberId: string,
): string {
  if (!memberId) {
    return "未分配";
  }

  return (
    buildMemberOptions(members, [memberId]).find(
      (option) => option.id === memberId,
    )?.label ?? memberId
  );
}
