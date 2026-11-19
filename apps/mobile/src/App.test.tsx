import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import App from "./App";

describe("App", () => {
  it("renders the product name as an accessible header", async () => {
    await render(<App />);
    expect(screen.getByRole("header", { name: "FleetTrust" })).toBeTruthy();
  });

  it("is honest that no features are available yet", async () => {
    await render(<App />);
    expect(screen.getByText(/No features are available yet/)).toBeTruthy();
  });
});
