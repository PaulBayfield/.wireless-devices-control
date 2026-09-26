"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type HTMLAttributes, type Ref } from "react";

import { visualFor } from "@/lib/visuals";

import { Carousel } from "./carousel";
import { useDeviceSettings } from "./controls/device-context";
import { DeviceIcon } from "./icons";
import { useBatteryBars, useModelLights, type ModelViewerElement } from "./use-model-lights";

// <model-viewer> is a custom element; tell TypeScript which attributes it takes.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": HTMLAttributes<HTMLElement> & {
        ref?: Ref<ModelViewerElement>;
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
        loading?: "auto" | "lazy" | "eager";
      };
    }
  }
}

/**
 * The device itself: its 3D model when there is one, else its photos, else
 * its picture, else its icon. The 3D viewer (three.js, ~1 MB) is loaded only on a page that
 * shows a model. A model with LED zones is lit as the device reports them.
 */
export function DeviceVisual({
  modelKey,
  kind,
  name,
  battery,
}: {
  modelKey: string;
  kind: string;
  name: string;
  /** Battery percentage, for a model whose LEDs show it. */
  battery?: number | null;
}) {
  const visual = visualFor(modelKey);
  const [viewerReady, setViewerReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const viewer = useRef<ModelViewerElement>(null);
  const lights = useDeviceSettings()?.settings?.led?.current;

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
      <div className="relative h-full min-h-56 w-full">
        {viewerReady ? (
          <model-viewer
            ref={viewer}
            src={visual.model}
            alt={`3D model of the ${name}`}
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
          <div className="flex h-full items-center justify-center">
            <DeviceIcon kind={kind} className="size-16 animate-pulse text-muted" />
          </div>
        )}
      </div>
    );
  }

  if (visual.gallery?.length) {
    return <Carousel images={visual.gallery} />;
  }

  // Product photos come on white, so the card is white behind them in both themes.
  if (visual.image) {
    return (
      <div className="relative h-full min-h-56 w-full bg-white">
        <Image src={visual.image} alt={name} fill sizes="(min-width: 768px) 400px, 100vw" className="object-contain p-4" priority />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-56 w-full items-center justify-center">
      <DeviceIcon kind={kind} className="size-16 text-muted" />
    </div>
  );
}
