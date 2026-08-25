"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatedPath, WORDS } from "./animated-path";

interface SplashScreenProps {
  onComplete?: () => void;
  autoDismissMs?: number;
}

export function SplashScreen({
  onComplete,
  autoDismissMs = 8000,
}: SplashScreenProps) {
  const [showButton, setShowButton] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [hidden, setHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalAnimMs = (WORDS.length - 1) * 800 + 2000 + 500;

  const dismiss = useCallback(() => {
    setExiting(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowButton(true), totalAnimMs);
    return () => clearTimeout(t);
  }, [totalAnimMs]);

  useEffect(() => {
    if (!showButton) return;
    const remaining = autoDismissMs - totalAnimMs;
    if (remaining <= 0) {
      dismiss();
      return;
    }
    const t = setTimeout(() => dismiss(), remaining);
    return () => clearTimeout(t);
  }, [showButton, autoDismissMs, totalAnimMs, dismiss]);

  const handleTransitionEnd = useCallback(() => {
    if (exiting) {
      setHidden(true);
      onComplete?.();
    }
  }, [exiting, onComplete]);

  if (hidden) return null;

  return (
    <div
      ref={containerRef}
      onTransitionEnd={handleTransitionEnd}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black ${
        exiting
          ? "-translate-y-full transition-transform duration-700 ease-[cubic-bezier(0.76,0,0.24,1)]"
          : "translate-y-0"
      }`}
      style={{ willChange: "transform" }}
      onClick={dismiss}
    >
      <div className="mb-10 flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgb(244 63 94)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
        </svg>
        <span className="text-sm font-medium text-white">Handwritten</span>
      </div>

      <div className="flex flex-col items-center">
        {WORDS.map((w: { word: string; d: string; viewBox: string }, i: number) => (
          <AnimatedPath
            key={w.word}
            d={w.d}
            viewBox={w.viewBox}
            width={720}
            height={120}
            strokeWidth={2}
            delay={i * 0.8}
            duration={2}
            className="text-rose-500"
          />
        ))}
      </div>

      <div
        className={`mt-12 overflow-hidden transition-all duration-500 ${
          showButton ? "max-h-20 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          className="cursor-pointer rounded-full border border-rose-500/30 bg-rose-500/10 px-8 py-3 text-sm font-medium text-rose-500 backdrop-blur-sm transition-colors hover:bg-rose-500/20"
        >
          Click to continue
        </button>
      </div>
    </div>
  );
}
