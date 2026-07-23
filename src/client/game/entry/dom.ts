// =============================
// 페이지 DOM 조회 경계
// root가 있으면 해당 page/component 안에서 찾고, 없으면 document 전체를 사용한다.
// 선택 요소는 null을 허용하고 필수 요소는 시작 시점에 명확한 오류로 실패시킨다.
// =============================

function getQueryScope(root: ParentNode | null | undefined): ParentNode {
        return root ?? document
}

/**
  * root 범위에서 첫 번째 일치 요소를 찾는다.
  * 요소가 없어도 정상인 선택 UI에 사용하며, 호출자가 null 처리를 결정한다.
  */
export function queryElement<ElementType extends Element = Element>(
        root: ParentNode | null | undefined,
        selector: string,
): ElementType | null {
        return getQueryScope(root).querySelector<ElementType>(selector)
}

/**
  * page 실행에 꼭 필요한 요소를 찾고, 없으면 selector와 호출 문맥을 포함해 즉시 실패한다.
  * 뒤쪽 코드에서 모호한 null 오류가 나기 전에 잘못된 HTML mount 계약을 드러내는 역할이다.
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
