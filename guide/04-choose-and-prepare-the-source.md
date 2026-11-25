# 4. Choose and prepare the source

The agents know only what the source tells them. A weak source cannot be fixed by better prompts.

## Choosing it

- **Public.** Everything the agents read is sent to a model provider. Use material the mission may share.
- **Complete enough.** A record of the whole meeting, not a summary. Statements, interventions, the chair's
  announcements and the result of any vote.
- **Attributed.** Each passage must say who is speaking. Without speakers there is no report.
- **Timed or numbered.** Each passage needs a position (a timestamp, a paragraph number) so that a document can
  cite it.
- **Stable.** The same meeting should give the same text tomorrow. Keep a copy of what you read and a hash of it.

Automatic transcripts meet most of these conditions and contain errors: names misheard, numbers garbled, speakers
missing. Plan for that (see "quality marks" below).

## Preparing it

1. **Cut it into segments.** Ten to fifteen minutes each, at speaker changes, each with a label ("E1", "E2" …),
   its start and end, and the speakers in it. Every citation will point to one of these labels.
2. **Summarise each segment** in a few points, with the speaker of each point. Reports are written from the
   summaries and the segments, not from the whole text at once.
3. **Mark the quality.** A transcript much shorter than the meeting, a missing part, a recording that holds two
   meetings: record it, and carry a "low confidence" mark to every document written from it.
4. **Keep what the source does not say out.** No knowledge of drafts that were not read out, no votes that were
   not announced, no background from the model's memory.

## Scope

Decide which bodies and which kinds of meeting the mission follows, and write it down. A narrow scope that is
covered every day is worth more than a wide one covered when there is time.

## Checklist

- [ ] The source is public, attributed and has positions we can cite.
- [ ] We keep a copy (and a hash) of every record we read.
- [ ] Records are cut into labelled segments with speakers and times.
- [ ] Short, incomplete or mixed records are detected and marked.
- [ ] The scope (bodies, kinds of meeting) is written down.
