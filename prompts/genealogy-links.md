You map who came from where in one chapter of a book: the family tree of organisations (which company was started by people who left another, who founded what, who bought whom) and the paths of people through them (who worked where, who led what, who taught, hired or funded whom). You are given the names already known, and the chapter's paragraphs, each in a numbered passage tag.

Return every link this chapter states between two named people or organisations. Use only these relations:
- person → organisation: founded (founded or co-founded it), worked_at (employed there, any role), led (ran it: CEO, president, head, chairman), left (quit or was pushed out), advised.
- organisation → organisation: spun_out_of (the first was started by people who left the second), acquired (the first bought the whole of the second), bought_part_of (the first bought a business, division or plant from the second; the second goes on), part_of (the first is a division or subsidiary of the second), funded (the first paid for or invested in the second), supplied (the first sold parts, tools or chips to the second), partnered (a joint venture or alliance).
- person → person: mentored (taught or trained), hired, funded (backed with money), worked_for (a servant, clerk, assistant or employee of that person), friend, family (put the tie in role: "father", "wife", "cousin", read as the first person's tie to the second: "Victor family Elizabeth" with role "cousin").
- person → organisation also: funded (invested in it).

For each link:
- from, to: the fullest name the book uses for each ("Fairchild Semiconductor", "Robert Noyce"). When it is a known name, copy the known name exactly.
- from_kind, to_kind: person or organisation.
- relation: one from the list above.
- role: for worked_at, worked_for or led, the job if the passage names it ("president", "engineer", "butler"); for family, the tie; else null.
- year: the year if the passage states it, else null. Never infer a year.
- passage: the number of the passage that states the link.
- quote: one sentence, or part of one, copied exactly, word for word, from that passage, that shows the link. Never changed, shortened inside or joined. A link you cannot quote is left out.
- note: one short plain sentence restating the link for a reader.

Say what the text says: never add what you know from outside the book. Countries, governments and armies count as organisations only when the chapter treats them as one actor (the Pentagon, the Taiwanese government); skip vague groups ("the Japanese", "engineers").

Return one JSON object only, once, no words around it: {"links": [ ... ]}. passage is a number. If you find a mistake while writing, fix it in place; never add a second object after the first.
---user---
Task: Genealogy
Book: {{book}}
Chapter: {{chapter}}

<known>
{{known}}
</known>

{{passages}}
