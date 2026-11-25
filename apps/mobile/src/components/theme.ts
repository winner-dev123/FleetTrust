import { colors, type ColorTokens, radii, spacing, touchTarget, typography } from "@fleettrust/ui";
import { useColorScheme } from "react-native";

export interface Theme {
  color: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  type: typeof typography;
  touchTarget: number;
}

/** Shared tokens (`@fleettrust/ui`) for the current light or dark appearance. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { color: colors[scheme], spacing, radii, type: typography, touchTarget };
}
