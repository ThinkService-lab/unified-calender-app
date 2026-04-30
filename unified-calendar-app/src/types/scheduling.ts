/**
 * AI scheduling and conflict detection type definitions.
 * Requirements: 5.1
 */

import type { CalendarEvent } from './models';

export interface SchedulingPreferences {
  userId: string;
  preferredStartHour: number;
  preferredEndHour: number;
  minimumBufferMinutes: number;
  maxMeetingsPerDay: number;
  focusTimeBlocks: TimeBlock[];
  learnedPatterns: LearnedPattern[];
}

export interface LearnedPattern {
  dayOfWeek: number;
  hourSlot: number;
  acceptanceRate: number;
  averageDuration: number;
  sampleCount: number;
}

export interface TimeBlock {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  label: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface SlotSuggestion {
  start: Date;
  end: Date;
  score: number;
  tradeoffs: string[];
}

export interface Conflict {
  id: string;
  eventA: CalendarEvent;
  eventB: CalendarEvent;
  overlapMinutes: number;
  travelTimeConflict: boolean;
}

export interface FreeBusySlot {
  start: Date;
  end: Date;
  status: 'busy' | 'tentative' | 'free';
}

export interface MeetingRequest {
  title: string;
  duration: number;
  attendeeEmails: string[];
  dateRange: { start: Date; end: Date };
  priority: 'high' | 'medium' | 'low' | 'normal';
}
