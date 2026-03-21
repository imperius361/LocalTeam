import { describe, expect, it } from 'vitest';
import { shouldIgnoreExternalChange } from '../src/runtime';

describe('shouldIgnoreExternalChange', () => {
  it('filters internal WebView cache churn from the event feed', () => {
    expect(shouldIgnoreExternalChange('EBWebView')).toBe(true);
    expect(
      shouldIgnoreExternalChange('EBWebView\\extensions_crx_cache\\metadata.json'),
    ).toBe(true);
    expect(shouldIgnoreExternalChange('WebView2/EBWebView/Default/Preferences')).toBe(true);
    expect(shouldIgnoreExternalChange('Crashpad/reports/settings.dat')).toBe(true);
    expect(shouldIgnoreExternalChange('.localteam/state.db')).toBe(true);
  });

  it('keeps real project file changes visible', () => {
    expect(shouldIgnoreExternalChange('localteam.json')).toBe(false);
    expect(shouldIgnoreExternalChange('src/App.tsx')).toBe(false);
    expect(shouldIgnoreExternalChange('docs/notes.md')).toBe(false);
  });
});
