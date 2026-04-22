/**
 * VOYO Direct Message Chat - User to User DMs
 *
 * Features:
 * - Real-time messaging via Supabase Realtime
 * - Read receipts
 * - Optimistic updates
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Send, ArrowLeft, Check, CheckCheck } from 'lucide-react';
import { haptics } from '../../utils/haptics';
import { messagesAPI, isConfigured as isSupabaseConfigured } from '../../lib/voyo-api';
import type { DirectMessage } from '../../lib/voyo-api';

// ============================================================================
// TYPES
// ============================================================================

interface DirectMessageChatProps {
  currentUser: string;
  otherUser: string;
  otherUserDisplayName?: string;
  otherUserAvatar?: string | null;
  onBack: () => void;
}

// ============================================================================
// MESSAGE BUBBLE
// ============================================================================

interface MessageBubbleProps {
  message: DirectMessage;
  isOwnMessage: boolean;
}

const MessageBubble = memo(({ message, isOwnMessage }: MessageBubbleProps) => {
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-3 animate-voyo-slide-up`}
    >
      <div
        className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
          isOwnMessage
            ? 'bg-purple-500 rounded-br-sm'
            : 'bg-white/10 rounded-bl-sm'
        }`}
      >
        <p className="text-white text-sm leading-relaxed">{message.message}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
          <span className="text-white/40 text-[10px]">{time}</span>
          {isOwnMessage && (
            message.read_at ? (
              <CheckCheck className="w-3 h-3 text-purple-400" />
            ) : (
              <Check className="w-3 h-3 text-white/40" />
            )
          )}
        </div>
      </div>
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ============================================================================
// DIRECT MESSAGE CHAT
// ============================================================================

export const DirectMessageChat = memo(({
  currentUser,
  otherUser,
  otherUserDisplayName,
  otherUserAvatar,
  onBack,
}: DirectMessageChatProps) => {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const subscriptionRef = useRef<any>(null);

  const displayName = otherUserDisplayName || otherUser;

  // Load messages and subscribe
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    const loadMessages = async () => {
      setIsLoading(true);
      const msgs = await messagesAPI.getMessages(currentUser, otherUser);
      setMessages(msgs);
      setIsLoading(false);

      // Mark messages from other user as read
      await messagesAPI.markAsRead(otherUser, currentUser);
    };
    loadMessages();

    // Subscribe to new messages in this conversation
    subscriptionRef.current = messagesAPI.subscribeToConversation(
      currentUser,
      otherUser,
      (newMessage) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
        // Mark as read if it's from the other user
        if (newMessage.from_user === otherUser.toLowerCase()) {
          messagesAPI.markAsRead(otherUser, currentUser);
        }
      }
    );

    return () => {
      if (subscriptionRef.current) {
        messagesAPI.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [currentUser, otherUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Send message
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isSending) return;

    const messageText = inputText.trim();
    setInputText('');
    setIsSending(true);
    haptics.light();

    // Optimistic update
    const optimisticMessage: DirectMessage = {
      id: `temp-${Date.now()}`,
      from_user: currentUser.toLowerCase(),
      to_user: otherUser.toLowerCase(),
      message: messageText,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // Send to Supabase
    const success = await messagesAPI.sendMessage(currentUser, otherUser, messageText);

    if (!success) {
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      setInputText(messageText);
    }

    setIsSending(false);
  }, [inputText, currentUser, otherUser, isSending]);

  // Handle enter key
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isSupabaseConfigured) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0c]">
        <p className="text-white/50">Chat offline - Supabase not configured</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0a0a0c] flex flex-col animate-voyo-slide-in-right"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-white/10 voyo-tap-scale"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        {otherUserAvatar ? (
          <img
            src={otherUserAvatar}
            alt=""
            decoding="async"
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-purple-500/30 flex items-center justify-center">
            <span className="text-purple-300 font-semibold">
              {displayName[0]?.toUpperCase()}
            </span>
          </div>
        )}

        <div className="flex-1">
          <h2 className="text-white font-semibold">{displayName}</h2>
          <p className="text-white/50 text-xs">@{otherUser}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mb-4">
              <Send className="w-7 h-7 text-purple-400" />
            </div>
            <p className="text-white/60 text-sm">No messages yet</p>
            <p className="text-white/40 text-xs mt-1">
              Say hi to {displayName}!
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwnMessage={msg.from_user === currentUser.toLowerCase()}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/10">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Message ${displayName}...`}
            className="flex-1 bg-white/10 border border-white/10 rounded-full px-5 py-3 text-white text-sm placeholder-white/40 focus:outline-none focus:border-purple-500/50"
            maxLength={1000}
            disabled={isSending}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className={`w-12 h-12 rounded-full flex items-center justify-center voyo-tap-scale ${
              inputText.trim() && !isSending
                ? 'bg-purple-500'
                : 'bg-white/10'
            }`}
          >
            <Send
              className={`w-5 h-5 ${
                inputText.trim() && !isSending
                  ? 'text-white'
                  : 'text-white/40'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
});

DirectMessageChat.displayName = 'DirectMessageChat';

export default DirectMessageChat;
