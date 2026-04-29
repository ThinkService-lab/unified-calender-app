/**
 * Sharing module — shared calendar views and delegation.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */

export {
  createSharedViewService,
  MAX_SHARED_VIEW_MEMBERS,
  type SharedViewService,
  type SharedViewResult,
  type SharedViewServiceConfig,
} from './sharedViewService';

export {
  createDelegationService,
  type DelegationService,
  type DelegationResult,
  type DelegationServiceConfig,
  type DelegateEventInput,
  type DelegateEventUpdate,
} from './delegationService';
