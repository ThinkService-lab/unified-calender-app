/**
 * Unit tests for online manager configuration.
 */

import { onlineManager } from '@tanstack/react-query';
import { setOnlineStatus, getOnlineStatus } from '../onlineManager';

describe('onlineManager', () => {
  afterEach(() => {
    // Reset to online after each test
    onlineManager.setOnline(true);
  });

  it('reports online by default', () => {
    expect(getOnlineStatus()).toBe(true);
  });

  it('can be set to offline', () => {
    setOnlineStatus(false);
    expect(getOnlineStatus()).toBe(false);
  });

  it('can be toggled back to online', () => {
    setOnlineStatus(false);
    expect(getOnlineStatus()).toBe(false);

    setOnlineStatus(true);
    expect(getOnlineStatus()).toBe(true);
  });
});
