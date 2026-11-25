# Contributing and contact

The only contact is this repository's **issues**. Use them to report a mistake in the guide or the templates,
a rule of the reference implementation that gives a wrong result, or a question about how something works.
Please quote the passage or name the file.

Changes: one logical change per pull request. For `reference/`, `npm run check` must pass there (types, tests,
the 400-line file rule, formatting), and tests use invented data only. Code, identifiers and documents are in
English.

Rules that hold the reference implementation together (see `reference/README.md`):

- The work never waits for a person: no state or button may hold a document for human approval. People read
  the output (guide, chapters 6 and 7); they are not a step of the workflow.
- The state of a meeting file lives in `files.status` only; stored documents are never rewritten.
- Every model call is recorded before it is sent; every document records its prompt id and version.
- Secrets never go into the repository, logs or issues.
