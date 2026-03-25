/**
 * Multi-channel notification dispatcher.
 *
 * Sends alerts and digests to configured notification channels (Telegram,
 * email, webhook). Fire-and-forget — notification failures never block
 * the monitor loop.
 */

import * as net from "node:net";
import * as tls from "node:tls";

import { TELEGRAM_API_BASE } from "../../config/defaults.js";

import type {
  EmailNotificationChannel,
  NotificationChannel,
  NotifyResult,
  TelegramNotificationChannel,
  WebhookNotificationChannel,
} from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a text message to all enabled notification channels.
 *
 * Returns one result per channel. Never throws — errors are captured per channel.
 */
export async function sendNotification(
  channels: readonly NotificationChannel[],
  subject: string,
  body: string,
): Promise<readonly NotifyResult[]> {
  const enabled = channels.filter((c) => c.enabled);
  if (enabled.length === 0) return [];

  const results = await Promise.all(
    enabled.map((channel) => dispatchToChannel(channel, subject, body)),
  );

  return results;
}

// ── Channel Dispatchers ─────────────────────────────────────────────────────

async function dispatchToChannel(
  channel: NotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  switch (channel.type) {
    case "telegram":
      return sendTelegram(channel, subject, body);
    case "webhook":
      return sendWebhook(channel, subject, body);
    case "email":
      return sendEmail(channel, subject, body);
  }
}

// ── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(
  config: TelegramNotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  const text = `*${escapeMarkdown(subject)}*\n\n${escapeMarkdown(body)}`;

  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      return { channel: "telegram", success: false, error: `Telegram API ${response.status}: ${responseBody}` };
    }

    return { channel: "telegram", success: true };
  } catch (err) {
    return { channel: "telegram", success: false, error: String(err) };
  }
}

// ── Webhook ─────────────────────────────────────────────────────────────────

async function sendWebhook(
  config: WebhookNotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify({
        subject,
        body,
        timestamp: new Date().toISOString(),
        source: "clawhq-monitor",
      }),
    });

    if (!response.ok) {
      return { channel: "webhook", success: false, error: `Webhook ${response.status}` };
    }

    return { channel: "webhook", success: true };
  } catch (err) {
    return { channel: "webhook", success: false, error: String(err) };
  }
}

// ── Email (SMTP) ────────────────────────────────────────────────────────

/** SMTP connection timeout in ms. */
const SMTP_TIMEOUT_MS = 15_000;

async function sendEmail(
  config: EmailNotificationChannel,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  try {
    await smtpSend({
      host: config.smtpHost,
      port: config.smtpPort,
      user: config.smtpUser,
      pass: config.smtpPass,
      from: config.from,
      to: config.to,
      subject,
      body,
    });
    return { channel: "email", success: true };
  } catch (err) {
    return { channel: "email", success: false, error: String(err) };
  }
}

interface SmtpParams {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

/**
 * Minimal SMTP client using Node.js built-in net/tls modules.
 * Supports implicit TLS (port 465) and plain/STARTTLS (other ports).
 * STARTTLS is attempted but gracefully skipped if the server rejects it.
 */
async function smtpSend(params: SmtpParams): Promise<void> {
  const { host, port, user, pass, from, to, subject, body } = params;
  const useImplicitTls = port === 465;

  return new Promise<void>((resolve, reject) => {
    let socket: net.Socket | tls.TLSSocket;
    let settled = false;
    let buffer = "";

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket?.destroy();
        reject(new Error(`SMTP connection to ${host}:${port} timed out`));
      }
    }, SMTP_TIMEOUT_MS);

    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        socket?.destroy();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve();
      }
    };

    /** Build the command sequence for the mail transaction. */
    const buildMailCommands = (): Array<{ cmd: string; expect: number }> => {
      const cmds: Array<{ cmd: string; expect: number }> = [];
      if (user && pass) {
        cmds.push({ cmd: `AUTH LOGIN\r\n`, expect: 334 });
        cmds.push({ cmd: `${Buffer.from(user).toString("base64")}\r\n`, expect: 334 });
        cmds.push({ cmd: `${Buffer.from(pass).toString("base64")}\r\n`, expect: 235 });
      }
      cmds.push({ cmd: `MAIL FROM:<${from}>\r\n`, expect: 250 });
      cmds.push({ cmd: `RCPT TO:<${to}>\r\n`, expect: 250 });
      cmds.push({ cmd: `DATA\r\n`, expect: 354 });

      const date = new Date().toUTCString();
      // SMTP dot-stuffing: lines starting with '.' get an extra '.' prepended (RFC 5321 §4.5.2)
      const escapedBody = body.replace(/^\./gm, "..");
      const message = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Date: ${date}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        ``,
        escapedBody,
        `.`,
        ``,
      ].join("\r\n");
      cmds.push({ cmd: message, expect: 250 });
      cmds.push({ cmd: `QUIT\r\n`, expect: 221 });
      return cmds;
    };

    // State machine phases
    type Phase = "greeting" | "ehlo" | "starttls" | "ehlo2" | "mail";
    let phase: Phase = "greeting";
    let mailCommands: Array<{ cmd: string; expect: number }> = [];
    let mailStep = 0;

    const processLine = (line: string) => {
      const code = parseInt(line.substring(0, 3), 10);
      // Multi-line responses have '-' at position 3; wait for final line
      if (line.length > 3 && line[3] === "-") return;

      switch (phase) {
        case "greeting":
          if (code !== 220) {
            fail(new Error(`SMTP greeting failed: ${line.trim()}`));
            return;
          }
          phase = "ehlo";
          socket.write(`EHLO clawhq\r\n`);
          return;

        case "ehlo":
          if (code !== 250) {
            fail(new Error(`SMTP EHLO rejected: ${line.trim()}`));
            return;
          }
          if (!useImplicitTls) {
            // Attempt STARTTLS
            phase = "starttls";
            socket.write(`STARTTLS\r\n`);
          } else {
            // Already on TLS, proceed to mail commands
            phase = "mail";
            mailCommands = buildMailCommands();
            mailStep = 0;
            sendMailNext();
          }
          return;

        case "starttls":
          if (code === 220) {
            // Server supports STARTTLS — upgrade
            const rawSocket = socket as net.Socket;
            const tlsSocket = tls.connect({ socket: rawSocket, host }, () => {
              socket = tlsSocket;
              phase = "ehlo2";
              socket.write(`EHLO clawhq\r\n`);
            });
            tlsSocket.on("error", fail);
            tlsSocket.on("data", onData);
          } else {
            // Server rejected STARTTLS — continue on plain connection
            phase = "mail";
            mailCommands = buildMailCommands();
            mailStep = 0;
            sendMailNext();
          }
          return;

        case "ehlo2":
          if (code !== 250) {
            fail(new Error(`SMTP EHLO after STARTTLS rejected: ${line.trim()}`));
            return;
          }
          phase = "mail";
          mailCommands = buildMailCommands();
          mailStep = 0;
          sendMailNext();
          return;

        case "mail": {
          const expected = mailCommands[mailStep - 1];
          if (!expected) {
            finish();
            return;
          }
          if (code !== expected.expect) {
            fail(new Error(`SMTP error: expected ${expected.expect}, got ${code} — ${line.trim()}`));
            return;
          }
          if (mailStep >= mailCommands.length) {
            finish();
            return;
          }
          sendMailNext();
          return;
        }
      }
    };

    const sendMailNext = () => {
      if (mailStep >= mailCommands.length) {
        return;
      }
      const cmd = mailCommands[mailStep];
      mailStep++;
      socket.write(cmd.cmd);
    };

    const onData = (data: Buffer) => {
      buffer += data.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.substring(0, idx + 2);
        buffer = buffer.substring(idx + 2);
        processLine(line);
      }
    };

    if (useImplicitTls) {
      socket = tls.connect({ host, port }, () => {
        // Wait for greeting
      });
    } else {
      socket = net.connect({ host, port });
    }

    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.on("timeout", () => fail(new Error(`SMTP socket timeout to ${host}:${port}`)));
    socket.on("error", fail);
    socket.on("data", onData);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}
