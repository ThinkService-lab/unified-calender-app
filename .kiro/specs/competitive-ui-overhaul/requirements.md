# Requirements Document: Competitive UI Overhaul

## Introduction

The Unified Calendar App has a strong backend — offline-first sync, multi-provider support, AI scheduling, conflict detection — but the UI layer uses static `StyleSheet`-only styling with no animations, no gesture interactions, and a generic Google Calendar-inspired color palette. This feature overhaul invests in the front-end to make the app competitive with premium calendar apps (Fantastical, Amie, Notion Calendar, Morgen) by establishing a distinct visual identity, adding fluid animations and gesture-driven interactions, implementing natural language event creation, and fixing the month view crash. The goal is a UI that makes people *want* to use the app and pay for it.

## Glossary

- **Animation_Engine**: The `react-native-reanimated` based module responsible for spring animations, layout transitions, and gesture-driven motion across all calendar views.
- **Gesture_Handler**: The module built on `react-native-gesture-handler` that processes pan, long-press, and swipe gestures on calendar events and views.
- **Design_Token_System**: The centralized theming module that defines the app's custom color palette, typography scale, spacing scale, border radii, and shadow definitions — replacing the current Google Calendar-derived styles.
- **NL_Parser**: The natural language event creation parser that converts free-text input (e.g., "Lunch with Sarah tomorrow at noon for 1 hour at Cafe Roma") into structured `CalendarEvent` fields.
- **NL_Printer**: The module that converts structured `CalendarEvent` fields back into a human-readable natural language string.
- **Quick_Create_Bar**: The text input component displayed at the top of calendar views that accepts natural language event descriptions and creates events from them.
- **Drag_Reschedule_Controller**: The gesture-based controller that allows users to long-press an event in day or week view and drag it to a new time slot to reschedule.
- **Micro_Interaction_System**: The collection of small, purposeful animations applied to UI actions such as event creation confirmation, view mode transitions, pull-to-refresh sync, and calendar toggle feedback.
- **Month_View**: The existing `MonthView` component that renders a monthly grid with event dots and previews.
- **Day_View**: The existing `DayView` component that renders a single-day timeline with hourly slots.
- **Week_View**: The existing `WeekView` component that renders a 7-day grid with time slots.
- **View_Transition_Animator**: The module that orchestrates animated transitions when switching between day, week, month, and agenda views.
- **Event_Card**: The visual representation of a calendar event within any view, styled with the Design_Token_System colors and supporting micro-interactions.
- **Reduced_Motion_Mode**: The accessibility mode that disables or simplifies all animations when the user's OS-level `prefers-reduced-motion` setting is enabled.
- **Keyboard_Shortcut_Manager**: The module that registers, resolves, and dispatches keyboard shortcuts on web and desktop platforms, mapping single-key and modifier-key combinations to calendar actions.
- **Shortcut_Help_Overlay**: The modal overlay that displays all available keyboard shortcuts grouped by category, accessible via the `?` key.
- **Inline_Event_Creator**: The interaction controller that allows users to click or click-and-drag on empty time slots in the Day_View or Week_View to create a new event at the selected time range.
- **Drag_Resize_Controller**: The gesture-based controller that allows users to drag the bottom edge of an Event_Card in the Day_View or Week_View to extend or shorten the event's duration.
- **Haptic_Feedback_Engine**: The module that triggers platform-native haptic feedback patterns (light, medium, heavy, selection) on iOS and Android devices during gesture interactions.
- **Swipe_Navigation_Controller**: The gesture controller that handles horizontal swipe gestures on mobile devices to navigate forward and backward in time across all calendar views.
- **Empty_State_View**: The component that renders contextual illustrations, messages, and quick-action prompts when a calendar view contains no events.
- **Recurrence_Expression**: A natural language phrase describing a repeating pattern (e.g., "every weekday", "every 2 weeks", "monthly on the 15th") that the NL_Parser converts into an RFC 5545 RRULE.
- **NL_Recurrence_Printer**: The module that converts a structured RRULE back into a human-readable recurrence expression string.
- **Live_Preview_Panel**: The real-time preview component displayed below the Quick_Create_Bar that updates parsed event fields (title, date, time, duration, location) as the user types.
- **Calendar_Sidebar**: The left-side panel displayed on tablet and desktop breakpoints containing a mini month navigator, calendar account visibility toggles, and an upcoming events list.
- **Mini_Month_Navigator**: The compact month grid within the Calendar_Sidebar that allows quick date jumping by tapping a day.
- **Onboarding_Animator**: The module that orchestrates animated sequences during the first-run experience, showcasing key app capabilities through guided, animated walkthroughs.
- **First_Run_Experience**: The animated onboarding flow presented to new users on their first app launch, consisting of a sequence of animated screens that highlight core features before transitioning to the main calendar view.

## Requirements

### Requirement 1: Design Token System and Visual Identity

**User Story:** As a user, I want the calendar app to have a distinctive, polished visual identity with warm, modern aesthetics, so that it feels premium and differentiated from generic calendar apps.

#### Acceptance Criteria

1. THE Design_Token_System SHALL define a custom color palette of at least 15 distinct event colors that meet WCAG 2.1 AA contrast ratios (4.5:1 for text, 3:1 for UI elements) against both light and dark backgrounds.
2. THE Design_Token_System SHALL define a typography scale with at least 6 named sizes (caption, body, subheading, heading, title, display) using a single primary font family and a monospace fallback.
3. THE Design_Token_System SHALL define a spacing scale based on a 4px base unit with at least 8 named tokens (xs, sm, md, lg, xl, 2xl, 3xl, 4xl).
4. THE Design_Token_System SHALL define border radius tokens (none, sm, md, lg, full) and elevation/shadow tokens (none, sm, md, lg) for consistent surface styling.
5. THE Design_Token_System SHALL export all tokens as a single importable TypeScript module that all UI components consume, replacing hardcoded style values.
6. WHEN a component renders an Event_Card, THE Event_Card SHALL use the Design_Token_System color palette for its background, border, and text colors instead of the current Google Calendar-derived palette.
7. THE Design_Token_System SHALL support a dark mode variant where all color tokens have corresponding dark-mode values.
8. WHILE the user's color scheme preference is set to 'system' AND the user changes the OS-level dark mode setting while the app is running, THE Design_Token_System SHALL update all consumer components to use the new token set within 500 milliseconds without requiring an app restart.

### Requirement 2: Animation Engine Integration

**User Story:** As a user, I want smooth, fluid animations throughout the calendar, so that the app feels responsive and alive rather than static and utilitarian.

#### Acceptance Criteria

1. THE Animation_Engine SHALL use `react-native-reanimated` for all animations, running them on the native UI thread to maintain 60fps on both mobile and web.
2. WHEN a user creates a new event, THE Micro_Interaction_System SHALL play a creation confirmation animation (scale-up with fade-in) on the new Event_Card that completes within 300 milliseconds.
3. WHEN a user toggles a calendar account's visibility, THE Micro_Interaction_System SHALL animate the affected Event_Cards with a fade-out or fade-in transition that completes within 200 milliseconds.
4. WHEN a user pulls down on any scrollable calendar view, THE Micro_Interaction_System SHALL play a pull-to-refresh animation that triggers a sync operation and displays a sync progress indicator.
5. WHILE Reduced_Motion_Mode is active, THE Animation_Engine SHALL disable all spring animations and layout transitions, applying instant state changes instead.
6. THE Animation_Engine SHALL provide a shared `useAnimatedStyle` and `withSpring` configuration module that all animated components import for consistent motion curves (damping: 15, stiffness: 150 as defaults).

### Requirement 3: View Transition Animations

**User Story:** As a user, I want animated transitions when switching between day, week, month, and agenda views, so that I maintain spatial context and the experience feels cohesive.

#### Acceptance Criteria

1. WHEN a user switches from one view mode to another via the ViewModeSwitcher, THE View_Transition_Animator SHALL animate the outgoing view out and the incoming view in using a crossfade with a subtle horizontal slide.
2. THE View_Transition_Animator SHALL complete each view transition within 350 milliseconds.
3. WHEN a user taps a day in the Month_View to navigate to the Day_View, THE View_Transition_Animator SHALL animate a zoom-in transition from the tapped day cell to the full Day_View.
4. WHILE Reduced_Motion_Mode is active, THE View_Transition_Animator SHALL skip all transition animations and display the target view immediately.
5. WHILE a view transition animation is in progress, THE View_Transition_Animator SHALL ignore additional view switch requests until the current transition completes.

### Requirement 4: Drag-to-Reschedule Events

**User Story:** As a user, I want to long-press and drag events to new time slots in day and week views, so that I can quickly reschedule without opening the event editor.

#### Acceptance Criteria

1. WHEN a user long-presses an Event_Card in the Day_View or Week_View for at least 300 milliseconds, THE Drag_Reschedule_Controller SHALL activate drag mode, visually lifting the event with an elevation increase and a subtle scale-up animation.
2. WHILE the user drags an Event_Card, THE Drag_Reschedule_Controller SHALL display a time indicator showing the new proposed start and end times, snapping to 15-minute increments.
3. WHEN the user releases the dragged Event_Card, THE Drag_Reschedule_Controller SHALL update the event's start and end times to the drop position and persist the change via the existing event update flow.
4. IF the user drags an Event_Card to a time slot that conflicts with another event, THEN THE Drag_Reschedule_Controller SHALL display a visual conflict indicator on the overlapping region.
5. IF the user releases the drag outside the valid time grid area, THEN THE Drag_Reschedule_Controller SHALL animate the Event_Card back to its original position without making changes.
6. WHILE Reduced_Motion_Mode is active, THE Drag_Reschedule_Controller SHALL still support drag-to-reschedule but skip the lift animation and scale-up, using only a border highlight to indicate drag mode.
7. THE Drag_Reschedule_Controller SHALL complete the drop-and-persist operation within 200 milliseconds of the user releasing the event.

### Requirement 5: Natural Language Event Creation

**User Story:** As a user, I want to type a natural language description like "Lunch with Sarah tomorrow at noon for 1 hour at Cafe Roma" and have the app create a structured event from it, so that event creation is fast and frictionless.

#### Acceptance Criteria

1. THE Quick_Create_Bar SHALL be displayed as a persistent text input at the top of the Day_View, Week_View, and Agenda_View.
2. WHEN a user submits text in the Quick_Create_Bar, THE NL_Parser SHALL extract event fields (title, date, time, duration, location, attendees) from the natural language input and populate a new event.
3. THE NL_Parser SHALL support the following date references: "today", "tomorrow", "next Monday" through "next Sunday", "next week", explicit dates in "Month Day" format (e.g., "January 15"), and relative references like "in 3 days".
4. THE NL_Parser SHALL support time expressions: "at noon", "at 3pm", "at 15:00", "morning" (mapped to 9:00 AM), "afternoon" (mapped to 2:00 PM), "evening" (mapped to 6:00 PM).
5. THE NL_Parser SHALL support duration expressions: "for 30 minutes", "for 1 hour", "for 2 hours", "for 1.5 hours". WHEN no duration is specified, THE NL_Parser SHALL default to 60 minutes.
6. THE NL_Parser SHALL extract location from "at <location>" phrases appearing after the time expression.
7. THE NL_Parser SHALL extract attendee names from "with <name>" phrases.
8. WHEN the NL_Parser cannot determine a required field (date or time), THE Quick_Create_Bar SHALL open the EventEditor pre-populated with the fields that were successfully parsed, allowing the user to fill in the rest.
9. THE NL_Printer SHALL convert a structured CalendarEvent back into a human-readable natural language string.
10. FOR ALL valid natural language inputs that the NL_Parser successfully parses into a CalendarEvent, parsing the NL_Printer output of that CalendarEvent SHALL produce an equivalent CalendarEvent (round-trip property).

### Requirement 6: Month View Stability Fix

**User Story:** As a user, I want the month view to render reliably without crashes, so that I can use this core calendar feature with confidence.

#### Acceptance Criteria

1. WHEN the Month_View receives an empty events array, THE Month_View SHALL render the month grid with day numbers and no event indicators, without throwing an error.
2. WHEN the Month_View receives events that span across month boundaries, THE Month_View SHALL display those events only on the days that fall within the visible month grid, without throwing an error.
3. WHEN the Month_View receives a date in any valid month and year (January 1970 through December 2099), THE Month_View SHALL render the correct number of weeks and days for that month.
4. WHEN the user navigates rapidly between months (more than 5 navigation actions within 2 seconds), THE Month_View SHALL render each requested month without crashing or displaying stale data.
5. THE Month_View SHALL render a full month of up to 500 events within 1 second on a mid-range device.

### Requirement 7: Event Card Micro-Interactions

**User Story:** As a user, I want subtle visual feedback when I interact with events, so that the app feels responsive and tactile.

#### Acceptance Criteria

1. WHEN a user presses down on an Event_Card, THE Micro_Interaction_System SHALL apply a scale-down animation (to 0.97) that completes within 100 milliseconds.
2. WHEN a user releases an Event_Card press, THE Micro_Interaction_System SHALL apply a spring-back animation to scale 1.0 that completes within 150 milliseconds.
3. WHEN a user successfully deletes an event, THE Micro_Interaction_System SHALL animate the Event_Card with a shrink-and-fade-out transition that completes within 250 milliseconds before removing it from the view.
4. WHEN a new event appears in the view due to a sync operation, THE Micro_Interaction_System SHALL animate the new Event_Card with a slide-in-from-right and fade-in transition that completes within 300 milliseconds.
5. WHILE Reduced_Motion_Mode is active, THE Micro_Interaction_System SHALL skip all Event_Card animations and apply instant visual state changes.

### Requirement 8: Animated View Mode Switcher

**User Story:** As a user, I want the view mode switcher to have a smooth sliding indicator, so that the active view is clearly communicated through motion.

#### Acceptance Criteria

1. THE ViewModeSwitcher SHALL display an animated sliding indicator behind the active tab that moves to the newly selected tab using a spring animation.
2. WHEN a user selects a new view mode tab, THE ViewModeSwitcher sliding indicator SHALL animate to the new position within 250 milliseconds.
3. THE ViewModeSwitcher SHALL use Design_Token_System colors for the indicator, active text, and inactive text.
4. WHILE Reduced_Motion_Mode is active, THE ViewModeSwitcher SHALL move the indicator instantly without animation.

### Requirement 9: Pull-to-Refresh Sync

**User Story:** As a user, I want to pull down on the calendar to trigger a manual sync, so that I can refresh my events on demand with satisfying visual feedback.

#### Acceptance Criteria

1. WHEN a user pulls down on the Day_View, Week_View, Month_View, or Agenda_View by at least 80 pixels, THE Micro_Interaction_System SHALL trigger a sync operation via the existing SyncEngine.
2. WHILE a pull-to-refresh sync is in progress, THE Micro_Interaction_System SHALL display a rotating sync indicator at the top of the view.
3. WHEN the sync operation completes, THE Micro_Interaction_System SHALL dismiss the sync indicator with a fade-out animation within 200 milliseconds.
4. IF the sync operation fails, THEN THE Micro_Interaction_System SHALL display a brief error banner for 3 seconds before auto-dismissing.
5. WHILE a sync operation is already in progress, THE Micro_Interaction_System SHALL ignore additional pull-to-refresh gestures.

### Requirement 10: Current Time Indicator

**User Story:** As a user, I want to see a clear "now" line on the day and week views, so that I can quickly orient myself in the timeline.

#### Acceptance Criteria

1. THE Day_View and Week_View SHALL display a horizontal line at the current time position, styled with the Design_Token_System primary accent color and a small circular dot at the left edge.
2. THE current time indicator SHALL update its position every 60 seconds without re-rendering the entire view.
3. WHEN the current day is visible in the Week_View, THE current time indicator SHALL appear only in the column for the current day.

### Requirement 11: Keyboard Shortcuts (Web/Desktop)

**User Story:** As a desktop or web user, I want to use keyboard shortcuts for common calendar actions, so that I can navigate and create events without reaching for the mouse.

#### Acceptance Criteria

1. WHEN the user presses the `C` key on web or desktop, THE Keyboard_Shortcut_Manager SHALL open the Quick_Create_Bar with focus in the text input.
2. WHEN the user presses the `T` key on web or desktop, THE Keyboard_Shortcut_Manager SHALL navigate the calendar to today's date.
3. WHEN the user presses the `1` key, THE Keyboard_Shortcut_Manager SHALL switch to the Day_View. WHEN the user presses `2`, THE Keyboard_Shortcut_Manager SHALL switch to the Week_View. WHEN the user presses `3`, THE Keyboard_Shortcut_Manager SHALL switch to the Month_View. WHEN the user presses `4`, THE Keyboard_Shortcut_Manager SHALL switch to the Agenda_View.
4. WHEN the user presses the left arrow key on web or desktop, THE Keyboard_Shortcut_Manager SHALL navigate the calendar one unit backward (one day in Day_View, one week in Week_View, one month in Month_View). WHEN the user presses the right arrow key, THE Keyboard_Shortcut_Manager SHALL navigate one unit forward.
5. WHEN the user presses the `?` key on web or desktop, THE Keyboard_Shortcut_Manager SHALL display the Shortcut_Help_Overlay listing all available shortcuts grouped by category (navigation, creation, view switching).
6. WHEN the user presses the `Escape` key while the Shortcut_Help_Overlay is visible, THE Keyboard_Shortcut_Manager SHALL dismiss the overlay.
7. WHILE a text input field has focus (Quick_Create_Bar, EventEditor, or any form field), THE Keyboard_Shortcut_Manager SHALL suppress single-key shortcuts to prevent conflicts with text entry.
8. THE Keyboard_Shortcut_Manager SHALL announce shortcut actions to screen readers using ARIA live regions so that assistive technology users receive equivalent feedback.

### Requirement 12: Inline Click-to-Create on Time Slots

**User Story:** As a user, I want to click on an empty time slot in day or week view to create an event starting at that time, so that event creation is spatially intuitive and fast.

#### Acceptance Criteria

1. WHEN a user clicks on an empty time slot in the Day_View or Week_View, THE Inline_Event_Creator SHALL open a new event form pre-populated with the start time corresponding to the clicked slot, snapped to the nearest 15-minute increment.
2. WHEN a user clicks and drags vertically across multiple time slots in the Day_View or Week_View, THE Inline_Event_Creator SHALL create a new event with the start time at the drag start position and the end time at the drag release position, both snapped to 15-minute increments.
3. WHILE the user drags to select a time range, THE Inline_Event_Creator SHALL display a highlighted overlay on the selected time range showing the proposed start and end times.
4. WHEN the user releases the drag, THE Inline_Event_Creator SHALL display an inline event creation popover at the selected time range with a title input field focused for immediate typing.
5. WHEN the user submits the inline popover (by pressing Enter or tapping a confirm button), THE Inline_Event_Creator SHALL create the event via the existing event creation flow and display the new Event_Card in the time slot.
6. IF the user presses Escape or clicks outside the inline popover without submitting, THEN THE Inline_Event_Creator SHALL dismiss the popover and remove the highlighted overlay without creating an event.
7. THE Inline_Event_Creator SHALL set a minimum event duration of 15 minutes for click-to-create (single click without drag).

### Requirement 13: Drag to Resize Event Duration

**User Story:** As a user, I want to drag the bottom edge of an event to extend or shorten its duration, so that I can adjust event length without opening the editor.

#### Acceptance Criteria

1. WHEN a user presses and holds the bottom edge (bottom 8 pixels) of an Event_Card in the Day_View or Week_View, THE Drag_Resize_Controller SHALL activate resize mode, displaying a resize handle indicator at the bottom edge.
2. WHILE the user drags the bottom edge of an Event_Card, THE Drag_Resize_Controller SHALL update the event's visual height in real time and display the new proposed end time, snapping to 15-minute increments.
3. WHEN the user releases the drag, THE Drag_Resize_Controller SHALL update the event's end time to the new position and persist the change via the existing event update flow.
4. THE Drag_Resize_Controller SHALL enforce a minimum event duration of 15 minutes, preventing the user from dragging the bottom edge above the 15-minute mark from the start time.
5. IF the user drags the bottom edge to a time that conflicts with a subsequent event, THEN THE Drag_Resize_Controller SHALL display a visual conflict indicator on the overlapping region.
6. WHILE Reduced_Motion_Mode is active, THE Drag_Resize_Controller SHALL still support drag-to-resize but skip the resize handle animation, using only a static border highlight to indicate resize mode.
7. THE Drag_Resize_Controller SHALL complete the resize-and-persist operation within 200 milliseconds of the user releasing the edge.

### Requirement 14: Haptic Feedback on Mobile

**User Story:** As a mobile user, I want to feel haptic feedback during key interactions, so that the app feels tactile and alive on touch devices.

#### Acceptance Criteria

1. WHEN a user long-presses an Event_Card on a mobile device to initiate drag-to-reschedule, THE Haptic_Feedback_Engine SHALL trigger a medium-intensity haptic pulse.
2. WHEN a user successfully drops a dragged Event_Card onto a new time slot on a mobile device, THE Haptic_Feedback_Engine SHALL trigger a light-intensity haptic confirmation pulse.
3. WHEN a user creates a new event via the Quick_Create_Bar on a mobile device, THE Haptic_Feedback_Engine SHALL trigger a success haptic pattern (two short light pulses).
4. WHEN a user initiates drag-to-resize on a mobile device, THE Haptic_Feedback_Engine SHALL trigger a selection haptic tick at each 15-minute snap point during the drag.
5. WHILE the user's OS-level haptic feedback setting is disabled, THE Haptic_Feedback_Engine SHALL skip all haptic triggers without errors.
6. THE Haptic_Feedback_Engine SHALL use platform-native haptic APIs (iOS UIImpactFeedbackGenerator, Android VibrationEffect) and fall back to a no-op on platforms that do not support haptics (web).

### Requirement 15: Swipe Gestures for Navigation

**User Story:** As a mobile user, I want to swipe left and right to navigate forward and backward in time, so that browsing my calendar feels natural and fluid.

#### Acceptance Criteria

1. WHEN a user swipes left on the Day_View, Week_View, or Month_View on a mobile device, THE Swipe_Navigation_Controller SHALL navigate one unit forward in time (next day, next week, or next month respectively).
2. WHEN a user swipes right on the Day_View, Week_View, or Month_View on a mobile device, THE Swipe_Navigation_Controller SHALL navigate one unit backward in time (previous day, previous week, or previous month respectively).
3. THE Swipe_Navigation_Controller SHALL require a minimum horizontal swipe distance of 50 pixels and a horizontal velocity greater than the vertical velocity to distinguish navigation swipes from vertical scrolling.
4. WHILE the user swipes, THE Swipe_Navigation_Controller SHALL animate the current view sliding out in the swipe direction and the incoming view sliding in from the opposite edge, completing the transition within 300 milliseconds.
5. WHILE Reduced_Motion_Mode is active, THE Swipe_Navigation_Controller SHALL still respond to swipe gestures but skip the slide animation, displaying the target view immediately.
6. WHILE a drag-to-reschedule or drag-to-resize gesture is active, THE Swipe_Navigation_Controller SHALL suppress swipe navigation to prevent gesture conflicts.

### Requirement 16: Empty State Design

**User Story:** As a user, I want to see helpful, encouraging content when my calendar has no events, so that the app feels welcoming rather than broken or empty.

#### Acceptance Criteria

1. WHEN the Day_View, Week_View, or Agenda_View renders with zero visible events, THE Empty_State_View SHALL display a contextual illustration, a primary message, and a call-to-action button.
2. THE Empty_State_View SHALL display a primary message appropriate to the context: "No events today — enjoy your free time!" for the Day_View, "Your week is wide open" for the Week_View, and "Nothing coming up" for the Agenda_View.
3. THE Empty_State_View SHALL display a call-to-action button labeled "Create an event" that opens the Quick_Create_Bar or Inline_Event_Creator when tapped.
4. WHEN a new user opens the app for the first time with no connected calendar accounts, THE Empty_State_View SHALL display a welcome illustration with a message prompting the user to connect their first calendar account and a "Connect Account" button.
5. THE Empty_State_View SHALL use Design_Token_System colors and typography for all text, illustrations, and buttons.
6. WHILE Reduced_Motion_Mode is active, THE Empty_State_View SHALL render illustrations as static images without entrance animations. WHILE Reduced_Motion_Mode is not active, THE Empty_State_View SHALL animate the illustration and text with a gentle fade-in and slide-up on first render, completing within 400 milliseconds.
7. THE Empty_State_View SHALL be accessible to screen readers, with the illustration marked as decorative (empty alt text) and the primary message and call-to-action button properly labeled.

### Requirement 17: Recurrence Expressions in NL Parser

**User Story:** As a user, I want to type recurring event descriptions like "Team standup every weekday at 9am" and have the app create a repeating event, so that I can set up recurring events as fast as one-off events.

#### Acceptance Criteria

1. WHEN a user submits text containing a Recurrence_Expression in the Quick_Create_Bar, THE NL_Parser SHALL extract the recurrence pattern and generate a valid RFC 5545 RRULE in addition to the single-event fields.
2. THE NL_Parser SHALL support the following recurrence frequencies: "every day" (FREQ=DAILY), "every weekday" (FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR), "every week" (FREQ=WEEKLY), "every 2 weeks" (FREQ=WEEKLY;INTERVAL=2), "every month" (FREQ=MONTHLY), "every year" (FREQ=YEARLY).
3. THE NL_Parser SHALL support day-specific weekly recurrence: "every Monday" (FREQ=WEEKLY;BYDAY=MO), "every Tuesday and Thursday" (FREQ=WEEKLY;BYDAY=TU,TH), and all other day-of-week combinations.
4. THE NL_Parser SHALL support interval-based recurrence: "every N days", "every N weeks", "every N months" where N is a positive integer, mapping to the corresponding FREQ with INTERVAL=N.
5. THE NL_Parser SHALL support ordinal monthly recurrence: "every first Monday of the month" (FREQ=MONTHLY;BYDAY=1MO), "every last Friday" (FREQ=MONTHLY;BYDAY=-1FR).
6. THE NL_Recurrence_Printer SHALL convert a structured RRULE back into a human-readable recurrence expression string.
7. FOR ALL valid Recurrence_Expressions that the NL_Parser successfully parses into an RRULE, parsing the NL_Recurrence_Printer output of that RRULE SHALL produce an equivalent RRULE (round-trip property).
8. WHEN the NL_Parser detects a recurrence expression but cannot determine the recurrence frequency, THE Quick_Create_Bar SHALL open the EventEditor pre-populated with the parsed single-event fields and the recurrence section highlighted for manual completion.

### Requirement 18: Live Preview While Typing in Quick Create Bar

**User Story:** As a user, I want to see a real-time preview of the parsed event as I type in the Quick Create Bar, so that I have confidence in what will be created before I submit.

#### Acceptance Criteria

1. WHILE a user types in the Quick_Create_Bar, THE Live_Preview_Panel SHALL appear below the input field and update its displayed fields (title, date, time, duration, location, recurrence) in real time as the NL_Parser processes the current input text.
2. THE Live_Preview_Panel SHALL update within 100 milliseconds of each keystroke to maintain a responsive feel.
3. WHEN the NL_Parser successfully extracts a field from the input, THE Live_Preview_Panel SHALL display that field with a confirmed visual style (solid text, Design_Token_System primary color).
4. WHEN the NL_Parser has not yet extracted a field, THE Live_Preview_Panel SHALL display a placeholder for that field with a muted visual style (Design_Token_System secondary text color).
5. WHEN the Quick_Create_Bar input is empty, THE Live_Preview_Panel SHALL be hidden.
6. WHEN the user submits the Quick_Create_Bar input, THE Live_Preview_Panel SHALL animate closed with a collapse transition within 200 milliseconds.
7. THE Live_Preview_Panel SHALL be accessible to screen readers, announcing field changes via ARIA live regions with a debounce of 500 milliseconds to avoid excessive announcements during rapid typing.

### Requirement 19: Calendar Sidebar with Account Toggles

**User Story:** As a tablet or desktop user, I want a polished sidebar with calendar account toggles, a mini month navigator, and an upcoming events list, so that I can manage calendar visibility and navigate dates without leaving the main view.

#### Acceptance Criteria

1. WHILE the app is displayed at a tablet or desktop breakpoint, THE Calendar_Sidebar SHALL be visible in the left panel of the ResponsiveLayout, containing three sections: the Mini_Month_Navigator at the top, calendar account toggles in the middle, and an upcoming events list at the bottom.
2. THE Mini_Month_Navigator SHALL display a compact month grid for the current month with the selected date highlighted, and WHEN a user taps a day in the Mini_Month_Navigator, THE Calendar_Sidebar SHALL update the main calendar view's anchor date to the tapped day.
3. WHEN a user taps the forward or backward arrows on the Mini_Month_Navigator, THE Mini_Month_Navigator SHALL navigate to the next or previous month with a crossfade animation completing within 200 milliseconds.
4. THE Calendar_Sidebar SHALL display a checkbox toggle for each connected calendar account, labeled with the account name and colored with the account's Design_Token_System color.
5. WHEN a user toggles a calendar account checkbox, THE Calendar_Sidebar SHALL show or hide that account's events across all views within 200 milliseconds using the existing visibility toggle flow.
6. THE Calendar_Sidebar SHALL display an upcoming events list showing the next 10 events across all visible calendars, sorted by start time, with each entry showing the event title, time, and account color indicator.
7. WHILE Reduced_Motion_Mode is active, THE Calendar_Sidebar SHALL skip the Mini_Month_Navigator crossfade animation and display month changes instantly.
8. THE Calendar_Sidebar SHALL be keyboard-navigable, with Tab key moving focus between the Mini_Month_Navigator, account toggles, and upcoming events list, and each interactive element accessible via Enter or Space key activation.

### Requirement 20: Animated Onboarding / First-Run Experience

**User Story:** As a new user, I want an animated, delightful first-run experience that showcases the app's key capabilities, so that I understand what the app can do and feel excited to use it.

#### Acceptance Criteria

1. WHEN a new user launches the app for the first time, THE Onboarding_Animator SHALL present the First_Run_Experience as a sequence of 3 to 5 animated screens before the main calendar view.
2. THE First_Run_Experience SHALL include animated demonstrations of at least three key features: natural language event creation, drag-to-reschedule, and view switching with transitions.
3. EACH animated screen in the First_Run_Experience SHALL use the Animation_Engine to play a looping demonstration animation that illustrates the featured capability, with each animation lasting between 3 and 6 seconds per loop.
4. THE First_Run_Experience SHALL display a progress indicator (dots or step counter) showing the user's position in the onboarding sequence.
5. WHEN a user taps "Next" or swipes left on an onboarding screen, THE Onboarding_Animator SHALL transition to the next screen with a horizontal slide animation completing within 300 milliseconds.
6. WHEN a user taps "Skip" at any point during the First_Run_Experience, THE Onboarding_Animator SHALL dismiss the onboarding flow and transition to the main calendar view.
7. WHEN the user completes or skips the First_Run_Experience, THE Onboarding_Animator SHALL persist the completion state so that the onboarding flow is not shown on subsequent launches.
8. WHILE Reduced_Motion_Mode is active, THE Onboarding_Animator SHALL replace looping demonstration animations with static illustrations and skip all transition animations between screens, displaying each screen instantly.
9. THE First_Run_Experience SHALL be accessible to screen readers, with each screen providing descriptive text alternatives for the animated demonstrations and all navigation controls (Next, Skip, progress indicator) properly labeled.
