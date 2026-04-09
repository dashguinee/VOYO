/**
 * VOYO Creator Upload - The Creator Economy Entry Point
 * Drop your vibe, share your energy with the OYO Nation
 */

import { useState, useRef } from 'react';
import { Upload, X, Music2, Video, Camera, ChevronRight, Check } from 'lucide-react';
import { usePlayerStore } from '../../../store/playerStore';

interface CreatorUploadProps {
  onClose: () => void;
}

// Upload Step Types
type UploadStep = 'select' | 'preview' | 'details' | 'posting';

export const CreatorUpload = ({ onClose }: CreatorUploadProps) => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const [step, setStep] = useState<UploadStep>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedSound, setSelectedSound] = useState<string | null>(
    currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setStep('preview');
    }
  };

  const handlePost = () => {
    setStep('posting');
    // Simulate posting
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  return (
    <div
      className="absolute inset-0 z-50 bg-[#0a0a0f] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10"
        >
          <X className="w-6 h-6 text-white" />
        </button>
        <span className="font-bold text-white text-lg">Create VOYO</span>
        <div className="w-10" />
      </div>

      {/* Content based on step */}
      
        {step === 'select' && (
          <div
            key="select"
            className="flex-1 flex flex-col items-center justify-center p-6"
          >
            {/* Upload Circle */}
            <button
              className="relative w-32 h-32 rounded-full bg-gradient-to-br from-purple-600/20 to-pink-600/20 border-2 border-dashed border-purple-500/50 flex items-center justify-center mb-8"
              onClick={() => fileInputRef.current?.click()}
            >
              <div
              >
                <Upload className="w-12 h-12 text-purple-400" />
              </div>
            </button>

            <h2 className="text-2xl font-bold text-white mb-2">Drop your Vibe</h2>
            <p className="text-white/50 text-center mb-8 max-w-xs">
              Share your energy with the OYO Nation. Videos up to 3 minutes.
            </p>

            {/* Quick Action Buttons */}
            <div className="flex gap-4 mb-8">
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10"
                onClick={() => fileInputRef.current?.click()}
              >
                <Video className="w-6 h-6 text-purple-400" />
                <span className="text-xs text-white/70">Upload</span>
              </button>

              <button
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10"
              >
                <Camera className="w-6 h-6 text-purple-400" />
                <span className="text-xs text-white/70">Record</span>
              </button>
            </div>

            {/* Currently Playing Suggestion */}
            {currentTrack && (
              <div
                className="w-full max-w-sm p-4 rounded-2xl bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/20"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                    <Music2 className="w-6 h-6 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-purple-300 mb-0.5">Use this sound?</p>
                    <p className="text-sm text-white font-medium truncate">
                      {currentTrack.title}
                    </p>
                    <p className="text-xs text-white/50 truncate">{currentTrack.artist}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-purple-400" />
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {step === 'preview' && previewUrl && (
          <div
            key="preview"
            className="flex-1 flex flex-col"
          >
            {/* Video Preview */}
            <div className="flex-1 relative bg-black">
              <video
                src={previewUrl}
                className="w-full h-full object-contain"
                controls
                autoPlay
                loop
                muted
              />
            </div>

            {/* Next Button */}
            <div className="p-4">
              <button
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 font-bold text-white flex items-center justify-center gap-2"
                onClick={() => setStep('details')}
              >
                Next
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div
            key="details"
            className="flex-1 flex flex-col p-4"
          >
            {/* Caption Input */}
            <div className="mb-6">
              <label className="text-sm text-white/50 mb-2 block">Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe your vibe... #OYE #AfricanVibes"
                className="w-full h-32 p-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-xs text-white/30 mt-2">{caption.length}/300</p>
            </div>

            {/* Sound Selection */}
            <div className="mb-6">
              <label className="text-sm text-white/50 mb-2 block">Sound</label>
              <button
                className="w-full p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3"
              >
                <Music2 className="w-5 h-5 text-purple-400" />
                <span className="flex-1 text-left text-white">
                  {selectedSound || 'Add sound'}
                </span>
                <ChevronRight className="w-5 h-5 text-white/30" />
              </button>
            </div>

            {/* Tags */}
            <div className="mb-6">
              <label className="text-sm text-white/50 mb-2 block">Tags</label>
              <div className="flex flex-wrap gap-2">
                {['#OYE', '#AfricanVibes', '#Dance', '#Music', '#Culture'].map((tag) => (
                  <button
                    key={tag}
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/70"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Post Button */}
            <button
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 font-bold text-white flex items-center justify-center gap-2"
              onClick={handlePost}
            >
              Post to VOYO
            </button>
          </div>
        )}

        {step === 'posting' && (
          <div
            key="posting"
            className="flex-1 flex flex-col items-center justify-center"
          >
            <div
              className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center mb-6"
            >
              <Check className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Posting...</h2>
            <p className="text-white/50">Sharing your vibe with the world</p>
          </div>
        )}
      
    </div>
  );
};

export default CreatorUpload;
