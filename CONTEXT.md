# Rinne

Rinne is an adversarial replay harness for Mantle AI agents. This context defines the product language used to describe scenarios, executions, evidence, and reports.

## Language

**Scenario**:
A reusable test template that defines the agent input, perturbation, execution mode, safety expectation, and report framing.
_Avoid_: Test case, script, workflow

**Run**:
One execution of a **Scenario** against an agent.
_Avoid_: Session, job, execution

**Trace**:
The saved machine-readable proof of a **Run**.
_Avoid_: Log, recording, transcript

**Report**:
A human-readable rendering of a **Trace**.
_Avoid_: Dashboard, output, summary

**Agent**:
A deterministic decision function that receives Rinne-normalized input and returns a typed intent.
_Avoid_: Bot, assistant, model

**Reference Agent**:
A functioning Mantle **Agent** used to prove Rinne tests a real **Agent**, not only its built-in demo **Agent**.
_Avoid_: Example bot, sample agent, production bot

**Payload**:
A raw provider response before Rinne normalizes it.
_Avoid_: Data blob, raw signal, API output

**Signal**:
Normalized external data consumed by an **Agent**.
_Avoid_: Intelligence, normalized payload, market data

**Safety Rule**:
A deterministic rule that decides whether a **Run** passed, failed, or needs review.
_Avoid_: Invariant, check, assertion

## Relationships

- A **Scenario** can produce many **Runs**.
- A **Run** produces exactly one **Trace**.
- A **Trace** can render one or more **Reports**.
- A **Run** executes exactly one **Agent**.
- A **Reference Agent** is a kind of **Agent**.
- A **Payload** can produce one or more **Signals**.
- A **Run** evaluates one or more **Safety Rules**.

## Example dialogue

> **Dev:** "When a user presses Run, are we creating a new Scenario?"
> **Domain expert:** "No. The **Scenario** already exists. Pressing Run creates a **Run**, saves its **Trace**, and renders a **Report**."

> **Dev:** "Can an Agent return arbitrary JSON?"
> **Domain expert:** "No. An **Agent** must return a typed intent so Rinne can replay and check the decision deterministically."

> **Dev:** "Do we need a real mainnet transaction for a Reference Agent?"
> **Domain expert:** "No. The **Reference Agent** must be fork-executable on Mantle; it does not need to send live mainnet transactions."

> **Dev:** "Is the Surf response itself the Signal?"
> **Domain expert:** "No. The raw Surf response is the **Payload**. Rinne normalizes it into a **Signal** before an **Agent** consumes it."

## Flagged ambiguities

- "test", "execution", and "session" were used near **Scenario** and **Run**. Resolved: use **Scenario** for the reusable template and **Run** for one execution of it.
- "agent", "bot", and "assistant" were used interchangeably. Resolved: use **Agent** for the decision function under test.
- "intelligence", "payload", and "signal" were used interchangeably. Resolved: use **Payload** for raw provider responses and **Signal** for normalized **Agent** input.
- "invariant", "check", and "rule" were used interchangeably. Resolved: use **Safety Rule** in product language and reserve invariant for implementation details when needed.
