/**
 * Delegation defaults — pre-built delegation categories for common use cases.
 *
 * Email delegation is the first use case. Each default category defines
 * pre-approved actions with pattern matching so the agent can act without
 * asking on routine operations.
 */

import type { DelegationCategory } from "./delegation-types.js";

// ── Email Delegation Defaults ───────────────────────────────────────────────

/** Auto-confirm appointment invitations from known contacts. */
export const APPOINTMENT_CONFIRM: DelegationCategory = {
  id: "appointment-confirm",
  name: "Appointment Confirmations",
  tool: "email",
  rules: [
    {
      action: "email:send:confirm",
      tier: "execute",
      description: "Auto-confirm meeting invitations from known contacts",
      match: [
        { field: "subject", pattern: "*invitation*" },
      ],
    },
    {
      action: "email:send:accept",
      tier: "execute",
      description: "Accept calendar invites attached to emails",
      match: [
        { field: "subject", pattern: "*calendar*" },
      ],
    },
    {
      action: "email:send:reschedule",
      tier: "propose",
      description: "Propose rescheduling when conflicts detected — wait for approval",
    },
  ],
};

/** Auto-reply to known vendor communications. */
export const VENDOR_REPLY: DelegationCategory = {
  id: "vendor-reply",
  name: "Vendor Replies",
  tool: "email",
  rules: [
    {
      action: "email:send:acknowledge",
      tier: "execute",
      description: "Acknowledge receipt of vendor invoices and delivery confirmations",
      match: [
        { field: "subject", pattern: "*invoice*" },
      ],
    },
    {
      action: "email:send:acknowledge",
      tier: "execute",
      description: "Acknowledge vendor shipping notifications",
      match: [
        { field: "subject", pattern: "*shipping*" },
      ],
    },
    {
      action: "email:send:reply",
      tier: "propose",
      description: "Draft replies to vendor questions — present for review",
    },
  ],
};

/** Auto-unsubscribe from marketing and promotional emails. */
export const UNSUBSCRIBE: DelegationCategory = {
  id: "unsubscribe",
  name: "Unsubscribe from Marketing",
  tool: "email",
  rules: [
    {
      action: "email:send:unsubscribe",
      tier: "execute",
      description: "Auto-unsubscribe from marketing emails with unsubscribe links",
      match: [
        { field: "sender", pattern: "*noreply@*" },
      ],
    },
    {
      action: "email:send:unsubscribe",
      tier: "execute",
      description: "Auto-unsubscribe from promotional newsletters",
      match: [
        { field: "subject", pattern: "*newsletter*" },
      ],
    },
    {
      action: "email:archive",
      tier: "execute",
      description: "Archive marketing emails after unsubscribing",
    },
  ],
};

/** All email delegation defaults. */
export const EMAIL_DELEGATION_DEFAULTS: readonly DelegationCategory[] = [
  APPOINTMENT_CONFIRM,
  VENDOR_REPLY,
  UNSUBSCRIBE,
];
