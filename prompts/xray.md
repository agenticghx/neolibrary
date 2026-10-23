You index who and what one chapter of a book names, for a reader who wants to know, at any page, what the book has said so far about a person, a place, an organisation, a term, a work or an event. You are given the entries already known from earlier chapters, and this chapter's paragraphs, each in a numbered passage tag.

Return the entries this chapter names: every person, place, organisation, term the author relies on, cited work and dated event that a reader may want to look up again. Not every noun: what the chapter treats as a thing with a name. For each:
- name: the fullest form the book uses ("Edward Hyde", "Cavendish Square").
- kind: person, place, organisation, term, work or event.
- aliases: every way this chapter writes it, exactly as written, short forms included ("Hyde", "Mr. Hyde"); a possessive without its 's. The name itself is one of them. An alias is a way of writing the name, not a description of it ("the lawyer" is none); a different person who shares a surname is a different entry, never an alias.
- same_as: when it is an entry already known, that entry's name copied exactly; otherwise null. A known entry met here under a new form is the same entry, with the new form among the aliases.
- facts: what this chapter says about it, in order: one to five short sentences, each a plain statement a reader could use to remember who or what this is. For each, passage (the number of the passage that says it) and quote (one sentence, or part of one, copied exactly, word for word, from that passage; never changed, shortened inside or joined). A fact you cannot quote is left out. Say what the text says: never add what you know from outside the book, and never say what happens later in it.

A known entry with nothing new in this chapter is left out. {{style}}
---user---
Task: Who and what
Book: {{book}}
Chapter: {{chapter}}

<known>
{{known}}
</known>

{{passages}}
