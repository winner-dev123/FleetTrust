import { searchProvidersQuerySchema } from "@fleettrust/types";
import { describe, expect, it } from "vitest";

import { parseSearchState, searchStateToParams, toApiQuery } from "./search-query";

describe("search state in the URL", () => {
  it("round-trips", () => {
    const params = new URLSearchParams(
      "q=brakes&where=Cape+Town&lat=-33.92490&lng=18.42410&radiusKm=50&category=workshop&openNow=true&verified=true&view=map",
    );
    const state = parseSearchState(params);
    expect(state).toMatchObject({
      q: "brakes",
      where: "Cape Town",
      lat: -33.9249,
      lng: 18.4241,
      radiusKm: 50,
      category: "workshop",
      openNow: true,
      verifiedOnly: true,
      view: "map",
    });
    expect(parseSearchState(searchStateToParams(state))).toEqual(state);
  });

  it("ignores junk instead of failing", () => {
    const state = parseSearchState(
      new URLSearchParams("lat=999&lng=18&radiusKm=7&category=spaceships&view=globe"),
    );
    expect(state).toMatchObject({
      lat: null,
      lng: null,
      radiusKm: 25,
      category: null,
      view: "list",
    });
  });

  it("builds a query the API schema accepts, only once a location is known", () => {
    expect(toApiQuery(parseSearchState(new URLSearchParams("q=tyres")))).toBeNull();
    const query = toApiQuery(
      parseSearchState(
        new URLSearchParams("lat=-33.9&lng=18.4&openNow=true&verified=true&category=towing"),
      ),
    );
    expect(query).not.toBeNull();
    expect(() => searchProvidersQuerySchema.parse(query)).not.toThrow();
  });
});
