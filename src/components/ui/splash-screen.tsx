"use client";

import { useEffect, useState, useCallback } from "react";
import { HandwritingSvg } from "./handwriting-svg";

interface SplashScreenProps {
  onComplete?: () => void;
  autoDismissMs?: number;
}

const WORDS = ["Music", "App"];
const WORD_DELAY_MS = 800;
const WORD_DURATION_S = 2.0;

export function SplashScreen({
  onComplete,
  autoDismissMs = 10000,
}: SplashScreenProps) {
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [hidden, setHidden] = useState(false);

  const totalAnimMs = WORDS.length * WORD_DELAY_MS + WORD_DURATION_S * 1000 + 500;

  const dismiss = useCallback(() => {
    setExiting(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowSubtitle(true), WORD_DELAY_MS);
    return () => clearTimeout(t);
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
      onTransitionEnd={handleTransitionEnd}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-[#0a0a14] ${
        exiting
          ? "-translate-y-full transition-transform duration-700 ease-[cubic-bezier(0.76,0,0.24,1)]"
          : "translate-y-0"
      }`}
      style={{ willChange: "transform" }}
      onClick={dismiss}
    >
      {/* Subtle background gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse at 30% 50%, rgba(139, 92, 246, 0.15) 0%, transparent 60%), radial-gradient(ellipse at 70% 50%, rgba(244, 63, 94, 0.1) 0%, transparent 60%)",
        }}
      />

      {/* Icon */}
      <div className="relative mb-8">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgb(244 63 94)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>

      {/* Handwritten "MusicApp" */}
      <div className="relative flex flex-col items-center gap-1">
        {WORDS.map((word, i) => (
          <HandwritingSvg
            key={word}
            text={word}
            width={400}
            height={80}
            fontSize={64}
            strokeWidth={1.5}
            duration={WORD_DURATION_S}
            delay={i * WORD_DELAY_MS / 1000}
            ease="easeInOut"
            className="text-rose-500"
          />
        ))}
      </div>

      {/* Subtitle */}
      <p
        className={`relative mt-6 text-sm tracking-wide text-white/60 transition-all duration-700 ${
          showSubtitle ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        Your Music, Your Mood
      </p>

      {/* Continue button */}
      <div
        className={`relative mt-14 overflow-hidden transition-all duration-500 ${
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
