import BLOCKS from "../state/blocks.ts";
import type { PieceType } from "../state/blocks.ts";

/** NEXT/HOLD용 조각 모양만 표시하며 gameplay state를 소유하지 않는다. */
export function PiecePreview({ pieceType, shapeOnly = false }: { pieceType: PieceType | null; shapeOnly?: boolean }) {
    const offsets = pieceType
        ? BLOCKS[pieceType][0]
        : null;
    const occupied = new Set<string>();
    let columns = 4;
    if (offsets) {
        const minX = Math.min(...offsets.map(([x]) => x));
        const minY = Math.min(...offsets.map(([, y]) => y));
        columns = Math.max(...offsets.map(([x]) => x)) - minX + 1;
        offsets.forEach(([x, y]) => occupied.add(`${y - minY}:${x - minX}`));
    }

    return (
        <ul className={shapeOnly ? "next-grid piece-shape" : "next-grid"}
            style={shapeOnly ? { gridTemplateColumns: `repeat(${columns}, 20px)` } : undefined}>
            {Array.from({ length: 16 }, (_, index) => {
                const active = occupied.has(`${Math.floor(index / 4)}:${index % 4}`);
                const className = active && pieceType
                    ? `next-cell ${pieceType} preview`
                    : "next-cell";
                return <li className={className} key={index}
                    style={shapeOnly ? { gridColumn: index % 4 + 1, gridRow: Math.floor(index / 4) + 1 } : undefined} />;
            })}
        </ul>
    );
}
