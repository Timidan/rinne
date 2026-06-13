import { emptyAllowlists, type GuardAllowlists } from "../src/guard/rules.js";

// Shared fixtures for the guard rule tests. Inline policy values like these are
// allowed in unit tests (they exercise rule math and gate logic); they are not
// product mock evidence and never stand in for a live provider.

export const EMPTY_ALLOWLISTS: GuardAllowlists = emptyAllowlists();

export const KNOWN_SPENDER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
export const KNOWN_PROTOCOL = "0xCFa5aE7c2CE8Fadc6426C1ff872cA45378Fb7cF3";

export function allowlistsWith(overrides: Partial<GuardAllowlists> = {}): GuardAllowlists {
  return {
    spenders: {
      mantle: [{ address: KNOWN_SPENDER, name: "Agni Router", source: "test" }],
    },
    protocols: {
      mantle: [{ address: KNOWN_PROTOCOL, name: "Lendle", source: "test" }],
    },
    approvalAmountThreshold: { default: "1000000", perToken: {} },
    ...overrides,
  };
}
