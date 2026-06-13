import { createServer, type Server } from "node:http";

// Shared test helper: a local stand-in for the Surf Data API. Used by the
// doctor test to probe Surf reachability without depending on the real
// gateway. The guard's own provider tests live in guard-helpers.ts.

interface StubServer {
  url: string;
  close(): Promise<void>;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolveListen(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

export interface StubSurfOptions {
  symbol?: string;
  // Newest price in the served series, as a number (e.g. 0.53).
  price?: number;
  // Age of the newest point relative to "now", in minutes.
  ageMinutes?: number;
  // When set, the stub answers every request with this HTTP status and body
  // instead of a price series — for failure-path tests.
  failWith?: { status: number; body?: string };
}

// A local stand-in for the Surf Data API serving the real market-price shape
// (a series of price points under raw "data"). Tests point the engine at it
// via SURF_API_URL; no canned data ships with the product.
export async function startStubSurf(options: StubSurfOptions = {}): Promise<StubServer> {
  const symbol = options.symbol ?? "MNT";
  const price = options.price ?? 0.53;
  const ageMinutes = options.ageMinutes ?? 1;
  const server = createServer((_req, res) => {
    if (options.failWith) {
      res.writeHead(options.failWith.status, { "Content-Type": "application/json" });
      res.end(options.failWith.body ?? JSON.stringify({ error: "stub failure" }));
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const latest = nowSec - Math.round(ageMinutes * 60);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        symbol,
        data: [
          { symbol, metric: "price", value: price * 0.99, timestamp: latest - 3600 },
          { symbol, metric: "price", value: price, timestamp: latest },
        ],
      })
    );
  });
  const url = await listen(server);
  return { url, close: () => close(server) };
}

// Points the engine's live Surf fetch at a stub for the duration of one test
// file. node --test runs each file in its own process, so this never leaks
// across files.
export function useSurfUrl(url: string): void {
  process.env.SURF_API_URL = url;
}
