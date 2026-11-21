import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../../config.js';
import type { Logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe for the newsletter. */
  headers?: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** Development: prints emails to the log instead of sending them. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  constructor(private readonly log: Logger) {}
  async send(msg: EmailMessage): Promise<void> {
    this.log.info({ email: { to: msg.to, subject: msg.subject } }, `\n──── email ────\nTo: ${[msg.to].flat().join(', ')}\nSubject: ${msg.subject}\n\n${msg.text}\n───────────────`);
  }
}

/** Tests: keeps sent emails in memory. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    config: Pick<
      Config,
      'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_OAUTH_CLIENT_ID' | 'SMTP_OAUTH_CLIENT_SECRET' | 'SMTP_OAUTH_REFRESH_TOKEN'
    >,
    private readonly from: string,
  ) {
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: smtpAuth(config),
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
  }
}

/**
 * SMTP login: OAuth2 (XOAUTH2, e.g. Gmail - nodemailer refreshes the access token itself) when
 * the SMTP_OAUTH_* settings are set, otherwise user + password, otherwise none.
 */
export function smtpAuth(
  config: Pick<Config, 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_OAUTH_CLIENT_ID' | 'SMTP_OAUTH_CLIENT_SECRET' | 'SMTP_OAUTH_REFRESH_TOKEN'>,
) {
  if (!config.SMTP_USER) return undefined;
  if (config.SMTP_OAUTH_REFRESH_TOKEN) {
    return {
      type: 'OAuth2' as const,
      user: config.SMTP_USER,
      clientId: config.SMTP_OAUTH_CLIENT_ID,
      clientSecret: config.SMTP_OAUTH_CLIENT_SECRET,
      refreshToken: config.SMTP_OAUTH_REFRESH_TOKEN,
    };
  }
  return { user: config.SMTP_USER, pass: config.SMTP_PASS };
}

export function createEmailProvider(config: Config, log: Logger): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmailProvider(config, config.EMAIL_FROM);
    case 'memory':
      return new MemoryEmailProvider();
    default:
      return new ConsoleEmailProvider(log);
  }
}
