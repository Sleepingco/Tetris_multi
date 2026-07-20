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
            name: "serve-index-at-root",
            configureServer(server) {
                server.middlewares.use((request, _response, next) => {
                    if (request.url === "/") request.url = "/pages/index.html";
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
            input: [
                resolve(clientRoot, "pages/index.html"),
                resolve(clientRoot, "pages/multiLobby.html"),
                resolve(clientRoot, "pages/tetrisSingle.html"),
                resolve(clientRoot, "pages/tetrisMulti.html"),
            ],
        },
    },
});
