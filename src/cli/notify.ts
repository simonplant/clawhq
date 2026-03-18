/**
 * `clawhq notify` command — manage admin notification channels.
 *
 * Subcommands: add, list, remove, test.
 */

import chalk from "chalk";
import { Command } from "commander";

import {
  addChannel,
  dispatchTest,
  loadChannels,
  newChannelId,
  removeChannel,
} from "../operate/notifications/index.js";
import type {
  NotificationChannel,
  NotificationEventType,
} from "../operate/notifications/index.js";

import { spinner, status } from "./ui.js";

const VALID_EVENTS: NotificationEventType[] = [
  "alert.critical",
  "alert.warning",
  "approval.pending",
  "health.degraded",
  "health.recovered",
  "update.available",
  "backup.failed",
];

function parseEvents(raw: string): NotificationEventType[] {
  const events = raw.split(",").map((e) => e.trim()) as NotificationEventType[];
  for (const e of events) {
    if (!VALID_EVENTS.includes(e)) {
      throw new Error(`Unknown event type: ${e}\nValid: ${VALID_EVENTS.join(", ")}`);
    }
  }
  return events;
}

export function createNotifyCommand(): Command {
  const notifyCmd = new Command("notify")
    .description("Manage admin notification channels")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  // --- list (default) ---
  notifyCmd
    .command("list", { isDefault: true })
    .description("List configured notification channels")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = notifyCmd.opts() as { clawhqDir: string };
      const clawhqHome = parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");
      const channels = await loadChannels(clawhqHome);

      if (opts.json) {
        console.log(JSON.stringify(channels, null, 2));
        return;
      }

      if (channels.length === 0) {
        console.log("No notification channels configured.");
        console.log(`Run ${chalk.cyan("clawhq notify add <type>")} to add one.`);
        return;
      }

      console.log(chalk.bold(`\nNotification Channels (${channels.length})\n`));
      for (const ch of channels) {
        const eventList = ch.events.join(", ");
        const enabledTag = ch.enabled ? chalk.green("enabled") : chalk.gray("disabled");
        console.log(`  ${chalk.bold(ch.id)}  ${ch.name}  [${ch.type}]  ${enabledTag}`);
        console.log(`    Events: ${eventList}`);
      }
      console.log("");
    });

  // --- add <type> ---
  notifyCmd
    .command("add <type>")
    .description("Add a notification channel (webhook, telegram, slack, email)")
    .option("--name <name>", "Channel name")
    .option("--events <events>", "Comma-separated event subscriptions", VALID_EVENTS.join(","))
    .option("--url <url>", "Webhook URL (webhook type)")
    .option("--secret <secret>", "HMAC secret (webhook type)")
    .option("--token <token>", "Bot token (telegram type)")
    .option("--chat-id <chatId>", "Chat ID (telegram type)")
    .option("--webhook-url <webhookUrl>", "Incoming webhook URL (slack type)")
    .option("--to <email>", "Recipient email (email type)")
    .option("--transport <transport>", "SMTP connection string (email type)")
    .action(async (type: string, opts: {
      name?: string;
      events: string;
      url?: string;
      secret?: string;
      token?: string;
      chatId?: string;
      webhookUrl?: string;
      to?: string;
      transport?: string;
    }) => {
      const parentOpts = notifyCmd.opts() as { clawhqDir: string };
      const clawhqHome = parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");

      let events: NotificationEventType[];
      try {
        events = parseEvents(opts.events);
      } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const id = newChannelId();
      const now = new Date().toISOString();
      const name = opts.name ?? `${type}-${id}`;
      let channel: NotificationChannel;

      switch (type) {
        case "webhook": {
          if (!opts.url) { console.error("--url is required for webhook channels"); process.exitCode = 1; return; }
          if (!opts.secret) { console.error("--secret is required for webhook channels"); process.exitCode = 1; return; }
          channel = { id, name, type: "webhook", events, enabled: true, createdAt: now, url: opts.url, secret: opts.secret };
          break;
        }
        case "telegram": {
          if (!opts.token) { console.error("--token is required for telegram channels"); process.exitCode = 1; return; }
          if (!opts.chatId) { console.error("--chat-id is required for telegram channels"); process.exitCode = 1; return; }
          channel = { id, name, type: "telegram", events, enabled: true, createdAt: now, token: opts.token, chatId: opts.chatId };
          break;
        }
        case "slack": {
          if (!opts.webhookUrl) { console.error("--webhook-url is required for slack channels"); process.exitCode = 1; return; }
          channel = { id, name, type: "slack", events, enabled: true, createdAt: now, webhookUrl: opts.webhookUrl };
          break;
        }
        case "email": {
          if (!opts.to) { console.error("--to is required for email channels"); process.exitCode = 1; return; }
          if (!opts.transport) { console.error("--transport is required for email channels"); process.exitCode = 1; return; }
          channel = { id, name, type: "email", events, enabled: true, createdAt: now, to: opts.to, transport: opts.transport };
          break;
        }
        default:
          console.error(`Unknown channel type: ${type}\nValid types: webhook, telegram, slack, email`);
          process.exitCode = 1;
          return;
      }

      try {
        await addChannel(channel, clawhqHome);
        console.log(`${status.pass} Channel added: ${chalk.bold(id)} (${type}) — ${name}`);
      } catch (err: unknown) {
        console.error(`${status.fail} Failed to add channel: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // --- remove <id> ---
  notifyCmd
    .command("remove <id>")
    .description("Remove a notification channel by ID")
    .action(async (id: string) => {
      const parentOpts = notifyCmd.opts() as { clawhqDir: string };
      const clawhqHome = parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");

      const removed = await removeChannel(id, clawhqHome);
      if (removed) {
        console.log(`${status.pass} Channel ${chalk.bold(id)} removed.`);
      } else {
        console.error(`${status.fail} Channel ${id} not found.`);
        process.exitCode = 1;
      }
    });

  // --- test <id> ---
  notifyCmd
    .command("test <id>")
    .description("Send a test notification to a channel")
    .action(async (id: string) => {
      const parentOpts = notifyCmd.opts() as { clawhqDir: string };
      const clawhqHome = parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");

      const s = spinner(`${chalk.magenta("Operate")} Sending test notification...`);
      s.start();

      const result = await dispatchTest(id, clawhqHome);

      if (result.sent) {
        s.succeed(`${chalk.magenta("Operate")} ${status.pass} Test sent to ${result.channelName} (${result.channelType})`);
      } else {
        s.fail(`${chalk.magenta("Operate")} ${status.fail} Test failed: ${result.error}`);
        process.exitCode = 1;
      }
    });

  return notifyCmd;
}
