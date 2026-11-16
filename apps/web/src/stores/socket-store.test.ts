import { describe, it, expect, beforeEach } from 'vitest';
import { useSocketStore } from '@/stores/socket-store';

describe('useSocketStore', () => {
  beforeEach(() => {
    useSocketStore.setState(useSocketStore.getInitialState());
  });

  describe('initial state', () => {
    it('has disconnected status', () => {
      expect(useSocketStore.getState().status).toBe('disconnected');
    });

    it('has empty activities', () => {
      expect(useSocketStore.getState().activities).toEqual([]);
    });
  });

  describe('setStatus', () => {
    it('updates connection status', () => {
      useSocketStore.getState().setStatus('connected');
      expect(useSocketStore.getState().status).toBe('connected');
    });

    it('updates to reconnecting', () => {
      useSocketStore.getState().setStatus('reconnecting');
      expect(useSocketStore.getState().status).toBe('reconnecting');
    });
  });

  describe('addActivity', () => {
    it('adds an activity item', () => {
      useSocketStore.getState().addActivity({
        id: 'a1',
        action: 'login',
        actor: 'user@test.com',
        timestamp: Date.now(),
      });

      expect(useSocketStore.getState().activities).toHaveLength(1);
      expect(useSocketStore.getState().activities[0]!.id).toBe('a1');
    });

    it('prepends new activities (newest first)', () => {
      useSocketStore.getState().addActivity({
        id: 'first',
        action: 'test',
        actor: 'user',
        timestamp: Date.now(),
      });
      useSocketStore.getState().addActivity({
        id: 'second',
        action: 'test',
        actor: 'user',
        timestamp: Date.now(),
      });

      const { activities } = useSocketStore.getState();
      expect(activities[0]!.id).toBe('second');
      expect(activities[1]!.id).toBe('first');
    });

    it('caps activities at 20', () => {
      for (let i = 0; i < 25; i++) {
        useSocketStore.getState().addActivity({
          id: `a-${i}`,
          action: 'test',
          actor: 'user',
          timestamp: Date.now(),
        });
      }

      expect(useSocketStore.getState().activities).toHaveLength(20);
      expect(useSocketStore.getState().activities[0]!.id).toBe('a-24');
    });
  });

  describe('clearAll', () => {
    it('resets the entire store to initial state', () => {
      useSocketStore.getState().setStatus('connected');
      useSocketStore.getState().addActivity({
        id: 'a1',
        action: 'test',
        actor: 'user',
        timestamp: Date.now(),
      });

      useSocketStore.getState().clearAll();

      const state = useSocketStore.getState();
      expect(state.status).toBe('disconnected');
      expect(state.activities).toEqual([]);
    });
  });
});
