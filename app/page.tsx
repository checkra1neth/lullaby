import React from "react";
import { CtaButton } from "./_components/CtaButton";
import { Icon } from "./_components/Icon";
import { WorkflowStack } from "./_components/WorkflowStack";
import {
  loadMarketingPrice,
  type MarketingPrice,
} from "@/lib/marketing/prices";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const [oneOff, subscription] = await Promise.all([
    loadMarketingPrice("STRIPE_PRICE_ONE_OFF"),
    loadMarketingPrice("STRIPE_PRICE_SUBSCRIPTION"),
  ]);

  return (
    <div className="relative overflow-hidden">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <PricingSection oneOff={oneOff} subscription={subscription} />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------
function Navbar() {
  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-glass-border bg-bg/75 backdrop-blur-md celestial-border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2 text-on-surface">
          <Icon name="bedtime" filled size={28} className="text-accent" />
          <div className="flex flex-col">
            <span className="font-display text-xl font-bold tracking-tight leading-none">
              Lullaby
            </span>
            <span className="font-mono text-[8px] tracking-[0.2em] text-accent/60 mt-0.5 uppercase">
              Celestial Audio
            </span>
          </div>
        </a>
        
        {/* Monospaced ledger tag center badge - Hidden on mobile */}
        <div className="hidden lg:flex items-center">
          <span className="ledger-tag text-[9px]">
            <span className="material-symbols-outlined text-[10px] animate-pulse">explore</span>
            SYSTEM ORBIT: 04.9 // ARCHIVE ACTIVE
          </span>
        </div>

        <div className="flex items-center gap-8">
          <div className="hidden items-center gap-8 text-xs font-medium text-on-surface-v sm:flex uppercase tracking-wider font-mono">
            <a href="#features" className="transition-colors hover:text-on-surface">
              Features
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-on-surface">
              How it works
            </a>
            <a href="#pricing" className="transition-colors hover:text-on-surface">
              Pricing
            </a>
          </div>
          <CtaButton href="/create" compact>
            Get started
          </CtaButton>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-32 sm:pt-40 lg:pb-32 lg:pt-48">
      {/* Decorative dot backdrop for vintage feel */}
      <div className="absolute inset-0 celestial-dots opacity-40 pointer-events-none" />
      
      {/* Structural Editorial Layout Grid */}
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8 items-center relative z-10">
        
        {/* Column 1: Editorial Headline & Copy (6 cols) */}
        <div className="flex flex-col gap-6 text-center lg:text-left lg:col-span-6">
          <div className="flex justify-center lg:justify-start">
            <span className="ledger-tag">
              <span className="material-symbols-outlined text-[12px] text-accent">auto_awesome</span>
              EDITION NO. 1 // PERSONALIZED BEDTIME ANTHEMS
            </span>
          </div>

          <h1
            className="hero-anim font-display text-[2.75rem] font-bold leading-[1.05] tracking-[-0.03em] text-on-surface sm:text-6xl lg:text-7xl text-shadow-md"
            style={{ "--delay": "0ms" } as React.CSSProperties}
          >
            A lullaby made
            <br />
            just for{" "}
            <span className="bg-gradient-to-r from-accent to-accent-dim bg-clip-text text-transparent">
              your child
            </span>
          </h1>

          <p
            className="hero-anim mx-auto max-w-md text-base sm:text-lg leading-relaxed text-on-surface/90 text-shadow-sm lg:mx-0"
            style={{ "--delay": "80ms" } as React.CSSProperties}
          >
            Tell us their name, age, and favorite things. We&apos;ll write,
            sing, and deliver a personalized 3–5 minute bedtime song — plus a
            beautiful keepsake video for sleepy little ones.
          </p>

          <div
            className="hero-anim flex flex-col items-center gap-4 sm:flex-row justify-center lg:justify-start mt-2"
            style={{ "--delay": "160ms" } as React.CSSProperties}
          >
            <CtaButton href="/create" iconName="auto_awesome">
              Create a lullaby
            </CtaButton>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-full border border-glass-border px-6 py-3.5 text-xs font-semibold text-on-surface uppercase tracking-wider transition-colors hover:bg-surface-low backdrop-blur-sm"
            >
              <Icon name="play_arrow" size={18} />
              See how it works
            </a>
          </div>

          {/* Coordinate stamp line */}
          <div className="text-[9px] font-mono tracking-[0.25em] text-accent/40 mt-8 select-none uppercase text-center lg:text-left border-t border-accent/10 pt-4">
            SPEC: MP3 RECORDING // LATITUDE: 45.109° N // LONGITUDE: 122.680° W // DEPTH: 16-BIT AUDIO
          </div>
        </div>

        {/* Column 2: Polaroid Celestial Illustration (4 cols) */}
        <div 
          className="hero-anim lg:col-span-4 flex justify-center w-full"
          style={{ "--delay": "240ms" } as React.CSSProperties}
        >
          <HeroIllustration />
        </div>

        {/* Column 3: Custom Ledger Specifications Card (2 cols / side-panel) */}
        <div
          className="hero-anim lg:col-span-2 hidden lg:flex flex-col gap-4 celestial-border-l pl-6 self-stretch justify-center"
          style={{ "--delay": "320ms" } as React.CSSProperties}
        >
          <div className="text-[10px] font-mono tracking-widest text-accent uppercase font-bold">
            [ PARAMETERS ]
          </div>
          
          <div className="flex flex-col gap-3 font-mono text-[11px] text-on-surface-v">
            <div className="border-b border-accent/5 pb-2">
              <span className="text-accent/50 block text-[9px] uppercase">01 / DURATION</span>
              <span className="text-on-surface font-semibold">3 – 5 MINUTES</span>
            </div>
            
            <div className="border-b border-accent/5 pb-2">
              <span className="text-accent/50 block text-[9px] uppercase">02 / FORMAT</span>
              <span className="text-on-surface font-semibold">HIFI MP3 & MP4</span>
            </div>

            <div className="border-b border-accent/5 pb-2">
              <span className="text-accent/50 block text-[9px] uppercase">03 / VOCALIST</span>
              <span className="text-on-surface font-semibold">REAL SOOTHING AI</span>
            </div>

            <div className="pb-1">
              <span className="text-accent/50 block text-[9px] uppercase">04 / KEEPSAKE</span>
              <span className="text-on-surface font-semibold">PRIVATE DOWNLOAD</span>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

function HeroIllustration() {
  return (
    <div className="relative w-full max-w-[310px] sm:max-w-[330px] aspect-[4/5]">
      {/* Outer Polaroid Celestial Card Container */}
      <div className="polaroid-card w-full h-full transform -rotate-1 hover:rotate-0 duration-300">
        
        {/* Photo corners holding picture */}
        <div className="polaroid-corner polaroid-corner-tl" />
        <div className="polaroid-corner polaroid-corner-tr" />
        <div className="polaroid-corner polaroid-corner-bl" />
        <div className="polaroid-corner polaroid-corner-br" />

        {/* Polaroid Inner Image Wrapper */}
        <div className="polaroid-image-wrapper">
          <img
            src="/hero-illustration.png"
            alt="Dreamy Lullaby Moon"
            className="polaroid-image"
          />
          {/* Subtle celestial gold radial gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-bg/30 via-transparent to-transparent pointer-events-none" />
          <div className="absolute inset-0 radial-gradient-glow pointer-events-none opacity-40" />
        </div>

        {/* Elegant handwriting note inside the polaroid wider bottom edge */}
        <div className="polaroid-handwriting">
          &ldquo;Crescent moon over indigo dreamscapes&rdquo;
        </div>

        {/* Little celestial badge */}
        <div className="absolute right-4 bottom-2 text-[8px] font-mono tracking-widest text-accent/40 select-none">
          SL.REF NO. 204
        </div>
      </div>

      {/* Floating vintage circular stamp seal */}
      <div className="absolute left-[-15%] top-[15%] z-20 transition-transform hover:scale-105 duration-300">
        <div className="wax-seal-wrapper scale-90">
          <div className="wax-seal-ribbon wax-seal-ribbon-left" />
          <div className="wax-seal-ribbon wax-seal-ribbon-right" />
          <div className="wax-seal">
            <div className="wax-seal-inner-circle">
              <span className="material-symbols-outlined text-[30px] text-bg">bedtime</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------
function Features() {
  const features = [
    {
      index: "01 / LYRICS",
      icon: "auto_awesome",
      title: "Truly Personal",
      description:
        "Every lyric includes your child's name, age, and the things they love most — like stars, dinosaurs, or blueberries.",
      handwriting: "Tailored to their unique little world",
      catalog: "[ REG. NO. 156 / WRITING ]",
    },
    {
      index: "02 / VOCALS",
      icon: "record_voice_over",
      title: "Real Soothing Voices",
      description:
        "Choose from exceptionally warm, soft narrator voices that sing with real emotion. No robotic text-to-speech.",
      handwriting: "Like a cozy bedtime story sung in person",
      catalog: "[ REG. NO. 158 / AUDIO ]",
    },
    {
      index: "03 / FORMAT",
      icon: "download",
      title: "Yours Forever",
      description:
        "Receive a high-quality, permanent MP3 download and a beautiful shareable video with starry art to surprise family.",
      handwriting: "A premium keepsake to keep for years",
      catalog: "[ REG. NO. 161 / STORAGE ]",
    },
    {
      index: "04 / SAFETY",
      icon: "verified_user",
      title: "Private & Safe",
      description:
        "Your child's details are used only for song generation and are fully protected. We never sell your personal data.",
      handwriting: "Your child's security is our highest law",
      catalog: "[ REG. NO. 165 / SECURITY ]",
    },
  ];

  return (
    <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-24 celestial-border-t celestial-border-b">
      {/* Subtle ledger dot grid backdrop */}
      <div className="absolute inset-0 celestial-dots opacity-30 pointer-events-none" />

      <div className="mb-16 text-center relative z-10">
        <div className="flex justify-center mb-3">
          <span className="ledger-tag text-[9px]">
            <span className="material-symbols-outlined text-[10px] animate-pulse">schema</span>
            CATALOG SPEC: PRIMARY BENEFITS
          </span>
        </div>
        <h2 className="font-display text-4xl font-bold tracking-tight text-on-surface sm:text-5xl text-shadow-md">
          Everything you need
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm sm:text-base text-on-surface/80 text-shadow-sm font-mono tracking-wide uppercase text-accent/60">
          A complete bedtime experience crafted around your little one
        </p>
      </div>

      {/* 2x2 asymmetric star map ledger grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 relative z-10 border border-accent/10 rounded-2xl overflow-hidden bg-bg/40 backdrop-blur-sm">
        {features.map((f, i) => {
          // Borders based on position to create a clean 2x2 grid crosshair
          const borderClasses = `p-8 flex flex-col gap-5 transition-colors duration-300 hover:bg-surface-low/30 relative group
            ${i % 2 === 0 ? "md:border-r border-accent/10" : ""}
            ${i < 2 ? "border-b border-accent/10" : ""}`;
            
          return (
            <div
              key={f.title}
              className={`${borderClasses} hero-anim`}
              style={{ "--delay": `${i * 80}ms` } as React.CSSProperties}
            >
              {/* Card top ledger header */}
              <div className="flex items-center justify-between font-mono text-[9px] text-accent/50 tracking-wider">
                <span>{f.index}</span>
                <span>{f.catalog}</span>
              </div>

              {/* Icon & Title */}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-high border border-glass-border group-hover:border-accent/40 group-hover:bg-surface-highest transition-all duration-300">
                  <Icon name={f.icon} filled size={24} className="text-accent group-hover:scale-110 duration-300" />
                </div>
                <h3 className="text-xl font-display font-semibold text-on-surface tracking-tight">
                  {f.title}
                </h3>
              </div>

              {/* Description */}
              <p className="text-sm leading-relaxed text-on-surface-v/90">
                {f.description}
              </p>

              {/* Handwritten italic serif annotation at bottom */}
              <div className="mt-auto pt-6 border-t border-accent/5 text-xs font-display italic text-accent/75 font-light tracking-wide pl-2 relative select-none">
                <span className="absolute left-0 top-[22px] w-1.5 h-1.5 rounded-full bg-accent/30" />
                &ldquo;{f.handwriting}&rdquo;
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    {
      num: "01",
      icon: "edit_note",
      title: "Tell Us About Your Child",
      description:
        "Share their name, age, and a few favorite things — like stars, dinosaurs, or blueberries.",
      handwriting: "Log entry #01 // child profile parameters",
    },
    {
      num: "02",
      icon: "auto_awesome",
      title: "We Craft the Lullaby",
      description:
        "Our AI writes gentle lyrics, records them in a warm voice, and composes original, relaxing music.",
      handwriting: "Log entry #02 // vocal synth & instrumentals",
    },
    {
      num: "03",
      icon: "download",
      title: "Download & Share",
      description:
        "Get the permanent high-quality MP3 for bedtime and a gorgeous starry video to surprise family.",
      handwriting: "Log entry #03 // download delivery complete",
    },
  ];

  return (
    <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      {/* Decorative dot backdrop */}
      <div className="absolute inset-0 celestial-dots opacity-30 pointer-events-none" />

      {/* Header */}
      <div className="mb-20 text-center relative z-10">
        <div className="flex justify-center mb-3">
          <span className="ledger-tag text-[9px]">
            <span className="material-symbols-outlined text-[10px] animate-pulse">sync_alt</span>
            WORKFLOW SPEC: GENERATION TIMELINE
          </span>
        </div>
        <h2 className="font-display text-4xl font-bold tracking-tight text-on-surface sm:text-5xl text-shadow-md">
          How it works
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm sm:text-base text-on-surface/80 text-shadow-sm font-mono tracking-wide uppercase text-accent/60">
          Three simple steps to a one-of-a-kind bedtime song
        </p>
      </div>

      {/* Split screen content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start relative z-10">
        
        {/* Left Column: Interactive Polaroid Stack (Sticky on large screens) */}
        <div className="lg:col-span-5 lg:sticky lg:top-32 flex flex-col items-center justify-center">
          <WorkflowStack />
        </div>

        {/* Right Column: Detailed Vintage Journal Step Checklist (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6 relative">
          
          {/* Vertical Connecting Line */}
          <div className="absolute left-[31px] top-6 bottom-6 w-[1px] bg-accent/15 z-0" />

          {steps.map((step, i) => (
            <div
              key={step.num}
              className="hero-anim flex items-start gap-6 relative z-10 group"
              style={{ "--delay": `${i * 100}ms` } as React.CSSProperties}
            >
              {/* Ledger Step Number Bubble */}
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-high border border-glass-border font-display text-lg font-bold text-accent group-hover:bg-accent group-hover:text-bg transition-all duration-300 shadow-md">
                {step.num}
              </div>

              {/* Step Details Ledger Card */}
              <div className="flex-1 celestial-border-b pb-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-low border border-glass-border">
                    <Icon name={step.icon} size={16} className="text-accent" />
                  </div>
                  <h3 className="text-xl font-display font-semibold text-on-surface">
                    {step.title}
                  </h3>
                </div>
                
                <p className="mt-2 text-sm leading-relaxed text-on-surface-v/90">
                  {step.description}
                </p>

                {/* Monospaced Log Entry label */}
                <div className="mt-3 font-mono text-[9px] text-accent/40 uppercase tracking-widest pl-1 select-none">
                  {step.handwriting}
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
function PricingSection({
  oneOff,
  subscription,
}: {
  oneOff: MarketingPrice | null;
  subscription: MarketingPrice | null;
}) {
  return (
    <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-6 py-24 celestial-border-t">
      <div className="relative mb-16 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 celestial-border-b">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              [ SECTION 04 // PASSAGE PROCUREMENT ]
            </span>
          </div>
          <h2 className="font-display text-4xl font-bold tracking-tight text-on-surface sm:text-5xl text-shadow-md">
            Celestial Vouchers
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-v/90">
            Secure a personalized bedtime anthem for your child. Select a single travel ticket or enroll in the permanent monthly sleep coordinates program.
          </p>
        </div>

        {/* Sleep Guarantee Wax Seal next to the header on desktop */}
        <div className="relative flex justify-center md:justify-end">
          <div className="wax-seal-wrapper">
            <div className="wax-seal-ribbon wax-seal-ribbon-left" />
            <div className="wax-seal-ribbon wax-seal-ribbon-right" />
            <div className="wax-seal">
              <div className="wax-seal-inner-circle flex flex-col items-center justify-center p-1 text-center select-none">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#0a0820] fill-[#0a0820] mb-0.5">
                  <path d="M12 3c.132 0 .263 0 .393.007a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 3zm0 2a7 7 0 1 0 5.093 11.8A9.5 9.5 0 0 1 12 5z" />
                </svg>
                <span className="font-mono text-[7px] tracking-tight leading-none uppercase text-[#0a0820]/90 font-bold">
                  GUARANTEE
                </span>
                <span className="font-mono text-[5px] tracking-tight leading-none text-[#0a0820]/70 mt-0.5">
                  SWEET DREAMS
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-[820px] mx-auto w-full">
        <PriceCard
          label="One-time"
          price={oneOff}
          description="One personalized lullaby. Yours to keep."
          unavailableNote="One-time purchase is temporarily unavailable."
        />
        <PriceCard
          label="Monthly"
          price={subscription}
          description="Unlimited lullabies while your subscription is active."
          unavailableNote="Monthly subscription is temporarily unavailable."
          popular
        />
      </div>
    </section>
  );
}

interface PriceCardProps {
  label: string;
  price: MarketingPrice | null;
  description: string;
  unavailableNote: string;
  popular?: boolean;
}

function PriceCard({
  label,
  price,
  description,
  unavailableNote,
  popular,
}: PriceCardProps) {
  const isMonthly = label === "Monthly";
  const features = isMonthly
    ? [
        { name: "Audio Files", val: "Infinite High-Fi" },
        { name: "Vocal Synthesizer", val: "Cozy AI Vocals" },
        { name: "Bedtime Library", val: "Cloud Archive" },
        { name: "Story Creation", val: "Unlimited Tries" },
        { name: "Support Priority", val: "Celestial Star" }
      ]
    : [
        { name: "Audio Files", val: "1 High-Fi File" },
        { name: "Vocal Synthesizer", val: "Cozy AI Vocals" },
        { name: "Bedtime Library", val: "Local Keep Only" },
        { name: "Story Creation", val: "Single Passage" },
        { name: "Support Priority", val: "Core Registry" }
      ];

  const voucherNumber = isMonthly ? "#LLBY-PASS-MONTHLY-2026" : "#LLBY-TKT-ONETIME-2026";
  const passType = isMonthly ? "INFINITE SLEEP ARCHIVE" : "ONE-TIME ENROLLMENT";

  return (
    <article
      className={`ticket-dashed-border relative flex flex-col justify-between p-6 rounded-xl bg-surface-low border border-glass-border/30 shadow-2xl transition-all duration-500 hover:scale-[1.02] hover:-translate-y-1 ${
        popular ? "shadow-accent/5 ring-1 ring-accent/30" : ""
      }`}
    >
      {/* Decorative Corner Punchouts are rendered via CSS classes and relative border mask */}
      
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[10px] font-mono font-bold text-bg tracking-widest uppercase shadow-md">
          ★ RECOMMENDED PASS ★
        </span>
      )}

      {/* Ticket Top: Meta and Header */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-start font-mono text-[9px] text-accent/50 tracking-widest">
          <span>{voucherNumber}</span>
          <span>ESTD 2026 // CORE</span>
        </div>
        
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-accent uppercase tracking-widest">
            {label} VOUCHER
          </span>
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">
            {passType}
          </h3>
        </div>

        {/* Pricing Segment */}
        <div className="py-2.5">
          {price ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-display font-bold tracking-tight text-on-surface">
                {price.formatted}
              </span>
              {isMonthly && (
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-v/80 text-shadow-sm">
                  / month
                </span>
              )}
            </div>
          ) : (
            <div
              role="status"
              className="rounded-lg bg-surface-lowest/50 border border-glass-border/30 px-4 py-3 text-xs font-mono text-on-surface-v text-center"
            >
              {unavailableNote}
            </div>
          )}
          <p className="mt-2 text-xs text-on-surface-v/90 leading-relaxed italic font-light">
            &ldquo;{description}&rdquo;
          </p>
        </div>
      </div>

      {/* Ticket Dashed Divider */}
      <div className="ticket-dashed-divider my-4" />

      {/* Ticket Mid: Itemized Specs Table */}
      <div className="flex flex-col gap-2 mb-4">
        <span className="font-mono text-[8px] text-accent/40 uppercase tracking-widest pl-1">
          [ ITEMISED PARAMETERS & VOUCHER INCLUSIONS ]
        </span>
        <div className="flex flex-col gap-1.5">
          {features.map((feat) => (
            <div key={feat.name} className="flex justify-between items-center text-[11px] pb-1 border-b border-accent/10">
              <span className="text-on-surface-v font-mono">{feat.name}</span>
              <span className="text-accent font-mono font-medium">{feat.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ticket Bottom: Action Button and Fine Print */}
      <div className="mt-auto flex flex-col gap-3">
        <CtaButton
          href={price ? "/create" : "#"}
          fullWidth
          compact
        >
          {price ? "EXECUTE VOUCHER" : "UNAVAILABLE"}
        </CtaButton>

        <div className="flex justify-between items-center font-mono text-[7px] text-on-surface-v/40 uppercase tracking-widest px-1">
          <span>VALID FOR: ONE CHILD</span>
          <span>NON-REFUNDABLE IN TRANSIT</span>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function Footer() {
  return (
    <footer className="relative z-10 py-16 celestial-border-t bg-surface-lowest/10">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Footer Top Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 pb-12">
          
          {/* Brand Column (5 cols) */}
          <div className="md:col-span-5 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-on-surface">
              <Icon name="bedtime" filled size={26} className="text-accent" />
              <span className="font-display text-xl font-bold tracking-tight">Lullaby</span>
            </div>
            
            <p className="font-display text-sm italic font-light text-on-surface-v/90 leading-relaxed max-w-sm">
              &ldquo;Curating peaceful slumbers and cozy acoustic dreamscapes for little ones since 2026. Handcrafted with stardust and orbital care.&rdquo;
            </p>
          </div>

          {/* Sitemap Navigation (3 cols) */}
          <div className="md:col-span-3 flex flex-col gap-4">
            <span className="font-mono text-[9px] text-accent uppercase tracking-[0.2em] font-medium">
              [ SYSTEM NAVIGATION ]
            </span>
            <div className="flex flex-col gap-2.5 text-xs font-mono">
              <a href="/create" className="text-on-surface-v transition-colors hover:text-accent flex items-center gap-1.5">
                <span className="text-[7px]">✦</span> CREATE LULLABY
              </a>
              <a href="/library" className="text-on-surface-v transition-colors hover:text-accent flex items-center gap-1.5">
                <span className="text-[7px]">✦</span> PERSONAL LIBRARY
              </a>
              <a href="#pricing" className="text-on-surface-v transition-colors hover:text-accent flex items-center gap-1.5">
                <span className="text-[7px]">✦</span> PRICING & VOUCHERS
              </a>
            </div>
          </div>

          {/* System Metadata (4 cols) */}
          <div className="md:col-span-4 flex flex-col gap-4">
            <span className="font-mono text-[9px] text-accent uppercase tracking-[0.2em] font-medium">
              [ CELESTIAL SPECIFICATIONS ]
            </span>
            
            <div className="flex flex-col gap-2 font-mono text-[9px] text-on-surface-v/85">
              <div className="flex justify-between border-b border-accent/5 pb-1">
                <span>SYSTEM STATUS:</span>
                <span className="text-accent">SECURE // ONLINE</span>
              </div>
              <div className="flex justify-between border-b border-accent/5 pb-1">
                <span>ORBITAL SECTOR:</span>
                <span>ZONE-09_NIGHTFALL</span>
              </div>
              <div className="flex justify-between border-b border-accent/5 pb-1">
                <span>ESTABLISHED:</span>
                <span>2026 // SL.ARCHIVE</span>
              </div>
              <div className="flex justify-between border-b border-accent/5 pb-1">
                <span>REVISION STATUS:</span>
                <span>V1.0.4-GOLD</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Bottom Border */}
        <div className="celestial-border-t pt-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          
          {/* Barcode & catalog number */}
          <div className="flex items-center gap-0.5 opacity-30 select-none h-6">
            <div className="w-[1.5px] h-full bg-accent" />
            <div className="w-[2.5px] h-full bg-accent" />
            <div className="w-[1px] h-full bg-accent" />
            <div className="w-[3px] h-full bg-accent" />
            <div className="w-[1px] h-full bg-accent" />
            <div className="w-[5px] h-full bg-accent" />
            <div className="w-[1.5px] h-full bg-accent" />
            <div className="w-[2px] h-full bg-accent" />
            <div className="w-[1px] h-full bg-accent" />
            <div className="w-[1.5px] h-full bg-accent" />
            <div className="w-[4px] h-full bg-accent" />
            <span className="font-mono text-[8px] tracking-[0.2em] text-accent ml-2">#LLBY-992-02</span>
          </div>

          {/* Copyrights and terms */}
          <div className="flex flex-col sm:items-end gap-1 font-mono text-[9px] text-on-surface-v/70 uppercase tracking-widest text-center sm:text-right">
            <p>&copy; {new Date().getFullYear()} Lullaby Co. All Bedtime Rights Preserved.</p>
            <p className="text-[7px] text-on-surface-v/40">Made with cosmic dust and real vocals for sweet dreams.</p>
          </div>

        </div>

      </div>
    </footer>
  );
}
