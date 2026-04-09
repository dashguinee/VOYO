# Neon Effects Quick Reference Guide

## Quick Copy-Paste Solutions

### 1. BASIC WARM NEON (Classic)
```html
<div class="demo-text neon-orange">YOUR TEXT</div>
```
```css
.neon-orange {
  color: #ff6600;
  text-shadow:
    0 0 7px #ff6600,
    0 0 15px #ff6600,
    0 0 25px rgba(255, 102, 0, 0.5),
    0 0 40px rgba(255, 102, 0, 0.3);
}
```

### 2. BASIC COLD NEON (Modern/Bright)
```html
<div class="demo-text neon-cyan">YOUR TEXT</div>
```
```css
.neon-cyan {
  color: #00ffff;
  text-shadow:
    0 0 8px #00ffff,
    0 0 12px #00ffff,
    0 0 30px rgba(0, 255, 255, 0.7),
    0 0 50px rgba(0, 255, 255, 0.5),
    0 0 80px rgba(0, 255, 255, 0.25);
}
```

### 3. STARTUP ANIMATION (Realistic Turn-On)
```html
<div class="demo-text neon-orange neon-startup">YOUR TEXT</div>
```
*Animation file already in neon-effects.css*

### 4. BREATHING EFFECT (Subtle Pulse)
```html
<div class="demo-text neon-orange neon-breathe">YOUR TEXT</div>
```

### 5. RAIN/FOG EFFECT
```html
<div class="demo-text neon-orange neon-rain">YOUR TEXT</div>
<div class="demo-text neon-orange neon-fog">YOUR TEXT</div>
<div class="demo-text neon-orange neon-heavy-rain">YOUR TEXT</div>
```

### 6. BROKEN/FLICKERING SIGN
```html
<div class="demo-text neon-orange neon-broken">YOUR TEXT</div>
```

### 7. COMBINE MULTIPLE EFFECTS
```html
<!-- Startup that transitions to breathing pulse -->
<div class="demo-text neon-orange"
     style="animation: neonStartup 2.5s ease-out forwards,
                      neonBreathe 3s ease-in-out 2.5s infinite;">
  YOUR TEXT
</div>
```

---

## Color Palette Reference

| Class | Color | Hex | Feel | Physics |
|-------|-------|-----|------|---------|
| `.neon-red` | Red | `#ff0000` | Warm | Pure neon |
| `.neon-orange` | Orange | `#ff6600` | Warm | Pure neon (most common) |
| `.neon-blue` | Blue | `#0080ff` | Cool | Argon + blue phosphor |
| `.neon-cyan` | Cyan | `#00ffff` | Cool-Modern | Brightest argon mix |
| `.neon-green` | Green | `#00ff00` | Cool | Argon + green phosphor |
| `.neon-purple` | Purple | `#9933ff` | Cold | Argon + purple phosphor |
| `.neon-pink` | Pink | `#ff00ff` | Cold | Argon + magenta phosphor |

**Warm Neons** → Use for vintage/nostalgic feel
**Cold Neons** → Use for modern/tech feel

---

## Effect Classes Cheat Sheet

### States & Animations
| Class | Effect | Duration | Best For |
|-------|--------|----------|----------|
| `.neon-startup` | Chaotic power-on flicker | 2.5s | Loading screens, page load |
| `.neon-jitter-startup` | Startup + position jitter | 2.5s | Glitchy, imperfect feel |
| `.neon-breathe` | Subtle breathing pulse | 3s loop | Always-on signs, ambiance |
| `.neon-fast-pulse` | AC hum ripple | 0.033s loop | Underlying electricity feel |
| `.neon-broken` | Random flicker | 3.5s loop | Broken/dying signs |
| `.neon-severe-broken` | Heavy flicker (near death) | 2s loop | Complete failure state |
| `.neon-dimmed` | Gradual brightness loss | 4s loop | Gas leak simulation |
| `.neon-severely-dimmed` | Permanently dim | Static | End-of-life sign |
| `.neon-cold-sluggish` | Below 45°F behavior | 2.5s loop | Cold weather effect |

### Environmental Effects
| Class | Condition | Filter | Best For |
|-------|-----------|--------|----------|
| `.neon-rain` | Light to moderate rain | blur(0.5px) | Atmospheric mood |
| `.neon-light-rain` | Starting to rain | blur(0.3px) | Transition effect |
| `.neon-heavy-rain` | Heavy downpour | blur(0.8px) | Storm scenes |
| `.neon-fog` | Dense fog | blur(1.5px) | Mystical mood |
| `.neon-heavy-fog` | Very thick fog | blur(2px) | Nearly invisible |
| `.neon-chromatic-static` | Color fringing | No blur | Moisture refraction |
| `.neon-chromatic` | Color flicker | Animated | Dynamic rain effect |

### Degradation
| Class | Failure Mode | Effect |
|-------|--------------|--------|
| `.neon-dimmed` | Gas leak | Slowly getting dimmer |
| `.neon-aged` | Phosphor decay | Hue shift + desaturation |
| `.neon-striations` | Audio frequency bands | 50/60Hz oscillation |
| `.neon-dead-spots` | Section failure | Parts don't light |

---

## Power Levels

### Low Power (Dim, Tight)
```css
.neon-warm.low-power {
  text-shadow:
    0 0 5px #ff6600,
    0 0 8px #ff6600,
    0 0 15px rgba(255, 102, 0, 0.4);
}
```
**Use when:** Old sign, degraded, or just powering up

### Standard Power (Balanced)
```css
.neon-orange {
  text-shadow:
    0 0 7px #ff6600,
    0 0 15px #ff6600,
    0 0 25px rgba(255, 102, 0, 0.5),
    0 0 40px rgba(255, 102, 0, 0.3);
}
```
**Use when:** Normal night-time sign, well-maintained

### High Power (Bright, Wide Bloom)
```css
.neon-warm.high-power {
  text-shadow:
    0 0 10px #ff6600,
    0 0 15px #ff6600,
    0 0 30px rgba(255, 102, 0, 0.8),
    0 0 50px rgba(255, 102, 0, 0.6),
    0 0 80px rgba(255, 102, 0, 0.3);
}
```
**Use when:** New sign, fresh installation, premium look

---

## Realistic Scenarios (Copy & Paste)

### Scenario 1: Fresh Neon Sign (Night)
```html
<div class="neon-orange neon-breathe">OPEN</div>
```
Fresh sign just turned on, subtle breathing pulse shows it's alive.

### Scenario 2: Aged Sign (Dim & Flickering)
```html
<div class="neon-orange neon-dimmed neon-aged">RETRO</div>
```
Old sign, losing gas, color has shifted red.

### Scenario 3: Neon in Rain at Night
```html
<div class="neon-orange neon-heavy-rain">BAR</div>
```
Atmospheric night scene with rain, bloom extends dramatically.

### Scenario 4: Startup Sequence (Page Load)
```html
<div class="neon-cyan neon-startup">LOADING</div>
```
Sign powers up from scratch, chaotic ionization then stabilizes.

### Scenario 5: Almost Dead Sign
```html
<div class="neon-orange neon-severe-broken neon-severely-dimmed">CLOSED</div>
```
Sign barely staying on, flickers erratically, very dim.

### Scenario 6: Broken Sign in Fog
```html
<div class="neon-purple neon-broken neon-fog">ERROR</div>
```
Error indicator barely visible in fog, flickering intermittently.

### Scenario 7: Premium Modern Sign
```html
<div class="neon-cyan neon-breathe">PREMIUM</div>
```
Modern cyan/blue neon with power-on stability, breathing pulse.

### Scenario 8: Neon Startup with Weather Cycle
```html
<div class="neon-orange neon-startup"></div>
<!-- Then after startup completes at 2.5s -->
<div class="neon-orange neon-weather-cycle">WEATHER</div>
```
Sign turns on, then cycles through weather conditions.

---

## Performance Tips

### 1. Use Classes (Fast)
```css
.neon-orange { /* Pre-calculated */ }
```

### 2. GPU Acceleration
```css
.neon {
  will-change: text-shadow, filter;
  transform: translateZ(0);
}
```

### 3. Limit Animations
- Use 3-4 shadow layers max (more = slower)
- Combine effects efficiently
- Avoid excessive blur (>2px) for performance

### 4. Browser Support
- All modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile-friendly
- GPU accelerated on most devices

---

## Creating Custom Colors

### Template: Warm Neon (Your Color)
```css
.neon-custom-warm {
  color: #YOUR_HEX;
  text-shadow:
    0 0 7px #YOUR_HEX,
    0 0 15px #YOUR_HEX,
    0 0 25px rgba(R, G, B, 0.5),     /* Your RGB with 0.5 alpha */
    0 0 40px rgba(R, G, B, 0.3);     /* Your RGB with 0.3 alpha */
}
```

### Template: Cold Neon (Your Color)
```css
.neon-custom-cold {
  color: #YOUR_HEX;
  text-shadow:
    0 0 8px #YOUR_HEX,
    0 0 12px #YOUR_HEX,
    0 0 30px rgba(R, G, B, 0.7),     /* Your RGB with 0.7 alpha */
    0 0 50px rgba(R, G, B, 0.5),     /* Your RGB with 0.5 alpha */
    0 0 80px rgba(R, G, B, 0.25);    /* Your RGB with 0.25 alpha */
}
```

**Pro Tip:** Use https://htmlcolorcodes.com/ to convert any color to hex + RGB

---

## Common Problems & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| Glow looks too sharp | Shadow layers too close | Increase spread: `0 0 10px`, `0 0 25px`, etc. |
| Glow looks too soft | Too much blur | Reduce blur or use fewer shadow layers |
| Color looks wrong | Wrong hex value | Check `color:` property matches shadow hex |
| Animation stutters | Too many effects | Reduce animations, combine classes |
| Not visible on dark BG | Not enough shadow | Increase shadow radius and opacity |
| Too bright | High-power settings | Use `.low-power` variant or reduce shadow count |

---

## Animation Timing Reference

```css
/* NATURAL TIMING (Physics-based) */
Startup:              2-3 seconds      /* Ionization phase */
Breathing Pulse:      2-4 seconds      /* Subtle pulsing */
Flickering (broken):  2-4 seconds      /* Intermittent on/off */
Cold Weather:         2-3 seconds      /* Sluggish response */
Weather Cycle:        15-20 seconds    /* Clear → Rain → Fog cycle */

/* FAST OSCILLATIONS */
AC Hum (60Hz):        0.0166 seconds   /* 60 cycles per second */
AC Hum (50Hz):        0.0200 seconds   /* 50 cycles per second */
```

---

## Quick Customization

### Make Neon Dimmer
```css
.neon-orange {
  opacity: 0.7;  /* Add this line */
  text-shadow: /* ... */
}
```

### Make Neon Brighter
```css
.neon-orange {
  filter: brightness(1.2);  /* Add this line */
  text-shadow: /* ... */
}
```

### Change Animation Speed
```html
<div class="neon-orange"
     style="animation: neonStartup 3s ease-out forwards;">
     <!-- Changed from 2.5s to 3s -->
</div>
```

### Combine Color & State
```html
<div class="neon-cyan neon-broken">ERROR</div>
<!-- Uses cyan color with flickering animation -->
```

---

## Files in This Package

- **neon-effects.css** → All animations and effects (import this)
- **neon-demo.html** → Interactive visual demo of all effects
- **NEON_RESEARCH.md** → Full physics documentation with sources
- **NEON_QUICK_REFERENCE.md** → This file (quick copy-paste)

---

## Implementation Checklist

- [ ] Import `neon-effects.css` into your HTML
- [ ] Add `.neon-[color]` class to text element
- [ ] Add animation class (`.neon-startup`, `.neon-breathe`, etc.) if needed
- [ ] Test on target devices (mobile, desktop)
- [ ] Adjust `.low-power` or `.high-power` variants if needed
- [ ] Add environmental effects (`.neon-rain`, `.neon-fog`) for atmosphere
- [ ] Check accessibility: `:reduced-motion` respected

---

## Real-World Physics Reminder

All these effects are based on actual neon sign behavior:
- **Startup flicker** = Gas ionization chaos
- **Breathing pulse** = AC ripple in power supply
- **Color choices** = Different gases/phosphor coatings
- **Rain bloom** = Light scattering through water
- **Broken flicker** = Air contamination in tube
- **Phosphor aging** = Degradation over years of use

The closer you stick to realistic physics, the more "authentic" and emotionally impactful the effect will feel.

---

**Last Updated:** December 16, 2025
**Based on:** Real neon physics research & optical properties
