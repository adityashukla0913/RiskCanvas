"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { generateMarketChatReply } from '../services/gemini';
import { STOCK_LIST } from '../services/stockData';

const QUICK_QUESTIONS = [
  'What does the market mood look like right now?',
  'Is it smarter to average in slowly or wait?',
  'What should I watch before buying a tech stock?',
];

function buildMarketSnapshot() {
  const featured = STOCK_LIST.slice(0, 5)
    .map((stock) => stock.symbol.replace('.NS', '').replace('%26', '&'))
    .join(', ');

  return `Featured symbols in this app: ${featured}. Fear and Greed is around the low 60s, which suggests investors are leaning optimistic but not euphoric.`;
}

export default function FloatingChatbot() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Ask about market mood, stocks in the simulator, or what a beginner should watch before buying.',
    },
  ]);

  // Voice Assistant State
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceAssistantMode, setVoiceAssistantMode] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('idle'); // idle, listening, processing, speaking
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const voiceAssistantModeRef = useRef(false);
  const isProcessingRef = useRef(false);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    voiceAssistantModeRef.current = voiceAssistantMode;
  }, [voiceAssistantMode]);

  // Initialize speech recognition and synthesis
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check for speech recognition support
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';
      }

      // Check for speech synthesis support
      if (window.speechSynthesis) {
        synthRef.current = window.speechSynthesis;
      }
    }

    return () => {
      // Cleanup
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Text-to-Speech function
  const speakText = useCallback((text, onComplete) => {
    if (!synthRef.current || !voiceEnabled) {
      onComplete?.();
      return;
    }

    // Cancel any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    // Try to use a natural-sounding voice
    const voices = synthRef.current.getVoices();
    const preferredVoice = voices.find(
      (voice) =>
        voice.name.includes('Google') ||
        voice.name.includes('Samantha') ||
        voice.name.includes('Microsoft') ||
        voice.lang.startsWith('en')
    );
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setAssistantStatus('speaking');
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setAssistantStatus('idle');
      onComplete?.();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setAssistantStatus('idle');
      onComplete?.();
    };

    synthRef.current.speak(utterance);
  }, [voiceEnabled]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
      if (voiceAssistantModeRef.current) {
        setAssistantStatus('listening');
      } else {
        setAssistantStatus('idle');
      }
    }
  }, []);

  // Start voice recognition
  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;

    // Stop any ongoing speech when starting to listen
    stopSpeaking();

    recognitionRef.current.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setQuestion(transcript);
      setIsListening(false);
    };

    recognitionRef.current.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognitionRef.current.onend = () => {
      setIsListening(false);
    };

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      setIsListening(false);
    }
  }, [isListening, stopSpeaking]);

  // Stop voice recognition
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [isListening]);

  const marketSnapshot = useMemo(() => buildMarketSnapshot(), []);

  // Process voice input for assistant mode
  const processVoiceInput = useCallback(async (transcript) => {
    if (!transcript.trim() || isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    setAssistantStatus('processing');
    setInterimTranscript('');
    
    setMessages((current) => [...current, { role: 'user', text: transcript }]);
    setLoading(true);

    try {
      const reply = await generateMarketChatReply({
        question: transcript,
        marketSnapshot,
      });

      setMessages((current) => [...current, { role: 'assistant', text: reply }]);
      
      // Speak the response and then resume listening
      speakText(reply, () => {
        isProcessingRef.current = false;
        if (voiceAssistantModeRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setAssistantStatus('listening');
          } catch (e) {
            // Recognition might already be running
          }
        }
      });
    } catch {
      const errorMessage = 'I could not reach the AI service. Please try again.';
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: errorMessage },
      ]);
      
      speakText(errorMessage, () => {
        isProcessingRef.current = false;
        if (voiceAssistantModeRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setAssistantStatus('listening');
          } catch (e) {
            // Recognition might already be running
          }
        }
      });
    }

    setLoading(false);
  }, [marketSnapshot, speakText]);

  // Start voice assistant mode (Siri-like)
  const startVoiceAssistant = useCallback(() => {
    if (!recognitionRef.current || !speechSupported) return;

    stopSpeaking();
    setVoiceAssistantMode(true);
    setAssistantStatus('listening');
    setOpen(true);
    
    // Configure for voice assistant mode
    recognitionRef.current.onresult = (event) => {
      let interim = '';
      let final = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      
      setInterimTranscript(interim);
      
      if (final) {
        processVoiceInput(final);
      }
    };

    recognitionRef.current.onerror = (event) => {
      console.error('Voice assistant error:', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setAssistantStatus('idle');
      }
    };

    recognitionRef.current.onend = () => {
      // Auto-restart if still in voice assistant mode and not processing
      if (voiceAssistantModeRef.current && !isProcessingRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          // Might already be running
        }
      }
    };

    try {
      recognitionRef.current.start();
      // Greeting
      speakText("Hi! I'm your StockAI assistant. How can I help you with the market today?");
    } catch (error) {
      console.error('Failed to start voice assistant:', error);
      setVoiceAssistantMode(false);
      setAssistantStatus('idle');
    }
  }, [speechSupported, stopSpeaking, processVoiceInput, speakText]);

  // Stop voice assistant mode
  const stopVoiceAssistant = useCallback(() => {
    setVoiceAssistantMode(false);
    setAssistantStatus('idle');
    setInterimTranscript('');
    isProcessingRef.current = false;
    
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
    setIsListening(false);
  }, []);

  async function askChatbot(nextQuestion) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) {
      return;
    }

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setQuestion('');
    setLoading(true);

    try {
      const reply = await generateMarketChatReply({
        question: trimmed,
        marketSnapshot,
      });

      setMessages((current) => [...current, { role: 'assistant', text: reply }]);
      
      // Speak the response if voice is enabled
      if (voiceEnabled) {
        speakText(reply);
      }
    } catch {
      const errorMessage = 'I could not reach the AI service just now. Please try again in a moment.';
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: errorMessage,
        },
      ]);
      
      if (voiceEnabled) {
        speakText(errorMessage);
      }
    }

    setLoading(false);
  }

  return (
    <>
      {/* Voice Assistant Overlay - Premium Siri-like full screen experience */}
      {voiceAssistantMode && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden">
          {/* Animated background */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
            {/* Floating orbs background effect */}
            <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl animate-pulse delay-1000" />
            <div className="absolute top-1/2 right-1/3 h-64 w-64 rounded-full bg-pink-500/15 blur-3xl animate-pulse delay-500" />
          </div>

          {/* Header */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5 z-10">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                <span className="material-symbols-outlined text-xl text-white">assistant</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">StockAI</h1>
                <p className="text-xs text-white/50">Voice Assistant</p>
              </div>
            </div>
            <button
              onClick={stopVoiceAssistant}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition hover:bg-white/20"
              aria-label="Close voice assistant"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          {/* Main content area */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Animated orb with multiple layers */}
            <div className="relative mb-10">
              {/* Outer glow ring */}
              <div
                className={`absolute -inset-8 rounded-full transition-all duration-700 ${
                  assistantStatus === 'listening'
                    ? 'bg-gradient-to-br from-purple-500/30 via-pink-500/30 to-red-500/30 animate-pulse blur-xl'
                    : assistantStatus === 'processing'
                    ? 'bg-gradient-to-br from-blue-500/30 via-cyan-500/30 to-teal-500/30 animate-spin blur-xl'
                    : assistantStatus === 'speaking'
                    ? 'bg-gradient-to-br from-emerald-500/30 via-green-500/30 to-teal-500/30 animate-pulse blur-xl'
                    : 'bg-slate-500/20 blur-xl'
                }`}
              />
              
              {/* Middle ring */}
              <div
                className={`absolute -inset-4 rounded-full transition-all duration-500 ${
                  assistantStatus === 'listening'
                    ? 'bg-gradient-to-br from-purple-400/40 to-pink-400/40'
                    : assistantStatus === 'processing'
                    ? 'bg-gradient-to-br from-blue-400/40 to-cyan-400/40 animate-spin'
                    : assistantStatus === 'speaking'
                    ? 'bg-gradient-to-br from-emerald-400/40 to-green-400/40'
                    : 'bg-slate-600/30'
                }`}
              />
              
              {/* Main orb */}
              <div
                className={`relative h-36 w-36 rounded-full transition-all duration-500 flex items-center justify-center ${
                  assistantStatus === 'listening'
                    ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 shadow-[0_0_80px_rgba(168,85,247,0.6)]'
                    : assistantStatus === 'processing'
                    ? 'bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 shadow-[0_0_80px_rgba(59,130,246,0.6)]'
                    : assistantStatus === 'speaking'
                    ? 'bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500 shadow-[0_0_80px_rgba(34,197,94,0.6)]'
                    : 'bg-gradient-to-br from-slate-600 to-slate-700 shadow-[0_0_40px_rgba(100,116,139,0.3)]'
                }`}
              >
                {/* Inner highlight */}
                <div className="absolute inset-3 rounded-full bg-white/20 backdrop-blur-sm" />
                
                {/* Icon */}
                <span className="material-symbols-outlined text-5xl text-white drop-shadow-lg relative z-10">
                  {assistantStatus === 'listening'
                    ? 'mic'
                    : assistantStatus === 'processing'
                    ? 'psychology'
                    : assistantStatus === 'speaking'
                    ? 'graphic_eq'
                    : 'assistant'}
                </span>
              </div>
              
              {/* Sound wave animation for listening */}
              {assistantStatus === 'listening' && (
                <div className="absolute -inset-12 flex items-center justify-center">
                  <div className="flex items-end gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-white/40 rounded-full animate-pulse"
                        style={{
                          height: `${20 + Math.random() * 30}px`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Status text */}
            <div className="text-center mb-6">
              <h2 className="mb-2 text-2xl font-semibold text-white tracking-tight">
                {assistantStatus === 'listening'
                  ? 'Listening...'
                  : assistantStatus === 'processing'
                  ? 'Thinking...'
                  : assistantStatus === 'speaking'
                  ? 'Speaking...'
                  : 'Ready'}
              </h2>
              <p className="text-sm text-white/50 max-w-xs">
                {assistantStatus === 'listening'
                  ? 'Ask me anything about stocks and the market'
                  : assistantStatus === 'processing'
                  ? 'Analyzing your question...'
                  : assistantStatus === 'speaking'
                  ? 'Tap the orb to interrupt'
                  : 'Tap the orb to start speaking'}
              </p>
            </div>

            {/* Live transcript */}
            {interimTranscript && (
              <div className="mx-4 max-w-md rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-md border border-white/10">
                <p className="text-center text-base text-white/90">
                  &quot;{interimTranscript}&quot;
                </p>
              </div>
            )}
          </div>

          {/* Recent messages panel */}
          {messages.length > 1 && (
            <div className="absolute bottom-28 left-4 right-4 z-10 max-w-lg mx-auto">
              <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4 max-h-36 overflow-y-auto">
                <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Recent</p>
                <div className="space-y-2">
                  {messages.slice(-2).map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 text-sm ${
                        msg.role === 'user' ? 'text-purple-300' : 'text-white/80'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-sm mt-0.5 ${
                        msg.role === 'user' ? 'text-purple-400' : 'text-emerald-400'
                      }`}>
                        {msg.role === 'user' ? 'person' : 'assistant'}
                      </span>
                      <p className="flex-1">
                        {msg.text.length > 120 ? msg.text.slice(0, 120) + '...' : msg.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bottom action button */}
          <div className="absolute bottom-6 left-0 right-0 flex justify-center z-10">
            <button
              onClick={() => {
                if (assistantStatus === 'speaking') {
                  stopSpeaking();
                }
              }}
              className="flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-6 py-3 text-sm text-white/70 transition hover:bg-white/20 border border-white/10"
            >
              <span className="material-symbols-outlined text-lg">
                {assistantStatus === 'speaking' ? 'stop_circle' : 'tips_and_updates'}
              </span>
              {assistantStatus === 'speaking' ? 'Tap to stop' : 'Just start speaking'}
            </button>
          </div>
        </div>
      )}

      {open && !voiceAssistantMode && (
        <div className="fixed bottom-[88px] right-4 z-[95] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white shadow-2xl md:right-6">
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                <span className="material-symbols-outlined text-lg">assistant</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">StockAI</span>
                  {speechSupported && (
                    <button
                      onClick={() => setVoiceEnabled(!voiceEnabled)}
                      className={`flex h-5 w-5 items-center justify-center rounded-full transition ${
                        voiceEnabled ? 'bg-emerald-500/30 text-emerald-400' : 'bg-white/10 text-slate-400'
                      }`}
                      aria-label={voiceEnabled ? 'Disable voice' : 'Enable voice'}
                      title={voiceEnabled ? 'Voice enabled' : 'Voice disabled'}
                    >
                      <span className="material-symbols-outlined text-xs">
                        {voiceEnabled ? 'volume_up' : 'volume_off'}
                      </span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400">Market guidance assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSpeaking && (
                <button
                  onClick={stopSpeaking}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition hover:bg-red-500/30"
                  aria-label="Stop speaking"
                  title="Stop speaking"
                >
                  <span className="material-symbols-outlined text-sm">stop</span>
                </button>
              )}
              {/* Voice Assistant Mode Button */}
              {speechSupported && (
                <button
                  onClick={startVoiceAssistant}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white transition hover:scale-105"
                  aria-label="Start voice assistant"
                  title="Talk to AI Assistant"
                >
                  <span className="material-symbols-outlined text-sm">mic</span>
                </button>
              )}
            </div>
          </div>

          <div data-lenis-prevent="true" className="max-h-80 space-y-3 overflow-y-auto px-4 py-4 bg-slate-50">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`group relative flex items-start gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                {/* Avatar */}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  message.role === 'user' 
                    ? 'bg-indigo-500 text-white' 
                    : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                }`}>
                  <span className="material-symbols-outlined text-sm">
                    {message.role === 'user' ? 'person' : 'assistant'}
                  </span>
                </div>
                
                {/* Message bubble */}
                <div
                  className={`relative max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-indigo-500 text-white rounded-tr-sm'
                      : 'bg-white text-slate-700 shadow-sm border border-slate-100 rounded-tl-sm cursor-pointer hover:bg-slate-50 transition'
                  }`}
                  onClick={() => {
                    if (message.role === 'assistant' && speechSupported && voiceEnabled) {
                      speakText(message.text);
                    }
                  }}
                  title={message.role === 'assistant' && speechSupported ? 'Click to hear this message' : undefined}
                >
                  {message.text}
                  {message.role === 'assistant' && speechSupported && (
                    <span className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                      <span className="material-symbols-outlined text-xs">volume_up</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
            
            {loading && (
              <div className="flex items-start gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                  <span className="material-symbols-outlined text-sm">assistant</span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-slate-500 shadow-sm border border-slate-100">
                  <span className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                  Thinking...
                </div>
              </div>
            )}
            
            {isSpeaking && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-100">
                <span className="material-symbols-outlined animate-pulse text-sm">graphic_eq</span>
                Speaking... 
                <button 
                  onClick={stopSpeaking}
                  className="ml-auto text-emerald-600 hover:text-emerald-800 font-medium"
                >
                  Stop
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3 rounded-b-2xl">
            {/* Quick questions */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.map((item) => (
                <button
                  key={item}
                  onClick={() => askChatbot(item)}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-indigo-100 hover:text-indigo-700"
                >
                  {item.length > 35 ? item.slice(0, 35) + '...' : item}
                </button>
              ))}
            </div>

            {/* Input area */}
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <textarea
                  data-lenis-prevent="true"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      askChatbot(question);
                    }
                  }}
                  rows={1}
                  placeholder={isListening ? 'Listening...' : 'Ask about the market...'}
                  className={`w-full resize-none rounded-xl border py-2.5 pl-4 pr-10 text-sm text-slate-800 outline-none transition ${
                    isListening 
                      ? 'border-red-300 bg-red-50' 
                      : 'border-slate-200 bg-slate-50 focus:border-indigo-400 focus:bg-white'
                  }`}
                />
                {/* Inline mic button */}
                {speechSupported && (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={loading}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-50 ${
                      isListening
                        ? 'animate-pulse bg-red-500 text-white'
                        : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                    }`}
                    aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                    title={isListening ? 'Stop listening' : 'Speak your question'}
                  >
                    <span className="material-symbols-outlined text-lg">
                      {isListening ? 'mic_off' : 'mic'}
                    </span>
                  </button>
                )}
              </div>
              
              {/* Send button */}
              <button
                onClick={() => askChatbot(question)}
                disabled={loading || !question.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send question"
              >
                <span className="material-symbols-outlined text-lg">send</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating action buttons - horizontal layout to avoid overlap */}
      {!voiceAssistantMode && (
        <div className="fixed bottom-4 right-4 z-[96] flex items-center gap-3 md:bottom-6 md:right-6">
          {/* Voice Assistant Button - Siri-like */}
          {speechSupported && (
            <button
              onClick={startVoiceAssistant}
              className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)]"
              aria-label="Start voice assistant"
              title="Talk to AI Assistant"
            >
              <span className="material-symbols-outlined text-2xl">assistant</span>
              {/* Pulse ring animation */}
              <span className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 opacity-40 animate-ping" />
            </button>
          )}
          
          {/* Chat Button */}
          <button
            onClick={() => setOpen((current) => !current)}
            className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 ${
              open 
                ? 'bg-slate-700 text-white' 
                : 'bg-[#5140c8] text-white hover:bg-[#4030b0]'
            }`}
            aria-label={open ? "Close chatbot" : "Open market chatbot"}
          >
            <span className="material-symbols-outlined text-2xl">
              {open ? 'close' : 'forum'}
            </span>
          </button>
        </div>
      )}
    </>
  );
}
