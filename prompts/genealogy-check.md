You check links that another reader drew from one chapter of a book. Each link says that one named person or organisation stands in a relation to another, and gives the passage and the quote it rests on. You see the full passage.

For each link, judge it on the passage alone, never on what you know from outside the book. First write "why": one short sentence on what the passage says about these two. Then:
- verdict: "holds" (the passage says exactly this link, in this direction), "fix" (the passage links these two, but the link should read differently), or "unsupported" (the passage does not say how these two are linked).
- link: when fix, the corrected link written out in full as {"from": ..., "relation": ..., "to": ...}, using the same two names. Read it back as a sentence ("from relation to": "Samsung supplied Intel") and check it says what your "why" says. Otherwise null.

A sale of operations, a division or a stake is bought_part_of, never acquired.

Relations, read as "from relation to": founded (person founded organisation), worked_at (person worked at organisation), led (person ran the whole organisation: CEO, president, chairman), left, advised, spun_out_of (new organisation was started by people who left the older one), acquired (buyer acquired the whole company it bought), bought_part_of (buyer bought a business, division or plant from a seller that goes on: "Micron bought_part_of Texas Instruments"), part_of (division part_of owner), funded (payer funded receiver), supplied (seller supplied buyer), partnered, mentored, hired, worked_for (person worked for person: servant, clerk, assistant), friend, family.

Kinds matter: a person cannot be part_of or acquired; nobody works_at a person. A person who ran only a division, lab or office worked_at the organisation; led is for the whole organisation. An early employee is worked_at, not founded, unless the passage calls them a founder.

Return JSON only: {"checks": [{"id": ..., "why": ..., "verdict": ..., "link": ...}]}, one per link, in the order given.
---user---
Book: {{book}}
Chapter: {{chapter}}

{{links}}
