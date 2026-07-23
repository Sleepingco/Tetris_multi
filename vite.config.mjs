/**
 * 네 HTML entry를 각각 번들링하는 client 개발·production build 설정이다.
 *
 * 개발 시에는 5173의 Vite가 page와 HMR을 제공하고 `/socket.io`만 5500 backend로 전달한다.
 * production build는 같은 entry들을 `dist/client`에 만들며 server bundle은 건드리지 않는다.
 */
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
                // production Express의 `/` 동작과 맞추기 위해 dev server의 root 요청만 index page로 바꾼다.
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
                // HTTP handshake와 이후 WebSocket upgrade를 같은 backend로 전달한다.
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
            // React router 한 개가 아니라 독립된 네 HTML page를 각각 진입점으로 유지한다.
            input: [
                resolve(clientRoot, "pages/index.html"),
                resolve(clientRoot, "pages/multiLobby.html"),
                resolve(clientRoot, "pages/tetrisSingle.html"),
                resolve(clientRoot, "pages/tetrisMulti.html"),
            ],
        },
    },
});
