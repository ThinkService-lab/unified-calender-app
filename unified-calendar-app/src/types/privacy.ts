/**
 * Privacy layer type definitions.
 * Requirements: 5.1
 */

export interface Audience {
  type: 'owner' | 'delegate' | 'shared-view-member';
  userId: string;
  permissionLevel: 'read-only' | 'read-write';
}

export interface SharedCalendarView {
  id: string;
  ownerId: string;
  name: string;
  calendarIds: string[];
  members: SharedViewMember[];
  maxMembers: number;
  createdAt: Date;
}

export interface SharedViewMember {
  userId: string;
  permission: 'read-only' | 'read-write';
  addedAt: Date;
}

export interface DelegationGrant {
  id: string;
  delegatorId: string;
  delegateId: string;
  calendarIds: string[];
  permission: 'read-only' | 'read-write';
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface EncryptedPreferences {
  /** Base64-encoded ciphertext (matches EncryptedData from encryption module) */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded authentication tag */
  authTag: string;
  version: number;
  updatedAt: Date;
}
