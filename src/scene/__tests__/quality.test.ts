// M5 graphics quality: the pure parts (dpr, scale, GL options, Auto → Low/High resolution without a browser).
import { describe, expect, it } from 'vitest';
import { qualityDpr, qualityGl, qualityScale } from '../quality';
import { autoQuality, pickAuto, resolveQuality } from '../../ui/graphics';

describe('graphics quality', () => {
  it('Low: dpr 1, half particles, no antialias; High keeps the scene range', () => {
    expect(qualityDpr('low')).toBe(1);
    expect(qualityDpr('high')).toEqual([1, 1.5]);
    expect(qualityDpr('high', [1, 2])).toEqual([1, 2]);
    expect(qualityDpr(undefined)).toEqual([1, 1.5]);
    expect(qualityScale('low')).toBe(0.5);
    expect(qualityScale('high')).toBe(1);
    expect(qualityGl('low').antialias).toBe(false);
    expect(qualityGl('high').antialias).toBe(true);
  });

  it('explicit Low / High win; Auto resolves to a concrete level', () => {
    expect(resolveQuality('low')).toBe('low');
    expect(resolveQuality('high')).toBe('high');
    expect(['low', 'high']).toContain(resolveQuality('auto'));
    // no window (node): Auto has nothing to detect → High
    expect(autoQuality().quality).toBe('high');
  });

  it('Auto rule on typical school laptops / phones (Device QA)', () => {
    const pc = { coarse: false, shortSide: 768, memory: 8, cores: 8 };
    const q = (gpu: string, extra = {}) => pickAuto({ ...pc, gpu, ...extra }).quality;
    // weak: software GL, budget Intel iGPUs (Windows ANGLE / ChromeOS Mesa strings), old / budget mobile GPUs
    expect(q('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)')).toBe('low');
    expect(q('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
    expect(q('ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
    expect(q('Mesa Intel(R) UHD Graphics (JSL)')).toBe('low');
    expect(q('ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
    expect(q('Mali-G52 MC2')).toBe('low');
    expect(q('Microsoft Basic Render Driver')).toBe('low');
    // fine: Apple, Iris Xe, desktop UHD 770, discrete
    expect(q('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('high');
    expect(q('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(q('ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(q('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    // memory / cores / phone / measured slowness
    expect(q('Apple M1', { memory: 4 })).toBe('low');
    expect(q('Apple M1', { cores: 2 })).toBe('low');
    expect(q('Apple M1', { coarse: true, shortSide: 390 })).toBe('low');
    expect(q('Apple M1', { coarse: true, shortSide: 1024 })).toBe('high'); // big tablet
    expect(pickAuto({ ...pc, gpu: 'Apple M1', slowFps: 31 })).toEqual({ quality: 'low', why: 'было 31 FPS' });
  });
});
