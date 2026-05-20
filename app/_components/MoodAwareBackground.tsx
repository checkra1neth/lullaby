"use client";

import { useEffect, useRef } from "react";
import { applyMood, readMoodVars } from "@/lib/mood/applyMood";
import { type Mood } from "@/lib/mood/MOODS";

interface MoodAwareBackgroundProps {
  /** Initial mood applied on mount. Defaults to "default" (h:245, s:55%, l:70%). */
  initialMood?: Mood;
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinkleSpeed: number;
  phase: number;
  driftX: number;
  driftY: number;
  baseAlpha: number;
  visualX?: number;
  visualY?: number;
}

interface Dust {
  x: number;
  y: number;
  progress: number;
  offsetY: number;
  size: number;
  alpha: number;
  speed: number;
}

interface ShootingStar {
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
  speed: number;
  alpha: number;
  fadeSpeed: number;
  color: string;
}

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
}

export function MoodAwareBackground({
  initialMood = "default",
}: MoodAwareBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const starMapRef = useRef<HTMLDivElement | null>(null);
  const moonChartRef = useRef<HTMLDivElement | null>(null);

  // Use refs for animation variables to prevent unnecessary re-renders
  const starsRef = useRef<Star[]>([]);
  const dustRef = useRef<Dust[]>([]);
  const shootingStarsRef = useRef<ShootingStar[]>([]);
  const sparklesRef = useRef<Sparkle[]>([]);
  const scrollRef = useRef(0);
  const smoothScrollRef = useRef(0);
  const mouseRef = useRef({
    x: -1000,
    y: -1000,
    targetX: -1000,
    targetY: -1000,
    active: false,
  });

  useEffect(() => {
    // 1. Initial CSS mood settings
    const cs = getComputedStyle(document.documentElement);
    const h = cs.getPropertyValue("--mood-h").trim();
    if (h === "" || h === "245") {
      applyMood(initialMood);
    }
  }, [initialMood]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;

    // Helper to generate stars based on screen size density
    const initStars = (w: number, h: number) => {
      const starCount = Math.min(120, Math.floor((w * h) / 12000));
      const arr: Star[] = [];
      for (let i = 0; i < starCount; i++) {
        arr.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: 0.6 + Math.random() * 1.8,
          twinkleSpeed: 0.005 + Math.random() * 0.015,
          phase: Math.random() * Math.PI * 2,
          driftX: (Math.random() - 0.5) * 0.04,
          driftY: (Math.random() - 0.5) * 0.04,
          baseAlpha: 0.15 + Math.random() * 0.5,
        });
      }
      starsRef.current = arr;
    };

    // Helper to generate cosmic dust particles
    const initDust = (w: number) => {
      const dustCount = 90;
      const arr: Dust[] = [];
      for (let i = 0; i < dustCount; i++) {
        arr.push({
          x: Math.random() * w,
          y: 0,
          progress: Math.random(),
          offsetY: (Math.random() - 0.5) * 120, // vertical spread around the wave path
          size: 0.4 + Math.random() * 1.2,
          alpha: 0.15 + Math.random() * 0.4,
          speed: 0.0002 + Math.random() * 0.0005,
        });
      }
      dustRef.current = arr;
    };

    // Initialize scroll positions
    scrollRef.current = window.scrollY;
    smoothScrollRef.current = window.scrollY;

    const handleScroll = () => {
      scrollRef.current = window.scrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    // Track max scroll height for normalized scroll fraction
    let maxScroll = 1;
    const updateMaxScroll = () => {
      if (typeof document !== "undefined") {
        maxScroll = Math.max(
          1,
          document.documentElement.scrollHeight - window.innerHeight
        );
      }
    };
    updateMaxScroll();

    // Secondary delay to ensure NextJS layout/hydration has settled
    const maxScrollTimeout = setTimeout(updateMaxScroll, 800);

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Re-init elements for new dimension
      initStars(width, height);
      initDust(width);
      updateMaxScroll();
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    // Mouse movement listeners
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.targetX = e.clientX;
      mouseRef.current.targetY = e.clientY;
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    // Click handler to trigger shooting stars and sparkles
    const handleWindowClick = (e: MouseEvent) => {
      const clickX = e.clientX;
      const clickY = e.clientY;

      // Read current mood color
      let moodHsl = { h: 245, s: 55, l: 70 };
      try {
        moodHsl = readMoodVars();
        if (Number.isNaN(moodHsl.h)) {
          moodHsl = { h: 245, s: 55, l: 70 };
        }
      } catch {
        // Fallback
      }

      const sparkColor = `hsla(${moodHsl.h}, ${moodHsl.s}%, ${moodHsl.l + 10}%, `;

      // 1. Spawn a custom shooting star cutting across the clicked area
      const angle = Math.random() * Math.PI * 0.2 + Math.PI * 0.15; // diagonal down-right
      const speed = 14 + Math.random() * 6;
      shootingStarsRef.current.push({
        x: clickX - Math.cos(angle) * 150,
        y: clickY - Math.sin(angle) * 150,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        length: 80 + Math.random() * 60,
        speed,
        alpha: 1.0,
        fadeSpeed: 0.015 + Math.random() * 0.01,
        color: sparkColor,
      });

      // 2. Spawn a burst of 6–10 sparkles
      const burstCount = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < burstCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const velocity = 0.5 + Math.random() * 2.5;
        sparklesRef.current.push({
          x: clickX,
          y: clickY,
          vx: Math.cos(theta) * velocity,
          vy: Math.sin(theta) * velocity,
          size: 1 + Math.random() * 2,
          alpha: 0.8 + Math.random() * 0.2,
          decay: 0.01 + Math.random() * 0.02,
          color: sparkColor,
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("click", handleWindowClick);

    // Touch events support for mobile devices
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        mouseRef.current.targetX = touch.clientX;
        mouseRef.current.targetY = touch.clientY;
        mouseRef.current.active = true;
      }
    };

    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleMouseLeave);

    // Track time for animation equations
    let time = 0;

    // Render loop
    const tick = () => {
      time++;
      ctx.clearRect(0, 0, width, height);

      // Smoothly interpolate scroll position (buttery smooth parallax inertia)
      smoothScrollRef.current += (scrollRef.current - smoothScrollRef.current) * 0.08;
      const scrollY = smoothScrollRef.current;
      const scrollFraction = maxScroll > 0 ? Math.min(1, Math.max(0, scrollY / maxScroll)) : 0;

      // Update background image transform (GPU-accelerated parallax translation and subtle zoom)
      if (bgRef.current) {
        // Translate up to -200px (fitting the calc(100vh + 220px) height budget perfectly)
        const bgTranslateY = -scrollFraction * 200;
        const bgScale = 1.02 + scrollFraction * 0.05;
        bgRef.current.style.transform = `translate3d(0, ${bgTranslateY}px, 0) scale(${bgScale})`;
      }

      // Parallax for the star map layer (drifts slower, e.g. up to -120px)
      if (starMapRef.current) {
        const starMapTranslateY = -scrollFraction * 120;
        starMapRef.current.style.transform = `translate3d(0, ${starMapTranslateY}px, 0)`;
      }

      // Parallax for the moon chart layer (drifts faster, e.g. up to -350px)
      if (moonChartRef.current) {
        const moonChartTranslateY = -scrollFraction * 350;
        moonChartRef.current.style.transform = `translate3d(0, ${moonChartTranslateY}px, 0)`;
      }

      // Smoothly interpolate mouse position
      const mouse = mouseRef.current;
      if (mouse.x === -1000) {
        mouse.x = mouse.targetX;
        mouse.y = mouse.targetY;
      } else {
        mouse.x += (mouse.targetX - mouse.x) * 0.08;
        mouse.y += (mouse.targetY - mouse.y) * 0.08;
      }

      // 1. Read current mood dynamically from CSS variables
      let moodHsl = { h: 245, s: 55, l: 70 };
      try {
        moodHsl = readMoodVars();
        if (Number.isNaN(moodHsl.h)) {
          moodHsl = { h: 245, s: 55, l: 70 };
        }
      } catch {
        // Safe fallback
      }

      // 2. Draw shifting cosmic nebula radial gradients (brighter for rich background aesthetic)
      // Nebulae translate slightly with scroll to create a deeper layer depth
      // Nebula 1: Top Right, moving slowly
      const nebula1X = width * 0.75 + Math.sin(time * 0.0003) * width * 0.1;
      const nebula1Y = height * 0.25 + Math.cos(time * 0.0002) * height * 0.1 - scrollY * 0.15;
      const grad1 = ctx.createRadialGradient(
        nebula1X,
        nebula1Y,
        0,
        nebula1X,
        nebula1Y,
        width * 0.55
      );
      grad1.addColorStop(0, `hsla(${moodHsl.h}, ${moodHsl.s}%, ${moodHsl.l}%, 0.075)`);
      grad1.addColorStop(0.5, `hsla(${(moodHsl.h + 25) % 360}, ${moodHsl.s}%, ${moodHsl.l}%, 0.035)`);
      grad1.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, width, height);

      // Nebula 2: Bottom Left, complementary color
      const nebula2X = width * 0.25 + Math.cos(time * 0.0002) * width * 0.1;
      const nebula2Y = height * 0.75 + Math.sin(time * 0.0003) * height * 0.1 - scrollY * 0.12;
      const grad2 = ctx.createRadialGradient(
        nebula2X,
        nebula2Y,
        0,
        nebula2X,
        nebula2Y,
        width * 0.45
      );
      const complementaryHue = (moodHsl.h + 180) % 360;
      grad2.addColorStop(0, `hsla(${complementaryHue}, ${moodHsl.s - 15}%, ${moodHsl.l}%, 0.025)`);
      grad2.addColorStop(0.5, `hsla(${complementaryHue}, ${moodHsl.s - 15}%, ${moodHsl.l}%, 0.01)`);
      grad2.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);

      // 3. Draw mouse torch glow aura if active
      if (mouse.active && mouse.x > -100 && mouse.y > -100) {
        const mouseGrad = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          130
        );
        mouseGrad.addColorStop(0, `hsla(${moodHsl.h}, ${moodHsl.s}%, ${moodHsl.l}%, 0.055)`);
        mouseGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = mouseGrad;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 130, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Draw Cosmic Dust River winding across the screen
      const dust = dustRef.current;
      for (let i = 0; i < dust.length; i++) {
        const d = dust[i];
        d.progress += d.speed;
        if (d.progress > 1) {
          d.progress = 0;
          d.offsetY = (Math.random() - 0.5) * 120;
        }

        d.x = d.progress * width;
        // Winding sine wave path representing a galaxy arm
        const waveY = height * 0.48 + Math.sin(d.progress * Math.PI * 1.6 + time * 0.0012) * (height * 0.18);
        d.y = waveY + d.offsetY;

        // Apply a subtle scroll parallax shift to the dust layer
        const visualDustY = d.y - scrollY * 0.08;

        ctx.fillStyle = `hsla(${moodHsl.h}, ${moodHsl.s}%, ${moodHsl.l + 10}%, ${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, visualDustY, d.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Update stars with 3D parallax drift
      const stars = starsRef.current;
      const maxDistance = 75;

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Apply drift
        star.x += star.driftX;
        star.y += star.driftY;

        // Wrap around boundaries
        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        // Visual parallax: larger stars move faster (simulate depth)
        const parallaxSpeed = star.size * 0.06;
        let visualY = (star.y - scrollY * parallaxSpeed) % height;
        if (visualY < 0) visualY += height;

        star.visualX = star.x;
        star.visualY = visualY;
      }

      // Draw stars and connection lines using visual coordinates
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const vX = star.visualX ?? star.x;
        const vY = star.visualY ?? star.y;

        // Twinkling logic
        star.phase += star.twinkleSpeed;

        // Calculate proximity alpha boost from mouse
        let alpha = star.baseAlpha + Math.sin(star.phase) * (star.baseAlpha * 0.45);
        let sizeScale = 1.0;

        if (mouse.active && mouse.x > -100 && mouse.y > -100) {
          const dx = vX - mouse.x;
          const dy = vY - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 130) {
            const factor = 1 - dist / 130;
            alpha += factor * 0.55; // boost brightness
            sizeScale += factor * 0.45; // slightly scale up
            star.phase += star.twinkleSpeed * 1.0; // speed up twinkle
          }
        }

        // Draw star
        ctx.fillStyle = `rgba(245, 240, 235, ${Math.max(0.08, Math.min(1.0, alpha))})`;
        ctx.beginPath();
        ctx.arc(vX, vY, star.size * sizeScale, 0, Math.PI * 2);
        ctx.fill();

        // 6. Draw constellation lines between close stars (using visual coordinates)
        for (let j = i + 1; j < stars.length; j++) {
          const otherStar = stars[j];
          const ovX = otherStar.visualX ?? otherStar.x;
          const ovY = otherStar.visualY ?? otherStar.y;

          const dx = vX - ovX;
          const dy = vY - ovY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxDistance) {
            const lineAlpha = (1 - dist / maxDistance) * 0.035;
            ctx.strokeStyle = `rgba(246, 193, 119, ${lineAlpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(vX, vY);
            ctx.lineTo(ovX, ovY);
            ctx.stroke();
          }
        }
      }

      // 7. Update and draw periodic shooting stars
      if (Math.random() < 0.0015 && shootingStarsRef.current.length < 3) {
        const startX = Math.random() * width * 0.6;
        const startY = Math.random() * height * 0.4;
        const angle = Math.PI * 0.2 + Math.random() * Math.PI * 0.08; // diagonal angle down-right
        const speed = 10 + Math.random() * 6;
        shootingStarsRef.current.push({
          x: startX,
          y: startY,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          length: 60 + Math.random() * 50,
          speed,
          alpha: 1.0,
          fadeSpeed: 0.008 + Math.random() * 0.008,
          color: `hsla(${moodHsl.h}, ${moodHsl.s}%, ${moodHsl.l + 10}%, `,
        });
      }

      const shootingStars = shootingStarsRef.current;
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.x += s.dx;
        s.y += s.dy;
        s.alpha -= s.fadeSpeed;

        if (s.alpha <= 0 || s.x > width + 200 || s.y > height + 200) {
          shootingStars.splice(i, 1);
          continue;
        }

        const grad = ctx.createLinearGradient(
          s.x,
          s.y,
          s.x - s.dx * (s.length / s.speed),
          s.y - s.dy * (s.length / s.speed)
        );
        grad.addColorStop(0, `${s.color}${s.alpha})`);
        grad.addColorStop(1, `${s.color}0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(
          s.x - s.dx * (s.length / s.speed),
          s.y - s.dy * (s.length / s.speed)
        );
        ctx.stroke();
      }

      // 8. Update and draw click sparkles
      const sparkles = sparklesRef.current;
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.02; // soft gravity drag
        sp.alpha -= sp.decay;

        if (sp.alpha <= 0) {
          sparkles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = `${sp.color}${sp.alpha})`;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    tick();

    // Clean up all window and frame listeners on unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(maxScrollTimeout);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseLeave);
    };
  }, []);

  return (
    <>
      <div ref={bgRef} aria-hidden="true" className="mood-bg" />
      <div ref={starMapRef} aria-hidden="true" className="mood-bg-star-map" />
      <div ref={moonChartRef} aria-hidden="true" className="mood-bg-moon-chart" />
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-0"
        style={{ opacity: 0.9 }}
        aria-hidden="true"
      />
    </>
  );
}
