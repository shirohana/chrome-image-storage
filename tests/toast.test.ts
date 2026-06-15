// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from '../src/viewer/toast';

describe('showToast', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends a toast with the message and success styling', () => {
    showToast('Saved!');
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toBe('Saved!');
    expect(toast!.className).toContain('toast-success');
  });

  it('uses error styling for error toasts', () => {
    showToast('Boom', 'error');
    expect(document.querySelector('.toast')!.className).toContain('toast-error');
  });

  it('injects the keyframe styles once, lazily', () => {
    expect(document.getElementById('toast-styles')).toBeNull();
    showToast('a');
    showToast('b');
    expect(document.querySelectorAll('#toast-styles')).toHaveLength(1);
  });

  it('removes the toast after the timeout', () => {
    showToast('bye');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(3000 + 300);
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});
