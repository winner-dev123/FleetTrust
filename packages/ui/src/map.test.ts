import { describe, expect, it } from "vitest";

import {
  fitZoom,
  pan,
  project,
  tileUrl,
  toScreen,
  unproject,
  viewportBbox,
  visibleTiles,
} from "./map.js";

const capeTown = { lng: 18.4241, lat: -33.9249 };

describe("Web Mercator", () => {
  it("round-trips coordinates", () => {
    const back = unproject(project(capeTown, 12), 12);
    expect(back.lng).toBeCloseTo(capeTown.lng, 6);
    expect(back.lat).toBeCloseTo(capeTown.lat, 6);
  });

  it("puts the centre in the middle of the viewport", () => {
    const view = { center: capeTown, zoom: 13, width: 600, height: 400 };
    expect(toScreen(capeTown, view)).toEqual({ x: 300, y: 200 });
    expect(toScreen({ ...capeTown, lng: capeTown.lng + 0.01 }, view).x).toBeGreaterThan(300);
  });

  it("takes the short way across the antimeridian", () => {
    const view = { center: { lng: 179.9, lat: 0 }, zoom: 8, width: 400, height: 400 };
    const x = toScreen({ lng: -179.9, lat: 0 }, view).x;
    expect(x).toBeGreaterThan(200);
    expect(x).toBeLessThan(400);
  });

  it("pans by screen pixels", () => {
    const view = { center: capeTown, zoom: 10, width: 400, height: 400 };
    expect(pan(view, 100, 0).lng).toBeGreaterThan(capeTown.lng);
    expect(pan(view, 0, 100).lat).toBeLessThan(capeTown.lat);
  });
});

describe("tiles", () => {
  it("covers the viewport and wraps x", () => {
    const tiles = visibleTiles({ center: { lng: 0, lat: 0 }, zoom: 1, width: 1024, height: 256 });
    expect(tiles.every((tile) => tile.x >= 0 && tile.x < 2)).toBe(true);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
  });

  it("fills only https (or local http) templates", () => {
    expect(tileUrl("https://tiles.example.com/{z}/{x}/{y}.png", { z: 3, x: 4, y: 5 })).toBe(
      "https://tiles.example.com/3/4/5.png",
    );
    expect(tileUrl("http://localhost:8081/{z}/{x}/{y}.png", { z: 1, x: 0, y: 0 })).toBe(
      "http://localhost:8081/1/0/0.png",
    );
    expect(tileUrl("http://tiles.example.com/{z}/{x}/{y}.png", { z: 1, x: 0, y: 0 })).toBeNull();
    expect(tileUrl("javascript:alert(1)//{z}", { z: 1, x: 0, y: 0 })).toBeNull();
    expect(tileUrl("https://user@tiles.example.com/{z}/{x}/{y}", { z: 1, x: 0, y: 0 })).toBeNull();
    expect(tileUrl("http://localhost.evil.com/{z}/{x}/{y}", { z: 1, x: 0, y: 0 })).toBeNull();
  });
});

describe("fitZoom and bbox", () => {
  it("zooms out until every pin fits", () => {
    const near = [capeTown, { lng: 18.43, lat: -33.93 }];
    const far = [capeTown, { lng: 28.04, lat: -26.2 }];
    expect(fitZoom(near, capeTown, 600, 400)).toBeGreaterThan(fitZoom(far, capeTown, 600, 400));
  });

  it("returns west, south, east, north around the centre", () => {
    const [west, south, east, north] = viewportBbox({
      center: capeTown,
      zoom: 12,
      width: 600,
      height: 400,
    });
    expect(west).toBeLessThan(capeTown.lng);
    expect(east).toBeGreaterThan(capeTown.lng);
    expect(south).toBeLessThan(capeTown.lat);
    expect(north).toBeGreaterThan(capeTown.lat);
  });
});
