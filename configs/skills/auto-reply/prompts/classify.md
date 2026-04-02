# Auto-Reply — Classification Prompt

Review the email and determine if it's eligible for a delegated reply.

## Eligibility Criteria

The email must match one of these categories:
- `appointment-confirm`: Sender is scheduling, confirming, rescheduling, or cancelling an appointment/booking
- `vendor-reply`: Sender is a service provider, sending a bill, invoice, or account notice requiring acknowledgement
- `unsubscribe`: Sender is a mailing list and the user wants to opt out

## Disqualifiers (reject if any apply)
- Sender is noreply@ or automated system
- Reply would commit to new spending or obligations
- Content is ambiguous or requires judgment call
- Conversation is new (not a reply to something the user initiated)

## Output
Category: [appointment-confirm | vendor-reply | unsubscribe | INELIGIBLE]
Reason: [one sentence]
