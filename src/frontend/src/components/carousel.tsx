"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GalleryImage } from "@/lib/visuals";

import { ChevronLeftIcon } from "./icons";

/** How long each photo stays before autoplay moves on. */
const AUTOPLAY_MS = 4000;

/**
 * A photo carousel: a horizontal scroll-snap strip, so swiping and trackpads
 * work natively, with arrows, dots and the arrow keys on top. Only the first
 * image loads eagerly.
 *
 * It autoplays, but never while you are looking closely: it pauses while
 * hovered or focused and while the tab is hidden, any move restarts the
 * countdown, and it stays still for anyone who prefers reduced motion.
 */
export function Carousel({ images }: { images: GalleryImage[] }) {
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

  // Restarted by every slide change, so a manual move gets a full interval.
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
      className="group relative h-full min-h-56 w-full bg-white outline-none"
      role="region"
      aria-roledescription="carousel"
      aria-label="Photos"
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
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        onScroll={(event) => {
          const element = event.currentTarget;
          setIndex(Math.round(element.scrollLeft / element.clientWidth));
        }}
      >
        {images.map((image, i) => (
          <div
            key={image.src}
            className="relative h-full w-full shrink-0 snap-center"
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${images.length}`}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(min-width: 768px) 650px, 100vw"
              priority={i === 0}
              className={image.fit === "cover" ? "object-cover" : "object-contain p-4"}
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => goTo(index - 1)}
            className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => goTo(index + 1)}
            className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeftIcon className="size-4 rotate-180" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-white/75 px-2 py-1 backdrop-blur-sm">
            {images.map((image, i) => (
              <button
                key={image.src}
                type="button"
                aria-label={`Photo ${i + 1}`}
                aria-current={i === index}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-black/70" : "w-1.5 bg-black/25"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
