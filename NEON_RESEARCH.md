# Real Neon Sign Physics & CSS Implementation Guide

## Research Summary: How Real Neon Behaves

### 1. STARTUP FLICKER (When Neon Tubes Turn On)

#### Real Physics
- **Ionization delay**: Neon tubes don't light instantly. They have an ionization threshold voltage they must exceed before gas becomes conductive
- **Chaotic startup**: Below the ignition point, the gas flickers randomly and chaotically (not predictably periodic) as electrons struggle to ionize atoms
- **Mercury vapor timing**: If argon + mercury is used, loose mercury hasn't vaporized yet, causing initial instability (solved by running sign for days)
- **Random glow location**: Flicker position moves randomly around tube due to pressure/temperature variations - NOT smooth
- **Duration**: Takes ~1-3 seconds to stabilize into steady glow
- **Visual effect**: Rapid, erratic on/off pulses with slight horizontal or positional jitter

#### CSS Implementation Strategy
```css
/* Random chaotic flicker during startup - 2-3 seconds */
@keyframes neonStartup {
  0% { opacity: 0; }
  5% { opacity: 0.3; }
  8% { opacity: 0; }
  12% { opacity: 0.2; }
  15% { opacity: 0; }
  20% { opacity: 0.4; }
  25% { opacity: 0.1; }
  30% { opacity: 0; }
  35% { opacity: 0.5; }
  40% { opacity: 0; }
  50% { opacity: 0.7; }
  60% { opacity: 0.8; }
  70% { opacity: 0.9; }
  85% { opacity: 1; }
  100% { opacity: 1; }
}

/* Chaotic position flicker */
@keyframes neonPositionJitter {
  0% { filter: blur(0px) brightness(0%); text-shadow: none; }
  5% { filter: blur(1px) brightness(30%); text-shadow: 0 0 4px currentColor; }
  10% { filter: blur(0px) brightness(5%); text-shadow: none; }
  15% { filter: blur(0.5px) brightness(20%); text-shadow: 0 0 3px currentColor; }
  25% { filter: blur(0px) brightness(0%); text-shadow: none; }
  35% { filter: blur(1.5px) brightness(40%); text-shadow: 0 0 6px currentColor; }
  45% { filter: blur(0px) brightness(10%); text-shadow: none; }
  55% { filter: blur(1px) brightness(50%); text-shadow: 0 0 8px currentColor; }
  70% { filter: blur(0.5px) brightness(80%); text-shadow: 0 0 12px currentColor; }
  85% { filter: blur(0.1px) brightness(100%); text-shadow: 0 0 15px currentColor; }
  100% { filter: blur(0px) brightness(100%); text-shadow: 0 0 20px currentColor; }
}
```

#### Key Characteristics
- Intervals are RANDOM, not evenly spaced
- Flicker gets progressively longer/brighter (not random throughout)
- Position may shift slightly (simulated with blur/glow changes)
- No smooth fade - sharp on/offs


### 2. WARM vs COLD GLOW

#### Real Physics: Gas Type Determines Color & Temperature

**WARM GLOW - Neon Gas:**
- **Color**: Deep red-orange (600-650nm wavelength)
- **Temperature perception**: Warm, nostalgic, vintage
- **Light spread**: Radiates 360° around tube continuously
- **Intensity**: Moderate (lower voltage requirement)
- **Phosphor**: Pure neon doesn't use phosphor - direct gas emission
- **Visual feel**: Soft, organic, analog

**COLD GLOW - Argon + Mercury:**
- **Color**: Blue, green, white, purple (when phosphor-coated)
- **Temperature perception**: Cool, clinical, modern
- **Light spread**: More precise, less diffuse
- **Intensity**: Brighter (mercury enables higher brightness)
- **Phosphor**: Argon UV excites phosphor coating, which reemits visible color
- **Thermal sensitivity**: Sluggish below 45°F (7°C), may flicker in cold
- **Purity**: Sharp, digital-feeling

#### CSS Implementation Strategy

```css
/* WARM NEON - Red/Orange */
.neon-warm {
  color: #ff6600;
  text-shadow:
    0 0 7px #ff6600,
    0 0 15px #ff6600,
    0 0 25px rgba(255, 102, 0, 0.5),
    0 0 40px rgba(255, 102, 0, 0.3);
}

/* COLD NEON - Blue/Cyan */
.neon-cold {
  color: #00ccff;
  text-shadow:
    0 0 7px #00ccff,
    0 0 15px #00ccff,
    0 0 25px rgba(0, 204, 255, 0.6),
    0 0 40px rgba(0, 204, 255, 0.4);
}

/* The difference: Warm spreads softer, Cold is more defined */
```

#### Color Reference Table
| Gas | Primary Color | Wavelength | Feel | Notes |
|-----|---------------|-----------|------|-------|
| Neon | Red-Orange | 600-650nm | Warm | Highest voltage needed |
| Neon (high pressure) | Pink/Pale Red | 600nm+ | Warm | Reduced saturation |
| Argon | Pale Blue/Lavender | 420-420nm | Cold | Usually + mercury |
| Argon + Mercury | Blue (bright) | 405-546nm | Cold | Most common for blue |
| Argon + Phosphor (Green) | Green | 520-560nm | Cool-neutral | Artificial via phosphor |
| Argon + Phosphor (Purple) | Purple | 400-420nm | Very Cold | Striking, modern |
| Helium | Yellow/Pink | 587nm | Warm | Rare, expensive |


### 3. LIGHT BLOOM & HALO (How Neon Light Spreads)

#### Real Physics
- **Continuous emission**: Neon radiates 360° along the entire tube length
- **Charge bleeding**: Bright light in cameras/eyes causes photons to scatter into adjacent areas
- **Atmospheric scattering**: Light particles scatter off dust, moisture, pollution
- **Lens aberration**: Camera/eye lenses refract light, causing bloom
- **Soft boundaries**: No sharp cutoff - light intensity drops off exponentially with distance
- **Multiple layers**:
  - Core bright inner glow (sharp)
  - Mid glow layer (soft bloom)
  - Outer halo (very soft)
- **Intensity relationship**: Stronger bloom with brighter colors, more power
- **Viewing angle**: Bloom more pronounced at night/dark backgrounds

#### CSS Implementation Strategy

```css
/* Three-layer bloom effect */
.neon-bloom {
  /* Layer 1: Core sharp glow */
  text-shadow:
    /* Inner bright glow - tight spread */
    0 0 5px #ff6600,
    0 0 10px #ff6600,

    /* Layer 2: Mid bloom - medium spread */
    0 0 15px #ff6600,
    0 0 25px rgba(255, 102, 0, 0.7),

    /* Layer 3: Outer halo - soft diffuse */
    0 0 40px rgba(255, 102, 0, 0.4),
    0 0 60px rgba(255, 102, 0, 0.2);
}

/* Bloom intensity varies with power level */
.neon-bloom.low-power {
  text-shadow:
    0 0 3px #ff6600,
    0 0 8px #ff6600,
    0 0 15px rgba(255, 102, 0, 0.4);
}

.neon-bloom.high-power {
  text-shadow:
    0 0 8px #ff6600,
    0 0 15px #ff6600,
    0 0 30px rgba(255, 102, 0, 0.8),
    0 0 50px rgba(255, 102, 0, 0.6),
    0 0 80px rgba(255, 102, 0, 0.3);
}

/* Glowing box variant - uses box-shadow for area fills */
.neon-box-bloom {
  box-shadow:
    /* Inner glow */
    inset 0 0 10px rgba(255, 102, 0, 0.3),
    /* Outer bloom layers */
    0 0 15px #ff6600,
    0 0 30px rgba(255, 102, 0, 0.5),
    0 0 50px rgba(255, 102, 0, 0.2);
}
```

#### Physics Layer Breakdown
```
CORE (1-5px):    Sharp, full saturation, high intensity
                 └─ Direct electron-to-photon emission

BLOOM (10-30px): Soft transition, medium opacity
                 └─ Light scattering in gas + air diffusion

HALO (40-80px):  Very soft, low opacity, fades to background
                 └─ Atmospheric scatter + lens aberration
```


### 4. NEON TUBE COLOR VARIATIONS

#### Color Production Mechanism

**Direct Gas Emission (Neon, Helium):**
- Pure gas + high voltage = electron excitation
- Electrons jump to higher orbital
- When they return, energy released as specific photon color
- **No phosphor needed** - color comes from gas itself
- **Examples**: Red-orange (neon), Yellow (helium), Lavender (xenon)

**Phosphor-Coated Emission (Argon + Mercury combinations):**
- Base gas: Argon produces UV light (invisible)
- Mercury: Added vapor improves brightness
- Phosphor coating: Absorbs UV, reemits visible color
- **Result**: Argon alone = pale blue; + phosphor coating = ANY color
- **Examples**: Bright blue, neon green, pure white, hot pink

#### CSS Color Values & Physical Accuracy

```css
/* WARM FAMILY - Direct gas emission */
.neon-red {           /* Pure neon - deepest, warmest */
  color: #ff0000;     /* Deep pure red */
  filter: hue-rotate(0deg) saturate(1.1);
}

.neon-orange-red {    /* Neon in higher pressure - warmer */
  color: #ff4400;     /* Red-orange blend */
}

.neon-orange {        /* Pure neon - classic sign color */
  color: #ff6600;     /* Warm orange */
}

/* COOL FAMILY - Argon + phosphor */
.neon-blue {          /* Argon + blue phosphor */
  color: #0080ff;     /* Bright blue */
  filter: saturate(1.3);
}

.neon-cyan {          /* Argon + cyan phosphor - brightest */
  color: #00ffff;     /* Bright cyan/aqua */
  filter: saturate(1.2) brightness(1.15);
}

.neon-green {         /* Argon + green phosphor */
  color: #00ff00;     /* Bright electric green */
  filter: saturate(1.2);
}

.neon-purple {        /* Argon + purple phosphor */
  color: #9933ff;     /* Bright purple */
  filter: saturate(1.1);
}

.neon-pink {          /* Argon + red/magenta phosphor */
  color: #ff00ff;     /* Bright magenta/pink */
  filter: saturate(1.15);
}

.neon-white {         /* Argon + multi-phosphor (rare, expensive) */
  color: #ffffff;     /* Pure white */
  filter: saturate(0.8) brightness(1.2);
}
```

#### Brightness & Saturation Relationships

```
Neon (direct):     Moderate brightness, high saturation, warm
Argon (direct):    Low brightness, low saturation, cool
Phosphor-coated:   Very high brightness, high saturation, specific color
Mercury vapor:     Enables high intensity by 2-3x
```


### 5. BROKEN & FLICKERING NEON EFFECTS

#### Real Physics of Degradation

**Gradual Failures:**
- **Gas leak**: Small hole → air infiltrates → loses ionization → dimming
- **Electrode erosion**: Electrodes degrade over years → less efficient ionization
- **Mercury condensation**: Mercury vapor cools/condenses → loses brightness over time
- **Phosphor aging**: Phosphor coating degrades under UV exposure → color shift

**Sudden Failures:**
- **Open circuit**: Complete break → no glow at all
- **Contamination**: Air/moisture enters → uncontrollable flicker
- **Voltage issues**: Power surge/brownout → unstable current
- **Cold weather**: Below 45°F, argon becomes sluggish → dimming/stuttering

**Visible Effects:**
- Dimming (gradual brightening loss)
- Intermittent flicker (random on/off cycles)
- Striations (bands of light moving through tube - audio frequency oscillation)
- Color shift (aging phosphors shift red/yellow)
- Partial glow (only sections light up)
- Dead spots (gaps in line where tube doesn't glow)

#### CSS Implementation Strategy

```css
/* DIMMED - Gas leak or electrode wear */
@keyframes neonDimmed {
  0%, 100% { opacity: 0.6; text-shadow: 0 0 8px currentColor; }
  50% { opacity: 0.5; text-shadow: 0 0 6px currentColor; }
}

.neon-dimmed {
  animation: neonDimmed 3s ease-in-out infinite;
}

/* INTERMITTENT FLICKER - Air contamination or power issues */
@keyframes neonFlicker {
  0% { opacity: 1; text-shadow: 0 0 15px currentColor; }
  10% { opacity: 0; text-shadow: none; }
  11% { opacity: 1; text-shadow: 0 0 12px currentColor; }
  20% { opacity: 0; text-shadow: none; }
  21% { opacity: 0.8; text-shadow: 0 0 10px currentColor; }
  35% { opacity: 1; text-shadow: 0 0 15px currentColor; }
  36% { opacity: 0; text-shadow: none; }
  40% { opacity: 0.5; text-shadow: 0 0 8px currentColor; }
  50% { opacity: 1; text-shadow: 0 0 15px currentColor; }
  70% { opacity: 1; text-shadow: 0 0 15px currentColor; }
  71% { opacity: 0; text-shadow: none; }
  100% { opacity: 1; text-shadow: 0 0 15px currentColor; }
}

.neon-broken-flicker {
  animation: neonFlicker 4s steps(2, end) infinite;
}

/* STRIATION EFFECT - Audio frequency oscillation (50/60Hz bands) */
@keyframes neonStriations {
  0%, 100% {
    text-shadow:
      0 0 10px currentColor,
      0 2px 0px rgba(0,0,0,0.3),
      0 4px 0px rgba(0,0,0,0.3);
  }
  50% {
    text-shadow:
      0 0 12px currentColor,
      0 2px 2px rgba(0,0,0,0.2),
      0 4px 2px rgba(0,0,0,0.2);
  }
}

.neon-striations {
  animation: neonStriations 0.05s linear infinite; /* 50Hz flicker */
}

/* COLD WEATHER SLUGGISH - Argon below 45°F */
@keyframes neonColdStutter {
  0% { opacity: 0.3; }
  20% { opacity: 0.5; }
  40% { opacity: 0.2; }
  60% { opacity: 0.6; }
  80% { opacity: 0.25; }
  100% { opacity: 0.8; }
}

.neon-cold-sluggish {
  animation: neonColdStutter 2s ease-in-out infinite;
}

/* COLOR SHIFT - Phosphor aging */
.neon-aged {
  filter: hue-rotate(-20deg) saturate(0.6) brightness(0.85);
}

/* DEAD SPOTS - Partial tube failure */
.neon-with-dead-spots {
  background: linear-gradient(
    90deg,
    rgba(255,102,0,1) 0%,
    rgba(255,102,0,0.2) 15%,
    rgba(255,102,0,1) 20%,
    rgba(255,102,0,0.3) 40%,
    rgba(255,102,0,1) 45%
  );
}
```


### 6. RAIN/FOG BLOOM EFFECT

#### Real Physics

**How moisture affects neon visibility:**
- **Direct water spray**: Can cause electrical shorts, flickering, temporary shutdown
- **Atmospheric moisture**: Fog/mist causes light scattering, increased halo
- **Refraction**: Water droplets act as tiny lenses, spreading light into rainbow halos
- **Reduced contrast**: Moisture particles diffuse light, reducing apparent brightness
- **Chromatic aberration**: Light splits into color fringes (red/blue separation) through water

**Visual Effects:**
- **Enhanced bloom**: Halo extends much further (2-3x normal size)
- **Softer boundaries**: No sharp transition between glow and background
- **Reduced saturation**: Color appears less vivid, more "washed out"
- **Increased blur**: Overall softness increases
- **Possible color fringing**: Slight rainbow halo at edges
- **Glow intensifies**: Appears brighter due to forward-scattered light

#### CSS Implementation Strategy

```css
/* RAIN EFFECT - Increased bloom, slight blur, washed color */
.neon-in-rain {
  filter: blur(0.5px) saturate(0.7) brightness(1.1);
  text-shadow:
    /* Tight core */
    0 0 5px #ff6600,
    0 0 10px #ff6600,
    /* Much larger bloom due to water scattering */
    0 0 25px rgba(255, 102, 0, 0.6),
    0 0 45px rgba(255, 102, 0, 0.4),
    0 0 70px rgba(255, 102, 0, 0.2),
    /* Extra diffuse halo */
    0 0 100px rgba(255, 102, 0, 0.1);
}

/* FOG EFFECT - Maximum blur and softness */
.neon-in-fog {
  filter: blur(1.5px) saturate(0.5) brightness(1.2) opacity(0.9);
  text-shadow:
    /* Soft, diffuse everywhere */
    0 0 10px rgba(255, 102, 0, 0.5),
    0 0 30px rgba(255, 102, 0, 0.4),
    0 0 60px rgba(255, 102, 0, 0.3),
    0 0 100px rgba(255, 102, 0, 0.15);
}

/* CHROMATIC ABERRATION - Color fringing in rain */
.neon-chromatic {
  text-shadow:
    /* Red channel shifted slightly left */
    -1px 0 3px #ff0000,
    /* Blue channel shifted right */
    1px 0 3px #0080ff,
    /* Core glow centered */
    0 0 15px rgba(255, 102, 0, 0.8);
}

/* PUDDLE REFLECTION - Neon reflecting in rain puddle */
.neon-puddle-reflection {
  position: relative;
}

.neon-puddle-reflection::after {
  content: attr(data-text);
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  filter: blur(1px) opacity(0.4) brightness(0.7);
  transform: scaleY(-1) translateY(5px);
  pointer-events: none;
  text-shadow:
    0 0 8px rgba(255, 102, 0, 0.3),
    0 0 15px rgba(255, 102, 0, 0.15);
}
```

#### Practical Multi-State Animation

```css
/* WEATHER CYCLE - Clear → Rain → Fog → Clear */
@keyframes weatherCycle {
  0%, 100% {
    /* Clear night - normal neon */
    filter: blur(0px) saturate(1) brightness(1);
    text-shadow:
      0 0 8px currentColor,
      0 0 15px currentColor,
      0 0 30px rgba(255,102,0,0.5);
  }

  33% {
    /* Light rain starting */
    filter: blur(0.3px) saturate(0.85) brightness(1.05);
    text-shadow:
      0 0 8px currentColor,
      0 0 20px currentColor,
      0 0 45px rgba(255,102,0,0.5),
      0 0 70px rgba(255,102,0,0.2);
  }

  50% {
    /* Heavy rain/fog */
    filter: blur(1px) saturate(0.6) brightness(1.15);
    text-shadow:
      0 0 10px currentColor,
      0 0 30px currentColor,
      0 0 60px rgba(255,102,0,0.4),
      0 0 100px rgba(255,102,0,0.15);
  }

  66% {
    /* Rain clearing */
    filter: blur(0.5px) saturate(0.8) brightness(1.08);
    text-shadow:
      0 0 8px currentColor,
      0 0 22px currentColor,
      0 0 50px rgba(255,102,0,0.4),
      0 0 80px rgba(255,102,0,0.15);
  }
}

.neon-weather-cycle {
  animation: weatherCycle 15s ease-in-out infinite;
}
```


## Complete CSS Reference Implementation

### Master Neon Class System

```css
/* ============================================
   BASE NEON GLOW
   ============================================ */

.neon {
  position: relative;
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;

  /* Anti-alias for better blur rendering */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ============================================
   COLOR FAMILIES
   ============================================ */

/* WARM NEONS */
.neon-red {
  color: #ff0000;
  text-shadow:
    0 0 7px #ff0000,
    0 0 15px #ff0000,
    0 0 25px rgba(255, 0, 0, 0.5),
    0 0 40px rgba(255, 0, 0, 0.3);
}

.neon-orange {
  color: #ff6600;
  text-shadow:
    0 0 7px #ff6600,
    0 0 15px #ff6600,
    0 0 25px rgba(255, 102, 0, 0.5),
    0 0 40px rgba(255, 102, 0, 0.3);
}

/* COOL NEONS */
.neon-blue {
  color: #0080ff;
  text-shadow:
    0 0 7px #0080ff,
    0 0 15px #0080ff,
    0 0 25px rgba(0, 128, 255, 0.6),
    0 0 40px rgba(0, 128, 255, 0.4);
}

.neon-cyan {
  color: #00ffff;
  text-shadow:
    0 0 7px #00ffff,
    0 0 15px #00ffff,
    0 0 25px rgba(0, 255, 255, 0.6),
    0 0 40px rgba(0, 255, 255, 0.4);
}

.neon-green {
  color: #00ff00;
  text-shadow:
    0 0 7px #00ff00,
    0 0 15px #00ff00,
    0 0 25px rgba(0, 255, 0, 0.5),
    0 0 40px rgba(0, 255, 0, 0.3);
}

.neon-purple {
  color: #9933ff;
  text-shadow:
    0 0 7px #9933ff,
    0 0 15px #9933ff,
    0 0 25px rgba(153, 51, 255, 0.5),
    0 0 40px rgba(153, 51, 255, 0.3);
}

.neon-pink {
  color: #ff00ff;
  text-shadow:
    0 0 7px #ff00ff,
    0 0 15px #ff00ff,
    0 0 25px rgba(255, 0, 255, 0.5),
    0 0 40px rgba(255, 0, 255, 0.3);
}

/* ============================================
   STATES & EFFECTS
   ============================================ */

/* Startup animation */
@keyframes neonStartup {
  0% { opacity: 0; }
  5% { opacity: 0.3; }
  8% { opacity: 0; }
  12% { opacity: 0.2; }
  15% { opacity: 0; }
  20% { opacity: 0.4; }
  25% { opacity: 0.1; }
  30% { opacity: 0; }
  35% { opacity: 0.5; }
  40% { opacity: 0; }
  50% { opacity: 0.7; }
  60% { opacity: 0.8; }
  70% { opacity: 0.9; }
  85% { opacity: 1; }
  100% { opacity: 1; }
}

.neon-startup {
  animation: neonStartup 2.5s ease-out forwards;
}

/* Breathing pulse */
@keyframes neonPulse {
  0%, 100% {
    text-shadow:
      0 0 7px currentColor,
      0 0 15px currentColor,
      0 0 25px rgba(255, 102, 0, 0.5),
      0 0 40px rgba(255, 102, 0, 0.3);
  }
  50% {
    text-shadow:
      0 0 10px currentColor,
      0 0 20px currentColor,
      0 0 35px rgba(255, 102, 0, 0.7),
      0 0 50px rgba(255, 102, 0, 0.5);
  }
}

.neon-pulse {
  animation: neonPulse 2s ease-in-out infinite;
}

/* Rain effect */
.neon-rain {
  filter: blur(0.5px) saturate(0.7) brightness(1.1);
  text-shadow:
    0 0 5px currentColor,
    0 0 10px currentColor,
    0 0 25px rgba(255, 102, 0, 0.6),
    0 0 45px rgba(255, 102, 0, 0.4),
    0 0 70px rgba(255, 102, 0, 0.2),
    0 0 100px rgba(255, 102, 0, 0.1);
}

/* Fog effect */
.neon-fog {
  filter: blur(1.5px) saturate(0.5) brightness(1.2);
  text-shadow:
    0 0 10px rgba(255, 102, 0, 0.5),
    0 0 30px rgba(255, 102, 0, 0.4),
    0 0 60px rgba(255, 102, 0, 0.3),
    0 0 100px rgba(255, 102, 0, 0.15);
}

/* Broken/flickering */
@keyframes neonFlicker {
  0% { opacity: 1; }
  10% { opacity: 0; }
  11% { opacity: 1; }
  20% { opacity: 0; }
  21% { opacity: 0.8; }
  35% { opacity: 1; }
  36% { opacity: 0; }
  40% { opacity: 0.5; }
  50% { opacity: 1; }
  70% { opacity: 1; }
  71% { opacity: 0; }
  100% { opacity: 1; }
}

.neon-broken {
  animation: neonFlicker 3s steps(2, end) infinite;
}
```


## Implementation Notes

### Browser Support
- `text-shadow`: All modern browsers (Chrome, Firefox, Safari, Edge)
- `filter`: All modern browsers (supports blur, brightness, saturate, hue-rotate)
- `box-shadow`: All modern browsers
- Performance: GPU-accelerated on most devices, smooth 60fps

### Performance Tips
1. Use `will-change: text-shadow` for animated glows
2. Limit text-shadow to 3-4 layers per element (more = slower)
3. Use `transform: translateZ(0)` to force GPU rendering
4. For many neon elements, use CSS classes not inline styles

### Accessibility
- Add `aria-label` for screen readers
- Consider reducing motion: `@media (prefers-reduced-motion: reduce)`
- High contrast: Neon works well at any brightness level

### Real-World Examples
See `/home/dash/voyo-music/` for implementation in:
- Music player UI neon text
- Neon button effects
- Animated neon loading states


## Sources

- [Physics Forums - Flickering Neon Bulb Causes](https://www.physicsforums.com/threads/flickering-neon-bulb-what-causes-the-flicker.442225/)
- [RSC Education - Trade Secrets: Neon Lights](https://edu.rsc.org/feature/trade-secrets--neon-lights-flicker-bulbs-and-chaos/3007420.article)
- [Neon Signs Now - Neon Sign Flicker Troubleshooting](https://www.neonsignsnow.com/guides/neon-sign-not-working-flickers-but-wont-turn-on)
- [WestAir - What Gases Are Used in Neon Signs](https://westairgases.com/blog/neon-sign-gases/)
- [Orant Neon - Gases Used in Neon Signs](https://orantneon.com/blogs/news/gase-used-in-neon-signs)
- [Scientific American - How Do Neon Lights Work](https://www.scientificamerican.com/article/how-do-neon-lights-work/)
- [Light Bloom - Wikipedia](https://en.wikipedia.org/wiki/Light_bloom)
- [ScienceDirect - Phosphor Coating Overview](https://www.sciencedirect.com/topics/engineering/phosphor-coating/)
- [Crazy Neon - How Weather Impacts Neon Signs](https://crazyneon.com/blogs/posts/how-weather-impacts-neon-signs-across-the-us-caring-tips-from-crazy-neon%C2%AE-experts)
- [Sygns Blog - Understanding Neon Sign Gases](https://www.sygns.com/blogs/magazine/our-neon-colors)
