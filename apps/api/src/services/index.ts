import type { Deps } from '../deps.js';
import { AuthService } from './auth.service.js';
import { GoodsService } from './goods.service.js';
import { JobsService } from './jobs.service.js';
import { NotificationService } from './notification.service.js';
import { OrderService } from './order.service.js';
import { PartyService } from './party.service.js';
import { ReminderService } from './reminder.service.js';
import { ReportService } from './report.service.js';
import { RequestService } from './request.service.js';
import { SettingsService } from './settings.service.js';

export function createServices(deps: Deps) {
  const settings = new SettingsService(deps);
  const notifications = new NotificationService(deps, settings);
  const orders = new OrderService(deps, notifications);
  const reminders = new ReminderService(deps, notifications);
  return {
    auth: new AuthService(deps),
    settings,
    notifications,
    parties: new PartyService(deps, settings),
    goods: new GoodsService(deps),
    orders,
    requests: new RequestService(deps, notifications, orders),
    reminders,
    reports: new ReportService(deps, orders, notifications),
    jobs: new JobsService(deps, notifications, reminders, settings),
  };
}

export type Services = ReturnType<typeof createServices>;
