# Notification Specification

Document ID: FDP-NOTIFY-001  
Status: Draft  
Milestone: Foundation

## Purpose

Notifications deliver time-sensitive recommendations, alerts, reports, and approval requests to users.

Notifications begin in Version 1. MVP may generate reports but does not require push delivery.

## Notification Types

- Morning report.
- Breaking injury alert.
- Projection change alert.
- Waiver deadline reminder.
- Lineup lock reminder.
- Trade opportunity alert.
- Approval request.
- Weekly planning report.
- Playoff planning alert.

## Delivery Channels

Future supported channels:

- Email.
- SMS.
- Push notification.
- Webhook.
- Slack.
- Teams.
- In-app notification.

## Notification Contract

Each notification includes:

- notification_id
- user_id
- league_id
- priority
- type
- title
- body
- related_recommendation_ids
- evidence_refs
- action_required
- expires_at

## Delivery Safety

- Users control channel preferences.
- Critical alerts require deduplication.
- Notification content must avoid secrets and access tokens.
- Approval notifications must link to a full explanation before any action can be approved.

## Version 1 Acceptance Criteria

- Scheduled morning report can be delivered.
- Breaking alerts can be triggered by news or projection changes.
- User can disable or configure notification types.
- Delivery attempts are logged with status and retry information.
