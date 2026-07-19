# SureShot Giving Donation Bot — Bot specification

**Archetype:** custom

**Voice:** friendly and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot enabling small nonprofits and individual fundraisers to collect, track, and acknowledge donations via chat. Supports one-time/recurring payments, donor records, automated receipts, campaign management, and admin notifications with a non-technical, Telegram-native interface.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Small nonprofit organizers
- Community groups
- Individual fundraisers
- Charity volunteers
- Telegram-preferred donors

## Success criteria

- Enable seamless donation collection via Telegram chat
- Generate automated receipts for 99% of transactions
- Provide real-time admin notifications for all successful donations
- Allow campaign creation and progress tracking with minimal configuration
- Maintain donor data privacy while enabling CSV exports for accounting

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with Donate, View Campaigns, and About options
- **Donate** (button, actor: user, callback: donation:start) — Initiate donation flow with campaign selection and amount entry
  - inputs: campaign selection, amount, recurring preference, email
  - outputs: secure payment link, confirmation message
- **/campaigns** (command, actor: user, command: /campaigns) — List active fundraising campaigns with progress indicators
- **/mydonations** (command, actor: user, command: /mydonations) — View donation history and receipts
- **/admin** (command, actor: admin, command: /admin) — Admin dashboard for campaign management and data exports

## Flows

### Donation flow
_Trigger:_ /donate or Donate button

1. Campaign selection
2. Amount entry
3. Recurring preference
4. Email collection
5. Payment confirmation
6. Secure payment link delivery

_Data touched:_ Donor, Donation, Campaign

### Campaign management
_Trigger:_ /admin

1. View dashboard metrics
2. Create/edit campaigns
3. Configure admin notifications
4. Export donation data

_Data touched:_ Campaign, AdminConfig

### Receipt delivery
_Trigger:_ Post-payment confirmation

1. Generate receipt text
2. Send email if provided
3. Display chat receipt

_Data touched:_ Donation, Donor

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Donor** _(retention: persistent)_ — Telegram user who makes donations
  - fields: Telegram ID, display name, email (optional), donation history
- **Donation** _(retention: persistent)_ — Record of a donation transaction
  - fields: amount, currency, timestamp, payment status, campaign tag, donor reference
- **Campaign** _(retention: persistent)_ — Fundraising goal with tracking metrics
  - fields: goal amount, description, start/end dates, progress tracking
- **AdminConfig** _(retention: persistent)_ — Administrator settings and permissions
  - fields: admin Telegram IDs, notification preferences, data retention policy
- **WebhookEvent** _(retention: persistent)_ — Payment status updates from Stripe
  - fields: event type, timestamp, payment reference

## Integrations

- **Telegram** (required) — Bot API messaging and notifications
- **Stripe** (required) — Payment processing for one-time and recurring donations
- **Transactional Email** (optional) — Receipt delivery to donors
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure admin notification recipients
- Create/edit fundraising campaigns
- Export CSV of donations
- Manage data deletion requests
- Set default currency and payment preferences

## Notifications

- Admin chat notifications for each successful donation
- Weekly admin summary reports
- Donor receipt via chat or email
- Campaign progress updates for active campaigns

## Permissions & privacy

- Admin access restricted to owner-configured Telegram IDs
- Donor emails used only for receipts unless opted in
- Payment details never stored by bot
- Data deletion available via /admin interface

## Edge cases

- Failed payment status updates from Stripe
- Missing donor email for receipt generation
- Expired campaign access requests
- Concurrent campaign edits by admins

## Required tests

- End-to-end donation flow with payment confirmation
- Campaign creation and progress tracking
- Admin notification delivery reliability
- Data export CSV formatting
- Receipt generation with and without email

## Assumptions

- Stripe as default payment provider
- Admin notifications delivered to single configured chat
- Default currency matches owner's region
- Recurring donations use monthly cadence
