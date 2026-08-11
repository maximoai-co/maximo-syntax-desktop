import type { EngineModel } from "../../desktop/types";
import type { SelectOption } from "../components/CustomSelect";

/** The provider catalog calls its active model `default`; desktop controls use an empty value for that same choice. */
export function modelControlValue(model: EngineModel): string {
  return model.value === "default" ? "" : model.value;
}

export function findEngineModel(models: EngineModel[], value: string): EngineModel | undefined {
  return models.find((model) => modelControlValue(model) === value);
}

export function effortLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Default";
}

export function normalizeEffortValue(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "extrahigh" || normalized === "ultra") return "xhigh";
  if (normalized === "maximum") return "max";
  if (normalized === "med") return "medium";
  return normalized || value.trim().toLowerCase();
}

/** Builds choices only from the selected model's authenticated provider metadata. */
export function effortOptionsFor(model: EngineModel | undefined): SelectOption<string>[] {
  if (!model?.supportsEffort) return [];
  const configuredDefault = model.activeEffort
    ? effortLabel(model.activeEffort)
    : model.defaultEffort
      ? effortLabel(model.defaultEffort)
      : "Model default";
  const defaultValue = model.activeEffort ?? model.defaultEffort ?? "";
  const options: SelectOption<string>[] = [{ value: defaultValue, label: configuredDefault }];
  for (const value of model.supportedEffortLevels ?? []) {
    if (value === defaultValue || options.some((option) => option.value === value)) continue;
    options.push({ value, label: effortLabel(value) });
  }
  return options;
}

/** Keeps a compatible explicit effort when switching models, otherwise uses the catalog default. */
export function effortForModel(model: EngineModel | undefined, currentEffort: string): string {
  if (!model) return currentEffort;
  const supported = model.supportedEffortLevels ?? [];
  const supportsEffort = model.supportsEffort ?? supported.length > 0;
  if (!supportsEffort) return "";
  const normalized = currentEffort ? normalizeEffortValue(currentEffort) : "";
  if (normalized && (supported.length === 0 || supported.includes(normalized))) return normalized;
  return model.defaultEffort
    ? normalizeEffortValue(model.defaultEffort)
    : model.activeEffort
      ? normalizeEffortValue(model.activeEffort)
      : supported[0] ?? "";
}
