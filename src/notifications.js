let audioContext = null;

export const playNotificationSound = (type = 'success') => {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'success') {
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } else if (type === 'warning') {
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(330, audioContext.currentTime + 0.15);
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.4);
    } else if (type === 'conflict') {
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.2);
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }
  } catch (error) {
    console.warn('[SENTINEL] Audio notification failed:', error);
  }
};

export const playVADBeep = () => {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(2000, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.02, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.05);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.05);
  } catch (error) {
    console.warn('[SENTINEL] VAD beep failed:', error);
  }
};

// --- THE HUMAN VOICE ENGINE ---
export const speakText = (text) => {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      console.warn('[SENTINEL] TTS not supported');
      resolve();
      return;
    }
    
    window.speechSynthesis.cancel(); // Purani aawaz band karo
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Natural human jaisi speed aur pitch
    utterance.rate = 0.95; 
    utterance.pitch = 1.05; // Thoda sa soft tone ke liye
    utterance.volume = 1.0;
    
    const setVoiceAndSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      
      // HACKATHON PRO-TIP: Specifically best human voices ko target karo
      const bestVoice = 
        voices.find(v => v.name === 'Google हिन्दी') || // Best for Hinglish
        voices.find(v => v.name === 'Microsoft Heera - English (India)') || // Windows ki best Indian voice
        voices.find(v => v.name.includes('Google') && v.lang.includes('en-IN')) || 
        voices.find(v => v.name === 'Google UK English Female') || // Premium fallback
        voices.find(v => v.lang.includes('hi')) || 
        voices.find(v => v.lang.includes('en-IN')) || 
        voices[0]; // Absolute fallback
        
      if (bestVoice) {
        utterance.voice = bestVoice;
        utterance.lang = bestVoice.lang;
      }
      
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        console.warn('[SENTINEL] TTS error:', e);
        resolve();
      };
      
      window.speechSynthesis.speak(utterance);
    };

    // Browsers aawaz load karne me time lete hain, isliye ye check lagana zaroori hai
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = setVoiceAndSpeak;
    } else {
      setVoiceAndSpeak();
    }
  });
};

export const isSpeaking = () => {
  return window.speechSynthesis?.speaking || false;
};

export const stopSpeaking = () => {
  window.speechSynthesis?.cancel();
};