# RFC 5545 - iCalendar Specification Summary

Source: https://www.rfc-editor.org/rfc/rfc5545

## Overview
RFC 5545 defines the iCalendar data format for representing and exchanging calendaring and scheduling information (events, to-dos, journal entries, free/busy info).

## Key Concepts

### Content Lines
- Delimited by CRLF
- Lines SHOULD NOT exceed 75 octets
- Long lines folded with CRLF + single whitespace (SPACE or HTAB)
- Property names, parameter names, enumerated values are case-insensitive
- Other property values are case-sensitive

### iCalendar Object Structure
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//...//EN
BEGIN:VEVENT
...
END:VEVENT
END:VCALENDAR
```

Required: PRODID, VERSION, at least one calendar component.

## Calendar Components

### VEVENT (Events)
- Required: DTSTAMP, UID
- Required if no METHOD: DTSTART
- Optional: DTEND or DURATION (not both), RRULE, SUMMARY, DESCRIPTION, LOCATION, ATTENDEE, etc.
- DTEND is non-inclusive end

### VTODO (To-Dos)
- Required: DTSTAMP, UID
- Optional: DUE or DURATION (not both, DURATION requires DTSTART)

### VJOURNAL (Journal Entries)
- Required: DTSTAMP, UID
- Does not consume time (transparent to free/busy)

### VFREEBUSY (Free/Busy)
- Required: DTSTAMP, UID
- No recurrence properties allowed

### VTIMEZONE (Time Zones)
- Required: TZID, at least one STANDARD or DAYLIGHT sub-component
- Sub-components require: DTSTART, TZOFFSETFROM, TZOFFSETTO

## Date-Time Formats

### Three Forms
1. **Local time** (floating): `19980118T230000` — not bound to any timezone
2. **UTC time**: `19980119T070000Z` — absolute time
3. **Local + timezone**: `TZID=America/New_York:19980119T020000`

### Duration Format
```
P15DT5H0M20S  (15 days, 5 hours, 20 seconds)
P7W           (7 weeks)
PT1H30M       (1 hour 30 minutes)
```

## Recurrence Rules (RRULE)
- FREQ is required (SECONDLY, MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY, YEARLY)
- UNTIL or COUNT (not both) to bound recurrence
- INTERVAL defaults to 1
- BYxxx parts: BYDAY, BYMONTHDAY, BYMONTH, BYHOUR, BYMINUTE, BYSECOND, BYSETPOS, BYWEEKNO, BYYEARDAY
- WKST (week start, default MO)
- Invalid dates (e.g., Feb 30) are silently skipped
- BYxxx evaluation order: BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS

### Examples
```
FREQ=DAILY;COUNT=10;INTERVAL=2          (every other day, 10 times)
FREQ=WEEKLY;BYDAY=TU,TH;COUNT=10       (Tue+Thu for 5 weeks)
FREQ=MONTHLY;BYDAY=1FR                  (first Friday monthly)
FREQ=YEARLY;BYMONTH=3;BYDAY=TH         (every Thursday in March)
```

## Key Properties

### Attendee
- CAL-ADDRESS value type (mailto: URI)
- Parameters: CN, ROLE, PARTSTAT, RSVP, CUTYPE, DELEGATED-TO, DELEGATED-FROM, SENT-BY, DIR

### Recurrence-ID
- Identifies specific instance of recurring component
- RANGE=THISANDFUTURE for range modifications

### Exception Dates (EXDATE)
- Excludes specific dates from recurrence set
- Takes precedence over RRULE and RDATE

## Text Escaping
- `\\` encodes `\`
- `\;` encodes `;`
- `\,` encodes `,`
- `\n` or `\N` encodes newline
- COLON is NOT escaped

## Character Set
- Default: UTF-8
- Applications MUST accept UTF-8 and US-ASCII

## Security Considerations
- Calendar data is privacy-sensitive
- Protocol-level security (TLS, etc.) is responsibility of transport layer
- Implementations should be cautious with alarm components from untrusted sources

## Implementation Notes
- Preserve unknown (x-name, iana-token) properties and parameters
- UID must be globally unique (recommend: datetime@domain format)
- UID must support at least 255 octets
- SEQUENCE starts at 0, incremented by Organizer on significant revisions
