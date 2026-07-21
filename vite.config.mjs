import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const clientRoot = fileURLToPath(new URL("./src/client", import.meta.url));
const serverTarget = process.env.VITE_SERVER_TARGET || "http://127.0.0.1:5500";

export default defineConfig({
    root: clientRoot,
    appType: "mpa",
    publicDir: false,
    plugins: [
        {
            name: "serve-spa-route-shell",
            configureServer(server) {
                server.middlewares.use((request, _response, next) => {
                    const requestUrl = new URL(request.url || "/", "http://localhost");
                    const spaRoutes = new Set([
                        "/",
                        "/pages/index.html",
                        "/pages/multiLobby.html",
                        "/pages/tetrisSingle.html",
                        "/pages/tetrisMulti.html",
                    ]);
                    if (spaRoutes.has(requestUrl.pathname)) {
                        request.url = `/pages/index.html${requestUrl.search}`;
                    }
                    next();
                });
            },
        },
    ],
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
        proxy: {
            "/socket.io": {
                target: serverTarget,
                ws: true,
            },
        },
    },
    build: {
        outDir: resolve(clientRoot, "../../dist/client"),
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            input: resolve(clientRoot, "pages/index.html"),
        },
    },
});
