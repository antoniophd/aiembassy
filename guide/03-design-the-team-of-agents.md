# 3. Design the team of agents

A mission is a division of labour. Copy it: each agent holds one role and writes one kind of document, and no
agent rewrites another's work. That keeps every document attributable and every error traceable to one step.

## A team that works

| Role | Writes | When |
|---|---|---|
| Deputy head of mission | the triage of every meeting; a short note for procedural meetings; the options memo | always; the memo only for full files |
| Counsellors (one per area: political, legal, economic…) | the meeting report; an opinion on a colleague's file | the lead counsellor reports; others give opinions on full files |
| Head of mission | the decision | full files only |
| Press counsellor | a statement or an explanation of vote; a press pack | the statement only when the decision takes the floor; the press pack whenever the decision asks for a public line |

The lead counsellor also drafts the cable to the capital, released by the head of mission.

## The press counsellor

The press counsellor turns a decision into words the mission can say and publish. When the head of mission
speaks in the meeting, it drafts the statement or the explanation of vote. Whenever the decision asks for a
public line, it also drafts a **press pack**: one document in three parts (see
[`templates/press-pack.md`](../templates/press-pack.md)).

1. **Stakeout remarks.** What the head of mission says to journalists outside the room: first person, to be said
   aloud, short sentences, the main message first, 120 to 180 words, then one question the press is likely to ask
   and a brief answer. Plain words, as spoken to a camera: what the State voted and why, with no procedural
   jargon ("explanation of vote", "operative paragraph") and no document symbols.
2. **Press release.** Third person: a headline, the place and date, then three short paragraphs: what happened,
   the State's position with one quote of the head of mission, and what comes next. 200 to 300 words. The quote
   gives the reason, in one or two sentences taken from the remarks; it does not repeat the headline or list the
   texts. Name the body without the meeting number ("in the Third Committee of the General Assembly").
3. **Social media post.** At most 280 characters, no platform named, no emoji, at most one hashtag.

Voting is not joining a consensus: if a text was adopted without a vote, the State "joined the consensus on" it
or "supported" it; "voted" is only for a text put to a vote. Models blur the two, so give the writer, for each
text, how it was adopted. Check all three by code, not by another model: the length of each part; that every name, figure and document
symbol is in the accepted documents of the file; the same option and the same vote as the decision, and "voted" only where there was a vote; no
delegation named in a critical sentence; no mention of the platform, the models or the internal process. Give the writer the meeting's own name: official titles call committee meetings "plenary", and a model will copy that. A pack
that fails gets one more try with the reasons; if it fails again, the file goes on without it, and the page says
nothing about it. Expect the length rule to fail first: models write remarks short, so say the target in the
prompt (about 150 words, in 10 to 14 sentences) and, on a rejection, how many words to add.

## Three levels of work

1. **Note.** Procedural meetings (adoption of the agenda, elections without debate) stop at triage, with a few
   lines.
2. **Report.** Most meetings stop at the report: what was discussed, who said what, what was decided.
3. **Full file.** Meetings that touch the State's interests go all the way: report, opinions, options, decision,
   cable. The decision is recorded as the State's position on that subject, so the next meeting on it starts from
   there.

Triage decides the level. Make its criteria explicit (which interests are engaged, whether a decision is pending)
and let code enforce what it can: for example, "a meeting that adopted a text on a subject we follow is never just
a note".

## Rules between agents

- **One author per document.** If a report is wrong, it is redone by its author, with the reason it failed.
- **Opinions add, they do not repeat.** Each desk says the one thing it adds; two opinions that cover the same
  ground are a sign of a vague brief.
- **Options are real options.** At least two, each with what the State would do, the benefit, the risk and with
  whom it would stand. A memo with one sensible option and one straw man is a decision in disguise.
- **The decision chooses and explains.** Which option, which interest prevailed, which red lines were
  considered, with whom the State coincides and what would make it reconsider.
- **The cable does not add facts.** It is written from the accepted documents, not from the record again.

## Prompts

Write one prompt per role and task, and version each one. Keep in the prompt what the role must do and must not
do; keep facts out of it. Placeholders in examples ("<symbol>", "<State>") are safer than real values: models copy
examples.

## Choose the models

- **Three roles.** A writer; a checker from a different model family; and a fallback writer, whose documents are
  checked by a model of yet another family.
- **Never the same family.** Models of the same family share blind spots, so the checker must never be of the
  writer's family.
- **Confidentiality.** If it matters, prefer open-weight models that can run on infrastructure the mission
  controls.
- **Cost.** It depends on the level of work: a note takes a couple of calls, a report a few dozen, a full file
  several dozen. Measure it in the shadow run (chapter 6) before choosing.
- **Traceability.** Record which model wrote and which model checked each document.

## Checklist

- [ ] Every role writes one kind of document, and we can name its author for every document.
- [ ] Triage criteria for note, report and full file are written down.
- [ ] Each document has a defined structure (see [`templates/`](../templates/)).
- [ ] Prompts are one per role and task, versioned, with placeholder examples.
- [ ] We decided what happens when a document fails twice: the file stays open for a later run, or goes on
      without a document it can do without (chapter 5).
- [ ] Press products are checked by code: lengths, names and figures from the file, the decision's vote, no blame,
      no platform or machinery.
- [ ] The checker is from a different model family than the writer, and the fallback is checked too.
