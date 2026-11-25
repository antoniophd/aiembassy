# State profile

The only description of the State the agents see. Fill the empty [state-profile.json](state-profile.json); the
notes below explain each field. Keep the whole profile to one page.

```jsonc
{
  "id": "state-profile",
  "version": "1.0.0",        // bump on every change; every document records the version it used
  "name": "the State",       // what the agents call it
  "naming_rule": "",         // e.g. what the agents must never describe (location, neighbours, history)
  "traits": {
    "weight": "",            // its size and power in one line
    "economy": "",           // what it lives from, what it is exposed to
    "security": "",          // alliances, or none
    "at_the_un": ""          // its place in the body it follows: member, observer, member of which organs
  },
  "interests": [             // ranked: the higher one prevails; at most six, one sentence each
    { "id": "I1", "rank": 1, "text": "" },
    { "id": "I2", "rank": 2, "text": "" },
    { "id": "I3", "rank": 3, "text": "" }
  ],
  "conflict_rule": "",       // e.g. "If two interests pull apart, the higher one wins; the decision names it."
  "red_lines": [             // actions it never takes, written so a check can recognise them
    { "id": "R1", "text": "" },
    { "id": "R2", "text": "" }
  ],
  "alignment": {
    "rule": "",              // e.g. it acts in its national capacity and coincides with whoever defends the same position
    "known_groups": ["national capacity"]   // add the groups of your forum it may coincide with
  },
  "behaviour": [""]          // habits: prefers consensus, abstains with an explanation, stays silent with nothing at stake
}
```

## A filled example (invented)

- **Traits.** A small coastal State; lives from fishing and shipping; in no alliance; a member of the assembly,
  not of the council.
- **Interests.** I1 Safe and open sea lanes. I2 Shared rivers managed by agreement. I3 Access for relief in any
  crisis.
- **Red lines.** R1 Never accepts a border changed by force. R2 Never votes against access for relief.
- **Alignment.** Acts in its own name; may coincide with the Coastal Group or any other group that defends the
  same position in a given meeting.

## Mistakes to avoid

- Interests that cannot be tested against a text ("peace and prosperity").
- Two ideas in one interest; an unranked list.
- Red lines that need interpretation ("never acts against its values").
- Facts the agents could repeat as if they were in the record (a population figure, a recent event).
