// =============================
// PJAX Vanilla Router (옵션 A)
// =============================
// 메인 페이지와 멀티 로비 간 이동 시 페이지 새로고침을 방지하여
// 백그라운드 오디오(BGM)가 끊기지 않도록 화면만 교체하는 라우터입니다.

const APP_ROOT_SELECTOR = "#app-content";

export function initRouter() {
    // 1번만 초기화 (전역 리스너 중복 방지)
    if (window._routerInitialized) return;
    window._routerInitialized = true;

    // 모든 클릭 이벤트를 가로채기
    document.addEventListener("click", (e) => {
        // 링크(a)를 클릭했는지 확인
        const link = e.target.closest("a");
        if (!link) return;

        const href = link.getAttribute("href");
        
        // 무시할 링크 (타 도메인, 해시, 새 창 띄우기)
        if (!href || href.startsWith("http") || href.startsWith("#") || link.target === "_blank") {
            return;
        }

        // --- 옵션 A ---
        // 싱글플레이나 기타 게임 코어는 구조가 다르므로 기존처럼 일반 로딩 허용
        if (href.includes("tetrisSingle.html")) {
            return;
        }

        // 라우팅 대상인 경우 브라우저 기본 이동을 차단
        e.preventDefault();
        navigateTo(href);
    });

    // 브라우저 뒤로 가기 / 앞으로 가기 대응
    window.addEventListener("popstate", (e) => {
        if (e.state && e.state.path) {
            loadContent(e.state.path);
        } else {
            const currentPath = location.pathname.split('/').pop() || 'index.html';
            loadContent(currentPath);
        }
    });

    // 시작 지점의 URL 정보 등록
    const startPath = location.pathname.split('/').pop() || 'index.html';
    history.replaceState({ path: startPath }, "", location.href);
}

/**
 * 브라우저 주소를 변경하고 새 문서를 불러옵니다.
 * @param {string} url - 이동할 상대 경로 
 */
async function navigateTo(url) {
    history.pushState({ path: url }, "", url);
    await loadContent(url);
}

/**
 * HTML 본문을 fetch해와서 렌더링하고 스크립트를 재실행합니다.
 * @param {string} url 
 */
async function loadContent(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const newAppContent = doc.querySelector(APP_ROOT_SELECTOR);
        if (newAppContent) {
            // 화면 갈아끼우기
            const currentAppContent = document.querySelector(APP_ROOT_SELECTOR);
            currentAppContent.innerHTML = newAppContent.innerHTML;

            // 타이틀 교체
            if (doc.title) document.title = doc.title;

            // DOM 덮어쓰기(`innerHTML`)로 들어온 <script>는 실행되지 않으므로 
            // 요소를 추출해 수동으로 실행
            executeScripts(currentAppContent);
        } else {
            console.warn("해당 문서에 #app-content 영역이 없습니다. 일반 로딩합니다.");
            window.location.href = url;
        }
    } catch (err) {
        console.error("라우팅 오류 (Fallback to hard load):", err);
        window.location.href = url;
    }
}

/**
 * 지정된 컨테이너 내부의 모든 <script> 태그를 뽑아내어
 * 똑같은 노드를 동적으로 생성, 교체하여 실행되도록 만듭니다.
 *
 * @param {HTMLElement} container - 스크립트 실행이 필요한 구역
 */
function executeScripts(container) {
    const scripts = container.querySelectorAll("script");
    scripts.forEach(oldScript => {
        const newScript = document.createElement("script");
        
        // 모듈 등 속성들 그대로 물려받기
        Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
        });
        
        // 실제 자바스크립트 코드 구문
        newScript.textContent = oldScript.textContent;
        
        // 기존 요소를 걷어내고 새 노드를 삽입 (이 순간 실행)
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

// 파일이 로드되면 라우터 시스템 즉각 가동
initRouter();
