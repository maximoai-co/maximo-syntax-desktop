import { describe, expect, it } from "vitest";
import { modelProvider } from "./modelProvider.js";

describe("modelProvider", () => {
  it.each(["kilo", "kilo/kilo-auto/free", "Kilo Auto Free", "kilo/gpt-5"])(
    "recognizes %s as Kilo",
    (model) => {
      expect(modelProvider(model)).toBe("kilo");
    },
  );
});
