import { CATEGORIES, CATEGORY_LABELS, type Category } from "../types";

type Props = { scores: Record<Category, number | null>; size?: number };

const RINGS = [20, 40, 60, 80, 100];

/** 5 軸のレーダーチャート。0 点は中心、100 点は外周。 */
export function RadarChart({ scores, size = 320 }: Props) {
  const c = size / 2;
  const radius = size / 2 - 52;
  const n = CATEGORIES.length;

  const point = (i: number, value: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (radius * value) / 100;
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)];
  };
  const polygon = (values: number[]) => values.map((v, i) => point(i, v).join(",")).join(" ");

  const values = CATEGORIES.map((k) => scores[k] ?? 0);
  const label = CATEGORIES.map((k) => `${CATEGORY_LABELS[k]} ${scores[k] ?? "-"}点`).join("、");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`カテゴリ別スコア: ${label}`} className="radar">
      {RINGS.map((ring) => (
        <polygon key={ring} points={polygon(CATEGORIES.map(() => ring))} className="radar-ring" />
      ))}
      {CATEGORIES.map((_, i) => {
        const [x, y] = point(i, 100);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="radar-axis" />;
      })}
      <polygon points={polygon(values)} className="radar-area" />
      {values.map((v, i) => {
        const [x, y] = point(i, v);
        return <circle key={i} cx={x} cy={y} r={4} className="radar-dot" />;
      })}
      {CATEGORIES.map((k, i) => {
        const [x, y] = point(i, 100);
        const dx = x - c;
        const anchor = Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
        const ox = Math.abs(dx) < 4 ? 0 : dx > 0 ? 8 : -8;
        const oy = y < c ? -8 : y > c + radius * 0.9 ? 16 : 4;
        return (
          <text key={k} x={x + ox} y={y + oy} textAnchor={anchor} className="radar-label">
            {CATEGORY_LABELS[k]}
            <tspan x={x + ox} dy="1.2em" className="radar-value">
              {scores[k] ?? "-"}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
