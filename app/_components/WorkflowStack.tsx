"use client";

import React, { useState } from "react";

export function WorkflowStack() {
  const [activeIndex, setActiveIndex] = useState(0);

  const cards = [
    {
      id: "profile",
      ref: "REF_ID: #01_PROFILE",
      caption: "“Leo, Age 4 — Blueberries & Stars”",
      hoverTx: "-50px",
      hoverTy: "-15px",
      hoverRot: "-15deg",
      svg: (
        <svg viewBox="0 0 100 100" className="w-full h-full bg-[#0a0820] p-4 text-accent/90">
          <circle cx="50" cy="40" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M25 80 C 25 60, 75 60, 75 80" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {/* Stars */}
          <circle cx="20" cy="20" r="1" fill="#f5f0eb" opacity="0.8" />
          <circle cx="80" cy="25" r="1" fill="#f5f0eb" opacity="0.8" />
          <path d="M45 40 L55 40" stroke="currentColor" strokeWidth="1.5" />
          <text x="50" y="88" fontSize="6" fontFamily="monospace" textAnchor="middle" fill="currentColor">
            REF_ID: #01_PROFILE
          </text>
        </svg>
      ),
    },
    {
      id: "vocals",
      ref: "REF_ID: #02_SYNTH",
      caption: "“Synthesizing cozy audio textures”",
      hoverTx: "15px",
      hoverTy: "-25px",
      hoverRot: "0deg",
      svg: (
        <svg viewBox="0 0 100 100" className="w-full h-full bg-[#0a0820] p-4 text-accent/90">
          <path d="M50 20 L50 65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="42" y="25" width="16" height="30" rx="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M30 40 C 30 65, 70 65, 70 40" fill="none" stroke="currentColor" strokeWidth="2" />
          {/* Soundwaves */}
          <path d="M15 50 Q 25 35, 35 50 T 55 50 T 75 50 T 85 50" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" />
          <text x="50" y="88" fontSize="6" fontFamily="monospace" textAnchor="middle" fill="currentColor">
            REF_ID: #02_SYNTH
          </text>
        </svg>
      ),
    },
    {
      id: "cassette",
      ref: "REF_ID: #03_DELIVERY",
      caption: "“A digital keepsake ready for bedtime”",
      hoverTx: "75px",
      hoverTy: "-5px",
      hoverRot: "12deg",
      svg: (
        <svg viewBox="0 0 100 100" className="w-full h-full bg-[#0a0820] p-4 text-accent/90">
          <rect x="15" y="25" width="70" height="46" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="25" y="32" width="50" height="15" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="40" cy="56" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="56" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M35 56 L65 56" stroke="currentColor" strokeWidth="1" />
          <text x="50" y="88" fontSize="6" fontFamily="monospace" textAnchor="middle" fill="currentColor">
            REF_ID: #03_DELIVERY
          </text>
        </svg>
      ),
    },
  ];

  const handleStackClick = () => {
    setActiveIndex((prev) => (prev + 1) % 3);
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="text-[10px] font-mono tracking-[0.2em] text-accent/40 mb-6 uppercase text-center select-none">
        [ HOVER TO SPREAD // CLICK TO CYCLE STACK ]
      </div>

      <div
        className="polaroid-stack group cursor-pointer"
        onClick={handleStackClick}
        role="button"
        tabIndex={0}
        aria-label="Interactive workflow stack. Click to cycle cards, hover to fan out."
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleStackClick();
          }
        }}
      >
        {cards.map((card, i) => {
          // Calculate depth: 0 = top, 1 = middle, 2 = bottom
          const depth = (i - activeIndex + 3) % 3;

          return (
            <div
              key={card.id}
              className={`polaroid-stack-item polaroid-item-${i} polaroid-depth-${depth}`}
              style={
                {
                  "--hover-tx": card.hoverTx,
                  "--hover-ty": card.hoverTy,
                  "--hover-rot": card.hoverRot,
                } as React.CSSProperties
              }
            >
              <div className="polaroid-card">
                {/* Photo corners holding picture */}
                <div className="polaroid-corner polaroid-corner-tl" />
                <div className="polaroid-corner polaroid-corner-tr" />
                <div className="polaroid-corner polaroid-corner-bl" />
                <div className="polaroid-corner polaroid-corner-br" />

                {/* Polaroid Inner Image Wrapper */}
                <div className="polaroid-image-wrapper select-none pointer-events-none">
                  {card.svg}
                </div>

                {/* Elegant handwriting note inside the polaroid wider bottom edge */}
                <div className="polaroid-handwriting text-sm mt-3 select-none">
                  {card.caption}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
