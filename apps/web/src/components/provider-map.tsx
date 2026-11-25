"use client";

import { copy } from "@fleettrust/copy";
import type { MapConfig } from "@fleettrust/types";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import {
  fitZoom,
  type LngLat,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  tileUrl,
  toScreen,
  visibleTiles,
} from "@fleettrust/ui";

export interface MapPin {
  id: string;
  /** Number shown on the pin; matches the numbered results list. */
  number: number;
  label: string;
  location: LngLat;
}

const PAN_STEP = 120;

/**
 * Results map. It repeats the results list (the list is the accessible primary view): each
 * pin is a numbered button that selects the matching list entry. Pan with the arrow buttons or
 * by dragging; zoom with + and −. Without a configured tile source it draws a plain grid.
 */
export function ProviderMap({
  pins,
  center,
  selectedId,
  onSelect,
  config,
}: {
  pins: readonly MapPin[];
  center: LngLat;
  selectedId: string | null;
  onSelect: (id: string) => void;
  config: MapConfig | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 360 });
  const [view, setView] = useState<{ center: LngLat; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fitted = {
    center,
    zoom: fitZoom(
      pins.map((pin) => pin.location),
      center,
      size.width,
      size.height,
    ),
  };
  const current = view ?? fitted;
  const viewport = { ...current, ...size };

  const move = (dx: number, dy: number) => {
    setView({ ...current, center: pan(viewport, dx, dy) });
  };
  const zoom = (delta: number) => {
    setView({ ...current, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom + delta)) });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = drag.current.x - event.clientX;
    const dy = drag.current.y - event.clientY;
    drag.current = { x: event.clientX, y: event.clientY };
    move(dx, dy);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const template = config?.tileUrl ?? null;

  return (
    <section aria-label={copy.web.map.label} className="stack" style={{ gap: 4 }}>
      <div
        ref={frame}
        className="map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {template ? (
          visibleTiles(viewport).map((tile) => {
            const src = tileUrl(template, tile);
            return src ? (
              // Map tiles are decorative background images from the configured vendor.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={tile.key}
                className="map__tile"
                src={src}
                alt=""
                style={{ left: tile.left, top: tile.top }}
                draggable={false}
              />
            ) : null;
          })
        ) : (
          <div className="map__grid" aria-hidden="true" />
        )}

        {pins.map((pin) => {
          const { x, y } = toScreen(pin.location, viewport);
          if (x < -40 || y < -40 || x > size.width + 40 || y > size.height + 40) return null;
          return (
            <button
              key={pin.id}
              type="button"
              className="map__pin"
              style={{ left: x, top: y }}
              aria-pressed={pin.id === selectedId}
              aria-label={`${String(pin.number)}. ${pin.label}`}
              onClick={() => {
                onSelect(pin.id);
              }}
            >
              {pin.number}
            </button>
          );
        })}

        <div className="map__controls">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              zoom(1);
            }}
            aria-label={copy.web.map.zoomIn}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              zoom(-1);
            }}
            aria-label={copy.web.map.zoomOut}
          >
            −
          </button>
        </div>
        {config?.attribution && template ? (
          <span className="map__attribution">{config.attribution}</span>
        ) : null}
      </div>
      <div className="cluster" role="group" aria-label={copy.web.map.move}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            move(0, -PAN_STEP);
          }}
        >
          {copy.web.map.north}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            move(0, PAN_STEP);
          }}
        >
          {copy.web.map.south}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            move(-PAN_STEP, 0);
          }}
        >
          {copy.web.map.west}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            move(PAN_STEP, 0);
          }}
        >
          {copy.web.map.east}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setView(null);
          }}
        >
          {copy.web.map.showAll}
        </button>
      </div>
      {!template ? <p className="small muted">{copy.web.map.noBackground}</p> : null}
    </section>
  );
}
