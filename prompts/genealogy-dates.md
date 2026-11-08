You date links that were drawn from one chapter of a book. Each link says that one named person or organisation stands in a relation to another (founded, worked at, led, left, hired, bought, supplied...). You get the whole chapter, its paragraphs in numbered passage tags, and the chapter's links, each with an id and the passage it came from.

For each link, find when it happened, using only this chapter's text, never what you know from outside the book:
- year: the year the link began or happened (founded, hired, bought, first sold), or null.
- end_year: for a job, a leadership or an alliance, the year it ended if the chapter says so, else null.
- date_passage and date_quote: the passage number, and words copied exactly, word for word, from that passage, that give the year. The year may be written in the quote ("In 1985, he hired Chang") or follow from it by plain arithmetic from a year the quote states ("three years later" after "In 1958" is 1961: quote the words that give both). Never changed, shortened inside or joined.
- basis: "stated" (the quote names the year), "worked_out" (the year follows by arithmetic from years the chapter states), or "none" (the chapter does not date it).
- after: when basis is "none", the id of another link in this chapter that the text shows happened before this one, or null if the chapter does not say.

A year must be backed by a quote. A guess is "none". Return JSON only: {"dates": [{"id": ..., "year": ..., "end_year": ..., "basis": ..., "date_passage": ..., "date_quote": ..., "after": ...}]}, one per link, in the order given.
---user---
Book: {{book}}
Chapter: {{chapter}}

{{passages}}

Links:
{{links}}
