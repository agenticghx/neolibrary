import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOT_YET } from "@/lib/library/availability";
import { Cover } from "./Cover";

describe("Cover", () => {
  it("draws a title with nothing available greyed, with no image even when one is given", () => {
    const html = renderToStaticMarkup(<Cover title="Fabless" available={NOT_YET} imageUrl="/cover.jpg" progress={0.5} href="/books/x" />);
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Fabless (not available yet)"');
    expect(html).toContain("Not available yet");
    expect(html).not.toContain("% read");
  });

  it("shows the image, the label and the progress of an available title", () => {
    const html = renderToStaticMarkup(
      <Cover title="Chip War" available={{ read: true, listen: true }} imageUrl="/cover.jpg" progress={0.5} href="/books/y" />,
    );
    expect(html).toContain('<img src="/cover.jpg"');
    expect(html).toContain('aria-label="Chip War"');
    expect(html).toContain("Read and listen");
    expect(html).toContain('aria-label="50% read"');
  });

  it("draws a title that can only be read in its colour, with its image and a plain name", () => {
    const html = renderToStaticMarkup(
      <Cover title="Discourse" available={{ read: true, listen: false }} imageUrl="/cover.jpg" progress={0.25} href="/books/z" />,
    );
    expect(html).toContain('<img src="/cover.jpg"');
    expect(html).toContain('aria-label="Discourse"');
    expect(html).toContain("Read only");
    expect(html).toContain('aria-label="25% read"');
  });

  it("leaves the label out when the page shows it itself", () => {
    const html = renderToStaticMarkup(<Cover title="Chip War" available={{ read: true, listen: false }} caption={false} />);
    expect(html).not.toContain("Read only");
    expect(html).not.toContain("figcaption");
  });
});
