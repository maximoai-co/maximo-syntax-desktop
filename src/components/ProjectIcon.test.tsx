import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectIcon } from "./ProjectIcon";

describe("ProjectIcon", () => {
  it("uses the closed folder for a collapsed folder project", () => {
    const html = renderToStaticMarkup(<ProjectIcon icon="folder" />);

    expect(html).toContain('lucide-folder');
    expect(html).not.toContain('lucide-folder-open');
  });

  it("uses the open folder for an expanded folder project", () => {
    const html = renderToStaticMarkup(<ProjectIcon icon="folder" isOpen />);

    expect(html).toContain('lucide-folder-open');
  });

  it("does not replace custom project icons with a folder variant", () => {
    const html = renderToStaticMarkup(<ProjectIcon icon="briefcase" isOpen />);

    expect(html).toContain('lucide-briefcase');
    expect(html).not.toContain('lucide-folder-open');
  });
});
