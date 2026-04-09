/**
 * VOYO Portal Chat - Dimensional Portal Messages
 *
 * Features:
 * - Real-time chat via Supabase Realtime
 * - Each user gets a unique color based on their username
 * - Messages persist for 2 hours (auto-cleanup)
 * - Smooth animations for new messages
 *
 * The vibe: You're in someone's musical dimension, chatting with other visitors
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Send, MessageCircle, X, Users, Wifi, WifiOff } from 'lucide-react';
import { haptics } from '../../utils/haptics';
import { portalChatAPI, PortalMessage, isSupabaseConfigured } from '../../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

interface PortalChatProps {
  portalOwner: string;          // Whose portal we're in
  currentUser: string;          // Who I am
  isPortalOpen: boolean;        // Is the portal active
  onClose?: () => void;         // Close chat overlay
}

// ============================================================================
// COLOR GENERATION - Unique color per user
// ============================================================================

// Predefined beautiful colors for portal dimensions
const PORTAL_COLORS = [
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#6366F1', // Indigo
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#84CC16', // Lime
  '#A855F7', // Purple
  '#22D3EE', // Sky
  '#FB7185', // Rose
  '#4ADE80', // Green
  '#FACC15', // Yellow
];

/**
 * Generate a consistent color for a username
 * Same username always gets the same color
 */
function getUserColor(username: string): string {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Use absolute value and mod to get index
  const index = Math.abs(hash) % PORTAL_COLORS.length;
  return PORTAL_COLORS[index];
}

// ============================================================================
// CHAT MESSAGE COMPONENT
// ============================================================================

interface ChatMessageProps {
  message: PortalMessage;
  isOwnMessage: boolean;
}

const ChatMessage = memo(({ message, isOwnMessage }: ChatMessageProps) => {
  const timeAgo = getTimeAgo(new Date(message.created_at).getTime());

  return (
    <div
      className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} mb-3 animate-[voyo-fade-in_0.2s_ease]`}
    >
      {/* Username with color */}
      <span
        className="text-xs font-medium mb-1"
        style={{ color: message.sender_color }}
      >
        {message.sender}
        <span className="text-white/30 ml-2 font-normal">{timeAgo}</span>
      </span>

      {/* Message bubble */}
      <div
        className={`max-w-[80%] px-4 py-2 rounded-2xl ${
          isOwnMessage
            ? 'rounded-tr-sm'
            : 'rounded-tl-sm'
        }`}
        style={{
          background: isOwnMessage
            ? `linear-gradient(135deg, ${message.sender_color}40 0%, ${message.sender_color}20 100%)`
            : 'rgba(255,255,255,0.1)',
          borderLeft: isOwnMessage ? 'none' : `3px solid ${message.sender_color}`,
        }}
      >
        <p className="text-white text-sm">{message.message}</p>
      </div>
    </div>
  );
});
ChatMessage.displayName = 'ChatMessage';

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// ============================================================================
// PORTAL CHAT COMPONENT
// ============================================================================

export const PortalChat = memo(({ portalOwner, currentUser, isPortalOpen, onClose }: PortalChatProps) => {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isMinimized, setIsMinimized] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const subscriptionRef = useRef<any>(null);

  // Get current user's color
  const userColor = getUserColor(currentUser);

  // Load initial messages and subscribe to realtime
  useEffect(() => {
    if (!isPortalOpen || !isSupabaseConfigured) return;

    // Load existing messages
    const loadMessages = async () => {
      const existing = await portalChatAPI.getMessages(portalOwner);
      setMessages(existing);
      setIsConnected(true);
    };
    loadMessages();

    // Subscribe to new messages
    subscriptionRef.current = portalChatAPI.subscribe(portalOwner, (newMessage) => {
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });
    });

    return () => {
      if (subscriptionRef.current) {
        portalChatAPI.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [portalOwner, isPortalOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !currentUser || isSending) return;

    const messageText = inputText.trim();
    setInputText('');
    setIsSending(true);
    haptics.light();

    // Optimistic update - add message immediately
    const optimisticMessage: PortalMessage = {
      id: `temp-${Date.now()}`,
      portal_owner: portalOwner,
      sender: currentUser,
      sender_color: userColor,
      message: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // Send to Supabase
    const success = await portalChatAPI.sendMessage(
      portalOwner,
      currentUser,
      userColor,
      messageText
    );

    if (!success) {
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      setInputText(messageText); // Restore input
    }

    setIsSending(false);
  }, [inputText, currentUser, userColor, portalOwner, isSending]);

  // Handle enter key
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isPortalOpen) return null;

  // Offline fallback
  if (!isSupabaseConfigured) {
    return (
      <div
        className="fixed bottom-24 right-4 z-50 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm animate-[voyo-fade-in_0.3s_ease]"
      >
        <span className="text-white/50 text-sm flex items-center gap-2">
          <WifiOff size={16} />
          Chat offline
        </span>
      </div>
    );
  }

  // Minimized state - just a floating button
  if (isMinimized) {
    return (
      <button
        className="fixed bottom-24 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center animate-[voyo-scale-in_0.3s_ease]"
        style={{
          background: `linear-gradient(135deg, ${userColor} 0%, ${userColor}80 100%)`,
          boxShadow: `0 4px 20px ${userColor}40`,
        }}
        onClick={() => {
          setIsMinimized(false);
          haptics.light();
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
      >
        <MessageCircle size={24} className="text-white" />
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">
            {messages.length > 9 ? '9+' : messages.length}
          </span>
        )}
        {/* Connection indicator */}
        <span
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-black ${
            isConnected ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />
      </button>
    );
  }

  // Expanded chat view
  return (
    <div
      className="fixed bottom-24 right-4 z-50 w-80 max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden animate-[voyo-scale-in_0.3s_ease]"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(20,20,30,0.98) 100%)',
        border: `1px solid ${userColor}30`,
        boxShadow: `0 10px 40px rgba(0,0,0,0.5), 0 0 20px ${userColor}20`,
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${userColor}20` }}
      >
        <div className="flex items-center gap-2">
          <Users size={18} style={{ color: userColor }} />
          <span className="text-white font-semibold text-sm">
            {portalOwner}'s Portal
          </span>
          {isConnected && (
            <Wifi size={14} className="text-green-400" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
            onClick={() => setIsMinimized(true)}
          >
            <span className="text-white text-lg">−</span>
          </button>
          {onClose && (
            <button
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
              onClick={onClose}
            >
              <X size={16} className="text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Your color indicator */}
      <div className="px-4 py-2 flex items-center gap-2" style={{ background: `${userColor}10` }}>
        <div
          className="w-3 h-3 rounded-full"
          style={{ background: userColor, boxShadow: `0 0 8px ${userColor}` }}
        />
        <span className="text-white/60 text-xs">
          Your dimension: <span style={{ color: userColor }}>{currentUser}</span>
        </span>
      </div>

      {/* Messages area */}
      <div className="h-64 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <MessageCircle size={40} className="text-white/20 mb-3" />
            <p className="text-white/40 text-sm">No messages yet</p>
            <p className="text-white/30 text-xs mt-1">
              Say hi to {portalOwner} and other visitors!
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isOwnMessage={msg.sender === currentUser}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="p-3 flex gap-2"
        style={{ borderTop: `1px solid ${userColor}20` }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={`Message ${portalOwner}'s portal...`}
          className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white text-sm placeholder-white/40 focus:outline-none focus:border-purple-500/50"
          maxLength={500}
          disabled={isSending}
        />
        <button
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: inputText.trim() && !isSending
              ? `linear-gradient(135deg, ${userColor} 0%, ${userColor}80 100%)`
              : 'rgba(255,255,255,0.1)',
          }}
          onClick={handleSend}
          disabled={!inputText.trim() || isSending}
        >
          <Send size={18} className={isSending ? 'text-white/50 animate-pulse' : 'text-white'} />
        </button>
      </div>
    </div>
  );
});

PortalChat.displayName = 'PortalChat';

export default PortalChat;
