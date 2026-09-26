/**
 * What to show for each model, by its key (`qc45`, `g502`...).
 *
 * Files live in `public/`: 3D models (glTF binary, `.glb`) in
 * `public/models/`, images and photo galleries in `public/devices/`. A model
 * without an entry, or whose entry has none of these, falls back to its icon.
 */

export interface DeviceVisual {
  /** A `.glb`, shown in an interactive 3D viewer on the device page. */
  model?: string;
  /** A picture (transparent PNG or WebP works best). */
  image?: string;
  /** Photos shown as a carousel, when there is no 3D model. */
  gallery?: GalleryImage[];
  /** Initial camera angle for the 3D model, as model-viewer's camera-orbit. */
  orbit?: string;
  /**
   * LED zone -> the model material that glows for it. The material's
   * emissive texture must be a greyscale mask (see scripts/g502_led_masks.py)
   * for the zone's colour to show as is.
   */
  zones?: Record<string, string>;
  /** LED bars that show the battery level; see `BatteryBars`. */
  batteryBars?: BatteryBars;
}

export interface GalleryImage {
  src: string;
  alt: string;
  /** "contain" for product shots on white, "cover" for photos that fill the frame. */
  fit: "contain" | "cover";
}

/**
 * A zone whose stripes double as a battery gauge. The zone's own mask lights
 * every bar; `masks` light fewer (bar count -> greyscale PNG, made by
 * scripts/g502_led_masks.py), and the unlit ones stay dark.
 */
export interface BatteryBars {
  zone: string;
  masks: Record<number, string>;
  /** Minimum percentage for each bar count above one: [2 bars, 3 bars]. */
  thresholds: number[];
}

/** How many bars `percent` lights: one, plus one per threshold reached. */
export function barsFor(bars: BatteryBars, percent: number): number {
  return 1 + bars.thresholds.filter((minimum) => percent >= minimum).length;
}

export const VISUALS: Record<string, DeviceVisual> = {
  g502: {
    model: "/models/g502-lightspeed-black-stalker.glb",
    orbit: "235deg 50deg auto",
    zones: { logo: "Material2", primary: "Material4" },
    batteryBars: {
      zone: "primary",
      masks: {
        1: "/models/g502-lightspeed-black-stalker-bars-1.png",
        2: "/models/g502-lightspeed-black-stalker-bars-2.png",
      },
      thresholds: [30, 60], // 30 % and up: two bars; 60 % and up: three
    },
  },
  // Product photos from bose.com, 1500 px WebP.
  qc45: { image: "/devices/qc45.webp" },
  micro2: {
    gallery: [
      { src: "/devices/micro2-1.webp", alt: "SoundLink Micro (2nd Gen), front", fit: "contain" },
      { src: "/devices/micro2-2.webp", alt: "SoundLink Micro (2nd Gen), three-quarter view", fit: "contain" },
      { src: "/devices/micro2-3.webp", alt: "SoundLink Micro (2nd Gen), back and strap", fit: "contain" },
      { src: "/devices/micro2-4.webp", alt: "SoundLink Micro (2nd Gen), angled", fit: "contain" },
      { src: "/devices/micro2-5.webp", alt: "SoundLink Micro (2nd Gen), top", fit: "contain" },
      { src: "/devices/micro2-6.webp", alt: "SoundLink Micro (2nd Gen), front with strap", fit: "contain" },
    ],
  },
};

export function visualFor(key: string): DeviceVisual {
  return VISUALS[key] ?? {};
}
