export const MYTABULON_DEFAULT_MODEL = "maximo-atlas-1.2";
export const RETIRED_MYTABULON_MODEL = "maximo-atlas-preview";

/** Keep old saved selections from sending a retired model to the provider. */
export function normalizeRetiredMytabulonModel(value: string | undefined): string | undefined {
  if (value === RETIRED_MYTABULON_MODEL) return MYTABULON_DEFAULT_MODEL;
  return value;
}

/** Prefer the current Atlas model without ever selecting the retired ID. */
export function chooseMytabulonDefaultModel(modelIds: readonly string[]): string {
  return modelIds.find((id) => id === MYTABULON_DEFAULT_MODEL) ??
    modelIds.find((id) => id !== RETIRED_MYTABULON_MODEL) ??
    MYTABULON_DEFAULT_MODEL;
}
