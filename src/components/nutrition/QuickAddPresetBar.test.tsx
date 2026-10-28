import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAddPresetBar } from './QuickAddPresetBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('QuickAddPresetBar', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders common container sizes (8oz, 16oz, 500ml, etc.)', async () => {
    const onQuickAdd = vi.fn();
    const onPrefill = vi.fn();

    await act(async () => {
      root.render(
        <QuickAddPresetBar
          activeUnit="oz"
          onQuickAdd={onQuickAdd}
          onPrefillInput={onPrefill}
        />
      );
    });

    expect(container.textContent).toContain('Quick Add Container Presets');
    expect(container.textContent).toContain('8 oz');
    expect(container.textContent).toContain('16 oz');
    expect(container.textContent).toContain('500 ml');
    expect(container.textContent).toContain('750 ml');
    expect(container.textContent).toContain('1,000 ml');
  });

  it('triggers onQuickAdd and onPrefillInput when container is clicked', async () => {
    const onQuickAdd = vi.fn();
    const onPrefill = vi.fn();

    await act(async () => {
      root.render(
        <QuickAddPresetBar
          activeUnit="oz"
          onQuickAdd={onQuickAdd}
          onPrefillInput={onPrefill}
        />
      );
    });

    // Find the 16 oz Pint button
    const pintBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('16 oz')
    );
    expect(pintBtn).toBeTruthy();

    await act(async () => {
      pintBtn?.click();
    });

    expect(onQuickAdd).toHaveBeenCalledWith(473, expect.stringContaining('16 oz'));
    expect(onPrefill).toHaveBeenCalledWith(16, 'oz');
  });

  it('handles 500ml shaker button properly', async () => {
    const onQuickAdd = vi.fn();
    const onPrefill = vi.fn();

    await act(async () => {
      root.render(
        <QuickAddPresetBar
          activeUnit="ml"
          onQuickAdd={onQuickAdd}
          onPrefillInput={onPrefill}
        />
      );
    });

    const shakerBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('500 ml')
    );
    expect(shakerBtn).toBeTruthy();

    await act(async () => {
      shakerBtn?.click();
    });

    expect(onQuickAdd).toHaveBeenCalledWith(500, expect.stringContaining('500 ml'));
    expect(onPrefill).toHaveBeenCalledWith(500, 'ml');
  });
});
