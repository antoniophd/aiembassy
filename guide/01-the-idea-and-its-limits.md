# 1. The idea and its limits

A permanent mission spends much of its day on work that follows a pattern. A meeting takes place; someone
decides whether it matters; someone writes what happened; if it touches the State's interests, colleagues give
their view, someone lays out the options, the head of mission decides, and a cable goes to the capital.

A mission of AI agents reproduces that pattern with software. Each agent holds one role and writes one kind of
document. The agents read only a public record of the meeting and a short description of the State. Every
sentence they write must point to the passage of the record it comes from, and code checks that it does.

## What it is good for

- **Coverage.** It can follow every public meeting of a body, including the ones nobody has time to attend.
- **Triage.** Most meetings need a line or a short report; a few need a position. Deciding which is which,
  consistently, is useful on its own.
- **A first draft with sources.** A report in which every figure and quotation is tied to a moment of the
  meeting is quicker to verify than one written from memory.
- **A visible line over time.** When positions are recorded meeting by meeting, it is easy to see when the State
  maintained a line and when it revised it.
- **Training and reflection.** Watching agents apply a profile shows where a profile is vague, contradictory or
  silent.

## What it is not

- **Not a diplomat.** It has no relationships, no memory of a room, no sense of what a silence meant.
- **Not a source of record.** Official records and documents remain the reference.
- **Not informed.** It knows only what was said in public. Informal consultations, bilateral contacts and
  instructions are outside its reach, and should stay outside unless the mission's rules allow the model
  provider to see them.
- **Not a judge of wisdom.** Checks can show that a position follows from the profile and the record. They
  cannot show that it is a good position.

## The two rules that make it usable

1. **Everything cites its source.** A figure, a quotation, a vote, a speaker: each points to a segment of the
   record. What cannot be cited is not written.
2. **Code checks what code can check.** Whether a figure appears in the cited passage, whether a speaker spoke,
   whether a tally adds up: these are not left to a model's judgement.

Everything else in this guide builds on those two rules.

## Be honest about it

Say on every page that the State is fictional (or, if it is real, that the work is an experiment) and that the
documents are written by software. Say what the checks prove and what they do not.

## Checklist

- [ ] We can say in one sentence what the mission will produce and for whom.
- [ ] We know which public record it will read, and that nothing else will be fed to it.
- [ ] We accept that it will not know what was said outside the meeting room.
- [ ] Every page it publishes will say that the work is produced by AI agents and what the checks cover.
- [ ] Someone is responsible for reading its output before anyone relies on it (chapter 6).
