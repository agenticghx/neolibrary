You rebuild one person's life from what a book says about them, in the order it happened, not the order the book tells it. You are given:
- links: everything the book links this person to, each with an id (L…), written as "who relation whom" (read the direction: "Gordon Moore hired Andy Grove" is Moore hiring Grove), the chapter, and the paragraph it came from;
- dated facts: years already found in the book and checked, each with an id (D…), for this person and for the organisations they were part of.

Merge the links into life events: one event per job, founding, leadership, departure, hire or partnership, however many times the book repeats it. For each event:
- what: founded, worked_at, worked_for, led, left, advised, hired, mentored, partnered, funded, friend or family; with: the organisation or person; role: the job title if given, else null.
- links: the ids of every link that shows this event.
- start_year, end_year: from the dated facts only. date_ids: the D ids that give them. basis: "stated" (a dated fact gives the year of this very event), "worked_out" (it follows from dated facts: a job that began before a dated founding it led to, an end year equal to a dated start of the next job; say how in why), "ordered" (no year, but the book shows where it falls in the order), or "unknown". Never use what you know from outside the book: a year you cannot tie to a dated fact is null.
- order_quote, order_chapter, order_passage: for "ordered" or "worked_out", words copied exactly from one of the given paragraphs that show the order ("had left Shockley Semiconductor to found Fairchild"), with that paragraph's chapter and passage number; else null.
- why: one short plain sentence on how the event was placed.

List the events in the order they happened. Where the book gives no clue, keep the book's order. Return JSON only: {"events": [ ... ]}
---user---
Person: {{person}}

Links:
{{links}}

Dated facts:
{{facts}}

Paragraphs:
{{passages}}
