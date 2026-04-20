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
      {/* Voice Assistant Overlay - Siri-like full screen experience */}
      {voiceAssistantMode && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-[#1a1a2e] via-[#16213e] to-[#0f0f23]">
          {/* Close button */}
          <button
            onClick={stopVoiceAssistant}
            className="absolute top-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"
            aria-label="Close voice assistant"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>

          {/* Animated orb */}
          <div className="relative mb-8">
            <div
              className={`h-40 w-40 rounded-full transition-all duration-500 ${
                assistantStatus === 'listening'
                  ? 'animate-pulse bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 shadow-[0_0_60px_rgba(168,85,247,0.5)]'
                  : assistantStatus === 'processing'
                  ? 'animate-spin bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 shadow-[0_0_60px_rgba(59,130,246,0.5)]'
                  : assistantStatus === 'speaking'
                  ? 'animate-bounce bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 shadow-[0_0_60px_rgba(34,197,94,0.5)]'
                  : 'bg-gradient-to-br from-slate-600 to-slate-700'
              }`}
            />
            {/* Inner glow */}
            <div className="absolute inset-4 rounded-full bg-white/20 backdrop-blur-sm" />
            {/* Icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-5xl text-white drop-shadow-lg">
                {assistantStatus === 'listening'
                  ? 'mic'
                  : assistantStatus === 'processing'
                  ? 'psychology'
                  : assistantStatus === 'speaking'
                  ? 'graphic_eq'
                  : 'assistant'}
              </span>
            </div>
          </div>

          {/* Status text */}
          <div className="mb-4 text-center">
            <h2 className="mb-2 text-2xl font-bold text-white">
              {assistantStatus === 'listening'
                ? 'Listening...'
                : assistantStatus === 'processing'
                ? 'Thinking...'
                : assistantStatus === 'speaking'
                ? 'Speaking...'
                : 'StockAI Assistant'}
            </h2>
            <p className="text-sm text-white/60">
              {assistantStatus === 'listening'
                ? 'Speak your question about the market'
                : assistantStatus === 'processing'
                ? 'Analyzing your question'
                : assistantStatus === 'speaking'
                ? 'Tap orb to interrupt'
                : 'Tap to start'}
            </p>
          </div>

          {/* Live transcript */}
          {interimTranscript && (
            <div className="mx-4 max-w-md rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-sm">
              <p className="text-center text-lg italic text-white/80">
                &quot;{interimTranscript}&quot;
              </p>
            </div>
          )}

          {/* Recent messages in voice mode */}
          {messages.length > 1 && (
            <div className="absolute bottom-24 left-4 right-4 max-h-32 overflow-y-auto rounded-2xl bg-black/30 p-4 backdrop-blur-sm">
              <div className="space-y-2">
                {messages.slice(-3).map((msg, idx) => (
                  <p
                    key={idx}
                    className={`text-sm ${
                      msg.role === 'user' ? 'text-purple-300' : 'text-white/80'
                    }`}
                  >
                    <span className="font-semibold">
                      {msg.role === 'user' ? 'You: ' : 'AI: '}
                    </span>
                    {msg.text.length > 100 ? msg.text.slice(0, 100) + '...' : msg.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Tap to interact hint */}
          <button
            onClick={() => {
              if (assistantStatus === 'speaking') {
                stopSpeaking();
              }
            }}
            className="absolute bottom-8 rounded-full bg-white/10 px-6 py-3 text-sm text-white/60 transition hover:bg-white/20"
          >
            {assistantStatus === 'speaking' ? 'Tap to stop speaking' : 'Say "Hey" to ask a question'}
          </button>
        </div>
      )}

      {open && !voiceAssistantMode && (
        <div className="fixed bottom-24 right-4 z-[95] w-[min(24rem,calc(100vw-2rem))] rounded-[1.75rem] border border-white/70 bg-white/95 shadow-2xl backdrop-blur-xl md:right-6">
          <div className="flex items-center justify-between rounded-t-[1.75rem] bg-[#111827] px-5 py-4 text-white">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black tracking-wide">StockAI</span>
                {speechSupported && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setVoiceEnabled(!voiceEnabled)}
                      className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                        voiceEnabled ? 'bg-green-500/30 text-green-400' : 'bg-white/10 text-slate-400'
                      }`}
                      aria-label={voiceEnabled ? 'Disable voice' : 'Enable voice'}
                      title={voiceEnabled ? 'Voice enabled' : 'Voice disabled'}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {voiceEnabled ? 'volume_up' : 'volume_off'}
                      </span>
                    </button>
                    {isSpeaking && (
                      <button
                        onClick={stopSpeaking}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/30 text-red-400 transition hover:bg-red-500/50"
                        aria-label="Stop speaking"
                        title="Stop speaking"
                      >
                        <span className="material-symbols-outlined text-sm">stop</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-300">
                {speechSupported ? 'Voice-enabled guidance' : 'Guidance for beginners'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Voice Assistant Mode Button */}
              {speechSupported && (
                <button
                  onClick={startVoiceAssistant}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white transition hover:scale-105"
                  aria-label="Start voice assistant"
                  title="Talk to AI Assistant"
                >
                  <span className="material-symbols-outlined text-lg">assistant</span>
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Close chatbot"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
          </div>

          <div data-lenis-prevent="true" className="max-h-96 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`group relative rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user'
                    ? 'ml-10 bg-[#5140c8] text-white'
                    : 'mr-6 bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200 transition'
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
                  <span className="absolute bottom-1 right-2 opacity-0 group-hover:opacity-60 transition text-xs text-slate-500">
                    <span className="material-symbols-outlined text-sm">volume_up</span>
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-6 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
                Thinking...
              </div>
            )}
            {isSpeaking && (
              <div className="mr-6 flex items-center gap-2 rounded-2xl bg-green-50 px-4 py-2 text-xs text-green-700">
                <span className="material-symbols-outlined animate-pulse text-sm">graphic_eq</span>
                Speaking... 
                <button 
                  onClick={stopSpeaking}
                  className="ml-auto text-green-600 hover:text-green-800 underline"
                >
                  Stop
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((item) => (
                <button
                  key={item}
                  onClick={() => askChatbot(item)}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                data-lenis-prevent="true"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder={isListening ? 'Listening...' : 'Ask about the market or a stock...'}
                className={`min-h-[56px] flex-1 resize-none rounded-2xl border px-4 py-3 text-sm text-[#1c1c1e] outline-none transition ${
                  isListening 
                    ? 'border-red-400 bg-red-50' 
                    : 'border-slate-200 focus:border-[#5140c8]'
                }`}
              />
              {speechSupported && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  disabled={loading}
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isListening
                      ? 'animate-pulse bg-red-500 text-white'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                  aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                  title={isListening ? 'Stop listening' : 'Speak your question'}
                >
                  <span className="material-symbols-outlined">
                    {isListening ? 'mic_off' : 'mic'}
                  </span>
                </button>
              )}
              <button
                onClick={() => askChatbot(question)}
                disabled={loading || !question.trim()}
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5140c8] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send question"
              >
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating action buttons */}
      <div className="fixed bottom-4 right-4 z-[96] flex flex-col gap-3 md:bottom-6 md:right-6">
        {/* Voice Assistant Button - Siri-like */}
        {speechSupported && !voiceAssistantMode && (
          <button
            onClick={startVoiceAssistant}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 text-white shadow-2xl transition hover:scale-105 hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]"
            aria-label="Start voice assistant"
            title="Talk to AI Assistant"
          >
            <span className="material-symbols-outlined text-2xl">assistant</span>
          </button>
        )}
        
        {/* Chat Button */}
        <button
          onClick={() => setOpen((current) => !current)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#5140c8] text-white shadow-2xl transition hover:scale-105"
          aria-label="Open market chatbot"
        >
          <span className="material-symbols-outlined text-3xl">forum</span>
        </button>
      </div>
    </>
  );
}
