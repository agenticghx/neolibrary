The picture is a figure from a scientific paper, {{width}} pixels wide and {{height}} high. Redraw it as a clean SVG that lies exactly over the original: every box, arrow, axis, tick mark, tick label, axis title, curve, dashed line, data point, error bar, legend and word, in the same place and the same size, so that the two pictures overlaid line up to within 2 pixels. The redraw replaces a blurred scan for a reader: it must show exactly what the figure shows, nothing more and nothing less.

How to be exact:
- First locate any axes in pixels: the position of at least two labelled ticks on each axis, and whether an axis is logarithmic (labels like 0.1, 0.2, 0.5, 1, 2, 5 unevenly spaced).
- A curve drawn from a formula printed in the figure (with its parameters printed): compute its points from the formula in data units and map them to pixels with the axis scale you located; at least 60 points. Any other curve or line: trace it where it is drawn, at least one point every 10 pixels along it.
- Data points: one marker each, at its centre, with the same symbol as printed (open or filled circle, square, triangle, cross), the same size. Error bars and box plots as drawn.
- Every tick mark, on every side the original has them (inner and outer, top and right too), and every gridline.
- A formula printed in the figure is laid out as printed: a fraction stacked with a horizontal rule, brackets drawn as paths of the printed height, subscripts and superscripts as smaller text lowered or raised with dy. Never write ^ or a / for a fraction that is printed stacked.
- Solid, dashed and dotted lines as in the original; heavier lines heavier.
- Do not add, move, smooth away, tidy or complete anything; do not draw anything the original does not have.

Rules:
- Output only the SVG, starting with <svg and ending with </svg>. No prose, no code fence.
- xmlns="http://www.w3.org/2000/svg", viewBox="0 0 {{width}} {{height}}", width="{{width}}" height="{{height}}", and first a white rect covering it all.
- Only these elements: svg, g, rect, line, polyline, polygon, path, circle, ellipse, text, tspan, defs, marker, title. No script, no style element or style attribute, no class, no foreignObject, no image, no links, no event attributes, no clip paths, no gradients.
- Colours: black on white, unless the original has colour.
- Text: font-family="Helvetica, Arial, sans-serif", in black, bold only where the original is bold. Each line of text is its own <text> at the original line's position; rotated titles with transform="rotate(...)". The words must be exactly these, character for character (a formula's ^ and stacked / are layout, not characters):
{{texts}}
---fix---
The first picture is the figure; the second is your redraw of it, drawn from your SVG below. Your redraw was compared with the figure and does not match yet:

{{problems}}

The third picture shows where: the figure in grey, red where the figure has a line your redraw lacks, orange where your redraw has a line the figure lacks, green where your redraw has words where the figure has none.

Correct the SVG so it lies exactly over the figure, keeping every rule given before (the same elements, the same words exactly, nothing added). Output only the whole corrected SVG, starting with <svg and ending with </svg>.

Your SVG:
{{svg}}
---review---
The first picture is a figure from a scientific paper. The second is meant to be the same figure, redrawn cleanly. Compare their content and list every difference a reader of the paper would care about:
- a word, number, symbol or panel letter that differs, is missing, is added, or sits in another place;
- a line, curve, data point, error bar, tick mark, arrow or box that is missing, added, or in another place or shape;
- a line drawn solid in one and dashed or dotted in the other; a data point's symbol changed (open or filled, circle, square, triangle);
- a formula laid out differently.
Ignore differences of font, line weight, sharpness, blur, specks and scanning marks, and the paper's colour.

Answer with JSON only (no prose, no code fence): {"differences": ["one short sentence for each difference"]}, with an empty list if there is none.
