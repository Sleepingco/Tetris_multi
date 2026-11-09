const brandMarkUrl = new URL("../../assets/favicon.svg", import.meta.url).href;

/** 모든 page header에서 같은 기존 SVG 엠블럼과 브랜드 표기를 사용한다. */
export function BrandLogo({ context }: { context?: string }) {
    return <span className="brand-logo">
        <img className="brand-mark" src={brandMarkUrl} alt="" width="32" height="32" />
        <span className="brand-wordmark">Tetra Arena{context && <small className="brand-context">{context}</small>}</span>
    </span>;
}
