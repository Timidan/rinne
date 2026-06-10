# Rinne dependency boundary

Rinne treats Surf as the source of raw **Payloads** that become Agent-consumed **Signals**, while Mantle RPC plus Anvil provide execution truth for replay and fork-local checking. Nansen is optional historical Scenario enrichment, not part of the critical Run path, because this keeps Surf central without overclaiming Mantle indexed-chain coverage, keeps replay deterministic, and avoids making either Surf on-chain coverage or Nansen access demo-critical.
