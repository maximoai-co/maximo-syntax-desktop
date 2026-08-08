import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent streaming mode", () => {
  it("keeps Markdown formatting while output is streaming", () => {
    const html = renderToStaticMarkup(<MarkdownContent streaming>{"**still streaming**"}</MarkdownContent>);

    expect(html).toContain("<strong>still streaming</strong>");
  });

  it("fully renders markdown after the message settles", () => {
    const html = renderToStaticMarkup(<MarkdownContent>{"**settled**"}</MarkdownContent>);

    expect(html).toContain("<strong>settled</strong>");
  });

  it("keeps a fenced-code shell while streaming", () => {
    const html = renderToStaticMarkup(<MarkdownContent streaming>{"```js\nconst answer = 42;\n```"}</MarkdownContent>);

    expect(html).toContain("md-code-block");
    expect(html).toContain("const answer = 42;");
    expect(html).not.toContain("hljs-keyword");
  });
});
