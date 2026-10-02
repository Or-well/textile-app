import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const vuePlugin = vue();
const transform = typeof vuePlugin.transform === "function"
  ? vuePlugin.transform
  : vuePlugin.transform?.handler;
if (typeof transform === "function") {
  // Components mount on a custom Vue host; compile client templates in the Node runner.
  vuePlugin.transform = function (code, id, options) {
    return transform.call(this, code, id, { ...options, ssr: false });
  };
}

export default defineConfig({
  plugins: [vuePlugin],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
