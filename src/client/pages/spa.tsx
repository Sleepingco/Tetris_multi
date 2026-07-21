import {
    lazy,
    StrictMode,
    Suspense,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ComponentType,
} from "react";
import { createRoot } from "react-dom/client";
import { IndexPage } from "./index";
import { SingleGamePage } from "./tetrisSingle";
import {
    isSpaPath,
    leaveCurrentRoute,
    navigate,
    SPA_NAVIGATION_EVENT,
} from "./spaNavigation";

type Route = {
    title: string;
    gameStyle: boolean;
    component: ComponentType;
};

const MultiLobbyPage = lazy(() => import("./multiLobby").then(module => ({
    default: module.MultiLobbyPage,
})));
const MultiplayerGamePage = lazy(() => import("./tetrisMulti").then(module => ({
    default: module.MultiplayerGamePage,
})));

const indexRoute: Route = {
    title: "Tetris Multi",
    gameStyle: false,
    component: IndexPage,
};
const routes: Record<string, Route> = {
    "/": indexRoute,
    "/pages/index.html": indexRoute,
    "/pages/multiLobby.html": {
        title: "멀티플레이 로비 - Tetris Multi",
        gameStyle: false,
        component: MultiLobbyPage,
    },
    "/pages/tetrisSingle.html": {
        title: "Single Player Tetris",
        gameStyle: true,
        component: SingleGamePage,
    },
    "/pages/tetrisMulti.html": {
        title: "Multiplayer Tetris",
        gameStyle: true,
        component: MultiplayerGamePage,
    },
};

function readLocationKey(): string {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function applyRouteChrome(route: Route): void {
    document.title = route.title;
    document.documentElement.dataset.pageStyle = route.gameStyle ? "game" : "shell";
    const shellStyles = document.getElementById("shellStyles") as HTMLLinkElement | null;
    const gameStyles = document.getElementById("gameStyles") as HTMLLinkElement | null;
    if (shellStyles) shellStyles.media = route.gameStyle ? "not all" : "all";
    if (gameStyles) gameStyles.media = route.gameStyle ? "all" : "not all";
}

function App() {
    const [locationKey, setLocationKey] = useState(readLocationKey);
    const [announcement, setAnnouncement] = useState("");
    const initialRender = useRef(true);
    const route = routes[window.location.pathname];
    if (!route) throw new Error(`Unsupported SPA route: ${window.location.pathname}`);

    useLayoutEffect(() => {
        applyRouteChrome(route);
    }, [locationKey, route]);

    useEffect(() => {
        const commitLocation = () => {
            const nextRoute = routes[window.location.pathname];
            if (nextRoute) applyRouteChrome(nextRoute);
            setLocationKey(readLocationKey());
        };
        const handlePopState = () => {
            const nextUrl = new URL(window.location.href);
            leaveCurrentRoute(nextUrl);
            commitLocation();
        };
        const handleDocumentClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
                || !(event.target instanceof Element)
            ) {
                return;
            }
            const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
            if (
                !anchor
                || anchor.download
                || (anchor.target && anchor.target !== "_self")
                || anchor.origin !== window.location.origin
                || !isSpaPath(anchor.pathname)
            ) {
                return;
            }
            if (
                anchor.pathname === window.location.pathname
                && anchor.search === window.location.search
                && anchor.hash
            ) {
                return;
            }
            event.preventDefault();
            navigate(anchor.href);
        };

        window.addEventListener("popstate", handlePopState);
        window.addEventListener(SPA_NAVIGATION_EVENT, commitLocation);
        document.addEventListener("click", handleDocumentClick);
        return () => {
            window.removeEventListener("popstate", handlePopState);
            window.removeEventListener(SPA_NAVIGATION_EVENT, commitLocation);
            document.removeEventListener("click", handleDocumentClick);
        };
    }, []);

    useEffect(() => {
        if (initialRender.current) {
            initialRender.current = false;
            return;
        }
        setAnnouncement(`${route.title} 화면`);
        document.getElementById("appRoot")?.focus();
    }, [locationKey, route.title]);

    const Page = route.component;
    return (
        <>
            <Suspense fallback={<div role="status">화면을 불러오는 중...</div>}>
                <Page key={locationKey} />
            </Suspense>
            <div className="route-announcement" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>
        </>
    );
}

const root = document.getElementById("appRoot");
if (!root) throw new Error("Missing #appRoot");
createRoot(root).render(<StrictMode><App /></StrictMode>);
