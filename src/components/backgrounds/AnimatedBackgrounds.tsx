/**
 * VOYO Backgrounds & Reaction Canvas
 *
 * Simple backgrounds: black or custom image.
 * Reaction animations pop up when users tap reactions.
 */

import { usePlayerStore } from '../../store/playerStore';
import { useState, useEffect, useRef } from 'react';

export type BackgroundType = 'none' | 'custom';

// Custom backdrop animation types
export type CustomAnimation = 'none' | 'zoom' | 'pan';

// LocalStorage keys
const STORAGE_KEYS = {
  IMAGE: 'voyo_custom_backdrop',
  BLUR: 'voyo_custom_blur',
  ANIMATION: 'voyo_custom_animation',
  BRIGHTNESS: 'voyo_custom_brightness',
};

// Generate stable random offset from reaction ID (hash-based)
const getStableOffset = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return ((hash % 100) - 50) * 1.2; // Range: -60 to 60
};

// ============================================
// REACTION CANVAS - Shows reactions when tapped
// ============================================
export const ReactionCanvas = () => {
  const reactions = usePlayerStore(s => s.reactions);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-30">
      {reactions.map(reaction => {
        const xPos = reaction.x || 50;
        const xOffset = getStableOffset(reaction.id);

        return (
          <div
            key={reaction.id}
            className="absolute text-4xl animate-voyo-float-reaction"
            style={{
              left: `${xPos}%`,
              bottom: '30%',
              '--spark-x': `${xOffset}px`,
            } as React.CSSProperties}
          >
            {reaction.emoji || (
              reaction.type === 'oyo' ? '\uD83D\uDC4B' :
              reaction.type === 'oye' ? '\uD83C\uDF89' :
              reaction.type === 'fire' ? '\uD83D\uDD25' :
              reaction.type === 'wazzguan' ? '\uD83E\uDD19' :
              '\u2728'
            )}
            {reaction.multiplier > 1 && (
              <span className="text-lg ml-1 text-[#D4A053] font-bold">
                x{reaction.multiplier}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============================================
// CUSTOM IMAGE BACKDROP - User uploaded image with controls
// ============================================
const CustomBackdrop = () => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [blur, setBlur] = useState<number>(10);
  const [animation, setAnimation] = useState<CustomAnimation>('none');
  const [brightness, setBrightness] = useState<number>(0.5);

  // Load settings from localStorage
  useEffect(() => {
    const loadedImage = localStorage.getItem(STORAGE_KEYS.IMAGE);
    const loadedBlur = localStorage.getItem(STORAGE_KEYS.BLUR);
    const loadedAnimation = localStorage.getItem(STORAGE_KEYS.ANIMATION);
    const loadedBrightness = localStorage.getItem(STORAGE_KEYS.BRIGHTNESS);

    if (loadedImage) setImageData(loadedImage);
    if (loadedBlur) setBlur(Number(loadedBlur));
    if (loadedAnimation) setAnimation(loadedAnimation as CustomAnimation);
    if (loadedBrightness) setBrightness(Number(loadedBrightness));
  }, []);

  if (!imageData) return null;

  const getAnimationStyle = () => {
    switch (animation) {
      case 'zoom': return 'animate-backdrop-zoom';
      case 'pan': return 'animate-backdrop-pan';
      default: return '';
    }
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className={`absolute inset-0 bg-cover bg-center ${getAnimationStyle()}`}
        style={{
          backgroundImage: `url(${imageData})`,
          filter: `blur(${blur}px) brightness(${brightness})`,
          willChange: animation !== 'none' ? 'transform' : 'auto',
        }}
      />
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
};

// ============================================
// CUSTOM BACKDROP SETTINGS
// ============================================
interface CustomBackdropSettingsProps {
  onClose: () => void;
}

export const CustomBackdropSettings = ({ onClose }: CustomBackdropSettingsProps) => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [blur, setBlur] = useState<number>(10);
  const [animation, setAnimation] = useState<CustomAnimation>('none');
  const [brightness, setBrightness] = useState<number>(0.5);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadedImage = localStorage.getItem(STORAGE_KEYS.IMAGE);
    const loadedBlur = localStorage.getItem(STORAGE_KEYS.BLUR);
    const loadedAnimation = localStorage.getItem(STORAGE_KEYS.ANIMATION);
    const loadedBrightness = localStorage.getItem(STORAGE_KEYS.BRIGHTNESS);

    if (loadedImage) setImageData(loadedImage);
    if (loadedBlur) setBlur(Number(loadedBlur));
    if (loadedAnimation) setAnimation(loadedAnimation as CustomAnimation);
    if (loadedBrightness) setBrightness(Number(loadedBrightness));
  }, []);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setImageData(base64);
      localStorage.setItem(STORAGE_KEYS.IMAGE, base64);
    };
    reader.readAsDataURL(file);
  };

  const handleBlurChange = (value: number) => {
    setBlur(value);
    localStorage.setItem(STORAGE_KEYS.BLUR, value.toString());
  };

  const handleAnimationChange = (value: CustomAnimation) => {
    setAnimation(value);
    localStorage.setItem(STORAGE_KEYS.ANIMATION, value);
  };

  const handleBrightnessChange = (value: number) => {
    setBrightness(value);
    localStorage.setItem(STORAGE_KEYS.BRIGHTNESS, value.toString());
  };

  const handleRemoveImage = () => {
    setImageData(null);
    localStorage.removeItem(STORAGE_KEYS.IMAGE);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-voyo-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-md bg-[#111114]/95 backdrop-blur-xl rounded-t-3xl p-6 pb-10 border-t border-white/10 max-h-[80vh] overflow-y-auto animate-voyo-spring-in-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-6" />
        <h3 className="text-lg font-bold text-white mb-4 text-center" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
          Custom Backdrop
        </h3>

        {imageData && (
          <div className="mb-6 relative rounded-2xl overflow-hidden h-40 border border-white/10">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${imageData})`, filter: `blur(${blur}px) brightness(${brightness})` }}
            />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="text-white/80 text-sm">Preview</span>
            </div>
          </div>
        )}

        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">Background Image</label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          <div className="flex gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 text-purple-300 px-4 py-3 rounded-xl font-medium transition-colors">
              {imageData ? 'Change Image' : 'Upload Image'}
            </button>
            {imageData && (
              <button onClick={handleRemoveImage} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 px-4 py-3 rounded-xl font-medium transition-colors">
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">Blur: {blur}px</label>
          <input type="range" min="0" max="20" value={blur} onChange={(e) => handleBlurChange(Number(e.target.value))} className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider-thumb" />
        </div>

        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">Brightness: {Math.round(brightness * 100)}%</label>
          <input type="range" min="0" max="1" step="0.05" value={brightness} onChange={(e) => handleBrightnessChange(Number(e.target.value))} className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider-thumb" />
        </div>

        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">Animation</label>
          <div className="flex gap-2">
            {(['none', 'zoom', 'pan'] as CustomAnimation[]).map((anim) => (
              <button
                key={anim}
                onClick={() => handleAnimationChange(anim)}
                className={`flex-1 px-4 py-3 rounded-xl font-medium transition-colors capitalize ${
                  animation === anim
                    ? 'bg-purple-500/30 border border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                {anim}
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose} className="w-full bg-white/10 hover:bg-white/20 text-white px-4 py-3 rounded-xl font-medium transition-colors">
          Done
        </button>
      </div>
    </div>
  );
};

// ============================================
// MAIN EXPORT
// ============================================
interface AnimatedBackgroundProps {
  type: BackgroundType;
  mood?: 'chill' | 'hype' | 'vibe' | 'focus';
}

export const AnimatedBackground = ({ type }: AnimatedBackgroundProps) => {
  switch (type) {
    case 'custom': return <CustomBackdrop />;
    case 'none':
    default: return null;
  }
};

// ============================================
// BACKGROUND PICKER UI
// ============================================
interface BackgroundPickerProps {
  current: BackgroundType;
  onSelect: (type: BackgroundType) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const BackgroundPicker = ({ current, onSelect, isOpen, onClose }: BackgroundPickerProps) => {
  const [showCustomSettings, setShowCustomSettings] = useState(false);

  const options: { type: BackgroundType; label: string; icon: string }[] = [
    { type: 'none', label: 'Black', icon: '\uD83C\uDF11' },
    { type: 'custom', label: 'Image', icon: '\uD83D\uDDBC\uFE0F' },
  ];

  const handleSelect = (type: BackgroundType) => {
    if (type === 'custom') {
      setShowCustomSettings(true);
      onSelect(type);
    } else {
      onSelect(type);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {!showCustomSettings ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center animate-voyo-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          <div className="relative w-full max-w-md bg-[#111114]/95 backdrop-blur-xl rounded-t-3xl p-6 pb-10 border-t border-white/10 animate-voyo-spring-in-bottom">
            <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-6" />
            <h3 className="text-lg font-bold text-white mb-4 text-center" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
              Background
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {options.map(option => (
                <button
                  key={option.type}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl transition-colors voyo-tap-scale ${
                    current === option.type
                      ? 'bg-purple-500/30 border border-purple-500/50'
                      : 'bg-white/5 border border-white/10 hover:bg-white/10'
                  }`}
                  onClick={() => handleSelect(option.type)}
                >
                  <span className="text-3xl">{option.icon}</span>
                  <span className="text-sm text-white/70 font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <CustomBackdropSettings
          onClose={() => {
            setShowCustomSettings(false);
            onClose();
          }}
        />
      )}
    </>
  );
};

export default AnimatedBackground;
