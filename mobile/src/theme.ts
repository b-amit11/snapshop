import { useColorScheme } from "react-native";

const light = {
  bg: "#f4f1ea",
  card: "#ffffff",
  ink: "#1c1f1e",
  muted: "#5f6763",
  line: "#e3ded3",
  brand: "#0f766e",
  brandInk: "#ffffff",
  brandSoft: "#d9efe9",
  accentSoft: "#fde3d3",
  warnBg: "#fff4e0",
  warnInk: "#7a4b00",
  danger: "#b42318",
};

const dark: typeof light = {
  bg: "#121514",
  card: "#1b1f1e",
  ink: "#eef1ef",
  muted: "#9aa39f",
  line: "#2c3331",
  brand: "#2fb3a5",
  brandInk: "#06201d",
  brandSoft: "#173a36",
  accentSoft: "#4a2a17",
  warnBg: "#3a2c12",
  warnInk: "#f5d08a",
  danger: "#ff7b6e",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
