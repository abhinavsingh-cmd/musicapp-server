"use client";

import { useEffect, useState } from "react";

interface AnimatedPathProps {
  d: string;
  viewBox: string;
  width: number;
  height: number;
  delay: number;
  duration: number;
  strokeWidth?: number;
  className?: string;
}

export interface Word {
  word: string;
  d: string;
  viewBox: string;
}

export const WORDS: Word[] = [
  { word: 'Music', d: 'M 50 50 Q 100 20 150 50 T 250 50', viewBox: '0 0 300 100' },
];

export function AnimatedPath({
  d,
  viewBox,
  width,
  height,
  delay,
  duration,
  strokeWidth = 2,
  className = "text-rose-500",
}: AnimatedPathProps) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay * 1000);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      style={{
        clipPath: started ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
        transition: `clip-path ${duration}s cubic-bezier(0.25, 0.1, 0.25, 1)`,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={viewBox}
        className={className}
        aria-hidden={true}
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
