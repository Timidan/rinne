// Fixed-point decimal helpers backed by BigInt so every Run is exact and
// deterministic. All money math in Milestone 1 uses these.

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function parseDecimal(value: string, scale: number): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) {
    throw new Error(
      `Decimal "${value}" has more than ${scale} fractional digits; refusing to round silently`
    );
  }
  const scaled =
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  return negative ? -scaled : scaled;
}

export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = (abs / base).toString();
  if (scale === 0) {
    return negative ? `-${whole}` : whole;
  }
  const fraction = (abs % base).toString().padStart(scale, "0");
  const text = `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

// Floor division; callers must guarantee divisor != 0.
export function mulDiv(a: bigint, b: bigint, divisor: bigint): bigint {
  return (a * b) / divisor;
}

export function scaleOne(scale: number): bigint {
  return 10n ** BigInt(scale);
}
