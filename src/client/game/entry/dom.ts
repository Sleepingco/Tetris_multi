function getQueryScope(root: ParentNode | null | undefined): ParentNode {
        return root ?? document
}

/**
  * root 범위 안에서 첫 번째 일치 요소를 조회한다.
  *
  * @param {ParentNode|null|undefined} root - 조회 기준 루트
  * @param {string} selector - 찾을 CSS selector
  * @returns {Element|null} 찾은 요소 또는 null
  */
export function queryElement<ElementType extends Element = Element>(
        root: ParentNode | null | undefined,
        selector: string,
): ElementType | null {
        return getQueryScope(root).querySelector<ElementType>(selector)
}

/**
  * root 범위 안에서 필수 요소를 조회하고, 없으면 문맥 정보를 포함한 오류를 던진다.
  *
  * @param {ParentNode|null|undefined} root - 조회 기준 루트
  * @param {string} selector - 찾을 CSS selector
  * @param {string} contextLabel - 오류 메시지에 포함할 호출 문맥
  * @returns {Element} 찾은 DOM 요소
  */
export function requireElement<ElementType extends Element = Element>(
        root: ParentNode | null | undefined,
        selector: string,
        contextLabel: string,
): ElementType {
        const element = queryElement<ElementType>(root, selector)
        if (!element) {
                throw new Error(`${contextLabel}: missing required element "${selector}"`)
        }
        return element
}
