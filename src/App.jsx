import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initDB,
  saveFact,
  getAllFacts,
  getTodayFacts,
  deleteFact,
  deleteAllFactsForDate,
  getFactCount
} from './db';
import { playNotificationSound, speakText } from './notifications';
import { initSpeechRecognition, startSpeechRecognition, stopSpeechRecognition } from './runanywhere-sdk';

const WORKER_PATH = new URL('./ai-worker.js', import.meta.url);

function App() {
  const [worker, setWorker] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initStatus, setInitStatus] = useState('initializing');
  const [initProgress, setInitProgress] = useState(0);
  const [initMessage, setInitMessage] = useState('Loading neural networks...');
  
  const [isListening, setIsListening] = useState(false);
  const [activeMode, setActiveMode] = useState('idle'); // 'idle', 'logging', 'assistant'
  const modeRef = useRef('idle'); // React state batching se bachne ke liye Ref
  
  const [vadLevel, setVadLevel] = useState(0);
  const [lastTranscription, setLastTranscription] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  
  const [factsByDate, setFactsByDate] = useState({});
  const [expandedDates, setExpandedDates] = useState({});
  const [totalFacts, setTotalFacts] = useState(0);
  
  const [toasts, setToasts] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const workerRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      await initDB();
      await loadFacts();
      initWorker();
    };
    init();
    
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const loadFacts = async () => {
    const facts = await getAllFacts();
    setFactsByDate(facts);
    
    const sortedDates = Object.keys(facts).sort((a, b) => b.localeCompare(a));
    const expanded = {};
    sortedDates.forEach(date => { expanded[date] = true; });
    setExpandedDates(expanded);
    
    const count = await getFactCount();
    setTotalFacts(count);
  };

  const initWorker = () => {
    const w = new Worker(WORKER_PATH, { type: 'module' });
    workerRef.current = w;
    setWorker(w);
    w.onmessage = handleWorkerMessage;
    w.postMessage({ type: 'INIT', payload: {} });
  };

  const handleWorkerMessage = useCallback(async (event) => {
    const { type, status, error, progress, text, fact, score, conflictWith, newFact, message, shouldSpeak } = event.data;

    switch (type) {
      case 'INIT_STATUS':
        setInitMessage(status === 'loading' ? event.data.message : '');
        break;
      case 'INIT_PROGRESS':
        setInitProgress(progress * 100);
        break;
      case 'INIT_COMPLETE':
        if (status === 'success') {
          setIsInitialized(true);
          setInitStatus('ready');
        } else setInitStatus('error');
        break;
      case 'TRANSCRIPTION_START':
        setStatusMessage('Listening...');
        break;
      case 'TRANSCRIPTION_COMPLETE':
      case 'TEXT_DETECTED':
        if (text) setLastTranscription(text);
        break;
      case 'ANALYSIS_START':
        setStatusMessage('Analyzing...');
        break;
      case 'FACT_EXTRACTED':
        setStatusMessage('Commitment detected!');
        playNotificationSound('success');
        try {
          await saveFact(fact, score);
          await loadFacts();
          addToast(`✓ Saved: ${fact.substring(0, 50)}...`, 'success');
        } catch (err) {
          addToast('Failed to save fact', 'error');
        }
        setTimeout(() => setStatusMessage(''), 2000);
        break;
      case 'FACT_REJECTED':
        setStatusMessage('');
        break;
      case 'CONFLICT_ALERT':
        playNotificationSound('conflict');
        addToast(`⚠ CONFLICT: "${newFact.substring(0, 30)}..." conflicts with "${conflictWith}"`, 'warning');
        break;
      case 'AI_RESPONSE':
        setChatMessages(prev => [...prev, {
          id: Date.now(),
          type: 'ai',
          message: message,
          timestamp: Date.now()
        }]);
        setStatusMessage('');
        if (shouldSpeak) speakText(message);
        break;
      case 'ERROR':
        console.error('[SENTINEL] Worker error:', error);
        setStatusMessage('');
        addToast(`Error: ${error}`, 'error');
        break;
    }
  }, []);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  // Naya startListening ab mode accept karega ('logging' ya 'assistant')
  const startListening = async (selectedMode) => {
    modeRef.current = selectedMode;
    setActiveMode(selectedMode);
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-IN';
        
        let finalTranscript = '';
        
        recognition.onresult = async (event) => {
          let interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
              setLastTranscription(finalTranscript.trim());
              
              if (finalTranscript.trim().length > 5) {
                // Pass current mode from ref
                await processUserInput(finalTranscript.trim(), modeRef.current);
              }
            } else {
              interimTranscript += transcript;
              setLastTranscription(interimTranscript);
            }
          }
        };
        
        recognition.onerror = (event) => {
          if (event.error !== 'no-speech') addToast(`Speech error: ${event.error}`, 'error');
        };
        
        recognition.onend = () => {
          if (modeRef.current !== 'idle') recognition.start();
        };
        
        recognition.start();
        mediaRecorderRef.current = { stop: () => recognition.stop() };
        setIsListening(true);
        setStatusMessage(selectedMode === 'logging' ? 'Listening to save task...' : 'Listening to your question...');
        return;
      } catch (error) {
        console.error('Speech API error:', error);
      }
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && typeof mediaRecorderRef.current.stop === 'function') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    modeRef.current = 'idle';
    setActiveMode('idle');
    setIsListening(false);
    setStatusMessage('');
  };

  // Magic Routing
  const processUserInput = async (text, currentMode) => {
    setStatusMessage('Processing...');
    const todayFacts = await getTodayFacts();
    const factsContent = todayFacts.map(f => ({ content: f.content, timestamp: f.timestamp }));      
    
    setChatMessages(prev => [...prev, {
      id: Date.now(),
      type: 'user',
      message: text,
      timestamp: Date.now()
    }]);
    
    // Check mode and route to worker
    if (currentMode === 'logging') {
      workerRef.current.postMessage({
        type: 'PROCESS_TEXT',
        payload: { text, todayFacts: factsContent }
      });
    } else if (currentMode === 'assistant') {
      workerRef.current.postMessage({
        type: 'ASSISTANT_CHAT',
        payload: { text, todayFacts: factsContent }
      });
    }
  };

  const toggleDate = (date) => setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  const handleDeleteFact = async (factId) => { await deleteFact(factId); await loadFacts(); addToast('Fact deleted', 'info'); };
  const handleDeleteDate = async (date) => {
    if (window.confirm(`Delete all facts for ${date}?`)) {
      await deleteAllFactsForDate(date); await loadFacts(); addToast(`Deleted all facts for ${date}`, 'info');
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === today.toISOString().split('T')[0]) return 'Today';
    if (dateStr === yesterday.toISOString().split('T')[0]) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const formatTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="sentinel-app">
      <header className="sentinel-header">
        <div className="logo-section">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="logo-text">
            <h1>SENTINEL</h1>
            <span className="subtitle">THE SECOND BRAIN</span>
          </div>
        </div>
        
        <div className="status-section">
          {!isInitialized ? (
            <div className="init-status">
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${initProgress}%` }}></div></div>
              <span className="init-message">{initMessage}</span>
            </div>
          ) : (
            <div className={`connection-status ${isInitialized ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              <span>{isInitialized ? 'NEURAL LINK ACTIVE' : 'OFFLINE'}</span>
            </div>
          )}
        </div>
        
        <div className="stats-section">
          <div className="stat">
            <span className="stat-value">{totalFacts}</span>
            <span className="stat-label">MEMORIES</span>
          </div>
        </div>
      </header>

      <main className="sentinel-main">
        <section className="control-panel">
          
          {/* THE NEW DUAL MIC UI */}
          <div className="dual-mic-container" style={{ display: 'flex', gap: '30px', justifyContent: 'center', margin: '30px 0' }}>
            
            {/* MIC 1: LOGGING (Red) */}
            <div className="mic-wrapper" style={{ textAlign: 'center' }}>
              <button 
                className={`listen-btn ${activeMode === 'logging' ? 'listening' : ''}`}
                onClick={() => activeMode === 'logging' ? stopListening() : startListening('logging')}
                disabled={!isInitialized || activeMode === 'assistant'}
                style={{ 
                  background: activeMode === 'logging' ? '#ff4757' : 'rgba(47, 53, 66, 0.8)',
                  border: '2px solid #ff4757',
                  boxShadow: activeMode === 'logging' ? '0 0 25px rgba(255, 71, 87, 0.6)' : 'none',
                  opacity: activeMode === 'assistant' ? 0.4 : 1
                }}
              >
                <span className="btn-content" style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
                  {activeMode === 'logging' ? '🛑 STOP' : '📝 LOG TASK'}
                </span>
              </button>
              <p style={{ fontSize: '13px', color: '#a4b0be', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>Silent Saving</p>
            </div>

            {/* MIC 2: ASSISTANT (Blue) */}
            <div className="mic-wrapper" style={{ textAlign: 'center' }}>
              <button 
                className={`listen-btn ${activeMode === 'assistant' ? 'listening' : ''}`}
                onClick={() => activeMode === 'assistant' ? stopListening() : startListening('assistant')}
                disabled={!isInitialized || activeMode === 'logging'}
                style={{ 
                  background: activeMode === 'assistant' ? '#1e90ff' : 'rgba(47, 53, 66, 0.8)',
                  border: '2px solid #1e90ff',
                  boxShadow: activeMode === 'assistant' ? '0 0 25px rgba(30, 144, 255, 0.6)' : 'none',
                  opacity: activeMode === 'logging' ? 0.4 : 1
                }}
              >
                <span className="btn-content" style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
                  {activeMode === 'assistant' ? '🛑 STOP' : '🤖 ASK AI'}
                </span>
              </button>
              <p style={{ fontSize: '13px', color: '#a4b0be', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>Voice Assistant</p>
            </div>

          </div>
          
          {statusMessage && (
            <div className="status-overlay" style={{ textAlign: 'center', marginBottom: '15px' }}>
              <span className="status-text" style={{ color: activeMode === 'logging' ? '#ff4757' : '#1e90ff', fontWeight: 'bold' }}>
                {statusMessage}
              </span>
            </div>
          )}
          
          {lastTranscription && (
            <div className="transcription-display">
              <div className="transcription-label">YOU SAID:</div>
              <p className="transcription-text">{lastTranscription}</p>
            </div>
          )}
          
          {chatMessages.length > 0 && (
            <div className="chat-container">
              {chatMessages.map(msg => (
                <div key={msg.id} className={`chat-message ${msg.type}`}>
                  <div className="chat-bubble" style={{ 
                    borderLeft: msg.type === 'ai' ? '3px solid #1e90ff' : 'none',
                    borderRight: msg.type === 'user' ? '3px solid #ff4757' : 'none' 
                  }}>
                    {msg.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="memory-vault">
          <div className="vault-header">
            <h2>MEMORY VAULT</h2>
            <div className="vault-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
          </div>
          
          <div className="vault-content">
            {Object.keys(factsByDate).length === 0 ? (
              <div className="empty-vault"><p>No commitments recorded</p><span>Activate the neural link to start capturing</span></div>
            ) : (
              Object.entries(factsByDate).sort((a, b) => b[0].localeCompare(a[0])).map(([date, facts]) => (
                <div key={date} className="date-folder">
                  <div className={`folder-header ${expandedDates[date] ? 'expanded' : ''}`} onClick={() => toggleDate(date)}>
                    <div className="folder-toggle"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
                    <span className="folder-date">{formatDate(date)}</span>
                    <span className="folder-count">{facts.length}</span>
                    <button className="folder-delete" onClick={(e) => { e.stopPropagation(); handleDeleteDate(date); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
                    </button>
                  </div>
                  {expandedDates[date] && (
                    <div className="folder-facts">
                      {facts.map(fact => (
                        <div key={fact.id} className="fact-item">
                          <div className="fact-time">{formatTime(fact.timestamp)}</div>
                          <div className="fact-content">{fact.content}</div>
                          <button className="fact-delete" onClick={() => handleDeleteFact(fact.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </main>

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}><span>{toast.message}</span></div>
        ))}
      </div>
      <div className="scanline"></div>
    </div>
  );
}

export default App;