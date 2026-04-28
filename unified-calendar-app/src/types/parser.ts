/**
 * iCalendar parser/serializer type definitions.
 * Requirements: 12.1, 12.2
 */

export interface ParseResult<T> {
  success: boolean;
  value?: T;
  error?: ParseError;
}

export interface ParseError {
  line: number;
  message: string;
  raw: string;
}
