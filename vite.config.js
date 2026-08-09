export default {
  build: {
    target: "es2015",
    lib: {
      entry: "src/widget-st-musik.ts",
      formats: ["iife"],
      name: "STMusikWidget",
      fileName: () => "widget-st-musik.js",
    },
  },
};
