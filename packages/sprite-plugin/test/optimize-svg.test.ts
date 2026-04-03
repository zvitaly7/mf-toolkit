import { describe, it, expect } from 'vitest';
import { optimizeSvg } from '../src/generator/optimize-svg.js';

// Realistic SVG content that SVGO won't remove
const icon = (attr: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path ${attr} d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;

describe('optimizeSvg', () => {
  it('replaces hex colors with currentColor', () => {
    const result = optimizeSvg(icon('fill="#000000"'));
    expect(result).toContain('currentColor');
    expect(result).not.toContain('#000000');
  });

  it('replaces shorthand hex with currentColor', () => {
    const result = optimizeSvg(icon('stroke="#000"'));
    expect(result).toContain('currentColor');
    expect(result).not.toContain('#000');
  });

  it('replaces "black" with currentColor', () => {
    const result = optimizeSvg(icon('fill="black"'));
    expect(result).toContain('currentColor');
  });

  it('replaces rgb(0,0,0) with currentColor', () => {
    const result = optimizeSvg(icon('stroke="rgb(0, 0, 0)"'));
    expect(result).toContain('currentColor');
  });

  it('replaces colors inside <style> blocks', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.a{fill:#000000}</style><path class="a" d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
    const result = optimizeSvg(input);
    expect(result).toContain('currentColor');
    expect(result).not.toContain('#000000');
  });

  it('preserves viewBox', () => {
    const result = optimizeSvg(icon('fill="#000"'));
    expect(result).toContain('viewBox="0 0 24 24"');
  });

  it('removes width and height', () => {
    const result = optimizeSvg(icon('fill="#000"'));
    expect(result).not.toMatch(/width="24"/);
    expect(result).not.toMatch(/height="24"/);
  });

  it('skips color replacement when disabled', () => {
    const result = optimizeSvg(icon('fill="#000000"'), false);
    expect(result).not.toContain('currentColor');
  });

  it('appends extra plugins from svgoOptions', () => {
    // removeTitle is a valid SVGO plugin — with it the title element should be removed
    const withTitle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Cart</title><path fill="#000" d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
    const result = optimizeSvg(withTitle, true, { plugins: ['removeTitle'] });
    expect(result).not.toContain('<title>');
  });

  it('respects multipass: false from svgoOptions', () => {
    // Just verifies the option is accepted and optimization still runs
    const result = optimizeSvg(icon('fill="#000"'), true, { multipass: false });
    expect(result).toContain('currentColor');
    expect(result).toContain('viewBox');
  });
});
