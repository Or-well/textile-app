import type { Member } from "./types";

export interface MemberOption {
  id: string;
  label: string;
  active: boolean;
  missing: boolean;
}

export interface MemberDisplayNameOptions {
  emptyLabel?: string;
  missingLabel?: string;
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
  options: MemberDisplayNameOptions = {},
): string {
  if (!memberId) {
    return options.emptyLabel ?? "未分配";
  }

  const member = members.find((item) => item.id === memberId);

  if (!member) {
    return options.missingLabel ?? "已删除成员";
  }

  return member.active ? member.name : `${member.name}（已禁用）`;
}
