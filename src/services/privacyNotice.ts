// SDE T178, T604, T754: the consent notice shown in Settings and the purposes the platform may only
// pursue with the member's consent. Shared by the app and the API. Bump CONSENT_NOTICE_VERSION when the
// notice or a purpose changes: decisions given for an older version no longer count.
export const CONSENT_NOTICE_VERSION = '2026-10';

export const CONSENT_PURPOSES = ['incident_alert_emails', 'automation_event_emails', 'daily_digest_emails'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_LOCALES = ['en', 'pt-BR'] as const;

export const CONSENT_PURPOSE_TEXT: Record<ConsentPurpose, { title: string; detail: string }> = {
  incident_alert_emails: { title: 'Critical incident e-mails', detail: 'E-mail me when a device of my organization raises a critical alert.' },
  automation_event_emails: { title: 'Automation e-mails', detail: 'E-mail me when an automation changes a device setpoint or relay.' },
  daily_digest_emails: { title: 'Daily digest', detail: 'Send me one e-mail per day summarizing my organization activity.' },
};

export const CONSENT_STATEMENT = {
  categories: 'Your name and work e-mail address.',
  retention: 'Used while the consent is active; every decision is kept in your consent history as proof.',
  withdrawal: 'Withdraw any item here at any time; e-mails for that purpose stop as soon as you save.',
  thirdParties: 'Sent through the platform e-mail provider only; never sold or shared for marketing.',
};

export interface ConsentDecision {
  purpose: ConsentPurpose;
  granted: boolean;
  noticeVersion: string;
  decidedAt: string;
}
