#!/usr/bin/env node
import { UsageError } from "./errors.js";
import { doctorCommand, DOCTOR_USAGE } from "./commands/doctor.js";
import { serveCommand, SERVE_USAGE } from "./commands/serve.js";

export const USAGE = `Rinne - hosted DeFi agent guard for Mantle

Usage:
  rinne serve [--port <port>]
      Start the Rinne server: the guard API (/v1, /api), the agent skill
      (/skill.md), and the dashboard. Behind nginx in production.
  rinne doctor
      Check this machine's readiness to run the Rinne server.
  rinne help [command]
      Show help for Rinne or for one command.

Run "rinne <command> --help" for details on a command.

Rinne never executes transactions. Agents register themselves over /v1 and ask
the guard before acting; the guard returns proceed / block / review backed by
live Surf and Nansen evidence.
`;

type CommandHandler = (argv: string[]) => number | Promise<number>;

const COMMANDS: Record<string, CommandHandler> = {
  serve: serveCommand,
  doctor: doctorCommand,
};

const COMMAND_USAGE: Record<string, string> = {
  serve: SERVE_USAGE,
  doctor: DOCTOR_USAGE,
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    const topic = rest[0];
    if (topic && COMMAND_USAGE[topic]) {
      console.log(COMMAND_USAGE[topic]);
    } else if (topic) {
      console.error(`Unknown command "${topic}"\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    } else {
      console.log(USAGE);
    }
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command "${command}"\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  try {
    process.exitCode = await handler(rest);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
    } else {
      console.error(`Rinne ${command} failed: ${(error as Error).message}`);
    }
    process.exitCode = 1;
  }
}

await main();
