export const adminPalette = {
  surface: {
    0: "#ffffff",
    50: "#fcf9f7",
    100: "#f7f2ee",
    200: "#eee7e2",
    300: "#ddd4cd",
    400: "#c4b7ae",
    500: "#9b8f87",
    600: "#756b64",
    700: "#5d5954",
    800: "#36322f",
    900: "#1e1b18",
    950: "#141210",
  },
  primary: {
    50: "#f3f7f2",
    100: "#e3ede3",
    200: "#d1dfd0",
    300: "#bed0bc",
    400: "#9db59e",
    500: "#7f9985",
    600: "#667b70",
    700: "#586b61",
    800: "#495851",
    900: "#39443e",
    950: "#232925",
  },
  accent: {
    sky: "#e5ebfb",
    butter: "#f6e8bf",
    rose: "#f9e4e9",
    peach: "#f7e3d3",
  },
  status: {
    success: {
      50: "#eef6f0",
      100: "#deece2",
      500: "#7d9d88",
      700: "#35543f",
    },
    warning: {
      50: "#fbf2d8",
      100: "#f6e8bf",
      500: "#b58a47",
      700: "#7a4d12",
      800: "#5f3c0d",
    },
    danger: {
      50: "#fdf0f3",
      100: "#f9e4e9",
      400: "#d68aa0",
      500: "#c16d82",
      600: "#a74b62",
      700: "#8f2f43",
    },
    info: {
      50: "#eef2fc",
      100: "#e5ebfb",
      500: "#8797c6",
      700: "#3e4a73",
    },
    amber: {
      100: "#f7edc8",
      700: "#7f5a18",
    },
    orange: {
      500: "#b56c38",
    },
  },
  ui: {
    ink: "#1e1b18",
    inkMuted: "#5d5954",
    inkSoft: "#77716b",
    sidebarTop: "#2b2925",
    sidebarBottom: "#1e1b18",
    sidebarText: "#f7f2ee",
    sidebarTextMuted: "#d8d0ca",
    mask: "rgba(20, 18, 16, 0.42)",
    fieldShadow: "0 1px 2px 0 rgb(30 27 24 / 0.05)",
  },
  apca: {
    bodyOnPaper: 100.75,
    mutedOnPaper: 80.78,
    softOnPaper: 70.15,
    whiteOnPrimary600: 76.96,
    whiteOnPrimary700: 83.73,
    inkOnPrimary50: 96.48,
    successOnSuccess100: 75.62,
    warningOnWarning100: 71.6,
    dangerOnDanger100: 73.61,
    infoOnInfo100: 77.71,
  },
} as const;

/**
 * APCA checkpoints were calculated with `apca-w3` on 2026-03-25.
 * We keep body text >= Lc 75 and support/muted text >= Lc 60.
 */
export const adminApcaTargets = {
  bodyTextMin: 75,
  mutedTextMin: 60,
} as const;

export const adminThemeColor = adminPalette.surface[50];
