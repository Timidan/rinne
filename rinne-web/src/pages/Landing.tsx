import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import BrandMark from "../components/BrandMark";
import ThemeToggle from "../components/ThemeToggle";
import InkField from "../components/InkField";
import LiveGuardDemo from "../components/LiveGuardDemo";

const WRAP = "mx-auto max-w-[1160px] px-7";
const PILL_BLUE =
  "inline-flex h-12 items-center justify-center rounded-full bg-blue px-6 text-base font-bold text-white transition-colors hover:bg-blue-press";
const PILL_SOFT =
  "inline-flex h-12 items-center justify-center rounded-full bg-blue-pale px-6 text-base font-bold text-blue-deep transition-colors hover:bg-[color-mix(in_srgb,var(--color-blue)_24%,transparent)]";

// The install command shown on the landing page: a copyable curl that returns
// the agent skill from this very instance.
function CurlInstall({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mx-auto mt-8 flex max-w-[560px] items-center gap-3 rounded-2xl border border-line bg-bg p-2 pl-5 text-left">
      <code className="flex-1 truncate font-mono text-[15px] text-ink">
        <span className="text-ink-dim">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-blue px-5 text-sm font-bold text-white transition-colors hover:bg-blue-press"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const STEPS: { tag: string; name: string; body: string; code: string }[] = [
  {
    tag: "STEP 1",
    name: "Register",
    body: "Your agent installs the skill and registers itself in one request. It gets an API key — no operator, no dashboard.",
    code: "POST /v1/register-agent",
  },
  {
    tag: "STEP 2",
    name: "Ask before acting",
    body: "Before any swap, approval, or borrow, it sends the planned action. Rinne runs deterministic rules against live Surf and Nansen evidence.",
    code: "POST /v1/guard",
  },
  {
    tag: "STEP 3",
    name: "Act on the gate",
    body: "proceed → execute it. block → don't. review → a human looks first. Every decision is recorded with the evidence behind it.",
    code: "→ proceed · block · review",
  },
];

export default function Landing() {
  const reduced = useReducedMotion();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-rinne";

  // Hero: the headline recedes and the rebirth dial turns a little as you leave.
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(heroP, [0, 1], [0, 90]);
  const heroFade = useTransform(heroP, [0, 0.85], [1, 0.2]);
  const dialTurn = useTransform(heroP, [0, 1], [0, 55]);
  const dialScale = useTransform(heroP, [0, 1], [1, 1.16]);

  // Closer rises to meet you.
  const closerRef = useRef<HTMLElement>(null);
  const { scrollYProgress: closerP } = useScroll({
    target: closerRef,
    offset: ["start 0.95", "start 0.55"],
  });
  const closerY = useTransform(closerP, [0, 1], [48, 0]);
  const closerFade = useTransform(closerP, [0, 1], [0.3, 1]);

  return (
    <>
      <InkField />

      <nav className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] backdrop-blur-md">
        <div className={`${WRAP} flex h-[76px] items-center justify-between`}>
          <Link to="/" className="flex items-center gap-[13px] text-2xl font-extrabold tracking-tight">
            <BrandMark className="size-10" />
            Rinne
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/app/dashboard"
              className="hidden rounded-full px-3.5 py-2 text-[15px] font-medium text-ink-dim transition-colors hover:text-ink sm:inline-flex"
            >
              Dashboard
            </Link>
            <Link
              to="/app/agents"
              className="hidden rounded-full px-3.5 py-2 text-[15px] font-medium text-ink-dim transition-colors hover:text-ink sm:inline-flex"
            >
              Agents
            </Link>
            <a
              href="#get-started"
              className="hidden rounded-full px-3.5 py-2 text-[15px] font-medium text-ink-dim transition-colors hover:text-ink sm:inline-flex"
            >
              Integrate
            </a>
            <ThemeToggle />
            <Link to="/app/dashboard" className={`${PILL_BLUE} ml-1`}>
              Open dashboard
            </Link>
          </div>
        </div>
      </nav>

      <main className="overflow-x-clip">
        {/* Hero: the rebirth dial turning behind the call to act */}
        <header ref={heroRef} className="relative pb-[72px] pt-[100px] text-center">
          <motion.div
            className="pointer-events-none absolute left-1/2 top-[118px] z-0 h-[480px] w-[480px] -translate-x-1/2 lg:h-[720px] lg:w-[720px]"
            style={reduced ? undefined : { rotate: dialTurn, scale: dialScale }}
            aria-hidden
          >
            <svg className="dial h-full w-full" viewBox="0 0 720 720">
              <g className="spin-a">
                <circle className="c1" cx="360" cy="360" r="318" />
              </g>
              <g className="spin-b">
                <circle className="c2" cx="360" cy="360" r="236" />
              </g>
            </svg>
          </motion.div>
          <motion.div
            className={`${WRAP} relative`}
            style={reduced ? undefined : { y: heroY, opacity: heroFade }}
          >
            <h1 className="text-[clamp(52px,9.5vw,120px)] font-extrabold leading-[0.98] tracking-[-0.035em]">
              <span className="text-blue">Catch</span> the trade
              <br />
              your agent shouldn&rsquo;t make.
            </h1>
            <p className="mx-auto mt-7 max-w-[52ch] text-xl text-ink-dim">
              Rinne is the safety gate your Mantle DeFi agent calls before every swap, approval, or
              borrow. Proceed, block, or review, from deterministic rules and live evidence, with a
              receipt for each call.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3.5">
              <Link to="/app/dashboard" className={PILL_BLUE}>
                Open dashboard
              </Link>
              <a href="#get-started" className={PILL_SOFT}>
                Integrate your agent
              </a>
            </div>
          </motion.div>
        </header>

        {/* Get started: the one curl that teaches an agent the whole guard flow */}
        <section id="get-started" className="pb-[96px] pt-2" aria-label="Get started with your agent">
          <div className={WRAP}>
            <div className="mx-auto max-w-[760px] rounded-3xl border border-line bg-card p-8 text-center sm:p-12">
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-blue">
                Get started with your agent
              </div>
              <h2 className="mt-4 text-[clamp(28px,3.6vw,42px)] font-extrabold leading-[1.06] tracking-[-0.02em]">
                Hand your agent the guard.
              </h2>
              <p className="mx-auto mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-dim">
                Point your agent at the skill and it learns the whole flow — register itself, then
                ask before every swap, approval, or borrow — in one request.
              </p>
              <CurlInstall command={`curl ${origin}/skill.md`} />
              <p className="mx-auto mt-5 max-w-[54ch] text-sm leading-relaxed text-ink-dim">
                Paste that to your financial agent. It self-registers, then Rinne answers{" "}
                <span className="font-mono text-blue">proceed</span> ·{" "}
                <span className="font-mono text-red">block</span> ·{" "}
                <span className="font-mono text-amber">review</span> on each action, with a recorded
                trail you can watch.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3.5">
                <Link to="/app/dashboard" className={PILL_BLUE}>
                  Watch the guard
                </Link>
                <a href={`${origin}/skill.md`} target="_blank" rel="noreferrer" className={PILL_SOFT}>
                  Read the skill
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* See it decide — interactive proof of the guard */}
        <LiveGuardDemo />

        {/* How the guard works — three moves, not the old replay flow */}
        <section id="how" className="pb-[96px]" aria-label="How the guard works">
          <div className={WRAP}>
            <h2 className="text-center text-[clamp(26px,3.2vw,38px)] font-extrabold leading-[1.08] tracking-[-0.02em]">
              One call before every move.
            </h2>
            <div className="mx-auto mt-10 grid max-w-[980px] gap-3.5 lg:grid-cols-3">
              {STEPS.map((step) => (
                <div
                  key={step.name}
                  className="flex flex-col rounded-[20px] border-2 border-ink bg-card px-[18px] pb-[18px] pt-5 shadow-[4px_4px_0_var(--color-ink)]"
                >
                  <div className="font-mono text-[11px] tracking-[0.05em] text-ink-dim">{step.tag}</div>
                  <h3 className="mt-2 text-[21px] font-extrabold tracking-[-0.01em]">{step.name}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">{step.body}</p>
                  <div className="mt-auto pt-4 font-mono text-[12.5px] text-ink-dim">{step.code}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What Rinne guards today — explicit scope, no overclaiming */}
        <section id="supports" className="pb-[110px]" aria-label="What Rinne guards today">
          <div className={WRAP}>
            <div className="mx-auto max-w-[860px]">
              <h2 className="text-center text-[clamp(26px,3.2vw,38px)] font-extrabold leading-[1.08] tracking-[-0.02em]">
                What Rinne guards today
              </h2>
              <p className="mx-auto mt-3 max-w-[56ch] text-center text-[15px] leading-relaxed text-ink-dim">
                Three DeFi action families, on Mantle mainnet and the Mantle Sepolia testnet. If your
                agent sends anything else, Rinne refuses it rather than guessing.
              </p>
              <div className="mx-auto mt-9 grid max-w-[760px] gap-3.5 sm:grid-cols-3">
                {(
                  [
                    ["Swap", "token-for-token trades", "min-received floor, slippage cap, live Surf price"],
                    ["Approval", "ERC-20 allowances", "no unlimited approvals, size limit, spender risk"],
                    ["Lending", "supply · borrow · withdraw · repay", "health-factor floor, protocol risk"],
                  ] as const
                ).map(([name, what, checks]) => (
                  <div key={name} className="rounded-2xl border border-line bg-card p-5">
                    <h3 className="font-display text-[19px] font-extrabold tracking-[-0.01em]">{name}</h3>
                    <p className="mt-1 text-[13px] text-ink-dim">{what}</p>
                    <p className="mt-3 font-mono text-[12px] leading-relaxed text-ink-dim">{checks}</p>
                  </div>
                ))}
              </div>
              <div className="mx-auto mt-6 flex max-w-[760px] flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-xs text-ink-dim">
                <span className="rounded-full border border-line px-3 py-1">Mantle mainnet · 5000</span>
                <span className="rounded-full border border-line px-3 py-1">Mantle Sepolia testnet · 5003</span>
                <span className="rounded-full border border-line px-3 py-1">gates: proceed · block · review</span>
              </div>
              <p className="mx-auto mt-6 max-w-[64ch] text-center text-[13px] leading-relaxed text-ink-dim">
                Rinne <strong className="font-semibold text-ink">decides, it never executes</strong> — your
                agent broadcasts the transaction itself after a <span className="text-blue">proceed</span>.
                Evidence is live (Surf market data, Nansen address risk); if a provider is unreachable the
                decision becomes <span className="text-amber">review</span>, never a guess. It guards only
                agents that integrate and obey <span className="text-red">block</span>; it does not stop
                arbitrary bots.
              </p>
            </div>
          </div>
        </section>

        {/* Closer */}
        <motion.section
          ref={closerRef}
          className="pb-[110px] pt-[40px] text-center"
          style={reduced ? undefined : { y: closerY, opacity: closerFade }}
        >
          <div className={WRAP}>
            <h2 className="text-[clamp(36px,5vw,60px)] font-extrabold leading-[1.04] tracking-[-0.03em]">
              Your agent&rsquo;s last check
              <br />
              before it moves funds.
            </h2>
            <p className="mx-auto mt-[18px] max-w-[44ch] text-[19px] text-ink-dim">
              One call before every action. No keys to Rinne, nothing executed on your behalf.
            </p>
            <Link to="/app/dashboard" className={`${PILL_BLUE} mt-8`}>
              Open dashboard
            </Link>
          </div>
        </motion.section>
      </main>

      <footer className="border-t border-line bg-[color-mix(in_srgb,var(--color-bg)_85%,transparent)]">
        <div className={`${WRAP} py-14`}>
          <div className="grid gap-x-10 gap-y-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="max-w-[300px]">
              <div className="flex items-center gap-3">
                <BrandMark className="size-9" />
                <span className="text-xl font-extrabold tracking-tight">Rinne</span>
              </div>
              <p className="mt-3.5 text-[15px] leading-relaxed text-ink-dim">
                The safety gate for Mantle DeFi agents. Ask before you act: proceed, block, or
                review, with the receipt.
              </p>
            </div>
            <div>
              <div className="text-sm font-extrabold">Product</div>
              <ul className="mt-4 space-y-2.5 text-[15px]">
                <li>
                  <Link to="/app/dashboard" className="text-ink-dim transition-colors hover:text-blue">
                    Guard dashboard
                  </Link>
                </li>
                <li>
                  <Link to="/app/agents" className="text-ink-dim transition-colors hover:text-blue">
                    Agents
                  </Link>
                </li>
                <li>
                  <a href="/skill.md" className="text-ink-dim transition-colors hover:text-blue">
                    Agent skill
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-extrabold">Builders</div>
              <ul className="mt-4 space-y-2.5 text-[15px]">
                <li>
                  <a href="#get-started" className="text-ink-dim transition-colors hover:text-blue">
                    Integrate your agent
                  </a>
                </li>
                <li>
                  <a href="#how" className="text-ink-dim transition-colors hover:text-blue">
                    How the guard works
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-extrabold">Ecosystem</div>
              <ul className="mt-4 space-y-2.5 text-[15px]">
                <li>
                  <a
                    href="https://www.mantle.xyz"
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-2.5 text-ink-dim transition-colors hover:text-blue"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md bg-[#10131a] p-1">
                      <img src="/brand/ext/mantle.svg" alt="" className="size-full" />
                    </span>
                    Mantle
                    <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                      ↗
                    </span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://asksurf.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-2.5 text-ink-dim transition-colors hover:text-blue"
                  >
                    <img src="/brand/ext/surf.png" alt="" className="size-6 rounded-md" />
                    Surf
                    <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                      ↗
                    </span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-11 border-t border-line pt-6 text-[13px] text-ink-dim">© 2026 Rinne</div>
        </div>
      </footer>
    </>
  );
}
