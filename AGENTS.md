# Project instructions

- Follow software engineering principles: keep responsibilities cohesive, dependencies explicit, and
  interfaces small. Prefer simple designs over speculative abstractions; share code when it
  represents shared knowledge, not merely similar syntax.
- Always use meaningful names that accurately express domain concepts, responsibilities, and
  behavior. Human readability is a top priority. Names also carry semantics that LLMs use to infer
  intent and relationships, so treat them as contracts. Use consistent vocabulary, include units or
  state when relevant, and rename identifiers when their meaning changes.
- Make types, invariants, side effects, and error handling explicit. Validate external input at
  boundaries; do not hide problems with unchecked assertions or suppressions.
- Keep changes scoped to the task and preserve unrelated work. Test observable behavior and relevant
  edge cases, and update documentation when behavior or workflows change.
- Test behavior promised by project code through its interfaces. Keep standalone dependency
  characterization out of the active suite and CI; preserve research findings and versioned evidence
  separately.
- Follow repository configuration and existing conventions for Bun tooling, Biome, formatting, linting,
  and type checking. Run checks appropriate to the change and report passed, failed, and unrun checks
  separately. Do not weaken acceptance criteria to excuse a failure or claim readiness while a
  required check with material risk remains unresolved.
- For code-quality reviews and refactoring, use the
  [code-quality skill](.agents/skills/code-quality/SKILL.md).
- For queue/backend integration or durable worker behavior validation, use the
  [queue-backend-integration skill](.agents/skills/queue-backend-integration/SKILL.md).

## Project workflow

Bun is the primary development and worker runtime. Use the scripts and pinned tooling in
`package.json` and `bun.lock`; the [decisions](docs/decisions/) record the tooling choices.

The [README](README.md) describes current project status. The [architecture](docs/architecture.md),
[decisions](docs/decisions/), [acceptance criteria](docs/validation.md), and
[library research](docs/library-research.md) define the project contract. Consult the relevant
sections for domain changes and inspect the code before assuming a documented capability exists.
The full first-slice design does not expand a narrower requested task. Deferred capabilities listed
in the acceptance criteria are outside the first slice: do not implement them speculatively or make
them blockers.

Make reasonable choices about dependency versions and internal APIs within the task. Investigate
decisions in proportion to migration costs, security boundaries, public commitments, or production
data. Ask when an invariant decision or explicit requirement must change, a material commitment
exceeds the task, or a missing fact blocks responsible progress. Inspect actual consumers and stored
data before incompatible changes; draft status and pre-v1 versions do not make existing contracts or
data disposable.

## Technical decisions

`docs/decisions/` holds one file per current technical decision: architecture, behavior,
interfaces, data, dependencies, and tooling. Product priorities, task plans, and process rules do
not belong there. Each file uses this structure:

```markdown
# <Decision stated as a short title>

- **Status:** provisional | invariant
- **Human-confirmed:** yes | no

## Decision

<The current choice, specific enough to implement and verify.>

## Context

<The constraints, evidence, and present rationale behind it.>
```

- **Invariant:** preserve it, like explicit requirements and established external contracts.
  Report a concrete conflict before changing it; reversibility does not make it optional. Only a
  human makes a decision invariant or changes an invariant decision.
- **Provisional:** implement the selected working choice. Revise it when evidence supports a simpler
  or safer approach, explain consequential changes, and update affected code, tests, and docs
  together. It is not a question awaiting approval.
- When you make a technical decision that future work must follow or would otherwise revisit,
  record it as a provisional file with `Human-confirmed: no` and continue; confirmation can come
  later. Only a human sets `Human-confirmed: yes`. Changing a decision's substance or status resets
  it to `no`; call out any revision of a confirmed decision in your report.
- A decision file contains only the current decision. Edit it in place when the decision changes and
  delete it when the decision no longer applies; do not keep superseded versions or history
  sections. Git history and the commit or PR that changes a decision record its history.
- Name files `<area>-<decision>.md`, reusing existing area prefixes, and link each decision from
  the architecture's [decisions by area](docs/architecture.md#decisions-by-area).
- Other documentation, including the README, AGENTS.md, and skills, links to the decision file
  instead of restating its choice or context. It may still describe current behavior and acceptance
  criteria.

## Completion

For implementation tasks, complete the requested behavior and bring changed code to the engineering
standards above before handing it back. Correctness, readable structure, semantically accurate
names, and appropriate validation are completion requirements. Resolve concrete shortcomings within
scope without waiting for another request. Stop when these requirements are met or a specific
blocker needs user input; continue independent, authorized work when only part of the task is
blocked.

Rerun checks whose results may have changed. Broaden validation when the change's impact or a
remaining uncertainty warrants it. Once relevant checks pass and the completion requirements are
met, finish.

## Content placement

Write prose and comments for the destination's readers and purpose. Include only information that
helps them understand, decide, or act. Explain current constraints directly; omit content that
merely recounts the change conversation or reassures its participants.

- README: Help users understand the project, its current capabilities, and how to use it; help
  contributors get started. Future-facing content should be limited to concise descriptions of
  intended capabilities or improvements useful to those readers. Keep implementation plans, task
  breakdowns, and agent execution instructions elsewhere.
- Code and comments: Communicate current intent, behavior, contracts, and constraints. Explain
  relevant design choices through their present rationale. Keep experiment logs, abandoned
  approaches, and change narratives elsewhere unless the historical detail is essential to
  understanding the current code.
- AGENTS.md: Include durable instructions an agent needs in every fresh session within its scope.
  Put instructions needed only for particular tasks or workflows in skills; retain only the minimal
  routing guidance needed to find and invoke them.
- docs/: Keep project requirements, design, acceptance criteria, and supporting research here.
  Put agent instructions and implementation workflows in AGENTS.md or repository skills instead.
- docs/decisions/: Keep only current technical decisions, in the format above. Other documents link
  to them.
- PRs and commits: Preserve relevant change context, alternatives considered, and decision
  history.
