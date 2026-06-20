// @vitest-environment happy-dom
// Smoke test: proves the SolidJS toolchain (JSX compile + reactivity) works in vitest.
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { describe, it, expect } from 'vitest';

describe('solid toolchain', () => {
  it('compiles JSX and updates the DOM reactively', () => {
    const [count, setCount] = createSignal(0);
    const container = document.createElement('div');
    const dispose = render(() => <span>{count()}</span>, container);

    expect(container.textContent).toBe('0');
    setCount(5);
    expect(container.textContent).toBe('5');

    dispose();
  });
});
