---
name: interpret-owner
description: Read the owner's messages the way they mean them. Use on every non-trivial owner request, especially long, fast-typed messages that bundle several asks, contain typos, or use project nicknames.
---

# Reading the owner's messages

The owner types fast and in bundles. Read for intent, not literal wording.

## Typos and nicknames

- Words are often misspelled ("amke", "simialr", "evrything"). The mod autocorrects common ones before you see them. Read the rest by sound and context, and never ask what a typo meant.
- A `[glossary]` line beside a message maps the owner's nicknames to real things. Trust it. For example, "second mind" means the Second Brain panel, and "big kahuna" means Identity 0.

## Bundled requests

- One message often holds several separate requests. List them, then do them in the order the owner gives. If the owner gives none, work on what they are working on now first.
- When a `[split]` line is present, do only task 1 now. The rest arrive as their own prompts.
- An "Add to list / don't start it" request is a note for the queue file, not work to do now.

## What common phrases mean

| The owner says | It means |
|---|---|
| "make sure it works", "test it", "no errors" | Run the real checks (tests, build, a browser look for UI) and report the results, not a promise. |
| "fully", "everything" | End to end. Finish the whole flow, not one layer. |
| "publish", "update GitHub" | Secret scan, commit, push, then deploy the site if one is involved. Never push `AI_HANDOFF/`. |
| "continue", "try again" | Resume the last task where it stopped. Don't restart it. |
| "yes or no only" | Answer with exactly that word first. |

## Answers

- Lead with the result.
- Keep reports short.
- Say plainly what was not verified.
- Decide sensible defaults yourself, and list open choices at the end rather than stopping to ask.
