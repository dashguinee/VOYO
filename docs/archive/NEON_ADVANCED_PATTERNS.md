# Advanced Neon CSS Patterns & Use Cases

## Pattern 1: Progressive Startup Sequence

**Scenario:** Website loads with neon sign turning on

```html
<h1 id="main-title" class="neon-cyan">YOUR SITE</h1>

<script>
  // On page load, trigger startup sequence
  window.addEventListener('load', () => {
    const title = document.getElementById('main-title');

    // Phase 1: Startup flicker (2.5s)
    title.classList.add('neon-startup');

    // Phase 2: After startup, switch to breathing (at 2.5s)
    setTimeout(() => {
      title.classList.remove('neon-startup');
      title.classList.add('neon-breathe');
    }, 2500);
  });
</script>

<style>
  h1 {
    font-size: 3em;
    text-align: center;
    margin: 50px 0;
  }
</style>
```

**Effect:** Sign flickers chaotically for 2.5s, then stabilizes into breathing pulse. Feels like real power-up.

---

## Pattern 2: Interactive Neon (Hover Changes Power)

**Scenario:** Button or link changes intensity on hover

```html
<button class="neon-button neon-cyan">CLICK ME</button>

<style>
  .neon-button {
    background: transparent;
    border: 2px solid #00ffff;
    color: #00ffff;
    padding: 15px 40px;
    font-size: 1.1em;
    cursor: pointer;
    text-transform: uppercase;
    font-weight: bold;
    transition: all 0.3s ease;

    /* Base glow */
    text-shadow:
      0 0 8px #00ffff,
      0 0 15px #00ffff,
      0 0 30px rgba(0, 255, 255, 0.5);

    box-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
  }

  .neon-button:hover {
    /* HIGH POWER on hover */
    text-shadow:
      0 0 12px #00ffff,
      0 0 20px #00ffff,
      0 0 40px rgba(0, 255, 255, 0.8),
      0 0 60px rgba(0, 255, 255, 0.6),
      0 0 80px rgba(0, 255, 255, 0.3);

    box-shadow: 0 0 20px rgba(0, 255, 255, 0.6);
    border-color: #00ffff;
    filter: brightness(1.2);
  }

  .neon-button:active {
    /* BURST on click - maximum power */
    text-shadow:
      0 0 15px #00ffff,
      0 0 25px #00ffff,
      0 0 50px rgba(0, 255, 255, 0.9),
      0 0 80px rgba(0, 255, 255, 0.7),
      0 0 120px rgba(0, 255, 255, 0.4);

    box-shadow: 0 0 30px rgba(0, 255, 255, 0.8);
    filter: brightness(1.4);
  }
</style>
```

**Effect:** Button has baseline glow, gets brighter on hover (power increase), then bursts with maximum glow on click.

---

## Pattern 3: Time-of-Day Simulation

**Scenario:** Different neon effects based on actual time

```html
<div id="ambient-sign" class="neon-orange">OPEN</div>

<script>
  function updateNeonByTime() {
    const sign = document.getElementById('ambient-sign');
    const hour = new Date().getHours();

    // Remove all effect classes
    sign.classList.remove('neon-breathe', 'neon-fog', 'neon-rain',
                          'neon-dimmed', 'neon-cold-sluggish');

    if (hour >= 6 && hour < 10) {
      // Early morning - cold, sluggish, foggy
      sign.classList.add('neon-cold-sluggish', 'neon-fog');
    } else if (hour >= 10 && hour < 17) {
      // Daytime - sign off or dimmed
      sign.style.opacity = '0.3';
      sign.classList.add('neon-dimmed');
    } else if (hour >= 17 && hour < 20) {
      // Evening - turning on
      sign.style.opacity = '1';
      sign.classList.add('neon-startup');
    } else if (hour >= 20 && hour < 23) {
      // Night - full power, breathing
      sign.classList.add('neon-breathe');
    } else {
      // Late night - storms possible
      const hasStorm = Math.random() > 0.7;
      if (hasStorm) {
        sign.classList.add('neon-heavy-rain');
      } else {
        sign.classList.add('neon-breathe');
      }
    }
  }

  // Update on load and every minute
  updateNeonByTime();
  setInterval(updateNeonByTime, 60000);
</script>
```

**Effect:** Sign's appearance changes throughout day - cold in morning, off in afternoon, turns on at evening, various night modes.

---

## Pattern 4: Degradation Over Time

**Scenario:** Sign slowly fails throughout user's session

```html
<div class="neon-sign neon-red">SALOON</div>

<script>
  let degradationLevel = 0;

  function applyDegradation() {
    const sign = document.querySelector('.neon-sign');
    sign.classList.remove('neon-breathe', 'neon-dimmed', 'neon-broken',
                         'neon-severe-broken', 'neon-severely-dimmed');

    degradationLevel += Math.random() * 0.15; // Random degradation

    if (degradationLevel < 0.25) {
      // Fresh
      sign.classList.add('neon-breathe');
      sign.style.opacity = '1';
    } else if (degradationLevel < 0.5) {
      // Getting old
      sign.classList.add('neon-dimmed');
      sign.style.opacity = '0.9';
    } else if (degradationLevel < 0.75) {
      // Degraded - intermittent flicker
      sign.classList.add('neon-broken');
      sign.style.opacity = '0.8';
    } else if (degradationLevel < 0.95) {
      // Severe - heavy flicker
      sign.classList.add('neon-severe-broken');
      sign.style.opacity = '0.6';
    } else {
      // Dying - barely on
      sign.classList.add('neon-severely-broken');
      sign.style.opacity = '0.3';
    }
  }

  // Degrade every 30 seconds (simulating hours of operation)
  setInterval(applyDegradation, 30000);
</script>
```

**Effect:** Sign starts fresh and slowly deteriorates - breathing → dimming → flickering → severe flicker → almost dead. Tells visual story over time.

---

## Pattern 5: Weather-Responsive Neon

**Scenario:** Neon responds to actual weather API

```html
<div id="weather-sign" class="neon-cyan">WEATHER</div>

<script>
  async function updateNeonByWeather() {
    // Using Open-Meteo (free, no API key needed)
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=weather_code,precipitation'
    );
    const data = await response.json();
    const weatherCode = data.current.weather_code;
    const precipitation = data.current.precipitation || 0;

    const sign = document.getElementById('weather-sign');
    sign.classList.remove('neon-breathe', 'neon-light-rain',
                         'neon-heavy-rain', 'neon-fog');

    // Weather code 0-1: Clear
    if (weatherCode <= 1) {
      sign.classList.add('neon-breathe');
    }
    // Weather code 45-48: Foggy
    else if (weatherCode >= 45 && weatherCode <= 48) {
      sign.classList.add('neon-fog');
    }
    // Weather code 51-67: Rain
    else if (weatherCode >= 51 && weatherCode <= 67) {
      if (precipitation > 5) {
        sign.classList.add('neon-heavy-rain');
      } else {
        sign.classList.add('neon-light-rain');
      }
    }
    // Weather code 80-82: Heavy rain
    else if (weatherCode >= 80 && weatherCode <= 82) {
      sign.classList.add('neon-heavy-rain');
    }
  }

  // Update weather effects every 10 minutes
  updateNeonByWeather();
  setInterval(updateNeonByWeather, 600000);
</script>
```

**Effect:** Real-time weather affects neon appearance. Clear day = normal breathing. Raining = bloom extends. Foggy = almost invisible. Truly immersive.

---

## Pattern 6: Multi-Layer Neon Sign (Different Colors)

**Scenario:** Complex sign with multiple colored tubes

```html
<div class="neon-sign-complex">
  <span class="sign-line-1 neon-red">RETRO</span>
  <span class="sign-line-2 neon-orange">ELECTRIC</span>
  <span class="sign-line-3 neon-cyan">VIBES</span>
</div>

<style>
  .neon-sign-complex {
    display: flex;
    flex-direction: column;
    gap: 20px;
    text-align: center;
    font-size: 2.5em;
    font-weight: bold;
    letter-spacing: 3px;
  }

  .sign-line-1 { animation: neonStartup 2.5s ease-out forwards; }
  .sign-line-2 { animation: neonStartup 2.5s ease-out 0.3s both; }
  .sign-line-3 { animation: neonStartup 2.5s ease-out 0.6s both; }

  /* All three then breathe together */
  .neon-sign-complex:hover > span {
    animation: neonBreathe 2s ease-in-out infinite !important;
  }
</style>
```

**Effect:** Each line starts up at slightly offset timing, creating a cascading power-on. Hover makes all lines breathe together.

---

## Pattern 7: State Machine Sign

**Scenario:** Sign shows different states based on application status

```html
<div id="status-sign" class="neon-status">LOADING</div>

<script>
  const states = {
    loading: { text: 'LOADING', color: 'neon-cyan', effect: 'neon-startup' },
    success: { text: 'SUCCESS', color: 'neon-green', effect: 'neon-breathe' },
    error: { text: 'ERROR', color: 'neon-red', effect: 'neon-broken' },
    warning: { text: 'WARNING', color: 'neon-orange', effect: 'neon-broken' },
    offline: { text: 'OFFLINE', color: 'neon-purple', effect: 'neon-dimmed' }
  };

  function setSignState(state) {
    const sign = document.getElementById('status-sign');
    const config = states[state];

    // Reset classes
    Object.values(states).forEach(s => {
      sign.classList.remove(s.color, s.effect);
    });

    // Apply new state
    sign.textContent = config.text;
    sign.classList.add(config.color, config.effect);
  }

  // Simulate state changes
  setSignState('loading');
  setTimeout(() => setSignState('success'), 3000);
  setTimeout(() => setSignState('error'), 6000);
  setTimeout(() => setSignState('loading'), 10000);
</script>

<style>
  .neon-status {
    font-size: 2em;
    font-weight: bold;
    text-align: center;
    padding: 30px;
    margin: 30px 0;
  }
</style>
```

**Effect:** Sign becomes state machine - shows loading (cyan startup), then success (green breathing), then error (red flicker). Perfect for dashboards.

---

## Pattern 8: Chromatic Aberration Animation

**Scenario:** Advanced rain effect with color separation

```html
<div class="neon-chromatic-rain">PRISM</div>

<style>
  @keyframes chromRed {
    0% { text-shadow: -2px 0 3px rgba(255, 0, 0, 0.6); }
    50% { text-shadow: -1px 0 5px rgba(255, 0, 0, 0.8); }
    100% { text-shadow: -2px 0 3px rgba(255, 0, 0, 0.6); }
  }

  @keyframes chromBlue {
    0% { text-shadow: 2px 0 3px rgba(0, 128, 255, 0.6); }
    50% { text-shadow: 1px 0 5px rgba(0, 128, 255, 0.8); }
    100% { text-shadow: 2px 0 3px rgba(0, 128, 255, 0.6); }
  }

  .neon-chromatic-rain {
    font-size: 2em;
    font-weight: bold;
    color: #ffffff;
    filter: blur(0.5px);

    /* Layer: red channel animated left */
    animation: chromRed 1.5s ease-in-out infinite;

    /* Add blue via box-shadow approximation */
    box-shadow: 2px 0 10px rgba(0, 128, 255, 0.5);
  }
</style>
```

**Effect:** Rain creates color separation (red shifts left, blue shifts right) creating prism/rainbow effect on neon.

---

## Pattern 9: Neon Grid/Wall

**Scenario:** Multiple neon signs in grid pattern

```html
<div class="neon-grid">
  <div class="neon-item neon-red">OPEN</div>
  <div class="neon-item neon-cyan">LIVE</div>
  <div class="neon-item neon-green">GO</div>
  <div class="neon-item neon-orange">ZONE</div>
  <div class="neon-item neon-purple">SYNC</div>
  <div class="neon-item neon-pink">VIBE</div>
</div>

<style>
  .neon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    padding: 40px;
    background: #0a0a0a;
  }

  .neon-item {
    font-size: 1.8em;
    font-weight: bold;
    text-align: center;
    padding: 30px;
    border: 2px solid currentColor;
    background: rgba(0, 0, 0, 0.6);
    cursor: pointer;
    transition: filter 0.3s ease;

    /* Cascade startup by grid position */
    animation: neonStartup 2.5s ease-out;
  }

  /* Stagger startup timing by nth-child */
  .neon-item:nth-child(1) { animation-delay: 0s; }
  .neon-item:nth-child(2) { animation-delay: 0.2s; }
  .neon-item:nth-child(3) { animation-delay: 0.4s; }
  .neon-item:nth-child(4) { animation-delay: 0.6s; }
  .neon-item:nth-child(5) { animation-delay: 0.8s; }
  .neon-item:nth-child(6) { animation-delay: 1s; }

  .neon-item:hover {
    filter: brightness(1.3);
  }
</style>
```

**Effect:** Neon grid powers on in cascade - each sign lights up 0.2s after previous. Visually striking and immersive.

---

## Pattern 10: Neon Text with Reflection

**Scenario:** Vegas-style sign with water reflection

```html
<div class="neon-reflection-container">
  <div class="neon-text neon-cyan">REFLECTION</div>
  <div class="neon-reflection neon-cyan">REFLECTION</div>
</div>

<style>
  .neon-reflection-container {
    position: relative;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    perspective: 1000px;
  }

  .neon-text {
    font-size: 3em;
    font-weight: bold;
    letter-spacing: 2px;
    color: #00ffff;
    text-shadow:
      0 0 10px #00ffff,
      0 0 20px #00ffff,
      0 0 40px rgba(0, 255, 255, 0.6),
      0 0 60px rgba(0, 255, 255, 0.3);
    z-index: 10;
  }

  .neon-reflection {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateX(-50%) translateY(10px) scaleY(-1);
    font-size: 3em;
    font-weight: bold;
    letter-spacing: 2px;
    color: #00ffff;
    opacity: 0.3;
    filter: blur(2px);
    text-shadow:
      0 0 10px rgba(0, 255, 255, 0.4),
      0 0 20px rgba(0, 255, 255, 0.2),
      0 0 40px rgba(0, 255, 255, 0.1);
  }
</style>
```

**Effect:** Sign reflects in water below (like Vegas). Reflection is dimmer, blurrier, and slightly offset. Very cinematic.

---

## Pattern 11: Neon Loading Bar

**Scenario:** Progress indicator with neon styling

```html
<div class="neon-progress-container">
  <div class="neon-progress-bar" id="progress"></div>
</div>
<p class="neon-progress-label">LOADING...</p>

<script>
  function simulateProgress() {
    const bar = document.getElementById('progress');
    let progress = 0;

    const interval = setInterval(() => {
      progress += Math.random() * 25;
      if (progress > 100) {
        progress = 100;
        clearInterval(interval);
      }
      bar.style.width = progress + '%';
    }, 500);
  }

  simulateProgress();
</script>

<style>
  .neon-progress-container {
    width: 100%;
    height: 10px;
    background: rgba(0, 0, 0, 0.8);
    border: 2px solid rgba(0, 255, 255, 0.3);
    border-radius: 5px;
    overflow: hidden;
    margin: 40px 0;
  }

  .neon-progress-bar {
    height: 100%;
    width: 0;
    background: #00ffff;
    transition: width 0.3s ease;
    box-shadow:
      0 0 10px #00ffff,
      0 0 20px rgba(0, 255, 255, 0.6),
      inset 0 0 10px rgba(0, 255, 255, 0.4);
  }

  .neon-progress-label {
    text-align: center;
    color: #00ffff;
    font-weight: bold;
    text-shadow: 0 0 10px #00ffff;
    letter-spacing: 2px;
    font-size: 0.9em;
  }
</style>
```

**Effect:** Progress bar glows neon cyan, grows with animation, filling with bright glow.

---

## Pattern 12: Neon Error Boundary

**Scenario:** Error state with dramatic neon effect

```html
<div id="error-display" class="neon-error" style="display: none;">
  <div class="neon-error-icon neon-red">!</div>
  <div class="neon-error-message neon-red">ERROR: SYSTEM FAILURE</div>
</div>

<script>
  function showError(message) {
    const display = document.getElementById('error-display');
    const messageEl = display.querySelector('.neon-error-message');

    messageEl.textContent = message;
    display.style.display = 'flex';

    // Add broken effect
    display.querySelector('.neon-error-icon').classList.add('neon-broken');
    messageEl.classList.add('neon-broken');
  }

  // Test: trigger error after 3s
  setTimeout(() => showError('CRITICAL: MATRIX FAILURE'), 3000);
</script>

<style>
  .neon-error {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 40px;
    background: rgba(0, 0, 0, 0.95);
    border: 3px solid #ff0000;
    border-radius: 5px;
    z-index: 9999;
    backdrop-filter: blur(10px);
  }

  .neon-error-icon {
    font-size: 4em;
    font-weight: bold;
    animation: neonFlicker 2s steps(2, end) infinite;
  }

  .neon-error-message {
    font-size: 1.5em;
    font-weight: bold;
    letter-spacing: 2px;
  }
</style>
```

**Effect:** Error modal appears with red flickering neon, creating sense of system failure/emergency.

---

## Performance Optimization Tips

### For Many Neon Elements
```css
/* Use ::before/::after pseudo-elements for shadow layers */
.neon::before {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  z-index: -1;
  color: inherit;
  text-shadow:
    0 0 20px currentColor,
    0 0 40px currentColor;
  filter: blur(1px);
}
```

### For Mobile
```css
/* Reduce bloom on mobile for battery life */
@media (max-width: 768px) {
  .neon {
    text-shadow:
      0 0 5px currentColor,
      0 0 10px currentColor;
  }
}
```

### Prevent Animation Jank
```css
.neon {
  will-change: text-shadow, filter;
  transform: translateZ(0);
  backface-visibility: hidden;
}
```

---

These patterns show the full power of real neon physics applied creatively. Mix and match for your specific use cases!
