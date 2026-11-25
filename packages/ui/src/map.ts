/**
 * Web Mercator helpers for the built-in tile map on web and mobile (ADR-0031, ADR-0032). The map vendor (OQ-13) is
 * configured by the API (`GET /v1/geo/map-config`); this code only places XYZ tiles and pins.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 17;
const MAX_LAT = 85.051_128_78;

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Point {
  x: number;
  y: number;
}

const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** Pixel position of a coordinate in the whole-world image at `zoom`. */
export function project({ lng, lat }: LngLat, zoom: number): Point {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const size = worldSize(zoom);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject({ x, y }: Point, zoom: number): LngLat {
  const size = worldSize(zoom);
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lng: ((((lng + 180) % 360) + 360) % 360) - 180, lat };
}

export interface Viewport {
  center: LngLat;
  zoom: number;
  width: number;
  height: number;
}

/** Where a coordinate falls inside the viewport, in CSS pixels from the top-left corner. */
export function toScreen(point: LngLat, view: Viewport): Point {
  const c = project(view.center, view.zoom);
  const p = project(point, view.zoom);
  const size = worldSize(view.zoom);
  // Take the shortest way round the antimeridian.
  let dx = p.x - c.x;
  if (dx > size / 2) dx -= size;
  if (dx < -size / 2) dx += size;
  return { x: view.width / 2 + dx, y: view.height / 2 + (p.y - c.y) };
}

/** Moves the centre by a screen offset (dragging or the arrow buttons). */
export function pan(view: Viewport, dx: number, dy: number): LngLat {
  const c = project(view.center, view.zoom);
  return unproject({ x: c.x + dx, y: c.y + dy }, view.zoom);
}

export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/** The tiles covering the viewport, with x wrapped round the world and y clipped at the poles. */
export function visibleTiles(view: Viewport): TilePlacement[] {
  const z = Math.round(view.zoom);
  const c = project(view.center, z);
  const originX = c.x - view.width / 2;
  const originY = c.y - view.height / 2;
  const count = 2 ** z;
  const tiles: TilePlacement[] = [];
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + view.width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + view.height) / TILE_SIZE));
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const x = ((tx % count) + count) % count;
      tiles.push({
        key: `${String(z)}/${String(tx)}/${String(ty)}`,
        z,
        x,
        y: ty,
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** Largest whole zoom at which every point fits inside the viewport (with padding). */
export function fitZoom(
  points: readonly LngLat[],
  center: LngLat,
  width: number,
  height: number,
  padding = 48,
): number {
  for (let zoom = 15; zoom > MIN_ZOOM; zoom--) {
    const view = { center, zoom, width, height };
    const fits = points.every((point) => {
      const { x, y } = toScreen(point, view);
      return x >= padding && x <= width - padding && y >= padding && y <= height - padding;
    });
    if (fits) return zoom;
  }
  return MIN_ZOOM;
}

/** The viewport's bounds for a map-area search: `west,south,east,north`. */
export function viewportBbox(view: Viewport): [number, number, number, number] {
  const c = project(view.center, view.zoom);
  const nw = unproject({ x: c.x - view.width / 2, y: c.y - view.height / 2 }, view.zoom);
  const se = unproject({ x: c.x + view.width / 2, y: c.y + view.height / 2 }, view.zoom);
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return [round(nw.lng), round(se.lat), round(se.lng), round(nw.lat)];
}

/**
 * Fills an XYZ template. Only https templates are used (plus http on localhost for
 * development), so a misconfigured value can't load mixed or script content. Checked with a
 * pattern rather than `URL`, which React Native implements only partly.
 */
export function tileUrl(
  template: string,
  tile: { z: number; x: number; y: number },
): string | null {
  const secure = /^https:\/\/[a-z0-9.-]+(?::\d+)?\//i.test(template);
  const local = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(template);
  if (!secure && !local) return null;
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}
