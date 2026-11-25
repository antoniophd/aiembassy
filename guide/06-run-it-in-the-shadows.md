# 6. Run it in the shadows and read the output

Before anyone relies on the mission, run it alongside the real work for a few weeks, unseen, and read what it
writes. This is where most of the useful changes come from.

## Start small

- One body, one week, run by hand.
- A budget on every run: a maximum number of model calls and of minutes. Stop cleanly when it is reached.
- Record every model call before it is sent, with the prompt version, the model, tokens and time. Without that
  record you cannot explain a document or its cost.
- Keep the output private while you test. Keep it out of search engines.

## Read it as a colleague would

For a sample of files, open the record and the documents side by side:

- **Reports.** Did it miss a statement that mattered? Did it give weight to a minor one? Is every figure right?
- **Triage.** Were procedural meetings treated as procedural, and meetings that touched our interests sent all the
  way?
- **Options.** Were there real alternatives, or one option and a straw man?
- **Decisions.** Would you have taken that position from this profile? If not, is the profile wrong, or the
  decision?
- **Line over time.** When the same subject came back, did the position stay, and when it changed, does the
  decision say why?

Write down every disagreement, and decide for each one whether the fix belongs in the profile, a prompt, a check
or the source.

## Change one thing at a time

- Keep a small, fixed regression set: a handful of meetings of each level. Re-run it, on a copy of the data, after
  every change of prompt or model, and compare.
- Version every change. A document must always say which profile, prompt and model produced it.
- Never rewrite a stored document. A new attempt is a new record; the old one stays.

## Know when to stop testing

Move on when a week of output reads right to the people who know the subject, when failures are rare and
explained, and when cost per meeting is stable. Then schedule it, with an alert when a run is missed, stalls or
fails.

## Checklist

- [ ] Every run has a budget of calls and minutes.
- [ ] Every model call is recorded before it is sent.
- [ ] Output stays private and unindexed while we test.
- [ ] Someone who knows the subject has read a sample of each kind of document against the record.
- [ ] Each disagreement is assigned to profile, prompt, check or source.
- [ ] A regression set is re-run after every change, on a copy of the data.
- [ ] Runs are scheduled only after a week of output reads right, with alerts for missed or failed runs.
