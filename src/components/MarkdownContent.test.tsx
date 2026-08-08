import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent streaming mode", () => {
  it("keeps incomplete output as plain text instead of parsing markdown", () => {
    const html = renderToStaticMarkup(<MarkdownContent streaming>{"**still streaming**"}</MarkdownContent>);

    expect(html).toContain("**still streaming**");
    expect(html).not.toContain("<strong>");
  });

  it("fully renders markdown after the message settles", () => {
    const html = renderToStaticMarkup(<MarkdownContent>{"**settled**"}</MarkdownContent>);

    expect(html).toContain("<strong>settled</strong>");
  });
});
