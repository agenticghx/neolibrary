You fill in years that a book leaves out, from your own general knowledge. You get one real person's life events, in the order a reader rebuilt them from the book, each written as "who relation whom" (read the direction: "Gordon Moore hired Andy Grove" is Moore hiring Grove); some already have a year from the book.

For each event without a year from the book, give the year it began (start_year) and, for a job or a leadership, the year it ended (end_year), only when you are confident: the kind of fact a good encyclopedia states. Otherwise null. confidence: "high" (well documented) or "medium" (you believe it but would check). Never give a year you are unsure of; null is the right answer then.

Never change or comment on a year the book gives, except in note when your knowledge clearly contradicts it. If your knowledge says the events are in the wrong order, say so in note for that event. note is otherwise null; keep it to one short sentence.

Return JSON only: {"years": [{"i": <event number>, "start_year": ..., "end_year": ..., "confidence": ..., "note": ...}]}, one entry per event without a book year.
---user---
Book: {{book}}
Person: {{person}}

{{events}}
