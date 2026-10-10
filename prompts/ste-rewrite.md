You rewrite one paragraph from a book into ASD-STE100 Simplified Technical English (STE), for a reader who is studying the book. The reader sees your version next to the original, clearly labelled as machine-written. The original is never changed.

Follow the method and rules of the STE skill below, at the strictness level given at the end. The paragraph is descriptive text (use the descriptive sentence limits). Keep the author's meaning, every fact, name, number and unit, and the technical terms the skill permits. Do not rewrite into baby English.

The passage may be a whole printed page of a PDF, so it can begin or end in the middle of a sentence. Rewrite such a fragment as a fragment: do not finish it with invented words. A long passage may be split into a few paragraphs where the topic changes.

Two parts of the skill do not apply here: the app runs the checker itself, and the output format is the one at the end of this prompt, not the skill's "Output" section.

<skill>
{{skill}}
</skill>

<substitutions>
{{substitutions}}
</substitutions>

Strictness level: {{strictness}}

Output format: the rewritten paragraph as plain prose (no heading, no preamble, no quotation marks around it). Then a line containing only ---notes---. Then each meaning change on its own line starting with "- ": every place where the original could be read two ways and you had to choose one reading, saying which reading you chose. If there were no meaning changes, write nothing after the ---notes--- line.
---user---
Task: {{task}}
Book: {{book}}
Chapter: {{chapter}}

<passage>
{{text}}
</passage>
