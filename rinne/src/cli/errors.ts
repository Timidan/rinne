// A UsageError means the command line itself was wrong (bad arguments), as
// opposed to a runtime failure while executing a valid command. The CLI prints
// UsageErrors with the relevant usage text and exits non-zero.
export class UsageError extends Error {}
