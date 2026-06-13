import { startServer } from "../../server/index.js";
import { UsageError } from "../errors.js";

export const SERVE_USAGE = `Usage: rinne serve [--port <port>]

Starts the Rinne server: the guard JSON API (/v1, /api), the agent skill
(/skill.md), and the rinne-web dashboard (when built) on one origin.

Binds to 127.0.0.1 by default — in production it runs behind an nginx reverse
proxy on the same host. Env:
  PORT                    Port to listen on (overridden by --port).
  RINNE_HOST              Bind address (default 127.0.0.1; set 0.0.0.0 only to
                          expose directly, without a proxy).
  RINNE_HOSTED=1          Require live providers: SURF_API_KEY + NANSEN_API_KEY.
  RINNE_ALLOWED_ORIGINS   Extra comma-separated CORS origins (same-origin is
                          always allowed).

Options:
  --port <port>  Port to listen on (default $PORT or 4517; 0 picks a free port).
  -h, --help     Show this help.
`;

export interface ServeArgs {
  port: number;
}

export function parseServeArgs(argv: string[]): ServeArgs {
  // Platforms (and our systemd unit) inject PORT; --port still wins if given.
  const envPort = process.env.PORT;
  let port = envPort && /^\d+$/.test(envPort) ? Number(envPort) : 4517;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--port") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new UsageError(`--port requires a number\n\n${SERVE_USAGE}`);
      }
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new UsageError(`Invalid port "${value}"\n\n${SERVE_USAGE}`);
      }
      i += 1;
    } else {
      throw new UsageError(`Unknown argument "${flag}"\n\n${SERVE_USAGE}`);
    }
  }
  return { port };
}

export async function serveCommand(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(SERVE_USAGE);
    return 0;
  }
  const args = parseServeArgs(argv);
  const server = await startServer(args.port);
  console.log("Rinne is running.");
  console.log(`  Dashboard: ${server.url}/app`);
  console.log(`  Agent skill (install URL): ${server.url}/skill.md`);
  console.log(`  Guard API: POST ${server.url}/v1/guard`);
  console.log("Press Ctrl+C to stop.");
  // Keep the process alive until interrupted; the HTTP server holds the loop.
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", resolveStop);
    process.once("SIGTERM", resolveStop);
  });
  await server.close();
  return 0;
}
