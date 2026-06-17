"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
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

const CHART_HEIGHT = 288;

export function PriorityChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-72 w-full min-w-0">
      {width > 0 && (
        <BarChart width={width} height={CHART_HEIGHT} data={DATA} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-popover border border-border rounded-lg p-2">
                    <p className="text-sm font-medium">{payload[0].name}</p>
                    <p className="text-sm text-muted-foreground">{payload[0].value}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {DATA.map((d) => (
              <Cell key={d.priority} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      )}
    </div>
  );
}
