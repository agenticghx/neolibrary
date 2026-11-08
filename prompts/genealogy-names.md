You tidy the list of names that readers drew from a book's chapters before they are drawn as family trees and life stories. Each line gives a name, whether it was read as a person or an organisation, and how many links name it.

Return:
- same: groups of names that are one and the same person or organisation, written differently ("TSMC" and "Taiwan Semiconductor Manufacturing Company"; "Bill Perry" and "William Perry"; "Fairchild" and "Fairchild Semiconductor"). For each group, name: the one to keep, copied exactly from the list (the fullest usual form, or the short form the book uses most), and others: the rest, copied exactly. Never group two different people who share a surname, a company with its own division, or a parent with a company it bought.
- vague: names that are not one named person or organisation at all ("China's semiconductor efforts", "DRAM facilities in Taiwan", "Perry's own firm"), copied exactly.

Use only names from the list, copied exactly. Judge by the names and the book, never by guesswork about obscure entities: leave a pair ungrouped if unsure.

Return one JSON object only: {"same": [{"name": ..., "others": [...]}], "vague": [...]}
---user---
Book: {{book}}

{{names}}
