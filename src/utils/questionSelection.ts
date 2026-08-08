export interface QuestionSelection {
  selected: string;
  custom: string;
}

export function isQuestionOptionSelected(current: string | undefined, optionLabel: string, multi: boolean): boolean {
  if (!current) return false;
  if (!multi) return current === optionLabel;
  return current.split("||").includes(optionLabel);
}

/**
 * Select or toggle a listed option. Listed options and "Other" are mutually
 * exclusive, so selecting a listed option always clears the custom answer.
 */
export function toggleQuestionSelection(current: QuestionSelection, optionLabel: string, multi: boolean): QuestionSelection {
  if (!multi) return { selected: optionLabel, custom: "" };

  const list = current.selected ? current.selected.split("||").filter(Boolean) : [];
  const idx = list.indexOf(optionLabel);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(optionLabel);
  return { selected: list.join("||"), custom: "" };
}

/** Clear listed options when the user activates the custom "Other" answer. */
export function activateOtherQuestion(current: QuestionSelection): QuestionSelection {
  return { selected: "", custom: current.custom };
}

/** Editing the custom answer also clears any listed option selection. */
export function updateOtherQuestionAnswer(current: QuestionSelection, custom: string): QuestionSelection {
  return { selected: "", custom };
}
