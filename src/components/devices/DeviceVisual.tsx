import { useCallback, useEffect, useRef, useState } from "react";
import type { ZoneLight } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import { visualFor, type GalleryImage } from "../../lib/visuals";
import { ChevronLeft, ChevronRight, DeviceIcon } from "../icons";
import { useBatteryBars, useModelLights, type ModelViewerElement } from "./useModelLights";

// <model-viewer> is a custom element; tell TypeScript which attributes it takes.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": import("react").HTMLAttributes<HTMLElement> & {
        ref?: import("react").Ref<ModelViewerElement>;
        src: string;
        alt: string;
        "camera-controls"?: boolean;
        "auto-rotate"?: boolean;
        "auto-rotate-delay"?: number;
        "rotation-per-second"?: string;
        "camera-orbit"?: string;
        "shadow-intensity"?: string;
        exposure?: string;
        "environment-image"?: string;
        "interaction-prompt"?: string;
      };
    }
  }
}

/**
 * The device itself: its 3D model when there is one, else its photos, else its picture, else its
 * icon. The 3D viewer (three.js, ~1 MB) is only loaded for a device that has a model. A model with
 * LED zones is lit as the device reports them.
 */
export function DeviceVisual({
  modelKey,
  kind,
  name,
  battery,
  lights,
}: {
  modelKey: string;
  kind: string;
  name: string;
  /** Battery percentage, for a model whose LEDs show it. */
  battery?: number | null;
  lights?: Record<string, ZoneLight> | null;
}) {
  const { t } = useSettings();
  const visual = visualFor(modelKey);
  const [viewerReady, setViewerReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const viewer = useRef<ModelViewerElement>(null);

  useModelLights(viewer, modelLoaded, visual.zones, lights);
  useBatteryBars(viewer, modelLoaded, visual.zones, visual.batteryBars, battery);

  useEffect(() => {
    const element = viewer.current;
    if (!viewerReady || !element) return;
    const onLoad = () => setModelLoaded(true);
    element.addEventListener("load", onLoad);
    return () => element.removeEventListener("load", onLoad);
  }, [viewerReady]);

  useEffect(() => {
    if (!visual.model) return;
    let cancelled = false;
    import("@google/model-viewer").then(() => {
      if (!cancelled) setViewerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [visual.model]);

  if (visual.model) {
    return (
      <div className="visual">
        {viewerReady ? (
          <model-viewer
            ref={viewer}
            src={visual.model}
            alt={t("model3d", { name })}
            camera-controls
            auto-rotate
            auto-rotate-delay={2000}
            rotation-per-second="18deg"
            camera-orbit={visual.orbit}
            shadow-intensity="0.8"
            exposure="1"
            environment-image="neutral"
            interaction-prompt="none"
            style={{ width: "100%", height: "100%", background: "transparent" }}
          />
        ) : (
          <div className="visual-icon pulse">
            <DeviceIcon kind={kind} size={64} />
          </div>
        )}
      </div>
    );
  }

  if (visual.gallery?.length) return <Carousel images={visual.gallery} />;

  // Transparent product photos: they sit on the card, in every theme.
  if (visual.image) {
    return (
      <div className="visual photo">
        <img src={visual.image} alt={name} />
      </div>
    );
  }

  return (
    <div className="visual">
      <div className="visual-icon">
        <DeviceIcon kind={kind} size={64} />
      </div>
    </div>
  );
}

/** How long each photo stays before autoplay moves on. */
const AUTOPLAY_MS = 4000;

/**
 * A photo carousel: a horizontal scroll-snap strip (swipes and trackpads work natively), with
 * arrows, dots and the arrow keys. It pauses while hovered or focused, while the tab is hidden,
 * and for anyone who prefers reduced motion.
 */
function Carousel({ images }: { images: GalleryImage[] }) {
  const { t } = useSettings();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const goTo = useCallback(
    (target: number) => {
      const element = track.current;
      if (!element) return;
      const next = (target + images.length) % images.length;
      element.scrollTo({ left: next * element.clientWidth, behavior: "smooth" });
    },
    [images.length],
  );

  useEffect(() => {
    if (hovered || focused || images.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") goTo(index + 1);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [index, hovered, focused, images.length, goTo]);

  return (
    <div
      className="visual photo carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={t("photos")}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") goTo(index + 1);
        if (event.key === "ArrowLeft") goTo(index - 1);
      }}
    >
      <div
        ref={track}
        className="carousel-track"
        onScroll={(event) => {
          const element = event.currentTarget;
          setIndex(Math.round(element.scrollLeft / element.clientWidth));
        }}
      >
        {images.map((image, i) => (
          <div key={image.src} className="carousel-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${images.length}`}>
            <img src={image.src} alt={image.alt} loading={i === 0 ? "eager" : "lazy"} className={image.fit === "cover" ? "cover" : ""} />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button className="carousel-arrow left" aria-label={t("previousPhoto")} onClick={() => goTo(index - 1)}>
            <ChevronLeft />
          </button>
          <button className="carousel-arrow right" aria-label={t("nextPhoto")} onClick={() => goTo(index + 1)}>
            <ChevronRight />
          </button>
          <div className="carousel-dots">
            {images.map((image, i) => (
              <button key={image.src} aria-label={t("photoN", { n: i + 1 })} aria-current={i === index} className={i === index ? "active" : ""} onClick={() => goTo(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
