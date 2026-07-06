import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const previewPlugins: PluginOption[] = [];

  if (command === "serve") {
    const [{ mcpPlugin }, { componentTagger }] = await Promise.all([
      import("@lovable.dev/mcp-js/stacks/supabase/vite"),
      import("lovable-tagger"),
    ]);

    previewPlugins.push(mcpPlugin());

    if (mode === "development") {
      previewPlugins.push(componentTagger());
    }
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), ...previewPlugins],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // xlsx-js-style toca em `stream.Readable` só em caminhos Node; no
        // browser, um shim inerte evita o warning de externalização do Vite.
        stream: path.resolve(__dirname, "./src/lib/stream-shim.ts"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
