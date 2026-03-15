/**
 * Main Renderer Process
 */
import { addLog } from './utils/logger.js';
import { initSidebar, setSessionActive, setSessionLoading, resetSessionUI, getActiveSessionId } from './ui/sidebar.js';

import { initOnboarding } from './ui/onboarding.js';
import { initPermissionsFlow } from './ui/permissions.js';
// import { initHistoryLogic } from './src/ui/history.js'; // Moved to history.html

// Global Event Handler
// Prevent duplicate registration on reload
if (!window.hasRegisteredRecorderEvents) {
  window.hasRegisteredRecorderEvents = true;

  window.recorderAPI.onRecorderEvent((eventData) => {
    const { event, data } = eventData;
    console.log('[Recorder Event]', event, data);

    switch (event) {

      case 'recording:started':
        addLog(`Recording started: ${data.sessionId}`, 'success');
        setSessionActive(data.sessionId);
        window.recorderAPI.notifyRecordingState(true);
        window.recorderAPI.showNotification('Recording Started', 'Screen and audio capture is active.');
        break;
      case 'recording:stopped':
        addLog(`Recording stopped: ${data.sessionId}`, 'info');
        resetSessionUI();
        window.recorderAPI.notifyRecordingState(false);
        window.recorderAPI.showNotification('Recording Stopped', 'Your recording is being processed.');
        break;
      case 'recording:error':
        addLog(`Recording error: ${data.error || data.message || 'Unknown error'}`, 'error');
        resetSessionUI();
        window.recorderAPI.notifyRecordingState(false);
        break;
      case 'upload:progress':
        console.log(`Upload progress: ${data.channelId} - ${Math.round((data.progress || 0) * 100)}%`);
        break;
      case 'upload:complete':
        addLog(`Upload complete`, 'success');
        window.recorderAPI.showNotification('Upload Complete', 'Your recording is ready to view.');
        break;
      case 'shortcut:toggle-recording': {
        const sessionId = getActiveSessionId();
        if (sessionId) {
          window.recorderAPI.stopSession(sessionId).then(() => resetSessionUI());
        } else {
          startSessionFlow();
        }
        break;
      }
      case 'error':
        addLog(`Error: ${data.message || 'Unknown error'}`, 'error');
        break;
      default:
        break;
    }
  });
}

async function startSessionFlow() {
  // Generate Session ID
  const sessionId = 'session-' + Date.now();

  addLog('Starting recording...', 'info');
  setSessionLoading();

  try {
    const result = await window.recorderAPI.startSession(sessionId);

    if (!result.success) {
      addLog(`Failed to start: ${result.error}`, 'error');
      resetSessionUI();
    }
  } catch (error) {
    addLog(`Start error: ${error.message}`, 'error');
    resetSessionUI();
  }
}

// Initialization
(async () => {
  try {
    addLog('🚀 App initializing...');

    // Init Modules


    // History is now separate window
    // initHistoryLogic();

    // 1. Check Permissions (Blocking)
    console.log('Checking permissions...');
    await initPermissionsFlow();
    console.log('Permissions check done.');

    // 2. Check onboarding status
    console.log('Checking onboarding...');
    await initOnboarding();
    console.log('Onboarding check done.');

    // Init Sidebar (replaces config/recording screens)
    console.log('Initializing sidebar...');
    await initSidebar(startSessionFlow);

    addLog('Ready');
    console.log('Initialization complete.');
  } catch (error) {
    console.error('Initialization failed:', error);
    addLog(`❌ Init Error: ${error.message}`, 'error');
  }
})();
