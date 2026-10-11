export default {
  appType: "mpa",
  build: {
    target: "es2015",
    sourcemap: true,
    lib: {
      entry: "src/widget-st-musik.ts",
      formats: ["iife"],
      name: "STMusikWidget",
      fileName: () => "widget-st-musik.js",
    },
  },
  test: {
    environment: "jsdom",
    css: true,
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
};
