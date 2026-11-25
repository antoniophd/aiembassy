# 2. Write the State's profile

The profile is the only description of the State the agents ever see. Every position the mission takes must
follow from it, so it has to be short, concrete and ranked. A template with empty fields is in
[`templates/state-profile.md`](../templates/state-profile.md).

## What goes in

- **A name to use.** "The State" is enough. Decide whether the agents may describe where it is, its neighbours or
  its history. If they may not, say so: models fill gaps with plausible detail.
- **Traits.** Three or four lines: its weight, its economy, its security, its place in the body it follows. These
  are the facts an adviser would keep in mind before speaking.
- **Interests, ranked.** Five or six at most, each one sentence, in order. The order is the point: when two
  interests pull apart, the higher one wins, and the decision must say which one prevailed.
- **Red lines.** Three or four things the State never does. Write them as actions ("never votes against …"), not
  values, so that a check can tell whether a decision crosses one.
- **How it behaves.** Habits that shape a position without being interests: for example, it would rather join a
  consensus than force a vote, or it keeps quiet on subjects where it has nothing at stake.
- **Alignment.** Whether it belongs to a group, and which groups it may coincide with. A State that belongs to
  none should not "join" a group by subject; it coincides with whoever defended the same position in that
  meeting.

## How to write it

- **Concrete over noble.** "Protection of civilians and access for relief" can be tested against a text. "Peace
  and prosperity for all" cannot.
- **One idea per line.** A line that holds two interests will be read as whichever suits the case.
- **Rank honestly.** If every interest is first, none is. Test the order on two or three past cases.
- **Version it.** Every change gets a new version number, and every document records the version it was written
  under. Otherwise you cannot tell whether a change of position came from the meeting or from the profile.

## Common mistakes

- A profile so long that each agent quotes a different part of it.
- Interests that are really outcomes ("the resolution is adopted"), not stakes.
- Red lines that need interpretation ("never acts against its values").
- Writing the profile to produce the positions you already want. Write it, then see what it produces.

## Checklist

- [ ] The profile fits on one page.
- [ ] Interests are ranked, one sentence each, at most six.
- [ ] Each red line is an action a check can recognise.
- [ ] Alignment says who the State may coincide with, and on what basis.
- [ ] The profile has a version number, and we know where documents record it.
- [ ] Two colleagues reading it would predict the same position on a simple case.
