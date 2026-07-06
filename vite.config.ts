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
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        // O pacote local `vendor/rededor/cura` contém apenas metadados/assets no
        // repositório atual; seu package.json aponta para `dist/`, que não existe
        // no ambiente de publicação. O shim mantém as APIs usadas pelo app sem
        // fazer o Rollup resolver um entrypoint inexistente.
        { find: /^@rededor\/cura$/, replacement: path.resolve(__dirname, "./src/lib/cura-runtime-shim.ts") },
        { find: /^@rededor\/cura\/dist\/loader$/, replacement: path.resolve(__dirname, "./src/lib/cura-runtime-shim.ts") },
        // xlsx-js-style toca em `stream.Readable` só em caminhos Node; no
        // browser, um shim inerte evita o warning de externalização do Vite.
        { find: "stream", replacement: path.resolve(__dirname, "./src/lib/stream-shim.ts") },
      ],
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
