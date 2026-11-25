import { copy } from "@fleettrust/copy";
import type { MapConfig } from "@fleettrust/types";
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
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { useTheme } from "./theme";
import { Body, Button, styles } from "./ui";

export interface MapPin {
  id: string;
  /** Number shown on the pin; matches the numbered results list. */
  number: number;
  label: string;
  location: LngLat;
}

const PAN_STEP = 120;
const HEIGHT = 280;

/**
 * Results map, the same built-in XYZ tile map as the web (no vendor SDK until OQ-13). The
 * list stays the primary, accessible view: each pin is a numbered button that selects the
 * matching result. Drag to pan, or use the move and zoom buttons (an alternative to dragging,
 * WCAG 2.5.7). Without a tile source it draws a plain background.
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
  const theme = useTheme();
  const [width, setWidth] = useState(320);
  const [view, setView] = useState<{ center: LngLat; zoom: number } | null>(null);
  const fitted = {
    center,
    zoom: fitZoom(
      pins.map((pin) => pin.location),
      center,
      width,
      HEIGHT,
    ),
  };
  const current = view ?? fitted;
  const viewport = { ...current, width, height: HEIGHT };
  const latest = useRef(viewport);
  useEffect(() => {
    latest.current = viewport;
  });

  const move = (dx: number, dy: number) => {
    const now = latest.current;
    setView({ center: pan(now, dx, dy), zoom: now.zoom });
  };
  const zoom = (delta: number) => {
    setView({
      center: current.center,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom + delta)),
    });
  };

  // Drag to pan (touch responder events; the move buttons below do the same without dragging).
  const drag = useRef<{ x: number; y: number } | null>(null);

  const template = config?.tileUrl ?? null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        accessibilityLabel={copy.map.label}
        onLayout={(event) => {
          setWidth(Math.max(200, Math.round(event.nativeEvent.layout.width)));
        }}
        style={{
          height: HEIGHT,
          overflow: "hidden",
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
        onMoveShouldSetResponder={(event) => {
          drag.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
          return true;
        }}
        onResponderTerminationRequest={() => false}
        onResponderMove={(event) => {
          const from = drag.current;
          const { pageX, pageY } = event.nativeEvent;
          drag.current = { x: pageX, y: pageY };
          if (from) move(from.x - pageX, from.y - pageY);
        }}
        onResponderRelease={() => {
          drag.current = null;
        }}
      >
        {template
          ? visibleTiles(viewport).map((tile) => {
              const uri = tileUrl(template, tile);
              return uri ? (
                <Image
                  key={tile.key}
                  source={{ uri }}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={{
                    position: "absolute",
                    left: tile.left,
                    top: tile.top,
                    width: 256,
                    height: 256,
                  }}
                />
              ) : null;
            })
          : null}
        {pins.map((pin) => {
          const { x, y } = toScreen(pin.location, viewport);
          if (x < -22 || y < -22 || x > width + 22 || y > HEIGHT + 22) return null;
          const selected = pin.id === selectedId;
          return (
            <Pressable
              key={pin.id}
              accessibilityRole="button"
              accessibilityLabel={`${String(pin.number)}. ${pin.label}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onSelect(pin.id);
              }}
              hitSlop={4}
              style={{
                position: "absolute",
                left: x - 20,
                top: y - 20,
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? theme.color.danger : theme.color.primary,
                borderWidth: 2,
                borderColor: theme.color.background,
              }}
            >
              <Text
                style={{
                  color: selected ? theme.color.onDanger : theme.color.onPrimary,
                  fontWeight: "700",
                }}
              >
                {pin.number}
              </Text>
            </Pressable>
          );
        })}
        {config?.attribution && template ? (
          <Text
            style={{
              position: "absolute",
              right: 4,
              bottom: 4,
              fontSize: 11,
              color: theme.color.text,
              backgroundColor: theme.color.background,
              paddingHorizontal: 4,
            }}
          >
            {config.attribution}
          </Text>
        ) : null}
      </View>
      <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel={copy.map.controls}>
        <Button
          label={copy.map.zoomIn}
          variant="ghost"
          onPress={() => {
            zoom(1);
          }}
        />
        <Button
          label={copy.map.zoomOut}
          variant="ghost"
          onPress={() => {
            zoom(-1);
          }}
        />
        <Button
          label={copy.map.north}
          variant="ghost"
          onPress={() => {
            move(0, -PAN_STEP);
          }}
        />
        <Button
          label={copy.map.south}
          variant="ghost"
          onPress={() => {
            move(0, PAN_STEP);
          }}
        />
        <Button
          label={copy.map.west}
          variant="ghost"
          onPress={() => {
            move(-PAN_STEP, 0);
          }}
        />
        <Button
          label={copy.map.east}
          variant="ghost"
          onPress={() => {
            move(PAN_STEP, 0);
          }}
        />
        <Button
          label={copy.map.showAll}
          variant="ghost"
          onPress={() => {
            setView(null);
          }}
        />
      </View>
      {!template ? (
        <Body small muted>
          {copy.map.noBackground}
        </Body>
      ) : null}
    </View>
  );
}
