import '@/server/only';
import { getEnv } from '@/lib/env';

/**
 * Outbound email.
 *
 * The application never talks to a mail provider directly — it talks to this
 * interface, and a driver is chosen from configuration. That matters for two
 * reasons beyond tidiness:
 *
 *  1. Password reset and verification flows are fully testable without a
 *     provider account. The `console` driver records what would have been sent,
 *     so integration tests assert on real message content.
 *  2. Delivery credentials live only in environment variables. No key is ever
 *     read from, or written to, the repository.
 *
 * With no provider configured the system does not silently pretend to send
 * mail: `console` logs the message and the reset endpoint still behaves
 * correctly, which is the honest behaviour for a deployment whose operator has
 * not finished wiring email yet.
 */

export type Mail = {
  to: string;
  subject: string;
  /** Plain text is mandatory; HTML is an enhancement, never the only content. */
  text: string;
  html?: string;
};

export interface MailDriver {
  readonly name: string;
  send(message: Mail): Promise<{ id: string | null }>;
}

/* --------------------------------------------------------------- console -- */

/** What the console driver captured, for tests and local development. */
export type CapturedMail = Mail & { at: Date };

declare global {
  var __caresyncMailbox: CapturedMail[] | undefined;
}

const mailbox: CapturedMail[] = global.__caresyncMailbox ?? [];
global.__caresyncMailbox = mailbox;

/** Test/dev helper: everything the console driver has "sent". */
export const outbox = {
  all: () => [...mailbox],
  lastTo: (email: string) =>
    [...mailbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase()) ?? null,
  clear: () => { mailbox.length = 0; },
};

class ConsoleMailDriver implements MailDriver {
  readonly name = 'console';

  async send(message: Mail) {
    mailbox.push({ ...message, at: new Date() });
    if (mailbox.length > 200) mailbox.splice(0, mailbox.length - 200);
    // Subject and recipient only. The body of a reset mail contains a live
    // credential, and logs are the last place that should exist.
    console.info(`[mail:console] to=${message.to} subject=${JSON.stringify(message.subject)}`);
    return { id: null };
  }
}

/* ---------------------------------------------------------------- resend -- */

class ResendMailDriver implements MailDriver {
  readonly name = 'resend';

  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: Mail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!res.ok) {
      // Provider errors can echo the payload back. Never let that reach a log.
      throw new Error(`Resend rejected the message with status ${res.status}`);
    }
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? null };
  }
}

/* ------------------------------------------------------------------ smtp -- */

class SmtpMailDriver implements MailDriver {
  readonly name = 'smtp';

  constructor(private readonly config: { url: string; from: string }) {}

  async send(message: Mail) {
    // nodemailer is an optional peer dependency: operators who use SMTP install
    // it, everyone else does not carry it. The specifier is held in a variable
    // so neither TypeScript nor the bundler tries to resolve it at build time —
    // a missing package must be a clear runtime message, not a broken build.
    type Transport = {
      sendMail(o: Record<string, unknown>): Promise<{ messageId?: string }>;
    };
    type Nodemailer = { createTransport(url: string): Transport };

    const specifier = 'nodemailer';
    let nodemailer: Nodemailer;
    try {
      nodemailer = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as unknown as Nodemailer;
    } catch {
      throw new Error(
        'MAIL_DRIVER=smtp requires the "nodemailer" package. Run `npm install nodemailer`, '
        + 'or use MAIL_DRIVER=resend / console.',
      );
    }
    const transport = nodemailer.createTransport(this.config.url);
    const info = await transport.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { id: info.messageId ?? null };
  }
}

/* -------------------------------------------------------------- selection -- */

let cached: MailDriver | null = null;

export function mailer(): MailDriver {
  if (cached) return cached;
  const env = getEnv();

  switch (env.MAIL_DRIVER) {
    case 'resend':
      if (!env.RESEND_API_KEY) {
        throw new Error('MAIL_DRIVER=resend but RESEND_API_KEY is not set.');
      }
      cached = new ResendMailDriver(env.RESEND_API_KEY, env.MAIL_FROM);
      break;
    case 'smtp':
      if (!env.SMTP_URL) {
        throw new Error('MAIL_DRIVER=smtp but SMTP_URL is not set.');
      }
      cached = new SmtpMailDriver({ url: env.SMTP_URL, from: env.MAIL_FROM });
      break;
    default:
      cached = new ConsoleMailDriver();
  }
  return cached;
}

/** Tests swap drivers between cases. */
export function resetMailer() { cached = null; }

/**
 * Send, but never let a mail failure break the flow that triggered it.
 *
 * A user who registers successfully should not see a 500 because the mail
 * provider is having a bad afternoon — their account exists and the token is
 * valid, and they can request another email. The failure is logged for the
 * operator instead.
 */
export async function sendQuietly(message: Mail): Promise<boolean> {
  try {
    await mailer().send(message);
    return true;
  } catch (err) {
    console.error(`[mail] delivery failed for subject ${JSON.stringify(message.subject)}:`,
      err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}
