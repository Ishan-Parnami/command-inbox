"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DATA = [
  { priority: "Urgent", count: 12, fill: "#ef4444" },
  { priority: "High", count: 34, fill: "#f59e0b" },
  { priority: "Normal", count: 87, fill: "#6366f1" },
  { priority: "Low", count: 51, fill: "#64748b" },
];

export function PriorityChart() {
  // Recharts' ResponsiveContainer measures its parent on first paint; during
  // SSR hydration that can resolve to -1 and emit a console warning. Render the
  // chart only after mount, when the container has real dimensions.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-72 w-full" />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={DATA} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <XAxis
            dataKey="priority"
            tickLine={false}
            axisLine={false}
            className="text-xs"
            stroke="currentColor"
          />
          <YAxis tickLine={false} axisLine={false} className="text-xs" stroke="currentColor" width={28} />
          <Tooltip
            cursor={{ fill: "currentColor", opacity: 0.06 }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {DATA.map((d) => (
              <Cell key={d.priority} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
