import { onBeforeUnmount, watch, type Ref } from "vue";
import { clearAppDraft, setAppDraft } from "../services/appDraft";

let draftSequence = 0;

export function useAppDraft(
  label: string,
  hasUnsavedChanges: Readonly<Ref<boolean>>,
): void {
  const draftId = `vue-draft-${++draftSequence}`;

  watch(
    hasUnsavedChanges,
    (hasChanges) => {
      setAppDraft(draftId, label, hasChanges);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    clearAppDraft(draftId);
  });
}
