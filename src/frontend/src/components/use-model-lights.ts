"use client";

import { useEffect, type RefObject } from "react";

import type { ZoneLight } from "@/lib/types";
import { barsFor, type BatteryBars } from "@/lib/visuals";

type Rgb = [number, number, number];

interface ModelTextureSlot {
  texture: unknown;
  setTexture(texture: unknown): void;
}

interface ModelMaterial {
  name: string;
  emissiveTexture: ModelTextureSlot;
  setEmissiveFactor(rgb: Rgb): void;
  setEmissiveStrength(strength: number): void;
}

/**
 * How much brighter than a lit surface an LED at full brightness reads on
 * screen. A physical LED looks bright even at a low setting, where the same
 * value as a plain emissive colour renders as a dull grey. Much above 1,
 * the tone mapping washes colours out towards white (red turns pink).
 */
const LED_GLOW = 2.0;

interface Glow {
  rgb: Rgb;
  strength: number;
}

export type ModelViewerElement = HTMLElement & {
  model?: { materials: ModelMaterial[] };
  createTexture(uri: string): Promise<unknown>;
};

/** glTF emissive factors are linear, colours from the device are sRGB. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * An LED colour as the eye sees it: the hue at full brightness, and the
 * set brightness (its brightest channel) as glow strength, square-rooted
 * because a dim LED still reads as clearly lit.
 */
function ledGlow(hex: string): Glow {
  const n = Number.parseInt(hex, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const peak = Math.max(...channels);
  if (peak === 0) return { rgb: [0, 0, 0], strength: 0 };
  const [r, g, b] = channels.map((c) => toLinear((c * 255) / peak));
  return { rgb: [r, g, b], strength: LED_GLOW * Math.sqrt(peak / 255) };
}

function hueToLinear(hue: number): Rgb {
  const channel = (offset: number) => {
    const k = (offset + hue * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [toLinear(channel(5)), toLinear(channel(3)), toLinear(channel(1))];
}

/** A zone's glow at `time` (ms), or null to leave the model's own colour. */
function glowAt(light: ZoneLight, time: number): Glow | null {
  if (light.effect === "off") return { rgb: [0, 0, 0], strength: 0 };
  if (light.effect === "cycle") return { rgb: hueToLinear((time / 6000) % 1), strength: LED_GLOW };
  if (!light.color) return null;
  const glow = ledGlow(light.color);
  if (light.effect === "breathe") {
    const level = 0.1 + 0.9 * (0.5 + 0.5 * Math.sin((2 * Math.PI * time) / 3000));
    return { rgb: glow.rgb, strength: glow.strength * level };
  }
  return glow;
}

/**
 * Light the model's LED zones as the device reports them. `zones` maps a
 * zone to the material that glows for it; cycle and breathe are animated
 * while the page is open. Unknown lighting leaves the model as exported.
 */
export function useModelLights(
  ref: RefObject<ModelViewerElement | null>,
  loaded: boolean,
  zones: Record<string, string> | undefined,
  lights: Record<string, ZoneLight> | null | undefined,
) {
  useEffect(() => {
    const materials = ref.current?.model?.materials;
    if (!loaded || !materials || !zones || !lights) return;

    const targets = Object.entries(zones).flatMap(([zone, name]) => {
      const light = lights[zone];
      const material = materials.find((m) => m.name === name);
      return light && material ? [{ light, material }] : [];
    });
    const animated = targets.some(({ light }) => light.effect === "cycle" || light.effect === "breathe");

    let frame = 0;
    const paint = (time: number) => {
      for (const { light, material } of targets) {
        const glow = glowAt(light, time);
        if (glow) {
          material.setEmissiveFactor(glow.rgb);
          material.setEmissiveStrength(glow.strength);
        }
      }
      if (animated) frame = requestAnimationFrame(paint);
    };
    paint(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [ref, loaded, zones, lights]);
}

/** Each material's own emissive texture, kept the first time one is swapped. */
const originalMasks = new WeakMap<ModelMaterial, unknown>();

/**
 * Show the battery level on a zone's bars: its full mask lights every bar,
 * the extra masks fewer, and unlit bars stay dark. The zone keeps its colour.
 */
export function useBatteryBars(
  ref: RefObject<ModelViewerElement | null>,
  loaded: boolean,
  zones: Record<string, string> | undefined,
  bars: BatteryBars | undefined,
  percent: number | null | undefined,
) {
  useEffect(() => {
    const viewer = ref.current;
    const name = bars && zones?.[bars.zone];
    const material = name ? viewer?.model?.materials.find((m) => m.name === name) : undefined;
    if (!loaded || !viewer || !bars || !material || percent == null) return;

    if (!originalMasks.has(material)) originalMasks.set(material, material.emissiveTexture.texture);
    const count = barsFor(bars, percent);
    const uri = bars.masks[count];
    if (!uri) {
      material.emissiveTexture.setTexture(originalMasks.get(material));
      return;
    }
    let cancelled = false;
    viewer.createTexture(uri).then((texture) => {
      if (!cancelled) material.emissiveTexture.setTexture(texture);
    });
    return () => {
      cancelled = true;
    };
  }, [ref, loaded, zones, bars, percent]);
}
