/**
 * DirectMessageChat - Full-screen DM conversation
 *
 * Features:
 * - Real-time messaging
 * - Read receipts
 * - App badge showing where message was sent from
 * - Optimistic updates
 * - Mobile-first layout with safe-area insets
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft, Send, Check, CheckCheck, Loader2,
  Music, Tv, GraduationCap, Paperclip
} from 'lucide-react';
import { messagesAPI, APP_CODES, getAppDisplay, type Message } from '../../lib/dahub/dahub-api';
import { useBackGuard } from '../../hooks/useBackGuard';
import { useMessagingViewport } from '../../hooks/useMessagingViewport';

// ==============================================
// TYPES
// ==============================================

interface DirectMessageChatProps {
  currentUserId: string;
  currentUserName: string;
  friendId: string;
  friendName: string;
  friendAvatar?: string;
  onClose: () => void;
}

// ==============================================
// HELPERS
// ==============================================

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getAppIcon(appCode: string | undefined) {
  switch (appCode) {
    case 'V': return <Music size={10} />;
    case 'E': return <GraduationCap size={10} />;
    case 'TV': return <Tv size={10} />;
    default: return null;
  }
}

// ==============================================
// MESSAGE BUBBLE
// ==============================================

function MessageBubble({
  message,
  isOwn,
  showTime = true
}: {
  message: Message;
  isOwn: boolean;
  showTime?: boolean;
}) {
  const appDisplay = message.sent_from ? getAppDisplay(message.sent_from) : null;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 w-full animate-voyo-fade-in`}>
      <div className={`max-w-[75%] min-w-0 ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Message content */}
        <div
          className={`px-4 py-2.5 rounded-2xl min-w-0 ${
            isOwn
              ? 'bg-gradient-to-br from-purple-500 to-violet-600 text-white rounded-br-md'
              : 'bg-white/[0.08] text-white rounded-bl-md'
          }`}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {message.message}
          </p>

          {/* Attachment preview */}
          {message.attachment_type && message.attachment_data && (
            <div className="mt-2 p-2 rounded-lg bg-black/20">
              {message.attachment_type === 'track' && (
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/30 flex items-center justify-center flex-shrink-0">
                    <Music size={16} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{message.attachment_data.title}</p>
                    <p className="text-[10px] text-white/60 truncate">{message.attachment_data.artist}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time and status */}
        {showTime && (
          <div className={`flex items-center gap-1.5 mt-1 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
            {/* App badge */}
            {appDisplay && message.sent_from !== 'CC' && (
              <span
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: appDisplay.color + '30' }}
              >
                {getAppIcon(message.sent_from)}
              </span>
            )}

            <span className="text-[10px] text-white/30">
              {formatMessageTime(message.created_at)}
            </span>

            {/* Read receipt for own messages */}
            {isOwn && (
              message.read_at ? (
                <CheckCheck size={12} className="text-purple-400 flex-shrink-0" />
              ) : (
                <Check size={12} className="text-white/30 flex-shrink-0" />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export function DirectMessageChat({
  currentUserId,
  currentUserName,
  friendId,
  friendName,
  friendAvatar,
  onClose
}: DirectMessageChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useBackGuard(true, onClose, 'dahub-dm');
  const { vh, keyboardOpen } = useMessagingViewport();

  // Scroll to bottom — `end` block avoids smooth jank when keyboard is mid-open
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, []);

  // Keep the newest message visible when the soft keyboard opens
  useEffect(() => {
    if (keyboardOpen) {
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ block: 'end' }));
    }
  }, [keyboardOpen]);

  // Load messages
  useEffect(() => {
    const loadMessages = async () => {
      setIsLoading(true);
      const msgs = await messagesAPI.getMessages(currentUserId, friendId);
      setMessages(msgs);
      setIsLoading(false);

      // Mark as read
      await messagesAPI.markAsRead(currentUserId, friendId);
    };

    loadMessages();
  }, [currentUserId, friendId]);

  // Scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Subscribe to new messages
  useEffect(() => {
    const unsubscribe = messagesAPI.subscribeToMessages(currentUserId, (msg) => {
      if (msg.from_id === friendId) {
        setMessages(prev => [...prev, msg]);
        // Mark as read immediately since chat is open
        messagesAPI.markAsRead(currentUserId, friendId);
      }
    });

    return () => unsubscribe();
  }, [currentUserId, friendId]);

  // Send message
  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;

    const messageText = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      from_id: currentUserId,
      to_id: friendId,
      message: messageText,
      sent_from: APP_CODES.COMMAND_CENTER,
      read_at: null,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // Send to server
    const success = await messagesAPI.sendMessage(
      currentUserId,
      friendId,
      messageText,
      APP_CODES.COMMAND_CENTER,
      undefined,
      currentUserName,
    );

    if (!success) {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setNewMessage(messageText); // Restore message
    }

    setIsSending(false);
    inputRef.current?.focus();
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, msg) => {
    const date = new Date(msg.created_at).toDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(msg);
    return groups;
  }, {} as Record<string, Message[]>);

  return (
    <div
      className="fixed inset-x-0 top-0 z-[80] bg-[#0a0a0f] flex flex-col overflow-hidden animate-voyo-slide-in-right"
      style={{ height: vh || '100dvh' }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-3 py-3 border-b border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-xl"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/[0.08] transition-colors active:scale-95 flex-shrink-0"
          aria-label="Close chat"
        >
          <ArrowLeft size={20} className="text-white/70" />
        </button>

        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold overflow-hidden bg-gradient-to-br from-purple-500 to-violet-600 text-white flex-shrink-0">
          {friendAvatar ? (
            <img src={friendAvatar} alt="" decoding="async" className="w-full h-full object-cover" />
          ) : (
            getInitials(friendName)
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold truncate">{friendName}</p>
          <p className="text-white/40 text-xs truncate">Active now</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-purple-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold bg-gradient-to-br from-purple-500 to-violet-600 text-white">
                {getInitials(friendName)}
              </div>
            </div>
            <p className="text-white font-semibold truncate max-w-full">{friendName}</p>
            <p className="text-white/40 text-sm mt-1">Start a conversation</p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              {/* Date separator */}
              <div className="flex items-center justify-center my-4">
                <span className="px-3 py-1 rounded-full bg-white/[0.05] text-white/30 text-[10px] font-medium">
                  {new Date(date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>
              </div>

              {/* Messages for this date */}
              {msgs.map((msg, i) => {
                const isOwn = msg.from_id === currentUserId;
                const prevMsg = msgs[i - 1];
                const nextMsg = msgs[i + 1];

                // Show time if:
                // - First message
                // - Different sender than previous
                // - More than 5 minutes since previous
                const showTime = !prevMsg ||
                  prevMsg.from_id !== msg.from_id ||
                  new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000;

                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isOwn={isOwn}
                    showTime={showTime || !nextMsg || nextMsg.from_id !== msg.from_id}
                  />
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 px-3 py-2.5 border-t border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-xl"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-end gap-2">
          {/* Attachment button */}
          <button
            className="p-2 rounded-full bg-white/[0.05] text-white/40 hover:bg-white/[0.08] hover:text-white/60 transition-colors active:scale-95 flex-shrink-0"
            aria-label="Attach file"
          >
            <Paperclip size={18} />
          </button>

          {/* Text input */}
          <div className="flex-1 min-w-0 relative">
            <textarea
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-white placeholder-white/30 resize-none focus:outline-none focus:border-purple-500/50 transition-colors"
              style={{ maxHeight: '120px', fontSize: '16px' }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
            className={`p-2.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${
              newMessage.trim() && !isSending
                ? 'bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-500/25'
                : 'bg-white/[0.05] text-white/30'
            }`}
            aria-label="Send message"
          >
            {isSending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DirectMessageChat;
