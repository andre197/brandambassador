import { CONTRACT, type SettingsInput } from '@ba/shared';
import { one, type Queryable } from '../db/pool.js';
import type { Deps } from '../deps.js';

export interface AppSettings {
  default_commission_bp: number;
  reminder_days_before: number;
  /** Where admin notifications are emailed (besides the admin accounts that have an email login). */
  notify_emails: string[];
  company_name: string | null;
  company_eik: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
}

const DEFAULTS: AppSettings = {
  default_commission_bp: CONTRACT.defaultCommissionBp,
  reminder_days_before: 3,
  notify_emails: [],
  company_name: null,
  company_eik: null,
  company_address: null,
  company_phone: null,
  company_email: null,
};

export class SettingsService {
  constructor(private readonly deps: Pick<Deps, 'db'>) {}

  async get(db: Queryable = this.deps.db): Promise<AppSettings> {
    const row = await one<{ value: Partial<AppSettings> }>(db, `SELECT value FROM settings WHERE key = 'app'`);
    return { ...DEFAULTS, ...(row?.value ?? {}) };
  }

  async update(input: SettingsInput): Promise<AppSettings> {
    const { default_commission_percent, ...rest } = input;
    const value: AppSettings = { ...(await this.get()), ...rest, default_commission_bp: default_commission_percent };
    await this.deps.db.query(
      `INSERT INTO settings (key, value) VALUES ('app', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(value)],
    );
    return value;
  }
}
