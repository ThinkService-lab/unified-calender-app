# Calendar Provider APIs Reference

Sources:
- https://developers.google.com/calendar/api/guides/overview
- https://developers.google.com/calendar/api/concepts/events-calendars
- https://learn.microsoft.com/en-us/graph/api/resources/calendar

## Google Calendar API

### Overview
RESTful API accessed via HTTP calls or Google Client Libraries.

### Key Resources
- **Event**: Object with title, start/end times, attendees, recurrence. Identified by unique ID.
- **Calendar**: Collection of events with metadata (summary, timezone, location).
- **CalendarList**: User's list of calendars with user-specific properties (color, reminders).
- **Setting**: User preferences (timezone, etc.).
- **ACL**: Access control rules for calendar sharing.

### Event Types
- **Single events**: One-time occurrence
- **Recurring events**: Defined by RRULE, RDATE, EXDATE (RFC 5545)
- **Timed events**: `start.dateTime` / `end.dateTime`
- **All-day events**: `start.date` / `end.date`

### Recurring Events
- Schedule defined by: start/end fields (first occurrence) + recurrence field (RRULE/RDATE/EXDATE)
- Instances act as individual events
- Exceptions: instances that differ from parent (different summary, time, attendees)
- Instance cancellations reflected in event status

### Time Zones
- Uses IANA timezone identifiers
- Calendar timezone = default for queries
- Event timezone can be specified via: offset in dateTime, timeZone field, or UTC
- Recurring events MUST have a single timezone specified

### Key API Operations
- `events.list`: List events with time range filter
- `events.get`: Get single event
- `events.insert`: Create event
- `events.update`: Update event
- `events.delete`: Delete event
- `events.instances`: Get instances of recurring event
- `calendarList.list`: List user's calendars
- `freebusy.query`: Get free/busy information

### Sync (Incremental)
- Use `syncToken` from previous list response
- Pass `syncToken` to next list call to get only changes
- If `syncToken` invalid (410 Gone), do full sync

### Push Notifications (Webhooks)
- `events.watch`: Subscribe to event changes
- Webhook delivers notification to your URL
- Must renew before expiration

## Microsoft Graph Calendar API

### Overview
Part of Microsoft Graph API. Supports user calendars and Microsoft 365 group calendars.

### Key Resources
- **calendar**: Container for events. Has properties: name, color, hexColor, owner, canEdit, canShare.
- **event**: Calendar event with standard properties.
- **calendarGroup**: Organizes user calendars (user calendars only, not groups).

### Key API Operations
- `GET /me/calendars`: List user's calendars
- `GET /me/events`: List events
- `POST /me/events`: Create event
- `PATCH /me/events/{id}`: Update event
- `DELETE /me/events/{id}`: Delete event
- `GET /me/calendarview`: Get events in time range (expands recurring)
- `POST /me/calendar/getSchedule`: Get free/busy schedule
- `POST /me/findMeetingTimes`: Suggest meeting times

### Subscriptions (Webhooks)
- `POST /subscriptions`: Create change notification subscription
- Supports: created, updated, deleted events
- Must renew before expiration (max 4230 minutes for calendar events)

### Differences from Google
- Group calendars auto-accept meetings
- No reminders for group events
- `changeKey` property for optimistic concurrency (similar to ETag)
- Supports `calendarPermissions` for sharing

## CalDAV / WebDAV Protocol

### Overview
CalDAV (RFC 4791) extends WebDAV for calendar access. Used by iCloud, Nextcloud, and generic CalDAV servers.

### Key Operations
- `PROPFIND`: Discover calendars and their properties
- `REPORT`: Query events (calendar-query, calendar-multiget)
- `PUT`: Create or update event (send full iCalendar object)
- `DELETE`: Remove event
- `GET`: Retrieve single event

### Sync
- `sync-collection` REPORT with `sync-token` for incremental sync
- No native push support — must poll
- Polling interval: ≤ 5 minutes per our requirements

### iCloud Specifics
- Uses CalDAV protocol
- Auth: Apple ID + app-specific password (or OAuth via Sign in with Apple)
- Server: `caldav.icloud.com`
- Discovery via `.well-known/caldav`

### Exchange (EWS / Graph)
- Modern: Use Microsoft Graph API (same as Outlook)
- Legacy: Exchange Web Services (EWS) SOAP API
- Supports push notifications via streaming subscriptions

## Provider Adapter Mapping

| Feature | Google | Outlook/Exchange | iCloud/CalDAV |
|---------|--------|-----------------|---------------|
| Auth | OAuth 2.0 | OAuth 2.0 (Graph) | CalDAV + app password |
| List calendars | `calendarList.list` | `GET /me/calendars` | `PROPFIND` |
| List events | `events.list` | `GET /me/calendarview` | `REPORT calendar-query` |
| Create event | `events.insert` | `POST /me/events` | `PUT` (iCal) |
| Update event | `events.update` | `PATCH /me/events/{id}` | `PUT` (iCal) |
| Delete event | `events.delete` | `DELETE /me/events/{id}` | `DELETE` |
| Incremental sync | `syncToken` | `deltaLink` | `sync-token` |
| Push notifications | `events.watch` (webhook) | Subscriptions (webhook) | Not supported (poll) |
| Free/busy | `freebusy.query` | `getSchedule` | `REPORT free-busy-query` |
| Data format | JSON | JSON | iCalendar (RFC 5545) |
