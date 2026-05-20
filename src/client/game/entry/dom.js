function getQueryScope(root) {
    return root ?? document
}

/**
 * root 범위 안에서 첫 번째 일치 요소를 조회한다.
 *
 * @param {ParentNode|null|undefined} root - 조회 기준 루트
 * @param {string} selector - 찾을 CSS selector
 * @returns {Element|null} 찾은 요소 또는 null
 */
export function queryElement(root, selector) {
    return getQueryScope(root).querySelector(selector)
}

/**
 * root 범위 안에서 필수 요소를 조회하고, 없으면 문맥 정보를 포함한 오류를 던진다.
 *
 * @param {ParentNode|null|undefined} root - 조회 기준 루트
 * @param {string} selector - 찾을 CSS selector
 * @param {string} contextLabel - 오류 메시지에 포함할 호출 문맥
 * @returns {Element} 찾은 DOM 요소
 */
export function requireElement(root, selector, contextLabel) {
    const element = queryElement(root, selector)
    if (!element) {
        throw new Error(`${contextLabel}: missing required element "${selector}"`)
    }
    return element
}
