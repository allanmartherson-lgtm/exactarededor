import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    // Plugins de instrumentação ficam restritos ao servidor de preview; no build
    // publicado, eles rodam no Rollup e podem falhar em `resolveId` antes do app carregar.
    command === "serve" && mcpPlugin(),
    command === "serve" && mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // xlsx-js-style toca em `stream.Readable` só em caminhos Node; no
      // browser, um shim inerte evita o warning de externalização do Vite.
      stream: path.resolve(__dirname, "./src/lib/stream-shim.ts"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
