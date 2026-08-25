"use client";

import * as opentype from "opentype.js";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { cn } from "@/utils/cn";

const DEFAULT_FONT_URL = "/fonts/IndieFlower-Regular.ttf";

const fontCache = new Map<string, Promise<opentype.Font>>();

function getFont(fontUrl: string): Promise<opentype.Font> {
  let p = fontCache.get(fontUrl);
  if (!p) {
    p = fetch(fontUrl)
      .then((res) => res.arrayBuffer())
      .then((buf) => opentype.parse(buf))
      .catch((err) => {
        fontCache.delete(fontUrl);
        throw err;
      });
    fontCache.set(fontUrl, p);
  }
  return p;
}

interface HandwritingSvgProps {
  path?: string;
  text?: string;
  fontUrl?: string;
  className?: string;
  strokeClassName?: string;
  duration?: number;
  delay?: number;
  strokeWidth?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  ease?: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

const easeMap: Record<string, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export function HandwritingSvg({
  path: pathProp,
  text,
  fontUrl = DEFAULT_FONT_URL,
  className,
  strokeClassName,
  duration = 2,
  delay = 0.5,
  strokeWidth = 2,
  width = 100,
  height = 100,
  fontSize = 48,
  ease = "easeInOut",
}: HandwritingSvgProps) {
  const [d, setD] = useState<string>(pathProp ?? "");
  const [viewBox, setViewBox] = useState(`0 0 ${width} ${height}`);
  const [loading, setLoading] = useState(!!text && !pathProp);
  const [, setAnimated] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!text || pathProp) {
      setD(pathProp ?? "");
      setViewBox(`0 0 ${width} ${height}`);
      setLoading(false);
      setAnimated(!!pathProp);
      return;
    }
    cancelledRef.current = false;
    setLoading(true);
    setAnimated(false);

    getFont(fontUrl)
      .then((font) => {
        if (cancelledRef.current) return;
        const p = font.getPath(text, 0, fontSize, fontSize);
        const bbox = p.getBoundingBox();
        const pad = 5;
        const vx = Math.floor(bbox.x1) - pad;
        const vy = Math.floor(bbox.y1) - pad;
        const vw = Math.ceil(bbox.x2 - bbox.x1) + pad * 2;
        const vh = Math.ceil(bbox.y2 - bbox.y1) + pad * 2;
        setViewBox(`${vx} ${vy} ${vw} ${vh}`);
        setD(p.toPathData(2));
      })
      .catch(() => {
        if (!cancelledRef.current) setD("");
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [text, fontUrl, pathProp, fontSize, width, height]);

  // Measure path length before paint, hide it
  useLayoutEffect(() => {
    if (!d || !pathRef.current) return;
    const el = pathRef.current;
    const length = el.getTotalLength();
    el.style.strokeDasharray = `${length}`;
    el.style.strokeDashoffset = `${length}`;
    el.style.transition = "none";
  }, [d]);

  // Animate after paint
  useEffect(() => {
    if (!d || !pathRef.current) return;
    const el = pathRef.current;
    const raf = requestAnimationFrame(() => {
      el.style.transition = `stroke-dashoffset ${duration}s ${easeMap[ease]} ${delay}s`;
      el.style.strokeDashoffset = "0";
      setAnimated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [d, duration, ease, delay]);

  if (loading) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("text-muted-foreground", className)}
        aria-hidden={true}
      >
        <title>Handwriting SVG loading</title>
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={14}
        >
          Loading…
        </text>
      </svg>
    );
  }

  if (!d) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("text-muted-foreground", className)}
        aria-hidden={true}
      >
        <title>Handwriting SVG</title>
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
        >
          {text ? "Invalid font" : "Provide path or text"}
        </text>
      </svg>
    );
  }

  const svgViewBox = pathProp ? `0 0 ${width} ${height}` : viewBox;

  return (
    <svg
      width={width}
      height={height}
      viewBox={svgViewBox}
      className={cn("text-rose-500", className)}
      aria-hidden={true}
    >
      <title>Handwriting SVG</title>
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
      />
    </svg>
  );
}

export default HandwritingSvg;
